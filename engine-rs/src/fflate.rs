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

use blocks::wblk;

mod blocks;
mod huffman;

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
mod tests;
