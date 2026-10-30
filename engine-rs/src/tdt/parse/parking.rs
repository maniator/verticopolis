//! Parking rows as SimTower saved them, closed up so the ramp reaches them.
//!
//! A SimTower parking row can hold a short paving piece between stalls: TOWER7
//! has a 3-tile one and a 1-tile one on its B5 row, left where the player
//! rebuilt stalls beside the ramp. The original still counts those stalls as
//! connected (the file's own count says so), while our rule chains stalls tile
//! to tile from the ramp, so they imported with red X marks. Every stall that
//! sits within a stall's width of its neighbor toward the ramp slides over the
//! gap. A row split by a wider gap stays split (TOWER1's far stalls, 56 tiles
//! away, are disconnected in the file too).

use super::OutUnit;
use crate::facilities::Kind;

/// Slides stalls toward the ramp on their row until the chain touches it.
pub(super) fn close_parking_gaps(units: &mut [OutUnit]) {
    let mut by_floor: Vec<(i64, Vec<usize>)> = Vec::new();
    for (i, u) in units.iter().enumerate() {
        if !matches!(u.kind, Kind::Parking | Kind::ParkingRamp) {
            continue;
        }
        match by_floor.iter_mut().find(|(f, _)| *f == u.floor) {
            Some((_, row)) => row.push(i),
            None => by_floor.push((u.floor, vec![i])),
        }
    }
    for (_, mut row) in by_floor {
        row.sort_by_key(|&i| units[i].x);
        let ramps: Vec<usize> = row
            .iter()
            .copied()
            .filter(|&i| units[i].kind == Kind::ParkingRamp)
            .collect();
        for ramp in ramps {
            let at = row.iter().position(|&i| i == ramp).expect("ramp in row");
            slide_side(units, &row[at + 1..], units[ramp].x + units[ramp].width, 1);
            slide_side(units, &row[..at], units[ramp].x, -1);
        }
    }
}

/// Walks `stalls` away from a ramp edge (`dir` +1 is rightward, in order; -1
/// is leftward, taken nearest first) and pulls each one onto the chain when
/// the file left less than one stall of gap before it.
fn slide_side(units: &mut [OutUnit], stalls: &[usize], edge: i64, dir: i64) {
    let mut cursor = edge;
    let mut file_edge = edge;
    let order: Vec<usize> = if dir > 0 {
        stalls.to_vec()
    } else {
        stalls.iter().rev().copied().collect()
    };
    for i in order {
        let (x, width, kind) = (units[i].x, units[i].width, units[i].kind);
        if kind != Kind::Parking {
            return;
        }
        let gap = if dir > 0 {
            x - file_edge
        } else {
            file_edge - (x + width)
        };
        if gap < 0 || gap >= width {
            return;
        }
        let placed = if dir > 0 { cursor } else { cursor - width };
        units[i].x = placed;
        cursor = if dir > 0 { placed + width } else { placed };
        file_edge = if dir > 0 { x + width } else { x };
    }
}
