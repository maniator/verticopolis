//! Constants, size and offset tables, the view-word mapping and the pure
//! binary walker for the 1994 `.TDT` save format (`tdtConstants.ts`,
//! `tdtViewMapping.ts`, `tdtFormat.ts`). Layout facts come from
//! `docs/canon/tdt-format.md`.

use super::byte_reader::ByteReader;
use super::tail::walk_tolerant_tail;
use super::types::{TdtFloor, TdtHeader, TdtTenant, TdtTower};
use super::LegacyImportError;
use crate::jsmath::round;
use crate::services::with_thousands;

/// Header magic: the u16 at offset 0 is `0x2400` in every known save.
pub const TDT_MAGIC: i64 = 0x2400;
/// Fixed header block size; the floor map starts at offset 560.
pub const TDT_HEADER_SIZE: usize = 0x230;
/// Floor slots in the file: indexes 0..119.
pub const TDT_FLOOR_COUNT: i64 = 120;
/// One tenant record is 18 bytes.
pub const TDT_TENANT_RECORD_SIZE: usize = 18;
/// Each floor record ends with a 94-entry u16 index map.
pub const TDT_FLOOR_INDEX_ENTRIES: usize = 94;
/// Hostile-input ceilings.
pub const TDT_MAX_TENANTS_PER_FLOOR: i64 = 256;
pub const TDT_MAX_FILE_BYTES: usize = 4 * 1024 * 1024;
pub const TDT_MAX_PEOPLE: i64 = 100_000;
pub const TDT_PERSON_RECORD_SIZE: usize = 16;
/// Upper bound the exporter clamps its people count to (the canon census).
pub const TDT_MAX_CENSUS: f64 = 15_000.0;
/// Default saved view-scroll the exporter writes (the New Tower default).
pub const TDT_DEFAULT_VIEW_X: i64 = 1105;
pub const TDT_DEFAULT_VIEW_Y: i64 = 3491;
/// TDT floor index to our floor: `ours = tdt - 9`.
pub const TDT_FLOOR_OFFSET: i64 = 9;
/// 1994 world metrics for the header's view-scroll words.
pub const TDT_TILE_PX: f64 = 8.0;
pub const TDT_FLOOR_PX: f64 = 36.0;
pub const TDT_WORLD_W: f64 = 375.0 * TDT_TILE_PX;
pub const TDT_WORLD_H: f64 = TDT_FLOOR_COUNT as f64 * TDT_FLOOR_PX;
pub const TDT_VIEW_W: f64 = 640.0;
pub const TDT_VIEW_H: f64 = 469.0;
pub const TDT_RETAIL_SLOTS: usize = 512;
pub const TDT_RETAIL_RECORD_SIZE: usize = 18;
pub const TDT_ELEVATOR_SLOTS: usize = 24;
pub const TDT_ELEVATOR_HEADER_SIZE: usize = 194;
/// Built shafts append a fixed block measured at 3140 bytes against real
/// 1994 saves, one 324-byte entry per spanned floor and a single 348-byte
/// car block (never multiplied by the car count).
pub const TDT_ELEVATOR_BUILT_FIXED: i64 = 3140;
pub const TDT_ELEVATOR_PER_FLOOR_SIZE: i64 = 324;
pub const TDT_ELEVATOR_CAR_BLOCK_SIZE: i64 = 348;
/// Elevator `type` byte for an express shaft.
pub const TDT_ELEVATOR_TYPE_EXPRESS: i64 = 0;
pub const TDT_FINANCE_SIZE: usize = 132;
pub const TDT_PARKING_SIZE: usize = 2 + 512 * 2;
pub const TDT_STAIR_SLOTS: usize = 64;
pub const TDT_STAIR_RECORD_SIZE: usize = 10;
/// The trailing routing/reachability region the exporter emits, 0xFF-filled.
pub const TDT_ROUTING_TAIL_SIZE: usize = 0x6400;
/// Our trailer: the ASCII magic then a u16 generation, at the very end.
pub const TDT_STAMP_MAGIC: &str = "VCTDT";
pub const TDT_STAMP_GENERATION: i64 = 1;
pub const TDT_STAMP_SIZE: usize = TDT_STAMP_MAGIC.len() + 2;
/// Sanity bounds for recognizing a stair record while scanning for the table.
pub const TDT_MAX_TILE: i64 = 800;
pub const TDT_MAX_STAIR_CROWD: i64 = 4000;
/// How far past the elevator table to scan for the stairs table.
pub const TDT_STAIR_SCAN_WINDOW: usize = 4096;

