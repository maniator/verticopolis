//! The trailer Verticopolis stamps on a `.TDT` it writes, and the read of it
//! (`tdtStamp.ts`).

use super::byte_writer::ByteWriter;
use super::format::{TDT_STAMP_GENERATION, TDT_STAMP_MAGIC, TDT_STAMP_SIZE};

/// Append the trailer. Must be the last thing written to the file.
pub fn write_format_stamp(w: &mut ByteWriter) {
    for ch in TDT_STAMP_MAGIC.bytes() {
        w.u8(ch as i64);
    }
    w.u16(TDT_STAMP_GENERATION);
}

/// The generation our trailer claims, or `None` when the file carries none.
pub fn stamped_generation(bytes: &[u8]) -> Option<i64> {
    if bytes.len() < TDT_STAMP_SIZE {
        return None;
    }
    let at = bytes.len() - TDT_STAMP_SIZE;
    if &bytes[at..at + TDT_STAMP_MAGIC.len()] != TDT_STAMP_MAGIC.as_bytes() {
        return None;
    }
    let g = at + TDT_STAMP_MAGIC.len();
    Some(bytes[g] as i64 | ((bytes[g + 1] as i64) << 8))
}
