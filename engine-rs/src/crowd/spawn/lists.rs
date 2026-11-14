//! The floor lists a plain commute picks from, and the errand it stamps
//! for the person card (#2092).

use super::super::trip::{Errand, ErrandPlace};
use super::super::Crowd;
use super::SpawnFloors;

/// Only homes now: office workers commute as people (`commuters`).
#[derive(Clone, Copy)]
pub(super) enum List {
    Homes,
}

/// Stamp the errand of a plain commute just added at `i` (none when the
/// spawn found no route), for the person card. Draws nothing.
pub(super) fn stamp_errand(crowd: &mut Crowd, i: Option<usize>, l: List, inbound: bool) {
    let place = match l {
        List::Homes => ErrandPlace::Home,
    };
    if let Some(i) = i {
        crowd.people[i].errand = Some(Errand { place, inbound });
    }
}

pub(super) fn list_of(floors: &SpawnFloors, l: List) -> &[i64] {
    match l {
        List::Homes => &floors.homes,
    }
}