/// The 56-byte per-shaft schedule/config block every built shaft carries
/// in a real save: 14 bytes 0x01, 14 bytes 0x05, 28 bytes 0x00.
pub fn tdt_elevator_schedule_default() -> Vec<i64> {
    let mut v = vec![0x01; 14];
    v.extend(vec![0x05; 14]);
    v.extend(vec![0x00; 28]);
    v
}

/// Bytes a built elevator slot appends after its header: the fixed block,
/// one per-floor entry for every floor the shaft spans and a single car
/// block. An inverted span is not a shaft the game can have written, so it
/// is refused rather than sized.
pub fn built_shaft_payload_size(bottom_floor: i64, top_floor: i64) -> Result<i64, String> {
    let spanned_floors = top_floor - bottom_floor + 1;
    if spanned_floors < 1 {
        return Err(format!(
            "elevator span must be a whole number of floors, at least one (bottom {bottom_floor}, top {top_floor})"
        ));
    }
    Ok(TDT_ELEVATOR_BUILT_FIXED
        + spanned_floors * TDT_ELEVATOR_PER_FLOOR_SIZE
        + TDT_ELEVATOR_CAR_BLOCK_SIZE)
}

/// One built shaft's payload size the way the 1994 game sizes it, by kind:
/// standard and service by spanned floors, express by the floors it stops at
/// (clamped up to one entry).
pub fn built_shaft_payload_size_for(
    type_id: i64,
    bottom_floor: i64,
    top_floor: i64,
    serviced_count: i64,
) -> Result<i64, String> {
    let spanned = built_shaft_payload_size(bottom_floor, top_floor)?;
    if type_id != TDT_ELEVATOR_TYPE_EXPRESS {
        return Ok(spanned);
    }
    built_shaft_payload_size(1, serviced_count.max(1))
}

/// Stories a stair-table record spans, from its type ordinal.
pub fn tdt_stair_stories(type_id: i64) -> i64 {
    if type_id <= 1 {
        1
    } else if type_id <= 3 {
        2
    } else {
        3
    }
}

/// `viewWordsFromView`: a saved camera view (center in our grid units) to
/// the header's view-scroll words. Non-finite members fall back to the New
/// Tower default; finite values clamp into the scrollable range, and the
/// (0, 0) sentinel is never emitted for a real view.
pub fn view_words_from_view(tile: f64, floor: f64) -> (i64, i64) {
    if !tile.is_finite() || !floor.is_finite() {
        return (TDT_DEFAULT_VIEW_X, TDT_DEFAULT_VIEW_Y);
    }
    let f_tdt = floor + TDT_FLOOR_OFFSET as f64;
    let center_x = tile * TDT_TILE_PX;
    let center_y = (TDT_FLOOR_COUNT as f64 - 1.0 - f_tdt) * TDT_FLOOR_PX + TDT_FLOOR_PX / 2.0;
    let x = round(center_x - TDT_VIEW_W / 2.0)
        .min(TDT_WORLD_W - TDT_VIEW_W)
        .max(0.0);
    let y = round(center_y - TDT_VIEW_H / 2.0)
        .min(TDT_WORLD_H - TDT_VIEW_H)
        .max(0.0);
    let (x, y) = (x as i64, y as i64);
    if x == 0 && y == 0 {
        (0, 1)
    } else {
        (x, y)
    }
}

/// `viewFromViewWords`: the inverse, header words to a camera center in our
/// grid units; (0, 0) is "no saved view" and maps to `None`. Values stay
/// fractional and unclamped, as the TypeScript leaves them.
pub fn view_from_view_words(x: i64, y: i64) -> Option<(f64, f64)> {
    if x == 0 && y == 0 {
        return None;
    }
    let tile = (x as f64 + TDT_VIEW_W / 2.0) / TDT_TILE_PX;
    let center_y = y as f64 + TDT_VIEW_H / 2.0;
    let f_tdt = TDT_FLOOR_COUNT as f64 - 1.0 - (center_y - TDT_FLOOR_PX / 2.0) / TDT_FLOOR_PX;
    Some((tile, f_tdt - TDT_FLOOR_OFFSET as f64))
}

