//! Microsoft KWAJ, the format COMPRESS.EXE writes and the retail disc's
//! files ship in (named with the last character replaced, `SIMTOWER.EX_`).
//!
//! A 14-byte header: the `KWAJ` signature, a 16-bit method, the offset of the
//! compressed data and a flags word announcing optional header extensions.
//! Method 0 stores, 1 XORs every byte with 0xFF, 2 is the QBasic SZDD LZSS,
//! 3 is LZ + Huffman, 4 is MS-ZIP. Methods 0 to 3 expand here; 4 is refused
//! until a real file needs it.
mod bits;
mod huffman;
mod lzh;
mod lzss;

use crate::limits::Limits;
use crate::refusal::{refuse, Code, Result};

pub const SIGNATURE: [u8; 8] = [0x4b, 0x57, 0x41, 0x4a, 0x88, 0xf0, 0x27, 0xd1];
pub const HEADER_LEN: usize = 14;
/// Header flags bit 0: a 4-byte expanded length follows the header.
const FLAG_LENGTH: u16 = 0x0001;

/// The details of the refusals where this decoder is deliberately stricter
/// than libmspack. Each refusal's detail starts with one of these, so the
/// oracle rule (`testkit::oracle`) can name them exactly.
pub mod strict {
    pub const HEADER_CUT: &str = "the stream ends before its table header";
    pub const TABLES_CUT: &str = "the stream ends inside its Huffman tables";
    pub const LENGTH_RANGE: &str = "a code length steps out of range";
    pub const OVER_SUBSCRIBED: &str = "a Huffman table is over-subscribed";
    pub const DECLARED_LENGTH: &str = "the expansion does not match the length its header declares";
    pub const ALL: [&str; 5] = [
        HEADER_CUT,
        TABLES_CUT,
        LENGTH_RANGE,
        OVER_SUBSCRIBED,
        DECLARED_LENGTH,
    ];
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Header {
    pub method: u16,
    pub data_offset: u16,
    pub flags: u16,
    /// The expanded length, when the header carries one (flags bit 0).
    pub expanded_len: Option<u32>,
}

/// True when `bytes` start with the KWAJ signature.
pub fn is_kwaj(bytes: &[u8]) -> bool {
    bytes.len() >= SIGNATURE.len() && bytes[..SIGNATURE.len()] == SIGNATURE
}

/// Parse the fixed header and, when present, the expanded-length extension.
/// `bytes` needs only the first 18 bytes of the file.
pub fn parse_header(bytes: &[u8]) -> Result<Header> {
    if !is_kwaj(bytes) {
        return refuse(Code::CorruptStream, "not a KWAJ file");
    }
    if bytes.len() < HEADER_LEN {
        return refuse(Code::CorruptStream, "the KWAJ header is truncated");
    }
    let u16le = |at: usize| u16::from_le_bytes([bytes[at], bytes[at + 1]]);
    let method = u16le(8);
    let data_offset = u16le(10);
    let flags = u16le(12);
    if (data_offset as usize) < HEADER_LEN {
        return refuse(
            Code::CorruptStream,
            "the KWAJ data offset points inside the header",
        );
    }
    let expanded_len = if flags & FLAG_LENGTH != 0 {
        if bytes.len() < HEADER_LEN + 4 || (data_offset as usize) < HEADER_LEN + 4 {
            return refuse(
                Code::CorruptStream,
                "the KWAJ length extension is truncated",
            );
        }
        Some(u32::from_le_bytes([
            bytes[14], bytes[15], bytes[16], bytes[17],
        ]))
    } else {
        None
    };
    Ok(Header {
        method,
        data_offset,
        flags,
        expanded_len,
    })
}

/// The expanded output, refusing the push that would cross the cap.
pub(crate) struct Out {
    bytes: Vec<u8>,
    cap: usize,
}

impl Out {
    fn new(cap: usize) -> Out {
        Out {
            bytes: Vec::new(),
            cap,
        }
    }

    pub(crate) fn len(&self) -> usize {
        self.bytes.len()
    }

