//! The lock view of the catalog: what `conformance/catalog-digests.json` hashes.

use serde_json::Value;

use crate::facilities::Kind;

/// The kinds whose footprint (`width` and `floors`) the shared lock does not
/// pin. Only the Rust engine builds the wedding hall as the 28 wide, five story
/// cathedral; the TypeScript engine keeps its one story hall, so the lock holds
/// both engines to every other number in the entry and leaves the footprint out.
pub const LOCK_FOOTPRINT_EXEMPT: [Kind; 1] = [Kind::WeddingHall];

/// `catalog` with the footprint of each `LOCK_FOOTPRINT_EXEMPT` kind set to
/// `null`: the text `conformance/catalog-digests.json` hashes. The TypeScript
/// side does the same in `src/engine/catalogLockView.ts`.
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
