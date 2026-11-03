//! The rebuilt elevator layout for a save whose elevator table cannot be read.

use std::collections::HashMap;

use super::OutUnit;
use crate::facilities::{Kind, LOT_WIDTH};
use crate::tdt::transports::{synthesize_transports, BuiltExtents, Synthesized};

/// Working shafts from the floors alone: a service shaft reaches the hotel and
/// housekeeping floors, and every shaft keeps clear of the imported rooms.
///
/// The rooms come from the final `units`, after parking stalls slid onto their
/// ramps and the finance seeding ran, so a moved stall blocks its new tiles
/// and not the ones it left.
pub(super) fn fallback_transports(
    units: &[OutUnit],
    built_extents: &BuiltExtents,
    first_id: i64,
) -> Synthesized {
    let floors_of = |keep: fn(Kind) -> bool| -> Vec<i64> {
        units
            .iter()
            .filter(|u| keep(u.kind))
            .map(|u| u.floor)
            .collect()
    };
    let hotel_floors = floors_of(Kind::is_hotel);
    let staff_floors = floors_of(|kind| kind == Kind::Housekeeping);
    synthesize_transports(
        built_extents,
        &room_tiles(units),
        &hotel_floors,
        &staff_floors,
        first_id,
    )
}

/// The tiles every unit covers, per floor, as a row of 0 (free) and 1.
fn room_tiles(units: &[OutUnit]) -> HashMap<i64, Vec<u8>> {
    let mut tiles: HashMap<i64, Vec<u8>> = HashMap::new();
    for unit in units {
        let (left, right) = (unit.x.max(0), (unit.x + unit.width).min(LOT_WIDTH));
        if right <= left {
            continue;
        }
        for floor in unit.floor..unit.floor + unit.kind.floors() {
            let row = tiles
                .entry(floor)
                .or_insert_with(|| vec![0; LOT_WIDTH as usize]);
            row[left as usize..right as usize].fill(1);
        }
    }
    tiles
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tdt::parse::parking::close_parking_gaps;

    fn unit(id: i64, kind: Kind, floor: i64, x: i64) -> OutUnit {
        OutUnit {
            id,
            kind,
            floor,
            x,
            width: kind.facility().width,
            state: "empty",
            occupants: 0,
            ever_occupied: false,
            rent: None,
            no_rate: false,
            subtype: None,
            complete_at: None,
        }
    }

    fn lot_extents(bottom: i64, top: i64) -> BuiltExtents {
        (bottom..=top).map(|f| (f, (0, LOT_WIDTH))).collect()
    }

    fn overlaps(shaft_x: i64, shaft_width: i64, u: &OutUnit) -> bool {
        shaft_x < u.x + u.width && u.x < shaft_x + shaft_width
    }

    /// The rooms are read from the final units, so a stall that slid onto its
    /// ramp blocks the tiles it moved to. Here the shaft's natural column is
    /// the first tile past the ramp, where the stall ends up.
    #[test]
    fn a_stall_that_slid_toward_its_ramp_blocks_its_new_tiles() {
        let shaft = Kind::ElevatorStandard.facility().width;
        let ramp = Kind::ParkingRamp.facility().width;
        let natural = (LOT_WIDTH as f64 / 2.0 - shaft as f64 / 2.0).round() as i64;
        // The ramp ends where the shaft would start, and the file left one tile
        // of gap before the stall, which the importer closes.
        let mut units = vec![
            unit(1, Kind::ParkingRamp, -1, natural - ramp),
            unit(2, Kind::Parking, -1, natural + 1),
        ];
        close_parking_gaps(&mut units);
        assert_eq!(units[1].x, natural, "the stall slid onto the ramp");

        let rebuilt = fallback_transports(&units, &lot_extents(-1, 3), 10);
        assert_eq!(rebuilt.left_out, 0, "a free column exists beside the stall");
        assert_eq!(rebuilt.transports.len(), 1);
        for t in &rebuilt.transports {
            for u in &units {
                assert!(
                    !overlaps(t.x, t.width, u),
                    "shaft at x={} stands on {:?} at x={}",
                    t.x,
                    u.kind,
                    u.x
                );
            }
        }
    }

    /// With every column of the shaft's floors taken, the shaft is left out
    /// and counted instead of being written over a room.
    #[test]
    fn a_fully_occupied_band_leaves_the_shaft_out_and_counts_it() {
        let shop = Kind::Shop.facility().width;
        let units: Vec<OutUnit> = (0..LOT_WIDTH / shop + 1)
            .map(|i| unit(i + 1, Kind::Shop, 1, i * shop))
            .collect();
        let rebuilt = fallback_transports(&units, &lot_extents(1, 3), 10);
        assert_eq!(rebuilt.transports.len(), 0);
        assert_eq!(rebuilt.left_out, 1);
    }

    #[test]
    fn a_band_with_a_free_column_still_gets_its_shaft() {
        let shaft = Kind::ElevatorStandard.facility().width;
        let units = vec![unit(1, Kind::Shop, 2, 0)];
        let rebuilt = fallback_transports(&units, &lot_extents(1, 3), 10);
        assert_eq!(rebuilt.left_out, 0);
        assert_eq!(rebuilt.transports.len(), 1);
        assert!(!overlaps(rebuilt.transports[0].x, shaft, &units[0]));
    }
}
