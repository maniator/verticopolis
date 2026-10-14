//! The engine library stays a library any host can link: no file, network,
//! process, environment, console or clock access in the simulation, nothing
//! from the JavaScript binding outside `src/wasm.rs`, and nothing compiled in
//! from the web game's tree. A native host, the WASM binding and the referee
//! all link the same code, so a dependency on any of these would tie every
//! frontend to one host. `engine-rs/API.md` states the rule; this test holds
//! it.
//!
//! Test code (`#[cfg(test)]` items and the files they pull in with `#[path]`)
//! and the binaries under `src/bin/` may read files: they are the referee and
//! its tools. A few named functions in two harness modules may read files
//! too (see [`MAY_READ_FILES`]).

use std::path::{Path, PathBuf};

/// The library functions that may read files: the conformance runner and the
/// `.TDT` referee open the scenario fixtures and the lock tables they are
/// given a path to, and none is reached from a game a host runs. Only these
/// bodies (and the files' `std::path` / `std::fs` imports) are exempt; the
/// rest of each file, `state_view` and any helper included, is scanned like
/// any other library code. Moving the harness behind a feature is a later
/// stage of the engine-independence plan (#980).
const MAY_READ_FILES: &[(&str, &[&str])] = &[
    (
        "src/scenario.rs",
        &[
            "start_sim",
            "run_scenario",
            "run_scenario_until",
            "run_scenario_inner",
        ],
    ),
    (
        "src/tdt/referee.rs",
        &["fixture_save", "replay_export", "replay_all", "read_lock"],
    ),
];

/// Host services the simulation never reaches for, as they read in
/// [`squeeze`]d code: the host owns IO, time, threads, the process and
/// foreign code. A needle that starts with a letter matches only at the start
/// of a word, so `print!(` does not match `blueprint!(`.
/// `std::fs` and `std::path` are checked separately against
/// [`MAY_READ_FILES`].
const HOST_ONLY: &[&str] = &[
    "std::env",
    "std::net",
    "std::process",
    "std::time",
    "std::thread",
    "std::os",
    "io::stdin",
    "io::stdout",
    "io::stderr",
    "stdin(",
    "stdout(",
    "stderr(",
    "extern{",
    "extern fn",
    "libc::",
    "SystemTime",
    "Instant::now",
    "env!",
    "option_env!",
    "print!",
    "println!",
    "eprint!",
    "eprintln!",
    "dbg!",
];

/// The `std` modules a grouped import (`use std::{...}`) may not name.
const HOST_MODULES: &[&str] = &["env", "net", "os", "process", "time", "thread"];

/// Every package `Cargo.lock` may name, optional ones (the binding's)
/// included. A host service can arrive through a dependency without a
/// `std::` path in `src/`, so a new crate fails this test until it is
/// reviewed and listed here. Never list a crate that reaches a browser, the
/// host's entropy, clock, console, threads or files on its own (`getrandom`,
/// `js-sys`, `web-sys`, a logger, a thread pool, a time library). The
/// exceptions are the optional binding's own crates (`wasm-bindgen*` and
/// `bumpalo`, compiled only with the `wasm` feature) and `libc`, which the
/// hashing and compression crates use for CPU feature detection. A crate
/// that only a dev-dependency pulls in belongs in [`TEST_ONLY_CRATES`].
const ALLOWED_CRATES: &[&str] = &[
    "adler2",
    "base64",
    "block-buffer",
    "bumpalo",
    "cfg-if",
    "const-oid",
    "cpufeatures",
    "crc32fast",
    "crypto-common",
    "digest",
    "equivalent",
    "flate2",
    // A hasher serde_json's ordered maps take on newer versions (the
    // consumer resolves one); pure computation.
    "foldhash",
    "hashbrown",
    "hybrid-array",
    "indexmap",
    "itoa",
    "libc",
    "memchr",
    "miniz_oxide",
    "once_cell",
    "proc-macro2",
    "quote",
    "rustversion",
    "ryu",
    "serde",
    "serde_core",
    "serde_derive",
    "serde_json",
    "sha2",
    "simd-adler32",
    "syn",
    "typenum",
    "unicode-ident",
    "verticopolis-engine",
    "wasm-bindgen",
    "wasm-bindgen-macro",
    "wasm-bindgen-macro-support",
    "wasm-bindgen-shared",
    "zlib-rs",
    "zmij",
];

