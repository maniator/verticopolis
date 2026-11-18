//! A Metro rider's trip between the station and a floor of the tower
//! (the retired TypeScript `src/engine/crowd/venueTrips.ts`).

use super::{add, inside_x, pick_x, seed_for};
use crate::crowd::{Crowd, METRO_DWELL_MAX, METRO_DWELL_MIN};
use crate::tower::{Tower, Unit};

/// The middle of `station`, where a rider's trip on its platform starts or
/// ends, so the route runs from the station's own run of the platform.
fn station_x(station: &Unit) -> i64 {
    station.x + station.width / 2
}

/// The tile a Metro rider's trip starts or ends on at its other floor: the
/// seed's tile of the whole floor, as it always was, so riders still spread
/// over every tower of a lot with several (fixing the station end alone
/// would send them all to the run nearest the station).
fn far_end_x(crowd: &Crowd, tower: &Tower, floor: i64) -> i64 {
    pick_x(tower, floor, seed_for(crowd.next_id))
}

pub(crate) fn metro_arrival(
    crowd: &mut Crowd,
    tower: &Tower,
    station: &Unit,
    to: i64,
) -> Option<usize> {
    let far = far_end_x(crowd, tower, to);
    let i = add(
        crowd,
        tower,
        station.floor + 1,
        to,
        Some(station_x(station)),
        Some(far),
    )?;
    crowd.people[i].x = inside_x(crowd, station, 2) as f64;
    crowd.people[i].start_x = crowd.people[i].x;
    crowd.people[i].from_metro = true;
    Some(i)
}

pub(super) fn metro_departure(
    crowd: &mut Crowd,
    tower: &Tower,
    station: &Unit,
    from: i64,
) -> Option<usize> {
    let far = far_end_x(crowd, tower, from);
    let i = add(
        crowd,
        tower,
        from,
        station.floor + 1,
        Some(far),
        Some(station_x(station)),
    )?;
    crowd.people[i].dest_x = inside_x(crowd, station, 2) as f64;
    crowd.people[i].linger_for = Some(crowd.rng.int(METRO_DWELL_MIN, METRO_DWELL_MAX) as f64);
    Some(i)
}
