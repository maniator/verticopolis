//! A disc image opened for listing and reading: the ISO walk, a KWAJ peek at
//! every file, and reads that expand on the way out. This is the surface
//! every host drives, natively or through the WASM binding.
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::iso::{self, IsoFile};
use crate::kwaj;
use crate::limits::Limits;
use crate::refusal::{refuse, Code, Result};
use crate::source::ReadAt;

/// The version of every JSON shape below. A host refuses any schema it does
/// not know.
pub const SCHEMA: u32 = 1;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub token: u32,
    pub path: String,
    /// The size as stored on the image.
    pub size: u32,
    /// `"plain"`, `"kwaj"`, or `"unreadable"` (its record is damaged, uses
    /// an unsupported layout, or points outside the image; it lists so the
    /// rest of the disc stays usable, and refuses when read).
    pub stored: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<u16>,
    /// The expanded size the KWAJ header declares, when it declares one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expanded_size: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Opened {
    pub schema: u32,
    pub source: &'static str,
    pub entries: Vec<Entry>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ReadInfo {
    pub schema: u32,
    pub token: u32,
    pub size: u32,
    pub sha256: String,
}

pub struct Disc<S: ReadAt> {
    src: S,
    limits: Limits,
    files: Vec<IsoFile>,
    entries: Vec<Entry>,
}

impl<S: ReadAt> Disc<S> {
    /// Walk the image and peek at each file's first bytes for a KWAJ header.
    pub fn open(mut src: S, limits: Limits) -> Result<Disc<S>> {
        limits.check()?;
        let files = iso::list_files(&mut src, &limits)?;
        let mut entries = Vec::with_capacity(files.len());
        let mut head = [0u8; kwaj::HEADER_LEN + 4];
        for (i, f) in files.iter().enumerate() {
            let (stored, method, expanded_size) = match f.extent(src.size()) {
                Err(_) => ("unreadable", None, None),
                Ok((_, 0)) => ("plain", None, None),
                Ok((start, len)) => {
                    let n = (len as usize).min(head.len());
                    src.read_at(start, &mut head[..n])?;
                    let peek = &head[..n];
                    if kwaj::is_kwaj(peek) {
                        // A KWAJ signature with an unreadable header still
                        // lists, as KWAJ with no method, and refuses when read.
                        match kwaj::parse_header(peek) {
                            Ok(h) => ("kwaj", Some(h.method), h.expanded_len),
                            Err(_) => ("kwaj", None, None),
                        }
                    } else {
                        ("plain", None, None)
                    }
                }
            };
            entries.push(Entry {
                token: i as u32,
                path: f.path.clone(),
                size: f.size,
                stored,
                method,
                expanded_size,
            });
        }
        Ok(Disc {
            src,
            limits,
            files,
            entries,
        })
    }

    pub fn opened(&self) -> Opened {
        Opened {
            schema: SCHEMA,
            source: "iso",
            entries: self.entries.clone(),
        }
    }

    /// A file's bytes exactly as stored on the image.
    pub fn read_stored(&mut self, token: u32) -> Result<Vec<u8>> {
        let Some(f) = self.files.get(token as usize) else {
            return refuse(Code::BadRequest, format!("no entry {token}"));
        };
        if f.size > self.limits.max_file_bytes {
            return refuse(
                Code::TooLarge,
                format!("{} is {} bytes, past the per-file limit", f.path, f.size),
            );
        }
        let (start, len) = f.extent(self.src.size())?;
        let mut buf = vec![0u8; len as usize];
        self.src.read_at(start, &mut buf)?;
        Ok(buf)
    }

    /// A file's bytes, expanded when it is KWAJ.
    pub fn read(&mut self, token: u32) -> Result<(ReadInfo, Vec<u8>)> {
        let stored = self.read_stored(token)?;
        let bytes = if self.entries[token as usize].stored == "kwaj" {
            kwaj::expand(&stored, &self.limits)?
        } else {
            stored
        };
        let info = ReadInfo {
            schema: SCHEMA,
            token,
            size: bytes.len() as u32,
            sha256: hex(&Sha256::digest(&bytes)),
        };
        Ok((info, bytes))
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