/// Crates only the engine's own tests pull in. They never reach a host: the
/// CI `consumer` job checks a host's normal and build dependency tree for
/// `getrandom` and the browser crates. Empty today.
const TEST_ONLY_CRATES: &[&str] = &[];

/// Marks a test file found by Rust's default module lookup, which starts in
/// the module's own directory rather than the file's.
const MODULE_DIR: &str = "<module>/";

/// What may follow `#[cfg(test)]` (after other attributes and a visibility):
/// the keywords that start an item. Anything else (a field, a variant, a
/// match arm, a statement) stops the test, since the scan cannot tell where
/// such a thing ends.
const ITEM_KEYWORDS: &[&str] = &[
    "mod",
    "fn",
    "impl",
    "use",
    "const",
    "static",
    "struct",
    "enum",
    "trait",
    "type",
    "macro_rules",
    "extern",
    "unsafe",
    "async",
];

fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn rel(p: &Path) -> String {
    normalize(p)
        .strip_prefix(normalize(&crate_dir()))
        .expect("under the crate")
        .to_string_lossy()
        .replace('\\', "/")
}

/// `a/b/../c` as `a/c`, without touching the file system.
fn normalize(p: &Path) -> PathBuf {
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

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
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
enum Part {
    Code,
    Comment,
    Literal,
}

fn is_ident(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

/// Which bytes of `src` are code, comments, or string and character
/// literals.
fn parts(src: &str) -> Vec<Part> {
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

/// One library file as the checks read it.
struct Library {
    /// Code only: comments and literals blanked, test items removed.
    code: String,
    /// The source with test items removed, for reading `include_*` paths.
    src: String,
    /// What each byte of `src` is.
    parts: Vec<Part>,
}

/// Remove every `#[cfg(test)]` item from `src`. Returns the kept source and
/// the files those items pull in with `#[path = "..."]`. An item runs from
/// the attribute to its first `;` outside any bracket or to the brace that
/// closes its body; a scan that leaves its enclosing scope or runs off the
/// file stops the test, so a misread can never hide library code.
fn strip_tests(name: &str, src: &str) -> (String, Vec<String>) {
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
fn path_attributes(src: &str, parts: &[Part], from: usize, to: usize) -> Vec<String> {
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

fn library(name: &str, src: &str) -> (Library, Vec<String>) {
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
fn library_sources() -> Vec<(String, Library)> {
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
fn module_declarations(code: &str) -> Vec<String> {
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
fn squeeze(code: &str) -> String {
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
fn has(hay: &str, needle: &str) -> bool {
    let wordy = needle.as_bytes()[0].is_ascii_alphabetic();
    hay.match_indices(needle)
        .any(|(i, _)| !wordy || i == 0 || !is_ident(hay.as_bytes()[i - 1]))
}

/// The host services `code` reaches: the [`HOST_ONLY`] paths, the
/// [`HOST_MODULES`] and `fs` named in a grouped `std` import, and `std::fs`.
/// Returns (services, reads files).
fn host_services(code: &str) -> (Vec<String>, bool) {
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
fn function_body<'a>(code: &'a str, name: &str) -> Option<&'a str> {
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
fn without_exempt_functions(name: &str, code: &str) -> String {
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

#[test]
fn the_library_uses_no_host_service() {
    let mut found = Vec::new();
    for (name, lib) in library_sources() {
        let code = without_exempt_functions(&name, &lib.code);
        let (services, reads_files) = host_services(&code);
        found.extend(services.into_iter().map(|s| format!("{name}: {s}")));
        if reads_files {
            found.push(format!("{name}: file access (std::fs or std::path)"));
        }
    }
    assert!(
        found.is_empty(),
        "the engine library reaches for a host service the host owns: {found:#?}"
    );
}

#[test]
fn the_javascript_binding_stays_in_wasm_rs() {
    let found: Vec<String> = library_sources()
        .into_iter()
        .filter(|(name, lib)| name != "src/wasm.rs" && has(&squeeze(&lib.code), "wasm_bindgen"))
        .map(|(name, _)| name)
        .collect();
    assert!(
        found.is_empty(),
        "wasm_bindgen outside src/wasm.rs: {found:?}"
    );
    let text = std::fs::read_to_string(crate_dir().join("src/lib.rs"))
        .expect("lib.rs")
        .replace("\r\n", "\n");
    let (lib, _) = library("src/lib.rs", &text);
    // The comments are blank here, so a commented-out line does not count;
    // the attribute is matched on the source line it sits on.
    let code: Vec<&str> = lib.code.lines().map(str::trim).collect();
    let lines: Vec<&str> = lib.src.lines().map(str::trim).collect();
    let at = code
        .iter()
        .position(|l| l.ends_with("mod wasm;"))
        .expect("lib.rs declares the wasm module");
    assert_eq!(
        lines[..at].iter().rev().find(|l| !l.is_empty()),
        Some(&"#[cfg(feature = \"wasm\")]"),
        "src/wasm.rs is compiled only with the wasm feature"
    );
}

/// The files a library source compiles in: the path of every `include!`,
/// `include_str!` and `include_bytes!` and of every `#[path]` module, or
/// `Err` for an argument that is not a plain string literal without escapes.
fn included(lib: &Library) -> Vec<Result<String, String>> {
    includes(lib, &["include!", "include_str!", "include_bytes!"], true)
}

/// The files compiled in as code: `include!` and `#[path]` targets, whatever
/// their extension.
fn included_code(lib: &Library) -> Vec<String> {
    includes(lib, &["include!"], true)
        .into_iter()
        .filter_map(Result::ok)
        .collect()
}

fn includes(
    lib: &Library,
    macros: &[&str],
    with_path_modules: bool,
) -> Vec<Result<String, String>> {
    let b = lib.src.as_bytes();
    let skip = |mut i: usize| {
        while i < b.len() && (lib.parts[i] == Part::Comment || b[i].is_ascii_whitespace()) {
            i += 1;
        }
        i
    };
    let mut out = Vec::new();
    for &mac in macros {
        let mut from = 0;
        while let Some(off) = lib.code[from..].find(mac) {
            let at = from + off;
            from = at + mac.len();
            if at > 0 && is_ident(b[at - 1]) {
                continue;
            }
            let open = skip(from);
            if b.get(open) != Some(&b'(') {
                out.push(Err(format!("{mac} at byte {at} has no argument list")));
                continue;
            }
            let arg = skip(open + 1);
            if lib.parts.get(arg) != Some(&Part::Literal) {
                out.push(Err(format!("{mac} at byte {at} takes a computed path")));
                continue;
            }
            let end = (arg..b.len())
                .find(|i| lib.parts[*i] != Part::Literal)
                .unwrap_or(b.len());
            let lit = &lib.src[arg..end];
            let raw = lit.starts_with('r') || lit.starts_with("br");
            let value = lit
                .trim_start_matches('b')
                .trim_start_matches('r')
                .trim_matches('#');
            let value = value
                .strip_prefix('"')
                .and_then(|v| v.strip_suffix('"'))
                .unwrap_or(value);
            if !raw && value.contains('\\') {
                out.push(Err(format!("{mac} at byte {at} escapes its path")));
            } else {
                out.push(Ok(value.to_string()));
            }
        }
    }
    if with_path_modules {
        out.extend(
            path_attributes(&lib.src, &lib.parts, 0, lib.src.len())
                .into_iter()
                .map(Ok),
        );
    }
    out
}

#[test]
fn compiled_in_data_comes_from_the_crate_or_the_conformance_suite() {
    let mut found = Vec::new();
    let krate = normalize(&crate_dir());
    let suite = normalize(&crate_dir().join("../conformance"));
    for (name, lib) in library_sources() {
        for inc in included(&lib) {
            match inc {
                Ok(path) => {
                    let file = normalize(&crate_dir().join(&name).parent().unwrap().join(&path));
                    if !(file.starts_with(&krate) || file.starts_with(&suite)) {
                        found.push(format!("{name}: {path}"));
                    }
                }
                Err(e) => found.push(format!("{name}: {e}")),
            }
        }
        // An imported include macro (`use std::include as inc;`) hides its
        // calls from the include reader.
        if imports_include_macro(&lib.code) {
            found.push(format!("{name}: an include macro is imported"));
        }
        // A module path set through `cfg_attr` hides from the #[path] reader;
        // name the file with a plain #[path] under a #[cfg] instead.
        if conditional_path(&lib.code) {
            found.push(format!("{name}: a cfg_attr sets a module path"));
        }
        // Code compiled in from anywhere but a `.rs` file under src/ (the
        // binaries aside) would escape the host-service scan, which reads
        // exactly those files.
        for path in included_code(&lib) {
            let file = normalize(&crate_dir().join(&name).parent().unwrap().join(&path));
            if !path.ends_with(".rs")
                || !file.starts_with(krate.join("src"))
                || file.starts_with(krate.join("src/bin"))
            {
                found.push(format!("{name}: {path} is code the scan skips"));
            }
        }
    }
    assert!(
        found.is_empty(),
        "the library compiles in code or data from where it may not (data from engine-rs/ or conformance/, code from src/): {found:?}"
    );
}

/// Whether `code` imports an include macro from `std` or `core`, by path or
/// in a group.
fn imports_include_macro(code: &str) -> bool {
    let c = squeeze(code);
    ["std::", "core::"].iter().any(|root| {
        c.match_indices(root).any(|(i, _)| {
            let rest = &c[i + root.len()..];
            if rest.starts_with("include") {
                return true;
            }
            rest.strip_prefix('{').is_some_and(|g| {
                let group = &g[..g.find('}').unwrap_or(g.len())];
                group
                    .split([',', '{'])
                    .any(|h| h.trim().starts_with("include"))
            })
        })
    })
}

/// Whether any `cfg_attr` in `code` (literals blanked) sets a `path`.
fn conditional_path(code: &str) -> bool {
    let c = squeeze(code);
    c.match_indices("cfg_attr(").any(|(at, _)| {
        let mut depth = 0;
        for (i, ch) in c[at + 8..].char_indices() {
            match ch {
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth == 0 {
                        let args = &c[at + 8..at + 8 + i];
                        return args.match_indices("path").any(|(j, _)| {
                            (j == 0 || !is_ident(args.as_bytes()[j - 1]))
                                && args[j + 4..].starts_with('=')
                        });
                    }
                }
                _ => {}
            }
        }
        false
    })
}

/// The `key = value` lines of every TOML section whose header `keep`
/// accepts, with the spaces taken out of the value.
fn toml_keys(toml: &str, keep: impl Fn(&str) -> bool) -> Vec<(String, String)> {
    let mut inside = false;
    let mut out = Vec::new();
    for line in toml.lines().map(str::trim) {
        if line.starts_with('[') {
            inside = keep(line);
        } else if inside {
            if let Some((k, v)) = line.split_once('=') {
                out.push((k.trim().to_string(), v.replace(' ', "")));
            }
        }
    }
    out
}

#[test]
fn the_binding_is_an_optional_feature() {
    let toml = std::fs::read_to_string(crate_dir().join("Cargo.toml")).expect("Cargo.toml");
    assert!(
        !toml
            .lines()
            .any(|l| l.trim().starts_with("[dependencies.") || l.trim().starts_with("[target.")),
        "declare dependencies inline under [dependencies] so this test can read them"
    );
    let wasm: Vec<_> = toml_keys(&toml, |h| h.ends_with("dependencies]"))
        .into_iter()
        .filter(|(k, _)| k == "wasm-bindgen")
        .collect();
    assert_eq!(wasm.len(), 1, "wasm-bindgen is declared once");
    assert!(
        wasm[0].1.contains("optional=true"),
        "wasm-bindgen must stay optional: {}",
        wasm[0].1
    );
    assert!(
        toml_keys(&toml, |h| h == "[features]")
            .iter()
            .all(|(k, v)| k != "default" || v == "[]"),
        "the crate has no default features, so a host links no binding by default"
    );
}

#[test]
fn the_engine_has_no_build_script() {
    let toml = std::fs::read_to_string(crate_dir().join("Cargo.toml")).expect("Cargo.toml");
    assert!(
        !crate_dir().join("build.rs").exists()
            && toml_keys(&toml, |h| h == "[package]")
                .iter()
                .all(|(k, _)| k != "build"),
        "the engine's own build script would run on every consumer's machine, outside these checks"
    );
}

#[test]
fn every_locked_crate_is_reviewed() {
    // The engine's lock and the consumer's, which resolves newer patch
    // versions the way a host outside this repository would.
    let mut unlisted = Vec::new();
    for lock in ["Cargo.lock", "consumer/Cargo.lock"] {
        let text = std::fs::read_to_string(crate_dir().join(lock)).expect("a lock file");
        unlisted.extend(
            text.lines()
                .filter_map(|l| l.strip_prefix("name = \""))
                .map(|n| n.trim_end_matches('"').to_string())
                .filter(|n| {
                    n != "verticopolis-engine-consumer"
                        && !ALLOWED_CRATES.contains(&n.as_str())
                        && !(lock == "Cargo.lock" && TEST_ONLY_CRATES.contains(&n.as_str()))
                })
                .map(|n| format!("{lock}: {n}")),
        );
    }
    assert!(
        unlisted.is_empty(),
        "crates not reviewed for host access (see ALLOWED_CRATES): {unlisted:?}"
    );
}

#[test]
fn the_scanner_sees_through_comments_strings_and_test_items() {
    let src = r##"
// std::env in a comment
/* std::process in a block /* nested */ comment */
fn a() { let s = "std::net in a string"; let c = '{'; let q = '\''; let r = r#"std::time"#; }
fn bytes() -> &'static [u8] { br#"{"a":"}"# }
#[cfg(test)]
mod tests { fn t() { let _ = std::env::var("X"); let b = '}'; } }
#[cfg(test)]
fn sized() -> [u8; 4] { [0; 4] }
#[cfg(test)]
#[path = "x_tests.rs"]
mod x_tests;
fn b<'a>(x: &'a str) -> &'a str { x }
fn c() { std::fs::read("y"); }
"##;
    let (lib, paths) = library("sample", src);
    assert_eq!(paths, vec!["x_tests.rs".to_string()]);
    let (services, reads) = host_services(&lib.code);
    assert!(
        services.is_empty(),
        "comments, strings and test items: {services:?}"
    );
    assert!(reads, "code after the test items is kept");
    assert!(lib.code.contains("fn b<'a>"));
    assert!(
        !lib.code.contains("sized"),
        "a [T; N] return type does not end the item"
    );
    assert!(
        lib.src.contains("\"std::net in a string\""),
        "strings stay in src"
    );
}

#[test]
fn the_scanner_finds_every_spelling_of_a_host_service() {
    for (src, want) in [
        ("use std::{env, fs};", "std::{env}"),
        (
            "use std::{collections::HashMap, process};",
            "std::{process}",
        ),
        ("use std::{time::Instant};", "std::{time}"),
        ("use std::{io::{stdout, Write}};", "std::{io::std*}"),
        (
            "use std::io::{stdout, Write}; fn f() { stdout().flush(); }",
            "stdout(",
        ),
        ("use std::io; fn f() { io::stderr(); }", "io::stderr"),
        ("fn f() { std :: thread :: sleep(d); }", "std::thread"),
        ("fn f() { println!(\"x\"); }", "println!"),
        ("fn f() { println!{\"x\"} }", "println!"),
        ("fn f() { let t = Instant::now(); }", "Instant::now"),
        ("use std::os::unix::net::UnixStream;", "std::os"),
        ("use std::{os::unix::net::UnixStream};", "std::{os}"),
        ("extern \"C\" { fn open(p: *const u8) -> i32; }", "extern{"),
        ("pub extern \"C\" fn hook() {}", "extern fn"),
    ] {
        let (lib, _) = library("sample", src);
        let (services, _) = host_services(&lib.code);
        assert!(services.contains(&want.to_string()), "{src}: {services:?}");
    }
    for src in [
        "use std::{io, fs};",
        "use std::{fs::File, io::Read};",
        "use std::path::Path; fn f(p: &str) -> bool { Path::new(p).exists() }",
        "use std::{path::Path};",
    ] {
        let (lib, _) = library("sample", src);
        assert!(host_services(&lib.code).1, "{src} reads files");
    }
    let (lib, _) = library(
        "sample",
        "use std::{io::Read, collections::HashMap}; fn refs(a: u8, refs: u8) {} \
         macro_rules! blueprint { () => {} } fn g() { blueprint!(); my_env!(); }",
    );
    assert_eq!(
        host_services(&lib.code),
        (vec![], false),
        "in-memory IO and look-alike names"
    );
}

#[test]
fn the_scanner_reads_every_include_form() {
    // The macro names are spelled at run time (INC is replaced below), so
    // this file holds no include call a tool reading the source would follow.
    let src = r##"
// floors 30–60 → a comment with multibyte characters before the includes
const A: &str = INC_str!("../../conformance/a.json");
const B: &str = INC_str!(
    "../../src/b.ts"
);
const C: &[u8] = INC_bytes! (r#"../../src/c.bin"#);
const D: &str = INC_str!(concat!("x", "y"));
const E: &str = "INC_str!(\"in a string ×";
const F: &str = INC_str!("..\x2f..\x2fsrc/f.ts");
INC!("../../src/e.rs");
#[path = "../../src/g.rs"]
mod g;
// #[path = "../../src/not_this.rs"]
"##
    .replace("INC", "include");
    let (lib, _) = library("sample", &src);
    let got = included(&lib);
    for want in [
        "../../conformance/a.json",
        "../../src/b.ts",
        "../../src/c.bin",
        "../../src/e.rs",
        "../../src/g.rs",
    ] {
        assert!(got.contains(&Ok(want.into())), "{want}: {got:?}");
    }
    assert_eq!(got.iter().filter(|r| r.is_err()).count(), 2, "{got:?}");
    for src in [
        "#[cfg_attr(all(), path = \"../outside.rs\")]\nmod outside;",
        "#[cfg_attr(\n    feature = \"x\",\n    path = \"a.rs\"\n)]\nmod a;",
    ] {
        assert!(conditional_path(&library("sample", src).0.code), "{src}");
    }
    for src in [
        "use std::include as inc;",
        "use core::{include_str as s, fmt};",
        "use ::std::include_bytes;",
    ] {
        assert!(
            imports_include_macro(&library("sample", src).0.code),
            "{src}"
        );
    }
    assert!(!imports_include_macro(
        &library("sample", "use std::{fmt, io::Read};").0.code
    ));
    assert!(!conditional_path(
        &library(
            "sample",
            "#[cfg_attr(test, allow(dead_code))]\nfn classpath() {}"
        )
        .0
        .code
    ));
    assert_eq!(
        got.len(),
        7,
        "the string and the comment are not includes: {got:?}"
    );
}

#[test]
fn a_file_the_library_also_loads_stays_library_code() {
    let src = "#[cfg(test)]\n#[path = \"shared.rs\"]\nmod shared_tests;\n#[path = \"shared.rs\"]\nmod shared;\npub(crate) mod plain;\n";
    let (lib, test_paths) = library("sample", src);
    assert_eq!(test_paths, vec!["shared.rs".to_string()]);
    assert_eq!(
        path_attributes(&lib.src, &lib.parts, 0, lib.src.len()),
        vec!["shared.rs".to_string()]
    );
    assert_eq!(
        module_declarations(&lib.code),
        vec!["shared".to_string(), "plain".to_string()]
    );
}

#[test]
fn a_cfg_test_on_anything_but_an_item_stops_the_scan() {
    for src in [
        "struct S { a: u8, #[cfg(test)] b: u8 }\nfn f() {}",
        "fn f(x: u8) { match x { #[cfg(test)] 0 => g(), _ => { h() } } }",
    ] {
        let r = std::panic::catch_unwind(|| strip_tests("sample", src));
        assert!(
            r.is_err(),
            "{src}: a misread attribute must not strip library code"
        );
    }
    let (lib, _) = library(
        "sample",
        "fn kept() { std::env::var(\"X\"); } #[cfg(test)] mod t {}",
    );
    assert_eq!(
        host_services(&lib.code).0,
        vec!["std::env".to_string()],
        "code before the attribute on its line stays scanned"
    );
    let (_, paths) = strip_tests(
        "sample",
        "#[cfg(test)]\n// helpers for the tests below\n#[allow(dead_code)]\npub(crate) mod helpers;\n#[cfg(test)]\nmod tests { }\n#[path = \"above_tests.rs\"]\n#[allow(clippy::float_cmp)]\n#[cfg(test)]\nmod above;",
    );
    assert_eq!(
        paths,
        vec![
            format!("{MODULE_DIR}helpers.rs"),
            format!("{MODULE_DIR}helpers/mod.rs"),
            "above_tests.rs".to_string()
        ]
    );
}
