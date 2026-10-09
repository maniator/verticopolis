//! A minimal ISO9660 reader: the primary volume descriptor, a depth-first
//! directory walk and file extents. Ported from the hardened TypeScript
//! reader reviewed in the desktop shell (its guards, limits and test cases
//! carry over one for one).
//!
//! The image is attacker-controlled. Every offset, length and count is
//! checked before use; the walk reads one 2048-byte sector at a time, so a
//! directory extent never drives an allocation; all traversal work (records
//! parsed and empty-sector skips) spends one shared budget; recursion is
//! depth-limited; and a directory reached twice is walked once.
use std::collections::{HashMap, HashSet};

use crate::limits::Limits;
use crate::refusal::{refuse, Code, Result};
use crate::source::{check_range, ReadAt};

pub const SECTOR: u64 = 2048;
/// Volume descriptors start after the 16-sector system area.
const FIRST_VD_SECTOR: u64 = 16;
const DIR_RECORD_MIN: usize = 34;
const FLAG_DIRECTORY: u8 = 0x02;
/// The root directory record's offset inside the primary volume descriptor.
const PVD_ROOT_RECORD: usize = 156;
/// The logical block size field (both-endian 16-bit) of the volume.
const PVD_BLOCK_SIZE: usize = 128;

/// A file on the image. `path` is uppercased, version-stripped and
/// slash-separated from the root (for example `SIMTOWER/TOWER5.TDT`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IsoFile {
    pub path: String,
    pub name: String,
    pub size: u32,
    /// The 2048-byte logical block where the file's data starts.
    pub lba: u32,
    /// Why the file cannot be read, when its record is damaged or uses a
    /// layout this reader does not support. It still lists, so one bad
    /// entry never hides the rest of the disc.
    pub unreadable: Option<&'static str>,
}

impl IsoFile {
    /// The byte range of the file's data, checked against the image.
    pub fn extent(&self, image_size: u64) -> Result<(u64, u64)> {
        if let Some(why) = self.unreadable {
            return refuse(Code::CorruptImage, format!("{}: {why}", self.path));
        }
        let start = self.lba as u64 * SECTOR;
        check_range(image_size, start, self.size as u64).or_else(|_| {
            refuse(
                Code::Truncated,
                format!("{} points outside the image", self.path),
            )
        })?;
        Ok((start, self.size as u64))
    }
}

/// One directory record, already bounds-checked.
struct DirRecord {
    length: usize,
    lba: u32,
    size: u32,
    is_dir: bool,
    /// An associated file (flag bit 2), which the walk skips.
    associated: bool,
    /// `Some("")` for ".", `None` for "..", otherwise the decoded name.
    name: Option<String>,
    /// The file version after `;` (1 when absent).
    version: u32,
    /// Flag bit 7: the file continues in the next record of the same name
    /// and version.
    multi_extent: bool,
    /// A damaged or unsupported record: the file lists as unreadable, and a
    /// directory refuses the walk (it cannot be walked safely).
    problem: Option<&'static str>,
}

const BOTH_ENDIAN_MISMATCH: &str = "a both-endian field disagrees with itself";
const UNSUPPORTED_LAYOUT: &str = "the record uses an unsupported layout";

const FLAG_ASSOCIATED: u8 = 0x04;
const FLAG_MULTI_EXTENT: u8 = 0x80;

/// A both-endian 32-bit field: the little-endian half, which readers in
/// practice use, and whether the big-endian half contradicts it. Some
/// mastering tools left the big-endian half zero; only a nonzero
/// disagreement counts.
fn both32(b: &[u8], at: usize) -> (u32, bool) {
    let le = u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]]);
    let be = u32::from_be_bytes([b[at + 4], b[at + 5], b[at + 6], b[at + 7]]);
    (le, be != le && be != 0)
}

/// Parse the record at `at` within one sector buffer. `Ok(None)` is the zero
/// length that pads out the rest of a sector.
fn parse_record(sector: &[u8], at: usize) -> Result<Option<DirRecord>> {
    let Some(&length) = sector.get(at) else {
        return Ok(None);
    };
    let length = length as usize;
    if length == 0 {
        return Ok(None);
    }
    if length < DIR_RECORD_MIN || at + length > sector.len() {
        return refuse(
            Code::CorruptImage,
            "a directory record has an impossible length",
        );
    }
    let rec = &sector[at..at + length];
    let fi_len = rec[32] as usize;
    if 33 + fi_len > length {
        return refuse(
            Code::CorruptImage,
            "a directory record's name runs past the record",
        );
    }
    // Layouts a disc of this era does not use are never read as plain
    // data: an extended attribute record shifts the data, interleaving
    // scatters it, and a multi-extent file spans several records.
    let flags = rec[25];
    let unsupported = rec[1] != 0 || rec[26] != 0 || rec[27] != 0 || flags & FLAG_MULTI_EXTENT != 0;
    let (lba, lba_bad) = both32(rec, 2);
    let (size, size_bad) = both32(rec, 10);
    let problem = if unsupported {
        Some(UNSUPPORTED_LAYOUT)
    } else if lba_bad || size_bad {
        Some(BOTH_ENDIAN_MISMATCH)
    } else {
        None
    };
    let fi = &rec[33..33 + fi_len];
    let (name, version) = match fi {
        [0x00] => (Some(String::new()), 1),
        [0x01] => (None, 1),
        _ => {
            let (name, version) = decode_name(fi)?;
            (Some(name), version)
        }
    };
    Ok(Some(DirRecord {
        length,
        lba,
        size,
        is_dir: flags & FLAG_DIRECTORY != 0,
        associated: flags & FLAG_ASSOCIATED != 0,
        name,
        version,
        multi_extent: flags & FLAG_MULTI_EXTENT != 0,
        problem,
    }))
}

