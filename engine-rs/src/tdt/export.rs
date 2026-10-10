//! Writer for original 1994 SimTower saves (`tdtExport.ts`): the importer's
//! mirror. `build_tdt` is the orchestrator over the gather pass, the encoder
//! and (next phase) the reverse fidelity report.

use serde_json::Value;

use super::encoder::{encode_tower, EncodeStats};
use super::export_gather::{gather_tower, ExportCounts};
use super::LegacyExportError;

/// Result of a successful export build.
pub struct BuiltLegacyTower {
    pub bytes: Vec<u8>,
    pub stats: EncodeStats,
    pub counts: ExportCounts,
}

/// `buildTDT`: the `.TDT` bytes for a serialized tower, or the refusal for a
/// tower the format cannot hold.
pub fn build_tdt(save: &Value) -> Result<BuiltLegacyTower, LegacyExportError> {
    if save.get("mode").and_then(Value::as_str) == Some("modern") {
        return Err(LegacyExportError(
            "This tower uses Modern rules. SimTower (1994) can only load Classic towers.".into(),
        ));
    }
    let gathered = gather_tower(save)?;
    let encoded = encode_tower(save, &gathered)?;
    Ok(BuiltLegacyTower {
        bytes: encoded.bytes,
        stats: encoded.stats,
        counts: gathered.counts,
    })
}
