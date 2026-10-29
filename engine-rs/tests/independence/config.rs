//! The reviewed lists the checks hold the library to.

/// The library functions that may read files: the conformance runner and the
/// `.TDT` referee open the scenario fixtures and the lock tables they are
/// given a path to, and none is reached from a game a host runs. Only these
/// bodies (and the files' `std::path` / `std::fs` imports) are exempt; the
/// rest of each file, every helper included, is scanned like
/// any other library code. Each file is compiled only with the
/// `conformance` feature (see [`the_harness_is_an_optional_feature`]), so
/// the library a host links by default reads no file at all.
pub(super) const MAY_READ_FILES: &[(&str, &[&str])] = &[
    (
        "src/scenario.rs",
        &[
            "start_sim",
            "run_scenario",
            "run_scenario_detailed",
            "run_scenario_until",
            "run_scenario_inner",
        ],
    ),
    (
        "src/tdt/referee.rs",
        &["fixture_save", "replay_export", "replay_all", "read_lock"],
    ),
    // `fixture_path` builds the path the two above open; it reads no file,
    // and checks only whether the suite it is given holds the expected
    // directories (the scan counts any `std::path` use as file access).
    ("src/suite.rs", &["fixture_path"]),
];

/// Host services the simulation never reaches for, as they read in
/// [`squeeze`]d code: the host owns IO, time, threads, the process and
/// foreign code. A needle that starts with a letter matches only at the start
/// of a word, so `print!(` does not match `blueprint!(`.
/// `std::fs` and `std::path` are checked separately against
/// [`MAY_READ_FILES`].
pub(super) const HOST_ONLY: &[&str] = &[
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
pub(super) const HOST_MODULES: &[&str] = &["env", "net", "os", "process", "time", "thread"];

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
pub(super) const ALLOWED_CRATES: &[&str] = &[
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
pub(super) const TEST_ONLY_CRATES: &[&str] = &[];

/// Marks a test file found by Rust's default module lookup, which starts in
/// the module's own directory rather than the file's.
pub(super) const MODULE_DIR: &str = "<module>/";

/// What may follow `#[cfg(test)]` (after other attributes and a visibility):
/// the keywords that start an item. Anything else (a field, a variant, a
/// match arm, a statement) stops the test, since the scan cannot tell where
/// such a thing ends.
pub(super) const ITEM_KEYWORDS: &[&str] = &[
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
