//! fflate 0.8.3 `deflateSync(data, { level: 1 })`, the raw DEFLATE the web
//! game's writers put inside a `.vctower` (`packSync`, `toTowerFile`,
//! `SaveGame.export`), ported line for line so the engine writes the same
//! bits. A DEFLATE stream has many valid encodings and any inflater reads all
//! of them; this port exists only so a file the engine writes equals, byte
//! for byte, the file the web game writes for the same save.
//!
//! The names follow `node_modules/fflate/esm/browser.js` (`dflt`, `wblk`,
//! `hTree`, `lc`, `hMap`, `wfblk`), and so does the arithmetic, JavaScript
//! quirks included: typed-array stores truncate, a write past the end of the
//! output is dropped, and shift counts wrap at 32. Change this only together
//! with the fflate version in package-lock.json, and keep the vectors in the
//! tests below in step with what that fflate writes.

use std::sync::OnceLock;

/// `fleb`: extra bits per length code.
const FLEB: [u8; 32] = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0, 0, 0, 0,
];
/// `fdeb`: extra bits per distance code.
const FDEB: [u8; 32] = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13,
    13, 0, 0,
];
/// `clim`: the order code length code lengths are written in.
const CLIM: [u8; 19] = [
    16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
];

/// `deo[0]` for level 1: `(nice << 13) | chain`.
const DEO_LEVEL1: i32 = 65540;

struct Tables {
    revfl: Vec<i32>,
    revfd: Vec<i32>,
    rev: Vec<u16>,
    flt: Vec<u8>,
    fdt: Vec<u8>,
    flm: Vec<u16>,
    fdm: Vec<u16>,
}

/// `freb(eb, start)`: the reverse index (value to `(extra << 5) | code`).
fn freb(eb: &[u8; 32], mut start: u32) -> Vec<i32> {
    let mut b = [0u16; 31];
    for (i, slot) in b.iter_mut().enumerate() {
        // `eb[i - 1]` is undefined for i = 0, and `1 << undefined` is 1.
        let shift = if i == 0 { 0 } else { eb[i - 1] };
        start += 1 << shift;
        *slot = start as u16;
    }
    let mut r = vec![0i32; b[30] as usize];
    for i in 1..30 {
        for j in b[i]..b[i + 1] {
            r[j as usize] = (((j - b[i]) as i32) << 5) | i as i32;
        }
    }
    r
}

fn tables() -> &'static Tables {
    static T: OnceLock<Tables> = OnceLock::new();
    T.get_or_init(|| {
        let mut revfl = freb(&FLEB, 2);
        revfl[258] = 28;
        let revfd = freb(&FDEB, 0);
        let rev: Vec<u16> = (0..32768u32)
            .map(|i| {
                let mut x = ((i & 0xAAAA) >> 1) | ((i & 0x5555) << 1);
                x = ((x & 0xCCCC) >> 2) | ((x & 0x3333) << 2);
                x = ((x & 0xF0F0) >> 4) | ((x & 0x0F0F) << 4);
                ((((x & 0xFF00) >> 8) | ((x & 0x00FF) << 8)) >> 1) as u16
            })
            .collect();
        let mut flt = vec![0u8; 288];
        for (i, l) in flt.iter_mut().enumerate() {
            *l = match i {
                0..=143 => 8,
                144..=255 => 9,
                256..=279 => 7,
                _ => 8,
            };
        }
        let fdt = vec![5u8; 32];
        let flm = h_map(&rev, &flt, 9);
        let fdm = h_map(&rev, &fdt, 5);
        Tables {
            revfl,
            revfd,
            rev,
            flt,
            fdt,
            flm,
            fdm,
        }
    })
}

