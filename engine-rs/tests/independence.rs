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
//! its tools. Two harness modules may read files too (see
//! [`MAY_READ_FILES`]).

use std::path::{Path, PathBuf};

/// Library files that may read files: the conformance runner and the `.TDT`
/// referee open the scenario fixtures and the lock tables they are given a
/// path to. Neither is reached from a game a host runs. Moving them behind a
/// feature is a later stage of the engine-independence plan (#980).
const MAY_READ_FILES: &[&str] = &["src/scenario.rs", "src/tdt/referee.rs"];

/// Host services the simulation never reaches for, as they read with the
/// whitespace taken out: the host owns IO, time, threads and the process.
/// `std::fs` is checked separately against [`MAY_READ_FILES`].
const HOST_ONLY: &[&str] = &[
    "std::env",
    "std::net",
    "std::process",
    "std::time",
    "std::thread",
    "std::io::stdin",
    "std::io::stdout",
    "std::io::stderr",
    "SystemTime",
    "Instant::now",
    "env!(",
    "option_env!(",
    "print!(",
    "println!(",
    "eprint!(",
    "eprintln!(",
    "dbg!(",
];

/// The `std` modules a grouped import (`use std::{...}`) may not name.
const HOST_MODULES: &[&str] = &["env", "net", "process", "time", "thread"];

/// Crates that reach a browser or the host's entropy. None may be in the
/// lock, optional or not.
const BROWSER_OR_HOST_CRATES: &[&str] = &["getrandom", "js-sys", "web-sys"];

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
        let item = &src[at..end];
        let mut rest = item;
        while let Some(p) = rest.find("#[path") {
            rest = &rest[p + 6..];
            let open = rest.find('"').expect("a #[path] names a file");
            let close = rest[open + 1..].find('"').expect("the path closes");
            test_paths.push(rest[open + 1..open + 1 + close].to_string());
            rest = &rest[open + 1 + close + 1..];
        }
        keep[at..end].iter_mut().for_each(|k| *k = false);
        from = end;
    }
    let kept: String = src
        .char_indices()
        .filter(|(i, _)| keep[*i])
        .map(|(_, c)| c)
        .collect();
    (kept, test_paths)
}

fn library(name: &str, src: &str) -> (Library, Vec<String>) {
    let (src, test_paths) = strip_tests(name, src);
    let parts = parts(&src);
    let code = src
        .char_indices()
        .map(|(i, c)| match (parts[i], c) {
            (Part::Code, c) => c,
            (_, '\n') => '\n',
            _ => ' ',
        })
        .collect();
    (Library { code, src, parts }, test_paths)
}

/// Every library source, keyed by its path in the crate.
fn library_sources() -> Vec<(String, Library)> {
    let mut files = Vec::new();
    rust_files(&crate_dir().join("src"), &mut files);
    let mut test_only: Vec<String> = Vec::new();
    let mut out = Vec::new();
    for p in &files {
        let name = rel(p);
        if name.starts_with("src/bin/") {
            continue;
        }
        let src = std::fs::read_to_string(p).expect("source reads");
        let (lib, paths) = library(&name, &src);
        for t in paths {
            test_only.push(rel(&p.parent().expect("dir").join(t)));
        }
        out.push((name, lib));
    }
    out.retain(|(name, _)| !test_only.contains(name));
    assert!(out.len() > 30, "found {} library files", out.len());
    out
}

/// The code with every whitespace character removed, so `std :: env` and a
/// path wrapped over two lines read as `std::env`.
fn compact(code: &str) -> String {
    code.chars().filter(|c| !c.is_whitespace()).collect()
}

