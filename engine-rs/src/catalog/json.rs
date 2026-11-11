// The catalog as JSON: the value, the canonical text and its hash.

use serde_json::Value;
use std::sync::OnceLock;

use super::{catalog, lock_view};
use crate::canonical::{canonical_json, digest};
use crate::clock::GameMode;

// The catalog for `mode` as a JSON value, built once per mode: a boot reads
// both catalogs through the binding and hashes both for the engine's
// identity, and the catalog depends on nothing but the mode.
fn shared_catalog_value(mode: GameMode) -> &'static Value {
    static CLASSIC: OnceLock<Value> = OnceLock::new();
    static MODERN: OnceLock<Value> = OnceLock::new();
    let cell = match mode {
        GameMode::Classic => &CLASSIC,
        GameMode::Modern => &MODERN,
    };
    cell.get_or_init(|| serde_json::to_value(catalog(mode)).expect("the catalog serializes"))
}

/// The catalog for `mode` as a JSON value.
pub fn catalog_value(mode: GameMode) -> Value {
    shared_catalog_value(mode).clone()
}

/// The catalog for `mode` as canonical JSON text: the bytes the lock hashes,
/// and the text the JavaScript package returns.
pub fn catalog_json(mode: GameMode) -> String {
    canonical_json(shared_catalog_value(mode))
}

/// The canonical hash of the catalog for `mode`, as
/// `conformance/catalog-digests.json` records it: the lock view, so the
/// exempt footprints do not move it.
pub fn catalog_digest(mode: GameMode) -> String {
    digest(&lock_view(shared_catalog_value(mode)))
}
