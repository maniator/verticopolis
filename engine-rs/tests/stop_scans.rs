//! A shaft's stops are listed with `Transport::stop_floors` (or the memoized
//! `Tower::stops_of`), never by walking its span and asking `stops_at` floor
//! by floor. `stops_at` scans the shaft's skip list, so the walk costs the
//! span times the skips: span squared on an express shaft, which skips every
//! floor but the lobbies (#1984). This test fails the moment the library
//! walks a span into `stops_at` again, so the slow shape is caught in review
//! rather than in a tall-tower profile.
//!
//! It looks for a `..=<shaft>.top` range followed within a short window by
//! a `stops_at(` call; a walk over some other bound is not caught.
//!
//! Test files are exempt: the rule tests walk spans on purpose to check
//! `stop_floors` against `stops_at`. An inline `#[cfg(test)]` module is
//! still scanned, so a test that walks a span on purpose lives in its own
//! test file.

mod scan;
use scan::{crate_dir, parts, rel, rust_files, Part};

/// How far past a `..=<shaft>.top` range a `stops_at(` call still counts as
/// part of the same walk: a closure or a loop header and a short body.
const WALK_WINDOW: usize = 240;

/// Every place in `code` (comments and literals already blanked, whitespace
/// removed) where a span range is followed closely by a `stops_at(` call.
fn span_walks_into_stops_at(code: &str) -> Vec<usize> {
    let mut found = Vec::new();
    let mut from = 0;
    while let Some(i) = code[from..].find("..=") {
        let at = from + i;
        from = at + 3;
        let rest = &code[from..];
        let ident_len = rest.bytes().take_while(|&b| scan::is_ident(b)).count();
        let after = &rest[ident_len..];
        let ends_a_span = [".top)", ".top{", ".top {"]
            .iter()
            .any(|end| after.starts_with(end));
        if ident_len == 0 || !ends_a_span {
            continue;
        }
        let end = (from + WALK_WINDOW).min(code.len());
        let window = &code[from..end];
        // A new item ends the walk: a stops_at in the next function is not
        // part of this one.
        let window = window.split(" fn ").next().unwrap_or(window);
        if window.contains(".stops_at(") {
            found.push(at);
        }
    }
    found
}

/// The file's code with comments and literals dropped and every run of
/// whitespace cut to one space, so a call split over lines still reads as
/// one and token boundaries (`pub fn`, `in t`) survive.
fn squeezed_code(src: &str) -> String {
    let kinds = parts(src);
    let mut out = String::with_capacity(src.len());
    for (b, k) in src.bytes().zip(kinds) {
        if k != Part::Code {
            continue;
        }
        if b.is_ascii_whitespace() {
            if !out.ends_with(' ') {
                out.push(' ');
            }
        } else if b.is_ascii() {
            out.push(b as char);
        } else {
            // One ASCII byte per source byte keeps every index a char
            // boundary; nothing the scanner looks for is non-ASCII.
            out.push('?');
        }
    }
    out
}

fn is_test_file(name: &str) -> bool {
    name.ends_with("_tests.rs")
        || name.ends_with("/tests.rs")
        || name.contains("/tests/")
        || name.contains("/rule_tests/")
        || name
            .rsplit('/')
            .next()
            .is_some_and(|f| f.starts_with("tests_"))
        || name.starts_with("src/bin/")
}

#[test]
fn no_library_code_walks_a_span_into_stops_at() {
    let mut files = Vec::new();
    rust_files(&crate_dir().join("src"), &mut files);
    let mut found = Vec::new();
    for p in &files {
        let name = rel(p);
        if is_test_file(&name) {
            continue;
        }
        let src = std::fs::read_to_string(p).expect("source reads");
        let code = squeezed_code(&src);
        if !span_walks_into_stops_at(&code).is_empty() {
            found.push(name);
        }
    }
    assert!(
        found.is_empty(),
        "these files walk a shaft's span and ask stops_at floor by floor; \
         use Transport::stop_floors or Tower::stops_of instead: {found:?}"
    );
}

#[test]
fn the_scanner_catches_each_walk_shape() {
    let walks = [
        "(t.bottom..=t.top).filter(|&fl| t.stops_at(fl)).collect()",
        "(t.bottom..=t.top).any(|f| t.stops_at(f) && served.contains(&f))",
        "for f in t.bottom..=t.top { if t.stops_at(f) { n += 1; } }",
        "for fl in (shaft.bottom..=shaft.top).rev() { flag(shaft.stops_at(fl)) }",
        "(t.bottom..=t.top)\n    .filter(|&fl| defn(fl) && t.stops_at(fl))",
    ];
    for walk in walks {
        let code = squeezed_code(walk);
        assert_eq!(span_walks_into_stops_at(&code).len(), 1, "{walk}");
    }
}

#[test]
fn the_scanner_passes_the_shapes_it_allows() {
    let allowed = [
        "let stops = t.stop_floors(); for &f in &stops { use_it(f); }",
        "for fl in (t.bottom..=t.top).rev() { flag(served.binary_search(&fl).is_ok()) }",
        "if shaft.stops_at(dest) { arrive(); }",
        "for f in t.bottom..=t.top { } } fn other() { t.stops_at(3) }",
        "// (t.bottom..=t.top).filter(|&fl| t.stops_at(fl))",
    ];
    for code in allowed {
        let code = squeezed_code(code);
        assert!(span_walks_into_stops_at(&code).is_empty(), "{code}");
    }
}
