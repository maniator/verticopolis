//! Bounds-checked little-endian reader for the `.TDT` binary walk
//! (`tdtByteReader.ts`). Every read names the block it happened in so an
//! overrun fails as a typed "cut short" error instead of a panic.

use super::LegacyImportError;

pub struct ByteReader<'a> {
    bytes: &'a [u8],
    pos: usize,
    block: String,
}

impl<'a> ByteReader<'a> {
    pub fn new(bytes: &'a [u8]) -> Self {
        ByteReader {
            bytes,
            pos: 0,
            block: "header".to_string(),
        }
    }

    /// Name the block subsequent reads belong to (for truncation messages).
    pub fn enter_block(&mut self, name: &str) {
        self.block = name.to_string();
    }

    pub fn remaining(&self) -> usize {
        self.bytes.len() - self.pos
    }

    pub fn offset(&self) -> usize {
        self.pos
    }

    /// The underlying buffer, for tail structures located by signature scan.
    pub fn raw(&self) -> &'a [u8] {
        self.bytes
    }

    fn need(&self, n: usize) -> Result<(), LegacyImportError> {
        if self.remaining() < n {
            return Err(LegacyImportError(format!(
                "This SimTower save is cut short. The file ends in the middle of its {}.",
                self.block
            )));
        }
        Ok(())
    }

    pub fn skip(&mut self, n: usize) -> Result<(), LegacyImportError> {
        self.need(n)?;
        self.pos += n;
        Ok(())
    }

    /// Read `n` raw bytes as a copy.
    pub fn bytes(&mut self, n: usize) -> Result<Vec<u8>, LegacyImportError> {
        self.need(n)?;
        let out = self.bytes[self.pos..self.pos + n].to_vec();
        self.pos += n;
        Ok(out)
    }

    pub fn u8(&mut self) -> Result<i64, LegacyImportError> {
        self.need(1)?;
        let v = self.bytes[self.pos];
        self.pos += 1;
        Ok(v as i64)
    }

    pub fn i8(&mut self) -> Result<i64, LegacyImportError> {
        self.need(1)?;
        let v = self.bytes[self.pos] as i8;
        self.pos += 1;
        Ok(v as i64)
    }

    pub fn u16(&mut self) -> Result<i64, LegacyImportError> {
        self.need(2)?;
        let v = u16::from_le_bytes([self.bytes[self.pos], self.bytes[self.pos + 1]]);
        self.pos += 2;
        Ok(v as i64)
    }

    pub fn u32(&mut self) -> Result<i64, LegacyImportError> {
        self.need(4)?;
        let b = &self.bytes[self.pos..self.pos + 4];
        let v = u32::from_le_bytes([b[0], b[1], b[2], b[3]]);
        self.pos += 4;
        Ok(v as i64)
    }

    pub fn i32(&mut self) -> Result<i64, LegacyImportError> {
        self.need(4)?;
        let b = &self.bytes[self.pos..self.pos + 4];
        let v = i32::from_le_bytes([b[0], b[1], b[2], b[3]]);
        self.pos += 4;
        Ok(v as i64)
    }
}
