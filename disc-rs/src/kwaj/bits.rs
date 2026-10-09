//! An MSB-first bit reader ("bits are always read from MSB to LSB, one byte
//! at a time"). Reading past the end yields zero bits and raises `past_end`,
//! so the caller decides what running out of input means at each point of
//! the stream.

pub struct Bits<'a> {
    data: &'a [u8],
    /// The next bit to read, counted from the start of `data`.
    pos: u64,
    past_end: bool,
}

impl<'a> Bits<'a> {
    pub fn new(data: &'a [u8]) -> Bits<'a> {
        Bits {
            data,
            pos: 0,
            past_end: false,
        }
    }

    /// One bit, or a zero bit past the end.
    pub fn bit(&mut self) -> u32 {
        let byte = (self.pos / 8) as usize;
        let shift = 7 - (self.pos % 8) as u32;
        self.pos += 1;
        match self.data.get(byte) {
            Some(&b) => ((b >> shift) & 1) as u32,
            None => {
                self.past_end = true;
                0
            }
        }
    }

    /// `n` bits (n <= 16), most significant first.
    pub fn bits(&mut self, n: u32) -> u32 {
        let mut v = 0;
        for _ in 0..n {
            v = (v << 1) | self.bit();
        }
        v
    }

    /// Input bits not yet read.
    pub fn remaining(&self) -> u64 {
        (self.data.len() as u64 * 8).saturating_sub(self.pos)
    }

    /// True once any bit has been read from beyond the input.
    pub fn past_end(&self) -> bool {
        self.past_end
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_most_significant_bit_first() {
        let mut b = Bits::new(&[0b1010_0000, 0xff]);
        assert_eq!(b.bits(3), 0b101);
        assert_eq!(b.bits(5), 0);
        assert_eq!(b.bits(4), 0xf);
        assert!(!b.past_end());
    }

    #[test]
    fn reads_zeros_past_the_end_and_says_so() {
        let mut b = Bits::new(&[0xff]);
        assert_eq!(b.bits(8), 0xff);
        assert!(!b.past_end());
        assert_eq!(b.bits(4), 0);
        assert!(b.past_end());
    }
}
