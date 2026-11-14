//! The floor lists a plain commute picks from, and the errand it stamps
//! for the person card (#2092).

use super::super::trip::{Errand, ErrandPlace};
use super::super::Crowd;
use super::SpawnFloors;

#[derive(Clone, Copy)]
pub(super) enum List {
    LeasedOffices,
    StaffedOffices,
    Homes,
    OpenVenues,
}

/// Stamp the errand of a plain commute just added at `i` (none when the
/// spawn found no route), for the person card. Draws nothing.
pub(super) fn stamp_errand(crowd: &mut Crowd, i: Option<usize>, l: List, inbound: bool) {
    let place = match l {
        List::LeasedOffices | List::StaffedOffices => ErrandPlace::Office,
        List::Homes => ErrandPlace::Home,
        List::OpenVenues => ErrandPlace::Venue,
    };
    if let Some(i) = i {
        crowd.people[i].errand = Some(Errand { place, inbound });
    }
}

pub(super) fn list_of(floors: &SpawnFloors, l: List) -> &[i64] {
    match l {
        List::LeasedOffices => &floors.leased_offices,
        List::StaffedOffices => &floors.staffed_offices,
        List::Homes => &floors.homes,
        List::OpenVenues => &floors.open_venues,
    }
}
