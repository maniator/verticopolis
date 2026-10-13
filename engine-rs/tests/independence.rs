//! The engine library stays a library any host can link: no file, network,
//! process, environment or clock access in the simulation, nothing from the
//! JavaScript binding outside `src/wasm.rs`, and nothing compiled in from the
//! web game's tree. A native host, the WASM binding and the referee all link
//! the same code, so a dependency on any of these would tie every frontend to
//! one host. `engine-rs/API.md` states the rule; this test holds it.
//!
//! Test code (`#[cfg(test)]` items and the files they pull in with `#[path]`)
//! and the binaries under `src/bin/` may read files: they are the referee and
//! its tools, not the engine.

use std::path::{Path, PathBuf};

/// Library files that may read files: the conformance runner and the `.TDT`
/// referee open the scenario fixtures and the lock tables they are given a
/// path to. Neither is reached from a game a host runs. Moving them behind a
/// feature is a later stage of the engine-independence plan (API.md).
const MAY_READ_FILES: &[&str] = &["src/scenario.rs", "src/tdt/referee.rs"];

/// Host services the simulation never reaches for: the host owns IO, time
/// and the process. `std::fs` is checked separately against
/// [`MAY_READ_FILES`].
const HOST_ONLY: &[&str] = &[
    "std::env",
    "std::net",
    "std::process",
    "std::time",
    "SystemTime",
    "Instant::now",
    "env!(",
    "option_env!(",
];

fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn rel(p: &Path) -> String {
    p.strip_prefix(crate_dir())
        .expect("under the crate")
        .to_string_lossy()
        .replace('\\', "/")
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
#[derive(Clone, Copy, PartialEq)]
enum Part {
    Code,
    Comment,
    Literal,
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
        if b[i] == b'/' && b.get(i + 1) == Some(&b'/') {
            part = Part::Comment;
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
        } else if b[i] == b'/' && b.get(i + 1) == Some(&b'*') {
            part = Part::Comment;
            let mut depth = 0;
            loop {
                if i >= b.len() {
                    break;
                }
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
        } else if b[i] == b'r'
            && (b.get(i + 1) == Some(&b'"') || b.get(i + 1) == Some(&b'#'))
            && (i == 0 || !(b[i - 1].is_ascii_alphanumeric() || b[i - 1] == b'_'))
        {
            // A raw string: r"..." or r#"..."#.
            let mut j = i + 1;
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
            loop {
                if j >= b.len() {
                    break;
                }
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
            // A character literal ('x', '\n', '\u{..}') or a lifetime ('a).
            if b.get(i + 1) == Some(&b'\\') {
                i += 2;
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

/// The source with every `#[cfg(test)]` item removed and comments blanked
/// (string literals are kept, so `include_str!` paths stay readable), plus
/// the files those items pull in with `#[path = "..."]`.
fn library_code(src: &str) -> (String, Vec<String>) {
    let mask: Vec<bool> = parts(src).iter().map(|p| *p == Part::Code).collect();
    let comment: Vec<bool> = parts(src).iter().map(|p| *p == Part::Comment).collect();
    let b = src.as_bytes();
    let mut keep = vec![true; b.len()];
    let mut test_paths = Vec::new();
    let marker = "#[cfg(test)]";
    let mut from = 0;
    while let Some(off) = src[from..].find(marker) {
        let at = from + off;
        from = at + marker.len();
        if !mask[at] {
            continue;
        }
        // The item runs to its first top-level `;` or its matching `}`.
        let mut i = from;
        let mut depth = 0;
        let mut end = b.len();
        while i < b.len() {
            if mask[i] {
                match b[i] {
                    b'{' => depth += 1,
                    b'}' => {
                        depth -= 1;
                        if depth == 0 {
                            end = i + 1;
                            break;
                        }
                    }
                    b';' if depth == 0 => {
                        end = i + 1;
                        break;
                    }
                    _ => {}
                }
            }
            i += 1;
        }
        let item = &src[at..end];
        if let Some(p) = item.find("#[path = \"") {
            let rest = &item[p + 10..];
            test_paths.push(rest[..rest.find('"').expect("path closes")].to_string());
        }
        keep[at..end].iter_mut().for_each(|k| *k = false);
    }
    let mut out = String::with_capacity(src.len());
    for (i, ch) in src.char_indices() {
        if !keep[i] {
            continue;
        }
        if comment[i] {
            out.push(if ch == '\n' { '\n' } else { ' ' });
        } else {
            out.push(ch);
        }
    }
    (out, test_paths)
}

/// Every library source, keyed by its path in the crate, as library code.
fn library_sources() -> Vec<(String, String)> {
    let mut files = Vec::new();
    rust_files(&crate_dir().join("src"), &mut files);
    let mut test_only: Vec<PathBuf> = Vec::new();
    let mut out = Vec::new();
    for p in &files {
        if rel(p).starts_with("src/bin/") {
            continue;
        }
        let src = std::fs::read_to_string(p).expect("source reads");
        let (code, paths) = library_code(&src);
        for t in paths {
            test_only.push(p.parent().expect("dir").join(t));
        }
        out.push((rel(p), code));
    }
    let test_only: Vec<String> = test_only.iter().map(|p| rel(p)).collect();
    out.retain(|(name, _)| !test_only.contains(name));
    assert!(out.len() > 30, "found {} library files", out.len());
    out
}

#[test]
fn the_library_uses_no_host_service() {
    let mut found = Vec::new();
    for (name, code) in library_sources() {
        for needle in HOST_ONLY {
            if code.contains(needle) {
                found.push(format!("{name}: {needle}"));
            }
        }
        let reads_files = code.contains("std::fs")
            || code.contains("use std::{") && code.contains("fs,")
            || code.contains("fs::read");
        if reads_files && !MAY_READ_FILES.contains(&name.as_str()) {
            found.push(format!("{name}: std::fs"));
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
        .filter(|(name, code)| name != "src/wasm.rs" && code.contains("wasm_bindgen"))
        .map(|(name, _)| name)
        .collect();
    assert!(
        found.is_empty(),
        "wasm_bindgen outside src/wasm.rs: {found:?}"
    );
    let lib = std::fs::read_to_string(crate_dir().join("src/lib.rs")).expect("lib.rs");
    assert!(
        lib.contains("#[cfg(feature = \"wasm\")]\npub mod wasm;"),
        "src/wasm.rs is compiled only with the wasm feature"
    );
}

#[test]
fn compiled_in_data_comes_from_the_crate_or_the_conformance_suite() {
    let mut found = Vec::new();
    for (name, code) in library_sources() {
        for mac in ["include_str!(\"", "include_bytes!(\""] {
            let mut rest = code.as_str();
            while let Some(at) = rest.find(mac) {
                rest = &rest[at + mac.len()..];
                let path = &rest[..rest.find('"').expect("path closes")];
                let file = crate_dir().join(&name).parent().unwrap().join(path);
                let resolved = normalize(&file);
                let repo = normalize(&crate_dir().join(".."));
                let in_crate = resolved.starts_with(normalize(&crate_dir()));
                let in_suite = resolved.starts_with(repo.join("conformance"));
                if !(in_crate || in_suite) {
                    found.push(format!("{name}: {path}"));
                }
            }
        }
    }
    assert!(
        found.is_empty(),
        "the library compiles in a file from outside engine-rs/ and conformance/: {found:?}"
    );
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

#[test]
fn the_binding_is_an_optional_feature() {
    let toml = std::fs::read_to_string(crate_dir().join("Cargo.toml")).expect("Cargo.toml");
    let line = toml
        .lines()
        .find(|l| l.starts_with("wasm-bindgen"))
        .expect("wasm-bindgen is declared");
    assert!(
        line.contains("optional = true"),
        "wasm-bindgen must stay optional: {line}"
    );
    assert!(
        !toml.lines().any(|l| l.trim_start().starts_with("default")),
        "the crate has no default features, so a host links no binding by default"
    );
    for browser in ["js-sys", "web-sys", "getrandom"] {
        assert!(
            !toml.lines().any(|l| l.starts_with(browser)),
            "{browser} is a browser or host dependency"
        );
    }
}

#[test]
fn the_scanner_sees_through_comments_strings_and_test_items() {
    let src = r##"
// std::env in a comment
/* std::process in a block /* nested */ comment */
fn a() { let s = "std::net in a string"; let c = '{'; let r = r#"std::time"#; }
#[cfg(test)]
mod tests { fn t() { let _ = std::env::var("X"); let b = '}'; } }
#[cfg(test)]
#[path = "x_tests.rs"]
mod x_tests;
fn b<'a>(x: &'a str) -> &'a str { x }
fn c() { std::fs::read("y"); }
"##;
    let (code, paths) = library_code(src);
    assert_eq!(paths, vec!["x_tests.rs".to_string()]);
    assert!(
        !code.contains("std::env"),
        "test item and comment removed: {code}"
    );
    assert!(!code.contains("std::process"));
    assert!(
        code.contains("std::fs::read"),
        "code after the test items is kept"
    );
    assert!(code.contains("fn b<'a>"));
    assert!(
        code.contains("\"std::net in a string\""),
        "strings are kept"
    );
}
