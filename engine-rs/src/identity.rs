//! The engine's identity record: which engine this is and which contracts
//! it speaks (crate version, save version, frame, view and catalog layout
//! versions, and the conformance lock's digest), so a frontend, a bug report
//! and a benchmark all name the same engine.
//!
//! The record holds only what the engine knows about itself. Which build of
//! the sources a binary came from is the packaging's fact; the crate's
//! README describes the build metadata a host supplies for it.
//!
//! ```
//! let id = verticopolis_engine::identity::identity();
//! assert_eq!(id["crate"]["name"], "verticopolis-engine");
//! println!("{}", verticopolis_engine::identity::identity_json());
//! ```

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

/// The record as canonical JSON, the text the JavaScript package returns.
pub fn identity_json() -> String {
    canonical_json(&identity())
}

#[cfg(test)]
#[path = "identity_tests.rs"]
mod tests;
