//! Little-endian byte writer for the `.TDT` exporter (`tdtByteWriter.ts`).
//! Every value is masked the way the TypeScript `& 0xff` closures mask a
//! JavaScript number: through `ToInt32`, so a fractional or out-of-range
//! value lands on the same byte it lands on there.

/// `ToInt32` for a double: truncate toward zero, wrap to 32 bits. NaN and
/// the infinities become 0.
pub fn to_int32(x: f64) -> i64 {
    if !x.is_finite() {
        return 0;
    }
    let m = x.trunc().rem_euclid(4294967296.0);
    (m as u32) as i32 as i64
}

#[derive(Default)]
pub struct ByteWriter {
    chunks: Vec<u8>,
}

impl ByteWriter {
    pub fn new() -> Self {
        ByteWriter { chunks: Vec::new() }
    }

    /// One byte (masked to 8 bits).
    pub fn u8(&mut self, v: i64) {
        self.chunks.push((v & 0xff) as u8);
    }

    /// A little-endian u16.
    pub fn u16(&mut self, v: i64) {
        self.chunks.push((v & 0xff) as u8);
        self.chunks.push(((v >> 8) & 0xff) as u8);
    }

    /// A little-endian i32 (two's complement via the byte masks).
    pub fn i32(&mut self, v: i64) {
        let v = (v as i32) as i64;
        for shift in [0, 8, 16, 24] {
            self.chunks.push(((v >> shift) & 0xff) as u8);
        }
    }

    /// `n` zero bytes.
    pub fn pad(&mut self, n: usize) {
        self.chunks.resize(self.chunks.len() + n, 0);
    }

    /// `n` bytes of 0xFF (the format's empty-slot sentinel).
    pub fn pad_ff(&mut self, n: usize) {
        self.chunks.resize(self.chunks.len() + n, 0xff);
    }

    /// Back-patch a little-endian u16 at an absolute offset already written.
    pub fn set_u16(&mut self, off: usize, v: i64) {
        assert!(
            off + 2 <= self.chunks.len(),
            "ByteWriter.set_u16 offset {off} is out of range for a {}-byte buffer; it only back-patches bytes already written",
            self.chunks.len()
        );
        self.chunks[off] = (v & 0xff) as u8;
        self.chunks[off + 1] = ((v >> 8) & 0xff) as u8;
    }

    pub fn len(&self) -> usize {
        self.chunks.len()
    }

    pub fn is_empty(&self) -> bool {
        self.chunks.is_empty()
    }

    pub fn to_bytes(self) -> Vec<u8> {
        self.chunks
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_int32_matches_javascript() {
        assert_eq!(to_int32(3.7), 3);
        assert_eq!(to_int32(-1.0), -1);
        assert_eq!(to_int32(4294967296.0 + 5.0), 5);
        assert_eq!(to_int32(2147483648.0), -2147483648);
        assert_eq!(to_int32(f64::NAN), 0);
        assert_eq!(to_int32(f64::INFINITY), 0);
        assert_eq!(to_int32(-0.5), 0);
    }

    #[test]
    fn masks_like_the_closures() {
        let mut w = ByteWriter::new();
        w.u8(-7);
        w.u16(0x12345);
        w.i32(-2);
        assert_eq!(w.to_bytes(), vec![0xf9, 0x45, 0x23, 0xfe, 0xff, 0xff, 0xff]);
    }
}