/// `hMap(cd, mb, 0)`: the (bit-reversed) code for each symbol.
fn h_map(rev: &[u16], cd: &[u8], mb: usize) -> Vec<u16> {
    let mut l = vec![0u16; mb];
    for &c in cd {
        if c != 0 {
            if let Some(n) = l.get_mut(c as usize - 1) {
                *n = n.wrapping_add(1);
            }
        }
    }
    let mut le = vec![0u16; mb];
    for i in 1..mb {
        le[i] = ((le[i - 1] as u32 + l[i - 1] as u32) << 1) as u16;
    }
    let mut co = vec![0u16; cd.len()];
    for (i, &c) in cd.iter().enumerate() {
        if c != 0 {
            if let Some(start) = le.get_mut(c as usize - 1) {
                let r = rev.get(*start as usize).copied().unwrap_or(0);
                co[i] = r >> (15 - c as u32);
                *start = start.wrapping_add(1);
            }
        }
    }
    co
}

/// `wbits`: OR `v` into the output at bit `p`, two bytes at most.
fn wbits(d: &mut [u8], p: usize, v: i32) {
    let v = v.wrapping_shl((p & 7) as u32);
    let o = p / 8;
    if let Some(b) = d.get_mut(o) {
        *b |= v as u8;
    }
    if let Some(b) = d.get_mut(o + 1) {
        *b |= (v >> 8) as u8;
    }
}

/// `wbits16`: the same, three bytes at most.
fn wbits16(d: &mut [u8], p: usize, v: i32) {
    let v = v.wrapping_shl((p & 7) as u32);
    let o = p / 8;
    if let Some(b) = d.get_mut(o) {
        *b |= v as u8;
    }
    if let Some(b) = d.get_mut(o + 1) {
        *b |= (v >> 8) as u8;
    }
    if let Some(b) = d.get_mut(o + 2) {
        *b |= (v >> 16) as u8;
    }
}

/// `shft`: the byte after bit `p`.
fn shft(p: usize) -> usize {
    p.div_ceil(8)
}

struct Node {
    s: i32,
    f: u32,
    l: usize,
    r: usize,
}

/// `ln`: depth of every leaf under `n`, and the deepest.
fn ln(nodes: &[Node], n: usize, tr: &mut [u16], d: u32) -> u32 {
    let node = &nodes[n];
    if node.s == -1 {
        let (l, r) = (node.l, node.r);
        ln(nodes, l, tr, d + 1).max(ln(nodes, r, tr, d + 1))
    } else {
        tr[node.s as usize] = d as u16;
        d
    }
}

/// `hTree(d, mb)`: code lengths from frequencies, at most `mb` bits.
fn h_tree(d: &[u16], mb: u32) -> (Vec<u8>, u32) {
    let mut nodes: Vec<Node> = Vec::new();
    let mut t: Vec<usize> = Vec::new();
    for (i, &f) in d.iter().enumerate() {
        if f != 0 {
            nodes.push(Node {
                s: i as i32,
                f: f as u32,
                l: 0,
                r: 0,
            });
            t.push(nodes.len() - 1);
        }
    }
    let s = t.len();
    let mut t2 = t.clone();
    if s == 0 {
        return (Vec::new(), 0);
    }
    if s == 1 {
        let sym = nodes[t[0]].s as usize;
        let mut v = vec![0u8; sym + 1];
        v[sym] = 1;
        return (v, 1);
    }
    // Array.prototype.sort is stable, as is sort_by.
    t.sort_by(|&a, &b| nodes[a].f.cmp(&nodes[b].f));
    nodes.push(Node {
        s: -1,
        f: 25001,
        l: 0,
        r: 0,
    });
    t.push(nodes.len() - 1);
    let (mut i0, mut i1, mut i2) = (0usize, 1usize, 2usize);
    let (l, r) = (t[0], t[1]);
    nodes.push(Node {
        s: -1,
        f: nodes[l].f + nodes[r].f,
        l,
        r,
    });
    t[0] = nodes.len() - 1;
    while i1 != s - 1 {
        let pick = if nodes[t[i0]].f < nodes[t[i2]].f {
            i0 += 1;
            i0 - 1
        } else {
            i2 += 1;
            i2 - 1
        };
        let l = t[pick];
        let pick = if i0 != i1 && nodes[t[i0]].f < nodes[t[i2]].f {
            i0 += 1;
            i0 - 1
        } else {
            i2 += 1;
            i2 - 1
        };
        let r = t[pick];
        nodes.push(Node {
            s: -1,
            f: nodes[l].f + nodes[r].f,
            l,
            r,
        });
        t[i1] = nodes.len() - 1;
        i1 += 1;
    }
    let max_sym = t2.iter().map(|&n| nodes[n].s).max().unwrap_or(0) as usize;
    let mut tr = vec![0u16; max_sym + 1];
    let mut mbt = ln(&nodes, t[i1 - 1], &mut tr, 0);
    if mbt > mb {
        let mut i = 0usize;
        let mut dt: i32 = 0;
        let lft = mbt - mb;
        let cst = 1i32.wrapping_shl(lft);
        t2.sort_by(|&a, &b| {
            let (sa, sb) = (nodes[a].s as usize, nodes[b].s as usize);
            tr[sb].cmp(&tr[sa]).then(nodes[a].f.cmp(&nodes[b].f))
        });
        while i < s {
            let sym = nodes[t2[i]].s as usize;
            if tr[sym] as u32 > mb {
                dt += cst - 1i32.wrapping_shl(mbt - tr[sym] as u32);
                tr[sym] = mb as u16;
            } else {
                break;
            }
            i += 1;
        }
        dt = dt.wrapping_shr(lft);
        while dt > 0 {
            let sym = nodes[t2[i]].s as usize;
            if (tr[sym] as u32) < mb {
                dt -= 1i32.wrapping_shl(mb - tr[sym] as u32 - 1);
                tr[sym] += 1;
            } else {
                i += 1;
            }
        }
        let mut j = i as isize;
        while j >= 0 && dt != 0 {
            let sym = nodes[t2[j as usize]].s as usize;
            if tr[sym] as u32 == mb {
                tr[sym] -= 1;
                dt += 1;
            }
            j -= 1;
        }
        mbt = mb;
    }
    (tr.iter().map(|&x| x as u8).collect(), mbt)
}

