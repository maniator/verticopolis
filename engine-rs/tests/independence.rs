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
//! its tools. A few named functions in three harness modules may read files
//! too (see [`MAY_READ_FILES`]).

use std::path::Path;

mod scan;
use scan::{crate_dir, normalize, rel};

#[path = "independence/config.rs"]
mod config;
#[path = "independence/includes.rs"]
mod includes;
#[path = "independence/scanner_tests.rs"]
mod scanner_tests;
#[path = "independence/source.rs"]
mod source;

use config::*;
use includes::*;
use source::*;

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

/// Every file that may read files is a module compiled only for the crate's
/// tests or with the `conformance` feature, declared in its parent module
/// right under that `cfg`. The binaries that drive it require the feature
/// too, so a default build holds none of the harness.
#[test]
fn the_harness_is_an_optional_feature() {
    const GATE: &str = "#[cfg(any(test, feature = \"conformance\"))]";
    for (file, _) in MAY_READ_FILES {
        let path = Path::new(file);
        let module = path.file_stem().unwrap().to_str().unwrap();
        let dir = path.parent().unwrap();
        let parent = if dir == Path::new("src") {
            dir.join("lib.rs")
        } else {
            dir.join("mod.rs")
        };
        let text = std::fs::read_to_string(crate_dir().join(&parent))
            .expect("the parent module")
            .replace("\r\n", "\n");
        let (lib, _) = library(&parent.to_string_lossy(), &text);
        let code: Vec<&str> = lib.code.lines().map(str::trim).collect();
        let lines: Vec<&str> = lib.src.lines().map(str::trim).collect();
        let declared: Vec<usize> = code
            .iter()
            .enumerate()
            .filter(|(_, l)| l.ends_with(&format!("mod {module};")))
            .map(|(i, _)| i)
            .collect();
        assert_eq!(declared.len(), 1, "{file} is declared once");
        assert_eq!(
            lines[..declared[0]].iter().rev().find(|l| !l.is_empty()),
            Some(&GATE),
            "{file} is compiled only for the tests or with the conformance feature"
        );
    }
    // Each `[[bin]]` table, read up to the next table header, by its path.
    let toml = std::fs::read_to_string(crate_dir().join("Cargo.toml"))
        .expect("Cargo.toml")
        .replace("\r\n", "\n");
    // Cargo would otherwise build `src/main.rs` and every `src/bin/` entry as
    // a binary of its own, outside the tables below.
    assert!(
        toml_keys(&toml, |h| h == "[package]")
            .iter()
            .any(|(k, v)| k == "autobins" && v == "false"),
        "autobins = false, so only the declared binaries build"
    );
    let mut declared = Vec::new();
    for table in toml.split("\n[").filter(|t| t.starts_with("[bin]]")) {
        let keys: Vec<String> = table.lines().map(|l| l.replace(' ', "")).collect();
        let path = keys
            .iter()
            .find_map(|k| k.strip_prefix("path=\""))
            .map(|p| p.trim_end_matches('"').to_string())
            .unwrap_or_else(|| panic!("a [[bin]] without a path: {table}"));
        assert!(
            keys.iter()
                .any(|k| k == "required-features=[\"conformance\"]"),
            "{path} requires the conformance feature"
        );
        declared.push(path);
    }
    let mut on_disk: Vec<String> = std::fs::read_dir(crate_dir().join("src/bin"))
        .expect("src/bin")
        .map(|e| rel(&e.expect("entry").path()))
        .filter(|p| p.ends_with(".rs"))
        .collect();
    declared.sort();
    on_disk.sort();
    assert_eq!(declared, on_disk, "every binary is declared in Cargo.toml");
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
