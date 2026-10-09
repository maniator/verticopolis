//! Where the image's bytes come from. The parsers read through `ReadAt`, so a
//! host hands over a file handle (a native worker), a JavaScript callback over
//! a `File` (WASM in a Web Worker) or an in-memory buffer (tests) and the
//! image is never copied whole into memory.
use crate::refusal::{refuse, Code, Result};

pub trait ReadAt {
    /// The image's total size in bytes.
    fn size(&self) -> u64;
    /// Fill `buf` from `offset`. Callers check the range against `size`
    /// first; an implementation refuses any read it cannot fill.
    fn read_at(&mut self, offset: u64, buf: &mut [u8]) -> Result<()>;
}

impl<T: ReadAt + ?Sized> ReadAt for Box<T> {
    fn size(&self) -> u64 {
        (**self).size()
    }

    fn read_at(&mut self, offset: u64, buf: &mut [u8]) -> Result<()> {
        (**self).read_at(offset, buf)
    }
}

/// Check `[offset, offset + len)` lies inside a source of `size` bytes.
pub(crate) fn check_range(size: u64, offset: u64, len: u64) -> Result<()> {
    match offset.checked_add(len) {
        Some(end) if end <= size => Ok(()),
        _ => refuse(
            Code::Truncated,
            format!("read of {len} bytes at {offset} runs past the {size}-byte image"),
        ),
    }
}

/// An image already in memory.
pub struct Bytes<'a>(pub &'a [u8]);

impl ReadAt for Bytes<'_> {
    fn size(&self) -> u64 {
        self.0.len() as u64
    }

    fn read_at(&mut self, offset: u64, buf: &mut [u8]) -> Result<()> {
        check_range(self.size(), offset, buf.len() as u64)?;
        let start = offset as usize;
        buf.copy_from_slice(&self.0[start..start + buf.len()]);
        Ok(())
    }
}

/// An owned image in memory (the WASM binding's `openBytes`).
pub struct OwnedBytes(pub Vec<u8>);

impl ReadAt for OwnedBytes {
    fn size(&self) -> u64 {
        self.0.len() as u64
    }

    fn read_at(&mut self, offset: u64, buf: &mut [u8]) -> Result<()> {
        Bytes(&self.0).read_at(offset, buf)
    }
}

/// Any seekable reader, such as an open `std::fs::File`.
#[cfg(not(target_arch = "wasm32"))]
pub struct Seekable<R> {
    inner: R,
    size: u64,
}

#[cfg(not(target_arch = "wasm32"))]
impl<R: std::io::Read + std::io::Seek> Seekable<R> {
    pub fn new(mut inner: R) -> Result<Seekable<R>> {
        let size = inner
            .seek(std::io::SeekFrom::End(0))
            .or_else(|e| refuse(Code::Truncated, format!("cannot size the image: {e}")))?;
        Ok(Seekable { inner, size })
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl<R: std::io::Read + std::io::Seek> ReadAt for Seekable<R> {
    fn size(&self) -> u64 {
        self.size
    }

    fn read_at(&mut self, offset: u64, buf: &mut [u8]) -> Result<()> {
        check_range(self.size, offset, buf.len() as u64)?;
        self.inner
            .seek(std::io::SeekFrom::Start(offset))
            .and_then(|_| self.inner.read_exact(buf))
            .or_else(|e| {
                refuse(
                    Code::Truncated,
                    format!("read of {} bytes at {offset} failed: {e}", buf.len()),
                )
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Read, Seek, SeekFrom};

    #[test]
    fn in_memory_sources_read_in_range_and_refuse_past_it() {
        let mut owned = OwnedBytes(vec![1, 2, 3, 4]);
        let mut buf = [0u8; 2];
        owned.read_at(2, &mut buf).unwrap();
        assert_eq!(buf, [3, 4]);
        assert_eq!(
            owned.read_at(3, &mut buf).unwrap_err().code,
            Code::Truncated
        );
        assert_eq!(
            owned.read_at(u64::MAX, &mut buf).unwrap_err().code,
            Code::Truncated
        );
        let mut boxed: Box<dyn ReadAt> = Box::new(owned);
        assert_eq!(boxed.size(), 4);
        boxed.read_at(0, &mut buf).unwrap();
        assert_eq!(buf, [1, 2]);
    }

    /// A reader whose reads fail, as a vanished or unreadable file would.
    struct Failing(Cursor<Vec<u8>>);

    impl Read for Failing {
        fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
            Err(std::io::Error::other("the disc went away"))
        }
    }

    impl Seek for Failing {
        fn seek(&mut self, to: SeekFrom) -> std::io::Result<u64> {
            self.0.seek(to)
        }
    }

    #[test]
    fn a_seekable_source_refuses_a_failed_read() {
        let mut src = Seekable::new(Failing(Cursor::new(vec![0; 64]))).unwrap();
        assert_eq!(src.size(), 64);
        let mut buf = [0u8; 8];
        let r = src.read_at(0, &mut buf).unwrap_err();
        assert_eq!(r.code, Code::Truncated);
        assert!(r.detail.contains("the disc went away"));
        assert_eq!(src.read_at(60, &mut buf).unwrap_err().code, Code::Truncated);
    }
}
