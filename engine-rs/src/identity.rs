//! The engine's identity record: which engine this is and which contracts it
//! speaks, written by the engine itself so a frontend, a bug report and a perf
//! run all name the same facts (#963).
//!
//! It holds only what the engine can know about itself. A hash of the engine's
//! sources cannot be compiled into those sources, and a build script or an
//! environment macro would run outside the independence rules
//! (`tests/independence.rs`), so the build hash stays the host's fact: the
//! served package's `BUILD.json` records it and the loader checks the bytes it
//! instantiates against that record.
//!
//! `src/compat-record.json` (compiled in; it sits inside the crate, so the source
//! hash covers it) holds the crate version and the lock digest. A test checks
//! them against `Cargo.toml`, the conformance files and the constants here, and
//! `src/tests/engineCompat.guard.test.ts` checks them against the same
//! constants and the checked-in declarations, so the version cannot stay put when a
//! contract moves. The rule is in the release plan (section 7.4): the crate
//! version changes with the conformance lock, `SAVE_VERSION`, or the public
//! Rust/WASM interface or compatibility contract; an internal change that
//! keeps all of these is told apart by the build hash alone.
use serde_json::{json, Value};

use crate::canonical::canonical_json;
use crate::catalog::{catalog_digest, CATALOG_VERSION};
use crate::clock::GameMode;
use crate::frame::FRAME_LAYOUT_VERSION;
use crate::load::OLDEST_SAVE_VERSION;
use crate::sim::SAVE_VERSION;

/// The record's own shape. It moves when a field is added, renamed or removed.
pub const IDENTITY_SCHEMA: u32 = 1;

/// The crate's name, as `Cargo.toml` spells it.
pub const CRATE_NAME: &str = "verticopolis-engine";

/// What `lockDigest` and `crate.version` read when the record is unreadable.
/// A test keeps the compiled-in record readable, so a host sees this only if
/// that test was skipped.
const UNREADABLE: &str = "unreadable";

const COMPAT_RECORD: &str = include_str!("compat-record.json");

fn compat_field(name: &str) -> String {
    serde_json::from_str::<Value>(COMPAT_RECORD)
        .ok()
        .and_then(|v| v.get(name).and_then(Value::as_str).map(str::to_owned))
        .unwrap_or_else(|| UNREADABLE.to_owned())
}

/// The crate version, from `compat-record.json`.
pub fn crate_version() -> String {
    compat_field("crateVersion")
}

/// The identity record as a value.
pub fn identity() -> Value {
    json!({
        "schema": IDENTITY_SCHEMA,
        "crate": { "name": CRATE_NAME, "version": crate_version() },
        "saveVersion": SAVE_VERSION,
        "oldestSaveVersion": OLDEST_SAVE_VERSION,
        "frameLayoutVersion": FRAME_LAYOUT_VERSION,
        "catalogVersion": CATALOG_VERSION,
        "catalogDigests": {
            "classic": catalog_digest(GameMode::Classic),
            "modern": catalog_digest(GameMode::Modern),
        },
        "lockDigest": compat_field("lockDigest"),
    })
}

/// The record as canonical JSON, the text the binding returns.
pub fn identity_json() -> String {
    canonical_json(&identity())
}

#[cfg(test)]
#[path = "identity_tests.rs"]
mod tests;
