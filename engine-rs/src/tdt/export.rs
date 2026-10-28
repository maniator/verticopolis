//! Writer for original 1994 SimTower saves (`tdtExport.ts`): the importer's
//! mirror. `build_tdt` is the orchestrator over the gather pass, the encoder
//! and (next phase) the reverse fidelity report.

use serde_json::Value;

use super::encoder::{encode_tower, EncodeStats};
use super::export_gather::{gather_tower, ExportCounts};
use super::LegacyExportError;
use crate::facilities::{MAX_FLOOR, MIN_FLOOR};

/// Result of a successful export build.
pub struct BuiltLegacyTower {
    pub bytes: Vec<u8>,
    pub stats: EncodeStats,
    pub counts: ExportCounts,
    /// The highest floor the file holds and its basement levels, counting
    /// only floors the grid allows (`buildExportReport`'s extents walk).
    pub top_floor: f64,
    pub basements: f64,
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
    let (mut top_floor, mut basements) = (0.0_f64, 0.0_f64);
    for key in gathered.extents.keys() {
        let floor = key.value();
        // Out-of-range rooms widened the extents but never reach the bytes.
        if !(MIN_FLOOR as f64..=MAX_FLOOR as f64).contains(&floor) {
            continue;
        }
        top_floor = top_floor.max(floor);
        if floor < 1.0 {
            basements = basements.max(1.0 - floor);
        }
    }
    Ok(BuiltLegacyTower {
        bytes: encoded.bytes,
        stats: encoded.stats,
        counts: gathered.counts,
        top_floor,
        basements,
    })
}
