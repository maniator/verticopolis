//! The source scanner the guard tests share: where the crate is, its Rust
//! files, and which bytes of a file are code, comments or literals.
// Each test binary uses only some of these.
#![allow(dead_code)]

use std::path::{Path, PathBuf};

pub fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

pub fn rel(p: &Path) -> String {
    normalize(p)
        .strip_prefix(normalize(&crate_dir()))
        .expect("under the crate")
        .to_string_lossy()
        .replace('\\', "/")
}

/// `a/b/../c` as `a/c`, without touching the file system.
pub fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            std::path::Component::ParentDir => {
                out.pop();
            }
            std::path::Component::CurDir => {}
            other => out.push(other),
        }
    }
    out
}

pub fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let mut entries: Vec<_> = std::fs::read_dir(dir)
        .expect("source dir")
        .map(|e| e.expect("entry").path())
        .collect();
    entries.sort();
    for p in entries {
        if p.is_dir() {
            rust_files(&p, out);
        } else if p.extension().is_some_and(|e| e == "rs") {
            out.push(p);
        }
    }
}

/// What a byte of source belongs to.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Part {
    Code,
    Comment,
    Literal,
}

pub fn is_ident(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

/// Which bytes of `src` are code, comments, or string and character
/// literals.
pub fn parts(src: &str) -> Vec<Part> {
    let b = src.as_bytes();
    let mut mask = vec![Part::Code; b.len()];
    let mut i = 0;
    while i < b.len() {
        let start = i;
        let mut part = Part::Literal;
        // A raw string may carry a `b` or `c` prefix (`br#"..."#`).
        let raw_at = if matches!(b[i], b'b' | b'c') && b.get(i + 1) == Some(&b'r') {
            i + 1
        } else {
            i
        };
        let raw = b[raw_at] == b'r'
            && matches!(b.get(raw_at + 1), Some(b'"') | Some(b'#'))
            && (i == 0 || !is_ident(b[i - 1]));
        if b[i] == b'/' && b.get(i + 1) == Some(&b'/') {
            part = Part::Comment;
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
        } else if b[i] == b'/' && b.get(i + 1) == Some(&b'*') {
            part = Part::Comment;
            let mut depth = 0;
            while i < b.len() {
                if b[i] == b'/' && b.get(i + 1) == Some(&b'*') {
                    depth += 1;
                    i += 2;
                } else if b[i] == b'*' && b.get(i + 1) == Some(&b'/') {
                    depth -= 1;
                    i += 2;
                    if depth == 0 {
                        break;
                    }
                } else {
                    i += 1;
                }
            }
        } else if raw {
            let mut j = raw_at + 1;
            let mut hashes = 0;
            while b.get(j) == Some(&b'#') {
                hashes += 1;
                j += 1;
            }
            if b.get(j) != Some(&b'"') {
                i += 1;
                continue;
            }
            j += 1;
            while j < b.len() {
                if b[j] == b'"' && (0..hashes).all(|k| b.get(j + 1 + k) == Some(&b'#')) {
                    j += 1 + hashes;
                    break;
                }
                j += 1;
            }
            i = j;
        } else if b[i] == b'"' {
            i += 1;
            while i < b.len() && b[i] != b'"' {
                if b[i] == b'\\' {
                    i += 1;
                }
                i += 1;
            }
            i += 1;
        } else if b[i] == b'\'' {
            // A character literal ('x', '\n', '\'', '\u{..}') or a lifetime.
            if b.get(i + 1) == Some(&b'\\') {
                // Past the quote, the backslash and the escaped character.
                i += 3;
                while i < b.len() && b[i] != b'\'' {
                    i += 1;
                }
                i += 1;
            } else {
                let c = src[i + 1..].chars().next().map_or(1, char::len_utf8);
                if b.get(i + 1 + c) == Some(&b'\'') {
                    i += 2 + c;
                } else {
                    i += 1;
                    continue;
                }
            }
        } else {
            i += 1;
            continue;
        }
        let end = i.min(b.len());
        mask[start..end].iter_mut().for_each(|m| *m = part);
    }
    mask
}
