//! A housekeeper's working day: they walk in from the lobby to their
//! housekeeping room, go from one dirty room to the next, come back to the
//! housekeeping room when nothing is left, and leave through the lobby when
//! the shift is over. Nobody appears at a housekeeping room or vanishes at a
//! hotel room. The crowd moves them; the simulation's housekeeping
//! (`housekeeping_shift.rs`) decides where they go next.

use super::motion::{finish, release_seat};
use super::spawn::{make_person, pick_x, seed_for};
use super::{Crowd, PState, Route, StaffResult};
use crate::tower::Tower;

/// The floor people enter and leave the tower on.
pub const STREET_FLOOR: i64 = 1;

/// Where a housekeeper is in their working day.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StaffTrip {
    /// Walking in from the lobby to their housekeeping room.
    In,
    /// At their housekeeping room, waiting for a room to clean.
    Base,
    /// On the way to a dirty room, or cleaning it.
    Job,
    /// Done with a room, and waiting this step for the next one.
    Free,
    /// On the way back to their housekeeping room.
    Home,
    /// Leaving through the lobby.
    Out,
}

/// Which network a trip uses: work trips keep to the staff network (service
/// elevators and stairs); the commute between the lobby and the
/// housekeeping room takes it too when it can, and the passenger elevators,
/// escalators and stairs when it cannot.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Network {
    Passenger,
    Staff,
}

fn route(
    crowd: &mut Crowd,
    tower: &Tower,
    net: Network,
    from: (i64, f64),
    to: (i64, f64),
) -> Option<Route> {
    match net {
        Network::Passenger => crowd.route(tower, from.0, to.0, Some(from.1), Some(to.1)),
        Network::Staff => crowd.staff_route(tower, from.0, to.0, Some(from.1), Some(to.1)),
    }
}

/// Bring one housekeeper of the crew at (`floor`, `x`) in from the lobby.
/// False when no route leads from the lobby to the housekeeping room.
pub fn spawn_commuter(crowd: &mut Crowd, tower: &Tower, crew_id: i64, floor: i64, x: f64) -> bool {
    // Where the new person will stand, as `add` picks it for a visitor.
    let street_x = pick_x(tower, STREET_FLOOR, seed_for(crowd.next_id));
    let street = (STREET_FLOOR, street_x as f64);
    let Some(r) = route(crowd, tower, Network::Staff, street, (floor, x))
        .or_else(|| route(crowd, tower, Network::Passenger, street, (floor, x)))
    else {
        return false;
    };
    let i = make_person(crowd, tower, r, x, Some(street_x));
    let p = &mut crowd.people[i];
    p.staff = true;
    p.crew_id = Some(crew_id);
    p.staff_trip = Some(StaffTrip::In);
    crowd.staff_count += 1;
    *crowd.crew_roster.entry(crew_id).or_insert(0) += 1;
    true
}

/// Send housekeeper `i` from where they stand to (`floor`, `x`) as `trip`.
/// False, with the housekeeper left where they are, when no route leads
/// there.
pub fn send(
    crowd: &mut Crowd,
    tower: &Tower,
    i: usize,
    net: Network,
    to: (i64, f64),
    trip: StaffTrip,
) -> bool {
    let from = (crowd.people[i].floor, crowd.people[i].x);
    let Some(r) = route(crowd, tower, net, from, to) else {
        return false;
    };
    let p = &mut crowd.people[i];
    p.state = if r.shafts.is_empty() {
        PState::ToDest
    } else {
        PState::ToShaft
    };
    p.shaft_id = r.shafts.first().copied();
    p.floors = r.floors;
    p.shafts = r.shafts;
    p.leg = 0;
    p.car_index = None;
    p.dest_x = to.1;
    p.wait = 0.0;
    p.trip_wait = 0.0;
    p.age = 0.0;
    p.linger = 0.0;
    p.staff_trip = Some(trip);
    true
}

/// Leave through the lobby, or, with no way down, leave from where they
/// stand.
pub fn send_out(crowd: &mut Crowd, tower: &mut Tower, i: usize) {
    let street_x = pick_x(tower, STREET_FLOOR, crowd.people[i].seed) as f64;
    let to = (STREET_FLOOR, street_x);
    if !send(crowd, tower, i, Network::Staff, to, StaffTrip::Out)
        && !send(crowd, tower, i, Network::Passenger, to, StaffTrip::Out)
    {
        finish(crowd, i, tower);
    }
}

/// A housekeeper at the end of a walk (`PState::ToDest`): home at the
/// housekeeping room, cleaning a room until the clean is done, or out the
/// door.
pub fn at_destination(crowd: &mut Crowd, i: usize, tower: &mut Tower, dt: f64, trip: StaffTrip) {
    let p = &mut crowd.people[i];
    match trip {
        StaffTrip::In | StaffTrip::Home => {
            p.staff_trip = Some(StaffTrip::Base);
            crowd.staff_ready.push(p.id);
        }
        StaffTrip::Job => {
            p.linger += dt;
            if p.linger > p.linger_for.unwrap_or(0.0) {
                if let Some(unit_id) = p.clean_unit_id.take() {
                    crowd.staff_done.push(StaffResult { unit_id, ok: true });
                }
                p.staff_trip = Some(StaffTrip::Free);
                crowd.staff_ready.push(p.id);
            }
        }
        StaffTrip::Out => finish(crowd, i, tower),
        StaffTrip::Base | StaffTrip::Free => {}
    }
}

/// A housekeeper whose trip cannot go on (out of patience, or the shaft or
/// car they used is gone): one on the way out tries another way out, and
/// anyone else gives up their room, stops where they stand and waits for
/// the dispatch to send them on, home or out. Nobody vanishes mid-tower.
pub fn stuck(crowd: &mut Crowd, i: usize, tower: &mut Tower) {
    if crowd.people[i].staff_trip == Some(StaffTrip::Out) {
        return send_out(crowd, tower, i);
    }
    release_seat(crowd, i);
    let p = &mut crowd.people[i];
    if let Some(unit_id) = p.clean_unit_id.take() {
        crowd.staff_done.push(StaffResult { unit_id, ok: false });
    }
    // Back on the floor the leg left from, where they stand.
    p.fy = p.floor as f64;
    p.state = PState::ToDest;
    p.dest_x = p.x;
    p.shaft_id = None;
    p.car_index = None;
    p.age = 0.0;
    p.staff_trip = Some(StaffTrip::Free);
    crowd.staff_ready.push(p.id);
}

/// The index of the person with id `id`. The crowd is in id order: people
/// join at the end with the next id and leave by `retain`.
pub fn index_of(crowd: &Crowd, id: i64) -> Option<usize> {
    crowd.people.binary_search_by_key(&id, |p| p.id).ok()
}