/// `parseTdtBinary`: walk a `.TDT` byte stream into the raw model. The
/// header and floor map are load-bearing; everything after is walked
/// tolerantly, downgrading misfits to warnings.
pub fn parse_tdt_binary(bytes: &[u8]) -> Result<TdtTower, LegacyImportError> {
    if bytes.len() > TDT_MAX_FILE_BYTES {
        return Err(LegacyImportError(
            "This file is too large to be a SimTower save.".into(),
        ));
    }
    if bytes.len() < TDT_HEADER_SIZE {
        return Err(LegacyImportError(
            "This file is too small to be a SimTower save.".into(),
        ));
    }
    let mut r = ByteReader::new(bytes);
    r.enter_block("header");
    let version = r.u16()?;
    if version != TDT_MAGIC {
        return Err(LegacyImportError(
            "This file doesn't look like a SimTower save.".into(),
        ));
    }
    let level = r.u16()?;
    let balance = r.i32()?;
    r.skip(12)?; // otherIncome, constructionCosts, lastQuarterMoney
    let frame_time = r.u16()?;
    let current_day = r.i32()?;
    r.skip(0x26 - r.offset())?;
    let view_x = r.u16()?;
    let view_y = r.u16()?;
    r.skip(TDT_HEADER_SIZE - r.offset())?;
    let header = TdtHeader {
        version,
        level,
        balance,
        frame_time,
        current_day,
        view_x,
        view_y,
    };

    let mut floors = Vec::with_capacity(TDT_FLOOR_COUNT as usize);
    for index in 0..TDT_FLOOR_COUNT {
        r.enter_block(&format!("floor map (floor record {index})"));
        let tenant_count = r.u16()?;
        let left_edge = r.u16()?;
        let right_edge = r.u16()?;
        if tenant_count > TDT_MAX_TENANTS_PER_FLOOR {
            return Err(LegacyImportError(format!(
                "This SimTower save is corrupt: one floor claims {} rooms.",
                with_thousands(tenant_count as f64)
            )));
        }
        let floor_bytes =
            tenant_count as usize * TDT_TENANT_RECORD_SIZE + TDT_FLOOR_INDEX_ENTRIES * 2;
        if r.remaining() < floor_bytes {
            return Err(LegacyImportError(
                "This SimTower save is cut short. The file ends in the middle of its floor map."
                    .into(),
            ));
        }
        let mut tenants = Vec::with_capacity(tenant_count as usize);
        for _ in 0..tenant_count {
            let left = r.u16()?;
            let right = r.u16()?;
            let type_id = r.i8()?;
            let status = r.u8()?;
            let variant = r.u8()?;
            r.skip(9)?;
            let rent_rate = r.u8()?;
            let subtype = r.u8()?;
            tenants.push(TdtTenant {
                left,
                right,
                type_id,
                status,
                variant,
                rent_rate,
                subtype,
            });
        }
        r.skip(TDT_FLOOR_INDEX_ENTRIES * 2)?;
        floors.push(TdtFloor {
            index,
            left_edge,
            right_edge,
            tenants,
        });
    }

    let tail = walk_tolerant_tail(&mut r);
    Ok(TdtTower {
        header,
        floors,
        tail,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_size_is_car_independent_and_refuses_inverted_spans() {
        assert_eq!(built_shaft_payload_size(10, 10), Ok(3140 + 324 + 348));
        assert_eq!(built_shaft_payload_size(10, 100), Ok(3140 + 91 * 324 + 348));
        assert!(built_shaft_payload_size(20, 15).is_err());
        assert_eq!(
            built_shaft_payload_size_for(0, 10, 100, 8),
            Ok(3140 + 8 * 324 + 348)
        );
        assert_eq!(
            built_shaft_payload_size_for(0, 10, 100, 0),
            Ok(3140 + 324 + 348)
        );
        assert!(built_shaft_payload_size_for(0, 20, 15, 3).is_err());
    }

    #[test]
    fn view_words_anchor_on_the_new_tower_default() {
        assert_eq!(view_words_from_view(f64::NAN, 1.0), (1105, 3491));
        assert_eq!(view_words_from_view(0.0, 109.0), (0, 1));
        let (tile, floor) = view_from_view_words(1105, 3491).unwrap();
        assert_eq!(view_words_from_view(tile, floor), (1105, 3491));
        assert_eq!(view_from_view_words(0, 0), None);
    }

    #[test]
    fn tenant_count_refusal_groups_thousands() {
        // The refusal sees a u16 above the per-floor cap, so these bound it.
        assert_eq!(with_thousands(257.0), "257");
        assert_eq!(with_thousands(999.0), "999");
        assert_eq!(with_thousands(1000.0), "1,000");
        assert_eq!(with_thousands(65535.0), "65,535");
    }
}
