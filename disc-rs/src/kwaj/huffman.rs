//! Canonical Huffman decoding. A table is defined only by each symbol's code
//! length: codes are assigned in order of length, and within one length in
//! ascending symbol order. Length 0 means the symbol is unused.
use super::bits::Bits;
use crate::refusal::{refuse, Code, Result};

/// The longest code a 4-bit length field can describe.
pub const MAX_LEN: usize = 15;

pub struct Table {
    /// How many codes of each length, index 1..=MAX_LEN.
    counts: [u16; MAX_LEN + 1],
    /// Symbols sorted by (length, symbol).
    symbols: Vec<u16>,
}

impl Table {
    /// Build a table from code lengths. Only a complete code is accepted:
    /// lengths past `MAX_LEN`, a set that assigns more codes than the bit
    /// space holds (over-subscribed), one that leaves part of it unassigned
    /// (incomplete) and a table with no codes are all refused. libmspack
    /// refuses incomplete tables too, even one the stream never reads from;
    /// it does not always catch an over-subscribed one, so refusing those is
    /// listed strictness (`testkit::oracle`).
    pub fn new(lengths: &[u8]) -> Result<Table> {
        let mut counts = [0u16; MAX_LEN + 1];
        for &l in lengths {
            if l as usize > MAX_LEN {
                return refuse(
                    Code::CorruptStream,
                    format!("a code length of {l} is out of range"),
                );
            }
            counts[l as usize] += 1;
        }
        counts[0] = 0;
        // Kraft check: the codes of each length must fit what the shorter
        // lengths left free.
        let mut left: i64 = 1;
        for &count in &counts[1..] {
            left = left * 2 - count as i64;
            if left < 0 {
                return refuse(Code::CorruptStream, super::strict::OVER_SUBSCRIBED);
            }
        }
        let mut symbols: Vec<u16> = (0..lengths.len() as u16)
            .filter(|&s| lengths[s as usize] != 0)
            .collect();
        if symbols.is_empty() {
            return refuse(Code::CorruptStream, "a Huffman table has no codes");
        }
        if left != 0 {
            return refuse(Code::CorruptStream, "a Huffman table is incomplete");
        }
        symbols.sort_by_key(|&s| (lengths[s as usize], s));
        Ok(Table { counts, symbols })
    }

    /// Decode one symbol. Every table is complete, so every bit string reaches
    /// a code within `MAX_LEN` bits; the refusal below is a guard that a
    /// complete table never reaches.
    pub fn decode(&self, bits: &mut Bits) -> Result<u16> {
        // The canonical walk: at each length, codes of that length occupy
        // [first, first + count) and map to the next `count` sorted symbols.
        let mut code: i64 = 0;
        let mut first: i64 = 0;
        let mut index: i64 = 0;
        for len in 1..=MAX_LEN {
            code |= bits.bit() as i64;
            let count = self.counts[len] as i64;
            if code - first < count {
                return Ok(self.symbols[(index + code - first) as usize]);
            }
            index += count;
            first = (first + count) << 1;
            code <<= 1;
        }
        refuse(Code::CorruptStream, "a bit string matches no Huffman code")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn equal_lengths_decode_as_plain_binary() {
        // Four 2-bit codes: 00 01 10 11 for symbols 0..3.
        let t = Table::new(&[2, 2, 2, 2]).unwrap();
        let mut b = Bits::new(&[0b00_01_10_11]);
        let got: Vec<u16> = (0..4).map(|_| t.decode(&mut b).unwrap()).collect();
        assert_eq!(got, vec![0, 1, 2, 3]);
    }

    #[test]
    fn shorter_codes_come_first_then_symbol_order() {
        // Lengths 2,1,3,3: symbol 1 = 0, symbol 0 = 10, 2 = 110, 3 = 111.
        let t = Table::new(&[2, 1, 3, 3]).unwrap();
        // 0 10 110 11|1: symbols 1, 0, 2, 3.
        #[allow(clippy::unusual_byte_groupings)]
        let mut b = Bits::new(&[0b0_10_110_11, 0b1000_0000]);
        let got: Vec<u16> = (0..4).map(|_| t.decode(&mut b).unwrap()).collect();
        assert_eq!(got, vec![1, 0, 2, 3]);
    }

    #[test]
    fn refuses_over_subscribed_and_empty_tables() {
        assert_eq!(
            Table::new(&[1, 1, 1]).err().unwrap().code,
            Code::CorruptStream
        );
        assert_eq!(Table::new(&[0, 0]).err().unwrap().code, Code::CorruptStream);
        assert_eq!(Table::new(&[16]).err().unwrap().code, Code::CorruptStream);
    }

    #[test]
    fn refuses_incomplete_tables() {
        // One 1-bit code leaves the string 1... unassigned; so does 1, 2.
        assert_eq!(Table::new(&[1, 0]).err().unwrap().code, Code::CorruptStream);
        assert_eq!(
            Table::new(&[1, 2, 0]).err().unwrap().code,
            Code::CorruptStream
        );
        assert!(Table::new(&[1, 2, 2]).is_ok());
    }
}
