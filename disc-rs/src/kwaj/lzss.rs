//! KWAJ method 2: the LZSS scheme of the "QBasic" SZDD variant. A 4096-byte
//! window starts full of spaces with the write position at 4096 - 18. Each
//! control byte's bits, least significant first, mark a literal byte (1) or
//! a two-byte match (0): a 12-bit window position and a 4-bit length + 3.
use super::Out;
use crate::refusal::Result;

pub fn expand(data: &[u8], out: &mut Out) -> Result<()> {
    let mut window = [0x20u8; 4096];
    let mut pos: usize = 4096 - 18;
    let mut input = data.iter().copied();
    'stream: while let Some(control) = input.next() {
        for bit in 0..8 {
            if control & (1 << bit) != 0 {
                let Some(b) = input.next() else { break 'stream };
                window[pos] = b;
                pos = (pos + 1) & 4095;
                out.push(b)?;
            } else {
                let (Some(lo), Some(hi)) = (input.next(), input.next()) else {
                    break 'stream;
                };
                let mut from = lo as usize | ((hi as usize & 0xf0) << 4);
                for _ in 0..(hi as usize & 0x0f) + 3 {
                    let b = window[from];
                    window[pos] = b;
                    pos = (pos + 1) & 4095;
                    from = (from + 1) & 4095;
                    out.push(b)?;
                }
            }
        }
    }
    Ok(())
}
