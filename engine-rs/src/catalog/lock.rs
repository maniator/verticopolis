//! The lock view of the catalog: what `conformance/catalog-digests.json` hashes.

use serde_json::Value;

use crate::facilities::Kind;

/// The kinds whose footprint (`width` and `floors`) the lock does not pin. The
/// exemption dates from when the lock also pinned the TypeScript engine, which
/// keeps a one story wedding hall where this engine builds the 28 wide, five
/// story cathedral. The WASM suite pins the hall's footprint directly; dropping
/// the exemption moves the lock.
pub const LOCK_FOOTPRINT_EXEMPT: [Kind; 1] = [Kind::WeddingHall];

/// `catalog` with the footprint of each `LOCK_FOOTPRINT_EXEMPT` kind set to
/// `null`: the text `conformance/catalog-digests.json` hashes. The WASM suite
/// does the same in `src/tests/conformance/catalogLockView.ts`.
pub fn lock_view(catalog: &Value) -> Value {
    let mut view = catalog.clone();
    if let Some(entries) = view["facilities"].as_array_mut() {
        for entry in entries {
            let exempt = LOCK_FOOTPRINT_EXEMPT
                .iter()
                .any(|k| entry["key"] == k.as_str());
            if exempt {
                entry["width"] = Value::Null;
                entry["floors"] = Value::Null;
            }
        }
    }
    view
}
