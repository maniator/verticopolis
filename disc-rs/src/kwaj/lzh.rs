//! KWAJ method 3, "LZ + Huffman", written from the format description in
//! libmspack's `doc/szdd_kwaj_format.html` (not from its source).
//!
//! The stream opens with six 4-bit nybbles: the encoding type (0 to 3) of
//! each of the five code-length lists that follow, then one of padding. The
//! five canonical Huffman tables are, in order: MATCHLEN (16 symbols),
//! MATCHLEN2 (16, used right after a short literal run), LITLEN (32), OFFSET
//! (64, the upper six bits of a match distance) and LITERAL (256).
//!
//! Then the data: a 4096-byte ring buffer starts full of spaces with the
//! position at 4096 - 17. A MATCHLEN (or MATCHLEN2) symbol above zero is a
//! match of `symbol + 2` bytes whose distance back from the current position
//! is `OFFSET symbol << 6 | six raw bits`. A zero symbol is a literal run of
//! `LITLEN symbol + 1` bytes; a run shorter than 32 switches the next lookup
//! to MATCHLEN2, and a full 32-byte run switches it back to MATCHLEN.
//!
//! The stream ends at the first read that reaches past the input; the symbol
//! that read belongs to is not emitted, and literals before it in the same
//! run stay. Every behavior here that the description leaves implicit (that
//! end rule among them) is pinned by the differential tests against
//! libmspack (`tests/oracle.rs`).
use super::bits::Bits;
use super::huffman::Table;
use super::{strict, Boundary, Out, TAIL_BITS};
use crate::refusal::{refuse, Code, Result};

const TABLE_SIZES: [usize; 5] = [16, 16, 32, 64, 256];

/// Read one code-length list of `n` symbols in encoding `kind`.
fn read_lengths(bits: &mut Bits, kind: u32, n: usize) -> Result<Vec<u8>> {
    let mut lengths = Vec::with_capacity(n);
    match kind {
        // Every symbol the same length, implied by the table size.
        0 => {
            let len = match n {
                16 => 4,
                32 => 5,
                64 => 6,
                _ => 8,
            };
            lengths.resize(n, len);
        }
        // First length in 4 bits, then: 0 = same as before, 10 = one more,
        // 11 = a new 4-bit length.
        1 => {
            let mut prev = bits.bits(4) as i32;
            lengths.push(prev as u8);
            for _ in 1..n {
                if bits.bit() == 1 {
                    prev = if bits.bit() == 0 {
                        prev + 1
                    } else {
                        bits.bits(4) as i32
                    };
                }
                lengths.push(length_byte(prev)?);
            }
        }
        // First length in 4 bits, then a 2-bit selector: 3 = a new 4-bit
        // length, otherwise previous + (selector - 1).
        2 => {
            let mut prev = bits.bits(4) as i32;
            lengths.push(prev as u8);
            for _ in 1..n {
                let sel = bits.bits(2) as i32;
                prev = if sel == 3 {
                    bits.bits(4) as i32
                } else {
                    prev + sel - 1
                };
                lengths.push(length_byte(prev)?);
            }
        }
        // Every length in 4 bits.
        3 => {
            for _ in 0..n {
                lengths.push(bits.bits(4) as u8);
            }
        }
        _ => {
            return refuse(
                Code::CorruptStream,
                format!("unknown code-length encoding {kind}"),
            )
        }
    }
    if bits.past_end() {
        return refuse(Code::CorruptStream, strict::TABLES_CUT);
    }
    Ok(lengths)
}

fn length_byte(len: i32) -> Result<u8> {
    if !(0..=15).contains(&len) {
        return refuse(
            Code::CorruptStream,
            format!("{} ({len})", strict::LENGTH_RANGE),
        );
    }
    Ok(len as u8)
}

/// Expand `data`. With `tail`, also record every token and literal boundary
/// that falls within the last `TAIL_BITS` of input (the oracle tests use it
/// to recognize libmspack's early stop exactly).
pub fn expand(data: &[u8], out: &mut Out, mut tail: Option<&mut Vec<Boundary>>) -> Result<()> {
    let mut bits = Bits::new(data);
    let kinds: Vec<u32> = (0..6).map(|_| bits.bits(4)).collect();
    if bits.past_end() {
        return refuse(Code::CorruptStream, strict::HEADER_CUT);
    }
    let mut tables = Vec::with_capacity(5);
    for (i, &n) in TABLE_SIZES.iter().enumerate() {
        tables.push(Table::new(&read_lengths(&mut bits, kinds[i], n)?)?);
    }
    let [matchlen, matchlen2, litlen, offset, literal] =
        <[Table; 5]>::try_from(tables).unwrap_or_else(|_| unreachable!("five tables were built"));

    let mut window = [0x20u8; 4096];
    let mut pos: usize = 4096 - 17;
    let mut use_matchlen2 = false;
    // The stream ends at the first read that reaches past the input: that
    // symbol, and the token it belongs to, is never emitted. Bytes already
    // written by the token's earlier literals stay.
    macro_rules! read {
        ($e:expr) => {{
            let v = $e;
            if bits.past_end() {
                return Ok(());
            }
            v
        }};
    }
    let mut mark = |out: &Out, bits: &Bits| {
        if let Some(t) = tail.as_deref_mut() {
            if bits.remaining() < TAIL_BITS {
                t.push(Boundary {
                    out: out.len(),
                    bits_left: bits.remaining(),
                });
            }
        }
    };
    loop {
        mark(out, &bits);
        let table = if use_matchlen2 { &matchlen2 } else { &matchlen };
        let code = read!(table.decode(&mut bits))?;
        if code > 0 {
            let len = code as usize + 2;
            let hi = read!(offset.decode(&mut bits))? as usize;
            let lo = read!(bits.bits(6)) as usize;
            let mut from = pos.wrapping_sub((hi << 6) | lo) & 4095;
            for _ in 0..len {
                let b = window[from];
                window[pos] = b;
                pos = (pos + 1) & 4095;
                from = (from + 1) & 4095;
                out.push(b)?;
            }
            use_matchlen2 = false;
        } else {
            let run = read!(litlen.decode(&mut bits))?;
            // A run shorter than the 32-byte maximum hands the next lookup
            // to MATCHLEN2; a full run hands it back to MATCHLEN, whichever
            // table this run's own code came from (pinned against libmspack).
            use_matchlen2 = run != 31;
            for _ in 0..=run {
                mark(out, &bits);
                let b = read!(literal.decode(&mut bits))? as u8;
                window[pos] = b;
                pos = (pos + 1) & 4095;
                out.push(b)?;
            }
        }
    }
}