/// `lc(c)`: the code length codes for a tree, and how many lengths it sends.
fn lc(c: &[u8]) -> (Vec<u16>, usize) {
    let mut s = c.len();
    while s != 0 {
        s -= 1;
        if c[s] != 0 {
            break;
        }
    }
    s += 1;
    let mut cl: Vec<u16> = Vec::with_capacity(s);
    let mut cln = c.first().copied().unwrap_or(0);
    let mut cls: i32 = 1;
    for i in 1..=s {
        if i != s && c[i] == cln {
            cls += 1;
        } else {
            if cln == 0 && cls > 2 {
                while cls > 138 {
                    cl.push(32754);
                    cls -= 138;
                }
                if cls > 2 {
                    cl.push(if cls > 10 {
                        (((cls - 11) << 5) | 28690) as u16
                    } else {
                        (((cls - 3) << 5) | 12305) as u16
                    });
                    cls = 0;
                }
            } else if cls > 3 {
                cl.push(cln as u16);
                cls -= 1;
                while cls > 6 {
                    cl.push(8304);
                    cls -= 6;
                }
                if cls > 2 {
                    cl.push((((cls - 3) << 5) | 8208) as u16);
                    cls = 0;
                }
            }
            while cls > 0 {
                cls -= 1;
                cl.push(cln as u16);
            }
            cls = 1;
            cln = c.get(i).copied().unwrap_or(0);
        }
    }
    (cl, s)
}

/// `clen(cf, cl)`: bits to send `cf` with lengths `cl`.
fn clen(cf: &[u16], cl: &[u8]) -> i64 {
    cl.iter().zip(cf).map(|(&l, &f)| l as i64 * f as i64).sum()
}

/// `wfblk`: a stored block at bit `pos`; returns the next bit.
fn wfblk(out: &mut [u8], pos: usize, dat: &[u8]) -> usize {
    let s = dat.len();
    let o = shft(pos + 2);
    let mut put = |at: usize, v: u8| {
        if let Some(b) = out.get_mut(at) {
            *b = v;
        }
    };
    put(o, (s & 255) as u8);
    put(o + 1, (s >> 8) as u8);
    put(o + 2, ((s & 255) as u8) ^ 255);
    put(o + 3, ((s >> 8) as u8) ^ 255);
    for (i, &b) in dat.iter().enumerate() {
        put(o + i + 4, b);
    }
    (o + 4 + s) * 8
}

