//! The floors each Modern halo is cast from, kept sorted with each story
//! once, and the nearest-story search the satisfaction step reads them by.

use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::tower::Unit;

/// The distance from `floor` to the nearest story in `floors`, a sorted list
/// with each story once (infinite when it is empty). The nearest story is
/// one of the two either side of where `floor` would sit, so this answers
/// as a walk over every story would.
pub(super) fn nearest_floor_dist(floors: &[i64], floor: i64) -> f64 {
    match floors.binary_search(&floor) {
        Ok(_) => 0.0,
        Err(at) => {
            let below = at.checked_sub(1).map(|b| floor - floors[b]);
            let above = floors.get(at).map(|&f| f - floor);
            match (below, above) {
                (Some(b), Some(a)) => b.min(a) as f64,
                (Some(d), None) | (None, Some(d)) => d as f64,
                (None, None) => f64::INFINITY,
            }
        }
    }
}

/// Add every story venue `c` fills to the list for the halo it casts in
/// `mode`, if any. A venue that starts casting mid-hour (a fitness club
/// leased this hour) is added the same way.
/// The list stays sorted with each story once.
pub(crate) fn note_halo_venue(halo_floors: &mut [Vec<i64>], mode: GameMode, c: &Unit) {
    if let Some(i) = halo_row(mode, c.kind) {
        let floors = &mut halo_floors[i];
        for f in c.floor..c.floor + c.kind.floors() {
            if let Err(at) = floors.binary_search(&f) {
                floors.insert(at, f);
            }
        }
    }
}

/// The row of `GameMode::halos` a venue of `kind` casts, if any.
pub(super) fn halo_row(mode: GameMode, kind: Kind) -> Option<usize> {
    mode.halos().iter().position(|h| h.source == kind)
}
