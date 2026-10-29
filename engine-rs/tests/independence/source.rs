//! One library file as the checks read it, and the scan behind it.

use super::scan::{crate_dir, is_ident, parts, rel, rust_files, Part};
use super::{included_code, HOST_MODULES, HOST_ONLY, ITEM_KEYWORDS, MAY_READ_FILES, MODULE_DIR};

/// One library file as the checks read it.
pub(super) struct Library {
    /// Code only: comments and literals blanked, test items removed.
    pub(super) code: String,
    /// The source with test items removed, for reading `include_*` paths.
    pub(super) src: String,
    /// What each byte of `src` is.
    pub(super) parts: Vec<Part>,
}

/// Remove every `#[cfg(test)]` item from `src`. Returns the kept source and
/// the files those items pull in with `#[path = "..."]`. An item runs from
/// the attribute to its first `;` outside any bracket or to the brace that
/// closes its body; a scan that leaves its enclosing scope or runs off the
/// file stops the test, so a misread can never hide library code.
pub(super) fn strip_tests(name: &str, src: &str) -> (String, Vec<String>) {
    let parts = parts(src);
    let b = src.as_bytes();
    let mut keep = vec![true; b.len()];
    let mut test_paths = Vec::new();
    let marker = "#[cfg(test)]";
    let mut from = 0;
    while let Some(off) = src[from..].find(marker) {
        let at = from + off;
        from = at + marker.len();
        if parts[at] != Part::Code {
            continue;
        }
        // Past whitespace, further attributes and a visibility, to the word
        // that says what the attribute is on.
        let mut k = from;
        loop {
            while k < b.len() && (b[k].is_ascii_whitespace() || parts[k] == Part::Comment) {
                k += 1;
            }
            if b.get(k) == Some(&b'#') {
                let close = src[k..].find(']').expect("an attribute closes");
                k += close + 1;
                continue;
            }
            break;
        }
        let word = |k: usize| {
            let n = b[k..].iter().take_while(|c| is_ident(**c)).count();
            &src[k..k + n]
        };
        if word(k) == "pub" {
            k += 3;
            if b.get(k) == Some(&b'(') {
                k += src[k..].find(')').expect("a visibility closes") + 1;
            }
            while k < b.len() && b[k].is_ascii_whitespace() {
                k += 1;
            }
        }
        assert!(
            ITEM_KEYWORDS.contains(&word(k)),
            "{name}: the #[cfg(test)] at byte {at} is not on an item ({:?})",
            word(k)
        );
        let mut depth: i64 = 0;
        let mut end = None;
        for i in from..b.len() {
            if parts[i] != Part::Code {
                continue;
            }
            match b[i] {
                b'{' | b'(' | b'[' => depth += 1,
                b'}' | b')' | b']' => {
                    depth -= 1;
                    assert!(
                        depth >= 0,
                        "{name}: the #[cfg(test)] at byte {at} is not on an item"
                    );
                    if depth == 0 && b[i] == b'}' {
                        end = Some(i + 1);
                        break;
                    }
                }
                b';' if depth == 0 => {
                    end = Some(i + 1);
                    break;
                }
                _ => {}
            }
        }
        let end = end.unwrap_or_else(|| panic!("{name}: the #[cfg(test)] at byte {at} never ends"));
        // Attributes written above `#[cfg(test)]` (a `#[path]`, say) belong
        // to the same item.
        let line_start = src[..at].rfind('\n').map_or(0, |i| i + 1);
        let before = src[line_start..at].trim();
        // Code sharing the line before the attribute is library code: keep
        // it, and look for attributes above only when the line starts here.
        let mut start = if before.is_empty() || before.starts_with("#[") {
            line_start
        } else {
            at
        };
        while start > 0 && b[start - 1] == b'\n' {
            let prev = src[..start - 1].rfind('\n').map_or(0, |i| i + 1);
            let line = src[prev..start - 1].trim();
            if line.starts_with("#[")
                && line.ends_with(']')
                && parts[prev + src[prev..].find('#').unwrap()] == Part::Code
            {
                start = prev;
            } else {
                break;
            }
        }
        let start = if src[start..at].trim().is_empty() {
            at
        } else {
            start
        };
        let paths = path_attributes(src, &parts, start, end);
        if paths.is_empty() {
            // `#[cfg(test)] mod name;` loads `name.rs` or `name/mod.rs` from
            // the module's directory; record it the way a #[path] is.
            let item = squeeze(
                &src[k..end]
                    .chars()
                    .filter(|c| !c.is_control() || *c == ' ')
                    .collect::<String>(),
            );
            if let Some(m) = item.strip_prefix("mod ").and_then(|m| m.strip_suffix(';')) {
                test_paths.push(format!("{MODULE_DIR}{m}.rs"));
                test_paths.push(format!("{MODULE_DIR}{m}/mod.rs"));
            }
        }
        test_paths.extend(paths);
        keep[start..end].iter_mut().for_each(|k| *k = false);
        from = end;
    }
    let kept: String = src
        .char_indices()
        .filter(|(i, _)| keep[*i])
        .map(|(_, c)| c)
        .collect();
    (kept, test_paths)
}

