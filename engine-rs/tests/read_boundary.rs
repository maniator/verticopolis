//! The crate's tests, binaries and consumer read only `engine-rs/` and
//! `conformance/`. The sparse CI job proves it by running them from a
//! checkout that holds nothing else; this test names the place in the source
//! when a path starts to climb elsewhere.

mod scan;
use scan::{crate_dir, parts, rel, rust_files, Part};

/// Calls that step up a directory without a `..` literal. The guard reports
/// each one; a file that needs one lists it in [`REFUSED_EXAMPLES`] with why.
const CLIMBS_IN_CODE: &[&str] = &[".parent()", ".ancestors()", "ParentDir"];

/// Where a path literal climbs out of the crate, it is a `..` step on the way
/// to the conformance suite and nowhere else: `"../conformance/..."`, or a
/// bare `".."` joined straight onto `"conformance"`. Every Rust file counts,
/// tests, binaries and the consumer included, so the crate's tests and the
/// referee read only `engine-rs/` and `conformance/` (the sparse CI job
/// proves the same by running them from a checkout that holds nothing else).
fn climbs_outside_the_suite(src: &str) -> Vec<String> {
    let parts = parts(src);
    let squeezed_after = |at: usize| -> String {
        src[at..]
            .chars()
            .filter(|c| !c.is_whitespace())
            .take(32)
            .collect()
    };
    let mut found = Vec::new();
    // A path can also climb in code, with no `..` literal at all.
    let code: String = src
        .char_indices()
        .filter(|(at, c)| parts[*at] == Part::Code && !c.is_whitespace())
        .map(|(_, c)| c)
        .collect();
    for step in CLIMBS_IN_CODE {
        if code.contains(step) {
            found.push(step.to_string());
        }
    }
    let mut i = 0;
    while i < parts.len() {
        if parts[i] != Part::Literal {
            i += 1;
            continue;
        }
        let start = i;
        while i < parts.len() && parts[i] == Part::Literal {
            i += 1;
        }
        let text = &src[start..i];
        let Some(open) = text.find('"') else { continue };
        let Some(close) = text.rfind('"').filter(|c| *c > open) else {
            continue;
        };
        let body = &text[open + 1..close];
        if !body.split(['/', '\\']).any(|step| step == "..") {
            continue;
        }
        // A literal that continues a `concat!` (`"/../conformance/..."`)
        // starts with a separator.
        let steps: Vec<&str> = body.strip_prefix('/').unwrap_or(body).split('/').collect();
        let ups = steps.iter().take_while(|s| **s == "..").count();
        let rest = &steps[ups..];
        let ok = match rest.first() {
            Some(&"conformance") => !rest.contains(&".."),
            None => squeezed_after(i).starts_with(").join(\"conformance\")"),
            _ => false,
        };
        if !ok {
            found.push(body.to_string());
        }
    }
    found
}

/// Climbs that are never read: fixture names the suite's own tests expect
/// `suite::fixture_path` to refuse, and the scanner's own path normalizer.
const REFUSED_EXAMPLES: &[(&str, &str)] = &[
    ("src/suite.rs", "conformance/../src/a.vctower"),
    ("src/suite.rs", "conformance/fixtures/../../a.vctower"),
    ("tests/scan/mod.rs", "ParentDir"),
];

#[test]
fn the_tests_and_the_referee_read_only_the_crate_and_the_suite() {
    let mut files = Vec::new();
    for dir in ["src", "tests", "consumer/src"] {
        rust_files(&crate_dir().join(dir), &mut files);
    }
    let mut found = Vec::new();
    for path in files {
        let name = rel(&path);
        // The scanners' own examples climb on purpose.
        if ["tests/independence.rs", "tests/read_boundary.rs"].contains(&name.as_str()) {
            continue;
        }
        let text = std::fs::read_to_string(&path)
            .expect("a source file")
            .replace("\r\n", "\n");
        found.extend(
            climbs_outside_the_suite(&text)
                .into_iter()
                .filter(|l| !REFUSED_EXAMPLES.contains(&(name.as_str(), l.as_str())))
                .map(|l| format!("{name}: {l:?}")),
        );
    }
    assert!(
        found.is_empty(),
        "a path outside engine-rs/ and conformance/: {found:#?}"
    );
}

#[test]
fn the_climb_check_reads_each_spelling() {
    let src = r#"
        let a = dir.join("../../conformance/a.json");
        let b = dir.join("..").join("conformance");
        let c = dir.join("../conformance");
        let d = dir.join("..").join("src");
        let e = dir.join("../../src/tests/fixtures/x.vctower");
        let f = dir.join("../conformance/../src");
        let g = dir.join("..");
        let h = "a/../b"; // a comment may say .parent() freely
        let k = dir.parent().unwrap().join("src");
        let l = Path::new(".").ancestors().nth(2);
        let i = concat!(env!("X"), "/../conformance/a.json");
        let j = concat!(env!("X"), "/../src/a.ts");
    "#;
    assert_eq!(
        climbs_outside_the_suite(src),
        [
            ".parent()",
            ".ancestors()",
            "..",
            "../../src/tests/fixtures/x.vctower",
            "../conformance/../src",
            "..",
            "a/../b",
            "/../src/a.ts"
        ]
    );
}