/// The characters a DOS 8.3 name may hold, plus the dot. Anything else
/// (spaces, path separators, `:`, `*`, `?` and the like) is refused, since a
/// name becomes part of a path a host trusts. The crate does not refuse DOS
/// device names (`CON`, `NUL`, `COM1` and the like): a host that writes a
/// listed name to its own filesystem sanitizes those itself.
fn name_char(c: u8) -> bool {
    c.is_ascii_alphanumeric() || b"!#$%&'()-@^_`{}~.".contains(&c)
}

/// An ISO9660 identifier as an uppercase name and its version: `;N` is split
/// off, then every trailing dot (`README.` becomes `README`, and `A..`
/// becomes `A`, so names that a filesystem trimming dots would merge are
/// listed as one and caught as duplicates). A name with a character outside
/// `name_char`, a malformed version, or nothing but dots is refused.
fn decode_name(fi: &[u8]) -> Result<(String, u32)> {
    let (stem, version) = match fi.iter().rposition(|&c| c == b';') {
        Some(i) => (&fi[..i], &fi[i + 1..]),
        None => (fi, &b"1"[..]),
    };
    if stem.iter().any(|&c| !name_char(c)) {
        return refuse(
            Code::CorruptImage,
            "a file name holds a character a disc name cannot",
        );
    }
    let version = match std::str::from_utf8(version)
        .ok()
        .and_then(|v| v.parse::<u32>().ok())
    {
        Some(v) if !version.is_empty() && version.iter().all(u8::is_ascii_digit) => v,
        _ => return refuse(Code::CorruptImage, "a file name has a malformed version"),
    };
    let mut name: String = stem.iter().map(|&c| c as char).collect();
    if name.bytes().all(|c| c == b'.') {
        return refuse(Code::CorruptImage, "a file name is empty or only dots");
    }
    while name.ends_with('.') {
        name.pop();
    }
    if name.is_empty() {
        return refuse(Code::CorruptImage, "a file name is empty or only dots");
    }
    Ok((name.to_ascii_uppercase(), version))
}

/// Find the primary volume and walk it. Returns every file, depth-first.
pub fn list_files(src: &mut dyn ReadAt, limits: &Limits) -> Result<Vec<IsoFile>> {
    let size = src.size();
    if size > limits.max_image_bytes {
        return refuse(
            Code::TooLarge,
            format!("a {size}-byte image is larger than any disc"),
        );
    }
    if size < (FIRST_VD_SECTOR + 2) * SECTOR {
        return refuse(Code::NotAnImage, "the file is too small to be a disc image");
    }
    let mut sector = vec![0u8; SECTOR as usize];
    for i in 0..limits.max_volume_descriptors as u64 {
        let base = (FIRST_VD_SECTOR + i) * SECTOR;
        if base + SECTOR > size {
            break;
        }
        src.read_at(base, &mut sector)?;
        // Every descriptor carries the standard identifier "CD001".
        if &sector[1..6] != b"CD001" {
            return refuse(
                Code::NotAnImage,
                "a volume descriptor lacks the CD001 identifier",
            );
        }
        match sector[0] {
            0xff => break, // the set terminator
            0x01 => {
                let le = u16::from_le_bytes([sector[PVD_BLOCK_SIZE], sector[PVD_BLOCK_SIZE + 1]]);
                let be =
                    u16::from_be_bytes([sector[PVD_BLOCK_SIZE + 2], sector[PVD_BLOCK_SIZE + 3]]);
                if le != SECTOR as u16 || be != SECTOR as u16 {
                    return refuse(
                        Code::CorruptImage,
                        "the volume's logical block size is not 2048",
                    );
                }
                let root = parse_record(&sector, PVD_ROOT_RECORD)?
                    .filter(|r| r.is_dir)
                    .ok_or_else(|| {
                        crate::refusal::Refusal::new(
                            Code::NotAnImage,
                            "the primary volume has no root directory",
                        )
                    })?;
                if let Some(why) = root.problem {
                    return refuse(Code::CorruptImage, format!("the root directory: {why}"));
                }
                let mut walk = Walk {
                    src,
                    limits,
                    size,
                    spent: 0,
                    visited: HashSet::new(),
                    out: Vec::new(),
                    sector,
                };
                walk.dir(root.lba, root.size, "", 0)?;
                return Ok(walk.out);
            }
            _ => {}
        }
    }
    refuse(Code::NotAnImage, "no primary volume descriptor")
}