/// The files the `#[path = "..."]` attributes in `src[from..to]` name, read
/// only where the attribute is code (a comment or a string that mentions one
/// does not count).
pub(super) fn path_attributes(src: &str, parts: &[Part], from: usize, to: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut at = from;
    while let Some(off) = src[at..to].find("#[path") {
        let p = at + off;
        at = p + 6;
        if parts[p] != Part::Code {
            continue;
        }
        let open = p + src[p..to].find('"').expect("a #[path] names a file");
        let close = open + 1 + src[open + 1..to].find('"').expect("the path closes");
        out.push(src[open + 1..close].to_string());
        at = close;
    }
    out
}

pub(super) fn library(name: &str, src: &str) -> (Library, Vec<String>) {
    let (src, test_paths) = strip_tests(name, src);
    let parts = parts(&src);
    // Byte for byte, so an offset in `code` is the same offset in `src`.
    let code = src
        .char_indices()
        .flat_map(|(i, c)| {
            let blank = match (parts[i], c) {
                (Part::Code, _) => None,
                (_, '\n') => Some('\n'),
                _ => Some(' '),
            };
            match blank {
                None => vec![c],
                Some(b) => vec![b; c.len_utf8()],
            }
        })
        .collect();
    (Library { code, src, parts }, test_paths)
}

/// Every library source, keyed by its path in the crate.
pub(super) fn library_sources() -> Vec<(String, Library)> {
    let mut files = Vec::new();
    rust_files(&crate_dir().join("src"), &mut files);
    let mut test_only: Vec<String> = Vec::new();
    // Files the library itself loads; a file both a test and the library
    // load is library code and stays in the scan.
    let mut production: Vec<String> = Vec::new();
    let mut out = Vec::new();
    for p in &files {
        let name = rel(p);
        if name.starts_with("src/bin/") {
            continue;
        }
        let src = std::fs::read_to_string(p).expect("source reads");
        let (lib, paths) = library(&name, &src);
        let dir = p.parent().expect("dir");
        let resolve = |t: &str| {
            let file = match t.strip_prefix(MODULE_DIR) {
                // `lib.rs` and `mod.rs` own their directory; `foo.rs` owns `foo/`.
                Some(t) if matches!(name.rsplit('/').next(), Some("lib.rs" | "mod.rs")) => {
                    dir.join(t)
                }
                Some(t) => dir.join(p.file_stem().expect("stem")).join(t),
                None => dir.join(t),
            };
            rel(&file)
        };
        test_only.extend(paths.iter().map(|t| resolve(t)));
        // `#[path]` modules and `include!` targets.
        production.extend(included_code(&lib).iter().map(|t| resolve(t)));
        production.extend(
            module_declarations(&lib.code)
                .iter()
                .flat_map(|m| {
                    [
                        format!("{MODULE_DIR}{m}.rs"),
                        format!("{MODULE_DIR}{m}/mod.rs"),
                    ]
                })
                .map(|t| resolve(&t)),
        );
        out.push((name, lib));
    }
    test_only.retain(|f| !production.contains(f));
    out.retain(|(name, _)| !test_only.contains(name));
    assert!(out.len() > 30, "found {} library files", out.len());
    out
}

/// The names of the file modules `code` declares (`mod name;`, with any
/// visibility), test items already removed.
pub(super) fn module_declarations(code: &str) -> Vec<String> {
    let c = squeeze(code);
    c.match_indices("mod ")
        .filter(|(i, _)| *i == 0 || !is_ident(c.as_bytes()[i - 1]))
        .filter_map(|(i, _)| {
            let rest = &c[i + 4..];
            let n = rest.bytes().take_while(|b| is_ident(*b)).count();
            (n > 0 && rest[n..].starts_with(';')).then(|| rest[..n].to_string())
        })
        .collect()
}