/// The host services `code` reaches: the [`HOST_ONLY`] paths, the
/// [`HOST_MODULES`] and `fs` named in a grouped `std` import, and `std::fs`.
/// Returns (services, reads files).
fn host_services(code: &str) -> (Vec<String>, bool) {
    let c = compact(code);
    let mut found: Vec<String> = HOST_ONLY
        .iter()
        .filter(|n| c.contains(*n))
        .map(|n| n.to_string())
        .collect();
    let mut reads_files = c.contains("std::fs");
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
            if h == "fs" {
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

#[test]
fn the_library_uses_no_host_service() {
    let mut found = Vec::new();
    for (name, lib) in library_sources() {
        let (services, reads_files) = host_services(&lib.code);
        found.extend(services.into_iter().map(|s| format!("{name}: {s}")));
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
        .filter(|(name, lib)| name != "src/wasm.rs" && compact(&lib.code).contains("wasm_bindgen"))
        .map(|(name, _)| name)
        .collect();
    assert!(
        found.is_empty(),
        "wasm_bindgen outside src/wasm.rs: {found:?}"
    );
    let lib = std::fs::read_to_string(crate_dir().join("src/lib.rs"))
        .expect("lib.rs")
        .replace("\r\n", "\n");
    let lines: Vec<&str> = lib.lines().map(str::trim).collect();
    let at = lines
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
/// `include_str!` and `include_bytes!`, or `Err` for an argument that is not
/// a plain string literal.
fn included(lib: &Library) -> Vec<Result<String, String>> {
    let b = lib.src.as_bytes();
    let skip = |mut i: usize| {
        while i < b.len() && (lib.parts[i] == Part::Comment || b[i].is_ascii_whitespace()) {
            i += 1;
        }
        i
    };
    let mut out = Vec::new();
    for mac in ["include!", "include_str!", "include_bytes!"] {
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
            let lit = lib.src[arg..end].trim_start_matches(['b', 'r']);
            out.push(Ok(lit.trim_matches('#').trim_matches('"').to_string()));
        }
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
    }
    assert!(
        found.is_empty(),
        "the library compiles in a file from outside engine-rs/ and conformance/: {found:?}"
    );
}

/// The `key = value` lines of one `[section]` of a TOML file.
fn toml_section<'a>(toml: &'a str, section: &str) -> Vec<(&'a str, &'a str)> {
    let header = format!("[{section}]");
    let mut inside = false;
    let mut out = Vec::new();
    for line in toml.lines().map(str::trim) {
        if line.starts_with('[') {
            inside = line == header;
        } else if inside {
            if let Some((k, v)) = line.split_once('=') {
                out.push((k.trim(), v.trim()));
            }
        }
    }
    out
}

#[test]
fn the_binding_is_an_optional_feature() {
    let toml = std::fs::read_to_string(crate_dir().join("Cargo.toml")).expect("Cargo.toml");
    let deps = toml_section(&toml, "dependencies");
    let wasm = deps
        .iter()
        .find(|(k, _)| *k == "wasm-bindgen")
        .expect("wasm-bindgen is declared under [dependencies]");
    assert!(
        wasm.1.contains("optional = true"),
        "wasm-bindgen must stay optional: {}",
        wasm.1
    );
    assert!(
        !toml_section(&toml, "features")
            .iter()
            .any(|(k, _)| *k == "default"),
        "the crate has no default features, so a host links no binding by default"
    );
    let lock = std::fs::read_to_string(crate_dir().join("Cargo.lock")).expect("Cargo.lock");
    for c in BROWSER_OR_HOST_CRATES {
        assert!(
            !lock.lines().any(|l| l == format!("name = \"{c}\"")),
            "{c} reaches a browser or the host's entropy and is in Cargo.lock"
        );
    }
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
        ("fn f() { std :: thread :: sleep(d); }", "std::thread"),
        ("fn f() { println!(\"x\"); }", "println!("),
        ("fn f() { let t = Instant::now(); }", "Instant::now"),
    ] {
        let (lib, _) = library("sample", src);
        let (services, _) = host_services(&lib.code);
        assert!(services.contains(&want.to_string()), "{src}: {services:?}");
    }
    for src in ["use std::{io, fs};", "use std::{fs::File, io::Read};"] {
        let (lib, _) = library("sample", src);
        assert!(host_services(&lib.code).1, "{src} reads files");
    }
    let (lib, _) = library(
        "sample",
        "use std::{io::Read, collections::HashMap}; fn refs(a: u8, refs: u8) {}",
    );
    assert_eq!(
        host_services(&lib.code),
        (vec![], false),
        "in-memory IO and look-alike names"
    );
}

#[test]
fn the_scanner_reads_every_include_form() {
    let src = r##"
const A: &str = include_str!("../../conformance/a.json");
const B: &str = include_str!(
    "../../src/b.ts"
);
const C: &[u8] = include_bytes! (r#"../../src/c.bin"#);
const D: &str = include_str!(concat!("x", "y"));
const E: &str = "include_str!(\"in a string";
include!("../../src/e.rs");
"##;
    let (lib, _) = library("sample", src);
    let got = included(&lib);
    for want in [
        "../../conformance/a.json",
        "../../src/b.ts",
        "../../src/c.bin",
        "../../src/e.rs",
    ] {
        assert!(got.contains(&Ok(want.into())), "{want}: {got:?}");
    }
    assert_eq!(got.iter().filter(|r| r.is_err()).count(), 1, "{got:?}");
    assert_eq!(
        got.len(),
        5,
        "the string literal is not an include: {got:?}"
    );
}

#[test]
fn a_cfg_test_on_a_field_stops_the_scan() {
    let r = std::panic::catch_unwind(|| {
        strip_tests(
            "sample",
            "struct S { a: u8, #[cfg(test)] b: u8 }\nfn f() {}",
        )
    });
    assert!(
        r.is_err(),
        "a misread attribute must not strip library code"
    );
}