    #[inline]
    pub(crate) fn push(&mut self, b: u8) -> Result<()> {
        if self.bytes.len() >= self.cap {
            return refuse(
                Code::OutputCap,
                format!("expansion passes the {}-byte cap", self.cap),
            );
        }
        self.bytes.push(b);
        Ok(())
    }
}

/// A token or literal boundary near the end of a method 3 stream: the output
/// length there and the input bits still unread. The oracle tests use these
/// to recognize libmspack's early stop at the end of the input.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Boundary {
    pub out: usize,
    pub bits_left: u64,
}

/// How close to the end of the input a boundary must be to be recorded:
/// libmspack's 16-bit prefetch plus the byte it may already hold.
pub const TAIL_BITS: u64 = 24;

/// The output cap for `file`: the smaller of the per-file limit and the
/// expansion ratio times the compressed data (the header does not count).
pub fn output_cap(file: &[u8], limits: &Limits) -> usize {
    let data = parse_header(file)
        .map(|h| file.len().saturating_sub(h.data_offset as usize))
        .unwrap_or(file.len());
    limits.output_cap(data.max(1))
}

/// Expand a whole KWAJ file under `output_cap`. A header that declares the
/// expanded length must match the expansion exactly (libmspack ignores the
/// declaration; checking it is how a cut or damaged stream is caught).
pub fn expand(file: &[u8], limits: &Limits) -> Result<Vec<u8>> {
    limits.check()?;
    expand_into(file, limits, None, true)
}

/// `expand`, plus (for method 3) the boundaries in the last `TAIL_BITS` of
/// input. Test kit only: it lets the oracle tests name libmspack's one known
/// end-of-input disagreement exactly instead of tolerating any.
#[cfg(any(test, feature = "testkit"))]
pub fn expand_with_tail(file: &[u8], limits: &Limits) -> (Result<Vec<u8>>, Vec<Boundary>) {
    let mut tail = Vec::new();
    let result = limits
        .check()
        .and_then(|_| expand_into(file, limits, Some(&mut tail), true));
    (result, tail)
}

/// `expand_with_tail` without the declared-length check, so the oracle can
/// compare the bytes behind a declared-length refusal with libmspack's.
#[cfg(any(test, feature = "testkit"))]
pub fn expand_ignoring_declared(file: &[u8], limits: &Limits) -> (Result<Vec<u8>>, Vec<Boundary>) {
    let mut tail = Vec::new();
    let result = limits
        .check()
        .and_then(|_| expand_into(file, limits, Some(&mut tail), false));
    (result, tail)
}

fn expand_into(
    file: &[u8],
    limits: &Limits,
    tail: Option<&mut Vec<Boundary>>,
    check_declared: bool,
) -> Result<Vec<u8>> {
    let header = parse_header(file)?;
    let start = header.data_offset as usize;
    if start > file.len() {
        return refuse(
            Code::CorruptStream,
            "the KWAJ data offset points past the file",
        );
    }
    let data = &file[start..];
    let mut out = Out::new(output_cap(file, limits));
    match header.method {
        0 => data.iter().try_for_each(|&b| out.push(b))?,
        1 => data.iter().try_for_each(|&b| out.push(b ^ 0xff))?,
        2 => lzss::expand(data, &mut out)?,
        3 => lzh::expand(data, &mut out, tail)?,
        4 => {
            return refuse(
                Code::UnsupportedCompression,
                "KWAJ method 4 (MS-ZIP) is not supported",
            )
        }
        m => {
            return refuse(
                Code::UnsupportedCompression,
                format!("unknown KWAJ method {m}"),
            )
        }
    }
    if let Some(declared) = header.expanded_len.filter(|_| check_declared) {
        if out.bytes.len() as u64 != declared as u64 {
            return refuse(
                Code::CorruptStream,
                format!(
                    "{} ({declared} declared, {} expanded)",
                    strict::DECLARED_LENGTH,
                    out.bytes.len()
                ),
            );
        }
    }
    Ok(out.bytes)
}