/// `wblk`: one block (stored, fixed or dynamic, whichever is shortest).
#[allow(clippy::too_many_arguments)]
fn wblk(
    dat: &[u8],
    out: &mut [u8],
    last: i32,
    syms: &[i32],
    lf: &mut [u16; 288],
    df: &[u16; 32],
    eb: i64,
    li: usize,
    bs: usize,
    bl: usize,
    mut p: usize,
) -> usize {
    let tb = tables();
    wbits(out, p, last);
    p += 1;
    lf[256] = lf[256].wrapping_add(1);
    let (dlt, mlb) = h_tree(lf, 15);
    let (ddt, mdb) = h_tree(df, 15);
    let (lclt, nlc) = lc(&dlt);
    let (lcdt, ndc) = lc(&ddt);
    let mut lcfreq = [0u16; 19];
    for &x in lclt.iter().chain(&lcdt) {
        lcfreq[(x & 31) as usize] += 1;
    }
    let (lct, mlcb) = h_tree(&lcfreq, 7);
    let lct_at = |i: usize| lct.get(i).copied().unwrap_or(0);
    let mut nlcc = 19;
    while nlcc > 4 && lct_at(CLIM[nlcc - 1] as usize) == 0 {
        nlcc -= 1;
    }
    let flen = ((bl as i64 + 5) as i32).wrapping_shl(3) as i64;
    let ftlen = clen(lf, &tb.flt) + clen(df, &tb.fdt) + eb;
    let dtlen = clen(lf, &dlt)
        + clen(df, &ddt)
        + eb
        + 14
        + 3 * nlcc as i64
        + clen(&lcfreq, &lct)
        + 2 * lcfreq[16] as i64
        + 3 * lcfreq[17] as i64
        + 7 * lcfreq[18] as i64;
    if flen <= ftlen && flen <= dtlen {
        let end = (bs + bl).min(dat.len());
        return wfblk(out, p, &dat[bs.min(end)..end]);
    }
    wbits(out, p, 1 + (dtlen < ftlen) as i32);
    p += 2;
    let dynamic = dtlen < ftlen;
    let (lm_dyn, dm_dyn);
    let (lm, ll, dm, dl): (&[u16], &[u8], &[u16], &[u8]) = if dynamic {
        lm_dyn = h_map(&tb.rev, &dlt, mlb as usize);
        dm_dyn = h_map(&tb.rev, &ddt, mdb as usize);
        let llm = h_map(&tb.rev, &lct, mlcb as usize);
        wbits(out, p, nlc as i32 - 257);
        wbits(out, p + 5, ndc as i32 - 1);
        wbits(out, p + 10, nlcc as i32 - 4);
        p += 14;
        for (i, &c) in CLIM.iter().enumerate().take(nlcc) {
            wbits(out, p + 3 * i, lct_at(c as usize) as i32);
        }
        p += 3 * nlcc;
        for clct in [&lclt, &lcdt] {
            for &x in clct {
                let len = (x & 31) as usize;
                wbits(out, p, llm[len] as i32);
                p += lct[len] as usize;
                if len > 15 {
                    wbits(out, p, ((x >> 5) & 127) as i32);
                    p += (x >> 12) as usize;
                }
            }
        }
        (&lm_dyn, &dlt, &dm_dyn, &ddt)
    } else {
        (&tb.flm, &tb.flt, &tb.fdm, &tb.fdt)
    };
    for &sym in &syms[..li] {
        if sym > 255 {
            let len = ((sym >> 18) & 31) as usize;
            wbits16(out, p, lm[len + 257] as i32);
            p += ll[len + 257] as usize;
            if len > 7 {
                wbits(out, p, (sym >> 23) & 31);
                p += FLEB[len] as usize;
            }
            let dst = (sym & 31) as usize;
            wbits16(out, p, dm[dst] as i32);
            p += dl[dst] as usize;
            if dst > 3 {
                wbits16(out, p, (sym >> 5) & 8191);
                p += FDEB[dst] as usize;
            }
        } else {
            wbits16(out, p, lm[sym as usize] as i32);
            p += ll[sym as usize] as usize;
        }
    }
    wbits16(out, p, lm[256] as i32);
    p + ll[256] as usize
}

