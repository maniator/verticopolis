//! Writer for original 1994 SimTower saves (`tdtExport.ts`): the importer's
//! mirror. `build_tdt` is the orchestrator over the gather pass, the encoder
//! and (next phase) the reverse fidelity report.

use std::borrow::Borrow;

use serde_json::Value;

use super::encoder::{encode_tower, EncodeStats};
use super::export_gather::{
    gather_tower, gather_units, ground_lobby_height, ExportCounts, GatheredTower,
};
use super::LegacyExportError;
use crate::clock::GameMode;
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
    refuse_modern(save)?;
    finish(save, gather_tower(save)?)
}

/// `build_tdt` for a game that hands over its unit entries one at a time and
/// the rest of the save as a tree without `units` (the encoder reads nothing
/// else off it), so the whole save is never held as one tree (#1431). The
/// same bytes, or the same refusal, as `build_tdt` of the whole save.
pub fn build_tdt_streamed<U: Borrow<Value>>(
    rest: &Value,
    units: impl IntoIterator<Item = U>,
) -> Result<BuiltLegacyTower, LegacyExportError> {
    refuse_modern(rest)?;
    finish(rest, gather_units(units, ground_lobby_height(rest))?)
}

fn refuse_modern(save: &Value) -> Result<(), LegacyExportError> {
    let mode = save
        .get("mode")
        .and_then(Value::as_str)
        .and_then(GameMode::parse);
    if mode.is_some_and(|m| !m.exports_to_1994()) {
        return Err(LegacyExportError(
            "This tower uses Modern rules. SimTower (1994) can only load Classic towers.".into(),
        ));
    }
    Ok(())
}

fn finish(save: &Value, gathered: GatheredTower) -> Result<BuiltLegacyTower, LegacyExportError> {
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