struct Walk<'a> {
    src: &'a mut dyn ReadAt,
    limits: &'a Limits,
    size: u64,
    spent: u32,
    visited: HashSet<u32>,
    out: Vec<IsoFile>,
    sector: Vec<u8>,
}

impl Walk<'_> {
    fn spend(&mut self) -> Result<()> {
        self.spent += 1;
        if self.spent > self.limits.max_records {
            return refuse(
                Code::BudgetExceeded,
                "the image has more directory data than a disc could",
            );
        }
        Ok(())
    }

    fn dir(&mut self, lba: u32, dir_size: u32, prefix: &str, depth: u32) -> Result<()> {
        if depth > self.limits.max_dir_depth {
            return refuse(
                Code::BudgetExceeded,
                "directories nest deeper than the depth limit",
            );
        }
        if !self.visited.insert(lba) {
            return Ok(()); // points back at itself or an ancestor
        }
        let start = lba as u64 * SECTOR;
        check_range(self.size, start, dir_size as u64)
            .or_else(|_| refuse(Code::Truncated, "a directory lies outside the image"))?;
        let sectors = (dir_size as u64).div_ceil(SECTOR);
        let mut children: Vec<DirRecord> = Vec::new();
        for s in 0..sectors {
            let sector_start = start + s * SECTOR;
            // The extent's last sector may be short; records never straddle
            // a sector boundary, so each sector parses on its own.
            let len = (dir_size as u64 - s * SECTOR).min(SECTOR) as usize;
            self.sector.resize(len, 0);
            let mut buf = std::mem::take(&mut self.sector);
            self.src.read_at(sector_start, &mut buf)?;
            let mut p = 0;
            loop {
                // Every iteration (a record or the skip to the next sector)
                // spends budget, so no crafted shape can spin unbounded.
                self.spend()?;
                let Some(rec) = parse_record(&buf, p)? else {
                    break;
                };
                p += rec.length;
                // ".", "..", and associated files are not listed.
                if rec.name.as_deref().is_some_and(|n| !n.is_empty()) && !rec.associated {
                    children.push(rec);
                }
            }
            self.sector = buf;
        }
        // One entry per name: of several versions of a file the highest
        // wins, as a reader of the disc would see it; the same name twice at
        // one version (wherever the records sit), or as both a file and a
        // directory, is refused. A multi-extent file's records share one
        // name and version: the first carries the flag, so the file lists
        // once, as unreadable, and its later records are passed over.
        let mut best: HashMap<String, (usize, u32, bool)> = HashMap::new();
        let mut versions: HashMap<(String, u32), usize> = HashMap::new();
        for (i, c) in children.iter().enumerate() {
            let name = c.name.clone().unwrap_or_default();
            if !c.is_dir {
                if let Some(&first) = versions.get(&(name.clone(), c.version)) {
                    if children[first].multi_extent {
                        continue;
                    }
                    return refuse(
                        Code::CorruptImage,
                        "two directory records resolve to the same path",
                    );
                }
                versions.insert((name.clone(), c.version), i);
            }
            match best.get(&name) {
                None => {
                    best.insert(name, (i, c.version, c.is_dir));
                }
                Some(&(_, v, d)) if !d && !c.is_dir => {
                    if c.version > v {
                        best.insert(name, (i, c.version, c.is_dir));
                    }
                }
                Some(_) => {
                    return refuse(
                        Code::CorruptImage,
                        "two directory records resolve to the same path",
                    )
                }
            }
        }
        for (i, c) in children.into_iter().enumerate() {
            let name = c.name.unwrap_or_default();
            if best.get(&name).map(|b| b.0) != Some(i) {
                continue; // an older version of a listed file
            }
            if c.is_dir {
                if let Some(why) = c.problem {
                    return refuse(
                        Code::CorruptImage,
                        format!("the directory {prefix}{name}: {why}"),
                    );
                }
                self.dir(c.lba, c.size, &format!("{prefix}{name}/"), depth + 1)?;
            } else {
                self.out.push(IsoFile {
                    path: format!("{prefix}{name}"),
                    name,
                    size: c.size,
                    lba: c.lba,
                    unreadable: c.problem,
                });
            }
        }
        Ok(())
    }
}