/// `deflateSync(dat, { level: 1 })`: raw DEFLATE, bit for bit as fflate
/// 0.8.3 writes it.
pub fn deflate_level1(dat: &[u8]) -> Vec<u8> {
    let tb = tables();
    let s = dat.len();
    // dopt's memory level for a one-shot call:
    // `Math.ceil(Math.max(8, Math.min(13, Math.log(len))) * 1.5)`, 12 to 20.
    let plvl = ((s as f64).ln().min(13.0).max(8.0) * 1.5).ceil();
    let mut w = vec![0u8; s + 5 * (1 + s.div_ceil(7000))];
    let mut pos = 0usize;
    let n = (DEO_LEVEL1 >> 13) as usize;
    let c = DEO_LEVEL1 & 8191;
    let msk: u32 = (1u32 << (plvl as u32)) - 1;
    let mut prev = vec![0u16; 32768];
    let mut head = vec![0u16; msk as usize + 1];
    let bs1 = (plvl / 3.0).ceil() as u32;
    let bs2 = 2 * bs1;
    let hsh = |i: usize| -> usize {
        ((dat[i] as u32 ^ ((dat[i + 1] as u32) << bs1) ^ ((dat[i + 2] as u32) << bs2)) & msk)
            as usize
    };
    let mut syms = vec![0i32; 25000];
    let mut lf = [0u16; 288];
    let mut df = [0u16; 32];
    let (mut lc_1, mut eb, mut i, mut li, mut wi, mut bs) =
        (0u32, 0i64, 0usize, 0usize, 0usize, 0usize);
    while i + 2 < s {
        let hv = hsh(i);
        let mut imod = (i & 32767) as i64;
        let mut pimod = head[hv] as i64;
        prev[imod as usize] = pimod as u16;
        head[hv] = imod as u16;
        if wi <= i {
            let rem = s - i;
            // The last block is the only one (`lst` is set), so `!lst` is false.
            if (lc_1 > 7000 || li > 24576) && rem > 423 {
                pos = wblk(dat, &mut w, 0, &syms, &mut lf, &df, eb, li, bs, i - bs, pos);
                li = 0;
                lc_1 = 0;
                eb = 0;
                bs = i;
                lf[..286].fill(0);
                df[..30].fill(0);
            }
            let mut l = 2usize;
            let mut d = 0i64;
            let mut ch = c;
            let mut dif = (imod - pimod) & 32767;
            if rem > 2 && hv == hsh((i as i64 - dif) as usize) {
                let maxn = n.min(rem) - 1;
                let maxd = 32767.min(i) as i64;
                let ml = 258.min(rem);
                while dif <= maxd
                    && {
                        ch -= 1;
                        ch != 0
                    }
                    && imod != pimod
                {
                    let back = (i + l) as i64 - dif;
                    if dat.get(i + l) == dat.get(back as usize) {
                        let mut nl = 0usize;
                        while nl < ml && dat[i + nl] == dat[((i + nl) as i64 - dif) as usize] {
                            nl += 1;
                        }
                        if nl > l {
                            l = nl;
                            d = dif;
                            if nl > maxn {
                                break;
                            }
                            let mmd = dif.min(nl as i64 - 2);
                            let mut md = 0i64;
                            for j in 0..mmd {
                                let ti = (i as i64 - dif + j) & 32767;
                                let pti = prev[ti as usize] as i64;
                                let cd = (ti - pti) & 32767;
                                if cd > md {
                                    md = cd;
                                    pimod = ti;
                                }
                            }
                        }
                    }
                    imod = pimod;
                    pimod = prev[imod as usize] as i64;
                    dif += (imod - pimod) & 32767;
                }
            }
            if d != 0 {
                let rl = tb.revfl[l];
                let rd = tb.revfd[d as usize];
                syms[li] = 268435456 | (rl << 18) | rd;
                li += 1;
                let lin = (rl & 31) as usize;
                let din = (rd & 31) as usize;
                eb += FLEB[lin] as i64 + FDEB[din] as i64;
                lf[257 + lin] = lf[257 + lin].wrapping_add(1);
                df[din] = df[din].wrapping_add(1);
                wi = i + l;
                lc_1 += 1;
            } else {
                syms[li] = dat[i] as i32;
                li += 1;
                lf[dat[i] as usize] = lf[dat[i] as usize].wrapping_add(1);
            }
        }
        i += 1;
    }
    i = i.max(wi);
    while i < s {
        syms[li] = dat[i] as i32;
        li += 1;
        lf[dat[i] as usize] = lf[dat[i] as usize].wrapping_add(1);
        i += 1;
    }
    pos = wblk(dat, &mut w, 1, &syms, &mut lf, &df, eb, li, bs, i - bs, pos);
    w.truncate(shft(pos));
    w
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::io::Read;

    /// The inputs, from a seeded xorshift32. Each expected length and SHA-256
    /// is what fflate 0.8.3 writes for the same bytes:
    /// `deflateSync(gen(kind, len, seed), { level: 1 })` with this generator
    /// written in JavaScript (`x ^= x << 13; x ^= x >>> 17; x ^= x << 5`, all
    /// unsigned).
    fn gen(kind: &str, len: usize, seed: u32) -> Vec<u8> {
        let mut x = seed;
        let mut next = move || {
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            x
        };
        let mut out = Vec::with_capacity(len);
        while out.len() < len {
            match kind {
                "zero" => out.push(0),
                "a" => out.push(b'a'),
                "rand" => out.push(next() as u8),
                "acgt" => out.push(b"ACGT"[(next() & 3) as usize]),
                "mixed" => {
                    let b = if next() % 4 == 0 {
                        next() as u8
                    } else {
                        b"abcdefgh"[(next() & 7) as usize]
                    };
                    out.push(b);
                }
                "runs" => {
                    let b = next() as u8;
                    let mut n = next() % 300;
                    while n > 0 && out.len() < len {
                        out.push(b);
                        n -= 1;
                    }
                }
                "geo" => {
                    let mut k = 0u8;
                    while k < 40 && next() % 1000 < 618 {
                        k += 1;
                    }
                    out.push(0x20 + k);
                }
                _ => unreachable!(),
            }
        }
        out
    }

    const VECTORS: &[(&str, usize, u32, usize, &str)] = &[
        (
            "zero",
            0,
            1,
            2,
            "9b4fb24edd6d1d8830e272398263cdbf026b97392cc35387b991dc0248a628f9",
        ),
        (
            "a",
            1,
            1,
            3,
            "59fced9a2ff83dabdd7055cf3abd6c12b802e6397b6fba5b8251cdf95d2bc991",
        ),
        (
            "mixed",
            2,
            3,
            4,
            "686a3e27361ae5436199fbc29c8b197d57e02c0680ac29a4959759aecf3309e7",
        ),
        (
            "mixed",
            3,
            4,
            5,
            "4c88b591c08cf183996884e4be8f6e6b526b6d9413e467a9bbc1da022be6ae80",
        ),
        (
            "a",
            100000,
            1,
            114,
            "30848518b27ec0b484826fe274f17fb0dd7c8cd8295b069350cf422f97ad99af",
        ),
        (
            "zero",
            2000000,
            1,
            1966,
            "4f699e0e219ee0f4a12b21db2248732d7b706e13ace75c5836782fb18637fcd9",
        ),
        (
            "rand",
            1000,
            5,
            1005,
            "a8d3561d13495a1b25aee3d685eee843fd0e2518884a01a7b7386a3a606cda92",
        ),
        (
            "rand",
            70000,
            6,
            70015,
            "80ba365a9c60fb6409cafc7bfa472a15316ea4517bb90b4da9a2d07bd5ee1b40",
        ),
        (
            "acgt",
            300000,
            7,
            97616,
            "bdefaadb5949e6d09095ec7a62e55ab6ac82f7aa13df6eeea5e30cb8d1f7219e",
        ),
        (
            "runs",
            500000,
            8,
            10774,
            "e20be8e4cd4665eb17a0f2b9453c931f03efc0713705089e02d3a3ef1868eb69",
        ),
        (
            "geo",
            200000,
            9,
            84435,
            "d4e83206a9e4c08bcd7be542131265155c24aef4345717e5c8b16de4c5c161d1",
        ),
        (
            "geo",
            3000,
            10,
            1270,
            "30ec3caafed77d3460e156fabb2ee7ea499d6f83a6f5284d0b496c0d88cfe7c8",
        ),
        // Either side of each length where the hash table size changes.
        (
            "mixed",
            2980,
            100,
            2093,
            "d671e404fb3097a3e4dc99611b902717e53058151704f98dd55615bcb3417b81",
        ),
        (
            "mixed",
            2982,
            101,
            2132,
            "0bb543dccec86eba44139826f8694b4ffb12b4e0d2d0d089ad369a0a3ef61a7b",
        ),
        (
            "mixed",
            8102,
            102,
            5785,
            "c73d857b0bfddeef6846bb13537dbb6182eede8eb0b77b6b5dfab558a8438a60",
        ),
        (
            "mixed",
            8104,
            103,
            5789,
            "92dbbe8b9655423cc062034a0204d77681c12011da0815985d1480d5848dd7f6",
        ),
        (
            "mixed",
            22025,
            104,
            15686,
            "d7c3a1c6fb6b65e2fc0fa499edcae8f153be41739b42f238a4d4763580f53973",
        ),
        (
            "mixed",
            22027,
            105,
            15869,
            "da1e41c3c207e3c1f4c0dbfd89b5d3de4f231dacc2e4f6fe839597868d252994",
        ),
        (
            "mixed",
            59873,
            106,
            42821,
            "f84c8bd0c7f9e9ae909f485ad207ebc92b6a2aab4aef245b1f3861c58657438c",
        ),
        (
            "mixed",
            59875,
            107,
            42919,
            "ac56fb42bd004e0f49d308cf2b09983523515276880583e3ed53992f649b9a78",
        ),
        (
            "mixed",
            162754,
            108,
            116772,
            "889fb816e40a141fb7835fca4214f79a3b6aa67c56d08090f4808991da6f50c7",
        ),
        (
            "mixed",
            162756,
            109,
            116579,
            "088f8f795c95f60c61d664cff026bd1ad549bd38640cc8cde0b1ec05754c39a9",
        ),
        (
            "mixed",
            442412,
            110,
            317596,
            "bada325caae7259b1ae0e0e573b9c6405fcb07d158dabe289982d614979e1045",
        ),
        (
            "mixed",
            442414,
            111,
            317378,
            "01ff9dee7076e6c47d00d201e73f926369ad7ac59461a7c2b890c26dfdcffa2b",
        ),
        // Saves the size of real towers and larger: many blocks of each kind.
        (
            "mixed",
            3000000,
            200,
            2153220,
            "61301f0298d3a86cc133e1eb31d8bbc346b5d1ef8ff7754892b5d65a2502a581",
        ),
        (
            "acgt",
            2500000,
            201,
            813144,
            "fceb046d78f239db20b4f5bb32bd47279a6c872ec4a69406748114f61b7d04db",
        ),
        (
            "geo",
            1000000,
            202,
            422441,
            "a8e4e3de05d238141b614575e059c92396e16cc7a1098adb2ef17423bebac3de",
        ),
    ];

    #[test]
    fn writes_what_fflate_writes() {
        for &(kind, len, seed, out_len, sha) in VECTORS {
            let dat = gen(kind, len, seed);
            let z = deflate_level1(&dat);
            let hex: String = Sha256::digest(&z)
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect();
            assert_eq!((z.len(), hex.as_str()), (out_len, sha), "{kind} {len}");
            let mut back = Vec::new();
            flate2::read::DeflateDecoder::new(&z[..])
                .read_to_end(&mut back)
                .unwrap();
            assert!(back == dat, "{kind} {len}: does not inflate back");
        }
    }
}
