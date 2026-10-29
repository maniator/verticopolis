//! Block writers: the stored block and the compressed block.

use super::huffman::{clen, h_tree, lc};
use super::{h_map, shft, tables, wbits, wbits16, CLIM, FDEB, FLEB};

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
pub(super) fn wblk(
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