/// The code with whitespace dropped except one space between two words, so
/// `std :: env` and a path wrapped over two lines read as `std::env` while
/// `pub extern "C" fn` reads as `pub extern fn`.
pub(super) fn squeeze(code: &str) -> String {
    let mut out = String::with_capacity(code.len());
    let mut gap = false;
    for c in code.chars() {
        if c.is_whitespace() {
            gap = true;
            continue;
        }
        let word = |c: char| c.is_ascii() && is_ident(c as u8);
        if gap && out.chars().last().is_some_and(word) && word(c) {
            out.push(' ');
        }
        gap = false;
        out.push(c);
    }
    out
}

/// Whether `needle` occurs in `hay`, at the start of a word when the needle
/// starts with one.
pub(super) fn has(hay: &str, needle: &str) -> bool {
    let wordy = needle.as_bytes()[0].is_ascii_alphabetic();
    hay.match_indices(needle)
        .any(|(i, _)| !wordy || i == 0 || !is_ident(hay.as_bytes()[i - 1]))
}

/// The host services `code` reaches: the [`HOST_ONLY`] paths, the
/// [`HOST_MODULES`] and `fs` named in a grouped `std` import, and `std::fs`.
/// Returns (services, reads files).
pub(super) fn host_services(code: &str) -> (Vec<String>, bool) {
    let c = squeeze(code);
    let mut found: Vec<String> = HOST_ONLY
        .iter()
        .filter(|n| has(&c, n))
        .map(|n| n.to_string())
        .collect();
    // A path is how code reaches the file system without `std::fs`
    // (`Path::exists`, `read_dir`, `metadata`).
    let mut reads_files = has(&c, "std::fs") || has(&c, "std::path");
    let mut rest = c.as_str();
    while let Some(at) = rest.find("std::{") {
        let group = &rest[at + 5..];
        let mut depth = 0;
        let mut end = group.len();
        for (i, ch) in group.char_indices() {
            match ch {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        end = i;
                        break;
                    }
                }
                _ => {}
            }
        }
        let inner = &group[1..end];
        // The head of each path in the group: what follows `{` or `,` at the
        // group's top level.
        let mut level = 0;
        let mut head = true;
        let mut word = String::new();
        let mut heads = Vec::new();
        for ch in inner.chars().chain(std::iter::once(',')) {
            if head && ch.is_ascii() && is_ident(ch as u8) {
                word.push(ch);
                continue;
            }
            if head && !word.is_empty() {
                heads.push(std::mem::take(&mut word));
            }
            head = false;
            match ch {
                '{' => level += 1,
                '}' => level -= 1,
                ',' if level == 0 => head = true,
                _ => {}
            }
        }
        for h in heads {
            if h == "fs" || h == "path" {
                reads_files = true;
            } else if HOST_MODULES.contains(&h.as_str()) {
                found.push(format!("std::{{{h}}}"));
            }
        }
        if ["stdin", "stdout", "stderr"]
            .iter()
            .any(|s| inner.contains(s))
        {
            found.push("std::{io::std*}".into());
        }
        rest = &group[end..];
    }
    (found, reads_files)
}

/// The source of the free function `name` in `code` (literals and comments
/// blanked): from `fn name` to the brace that closes its body.
pub(super) fn function_body<'a>(code: &'a str, name: &str) -> Option<&'a str> {
    let needle = format!("fn {name}");
    let at = code
        .match_indices(&needle)
        .find(|(i, _)| {
            let after = code
                .as_bytes()
                .get(i + needle.len())
                .copied()
                .unwrap_or(b' ');
            !is_ident(after) && (*i == 0 || !is_ident(code.as_bytes()[i - 1]))
        })?
        .0;
    let open = at + code[at..].find('{')?;
    let mut depth = 0;
    for (i, ch) in code[open..].char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&code[at..open + i + 1]);
                }
            }
            _ => {}
        }
    }
    None
}

/// `code` with the [`MAY_READ_FILES`] functions of `name` and the file
/// imports blanked out. Each listed function must exist.
pub(super) fn without_exempt_functions(name: &str, code: &str) -> String {
    let Some((_, functions)) = MAY_READ_FILES.iter().find(|(f, _)| *f == name) else {
        return code.to_string();
    };
    let mut out = code.to_string();
    for function in *functions {
        let body = function_body(code, function)
            .unwrap_or_else(|| panic!("{name} has no fn {function}; update MAY_READ_FILES"));
        let at = body.as_ptr() as usize - code.as_ptr() as usize;
        out.replace_range(at..at + body.len(), &" ".repeat(body.len()));
    }
    out.lines()
        .map(|l| {
            let t = l.trim_start();
            if t.starts_with("use std::path") || t.starts_with("use std::fs") {
                ""
            } else {
                l
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}
