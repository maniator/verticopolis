//! Modern housekeeping triage: dirty rooms are ordered by days dirty times
//! ten less the floors to the nearest connected crew, so a room close to
//! infesting is rescued before a fresh nearer one, equal urgency goes to the
//! nearer room, equal scores fall to the lower room id, unreachable rooms
//! sort last and are reported, and the 10:1 weight holds at its boundary.
//! Classic keeps the original's tower order. Order is read from the crowd:
//! maids spawn in dispatch order.
//!
//! Crew choice on a split staff network is covered by
//! `housekeeping_dispatch_tests::modern_sends_the_nearest_connected_crew_to_the_most_urgent_room`
//! and `housekeeping_dispatch_tests::classic_tries_the_connected_crews_in_tower_order`.
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{seeded_game, MID};

const X0: i64 = MID - 20;
const MIDSHIFT: f64 = 13.0 * 60.0;

fn slab(sim: &mut Simulation, floor: i64) {
    for i in 0..30 {
        assert!(sim.tower.place(Kind::Floor, floor, X0 + i).ok);
    }
}

/// Floors 2 to 8, a passenger elevator, a service elevator over every floor
/// and a crew on floor 2.
fn triage_tower(seed: u32, mode: GameMode) -> Simulation {
    let mut sim = seeded_game(seed, mode);
    sim.star = 2;
    for floor in 2..=8 {
        slab(&mut sim, floor);
    }
    assert!(
        sim.build_transport(Kind::ElevatorStandard, X0 + 26, 1, 8)
            .ok
    );
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorService, X0 + 18, 1, 8)
            .ok
    );
    assert!(sim.tower.place(Kind::Housekeeping, 2, X0 + 8).ok);
    sim
}

fn dirty_room(sim: &mut Simulation, floor: i64, x: i64, days: Option<i64>) -> i64 {
    let r = sim.tower.place(Kind::HotelSingle, floor, x);
    assert!(r.ok, "{:?}", r.reason);
    let id = r.unit_id.unwrap();
    let u = sim.tower.get_unit_mut(id).unwrap();
    u.state = UnitState::Dirty;
    if days.is_some() {
        u.extras_mut().dirty_days = days;
    }
    id
}

fn stairs(sim: &mut Simulation, x: i64, bottom: i64) {
    assert!(
        sim.tower
            .place_transport(Kind::Stairs, x, bottom, bottom + 1)
            .ok
    );
}

/// The rooms maids were sent to, in spawn order.
fn dispatch(sim: &mut Simulation) -> Vec<i64> {
    sim.clock.minutes = MIDSHIFT;
    sim.dispatch_housekeepers();
    sim.crowd
        .people
        .iter()
        .filter(|p| p.staff)
        .filter_map(|p| p.clean_unit_id)
        .collect()
}

#[test]
fn a_room_about_to_infest_is_rescued_before_a_fresh_nearer_one() {
    let mut sim = triage_tower(61, GameMode::Modern);
    let near = dirty_room(&mut sim, 2, X0, None); // score 0
    let far = dirty_room(&mut sim, 8, X0, Some(2)); // 2 * 10 - 6 = 14
    assert_eq!(dispatch(&mut sim), [far, near]);
}

#[test]
fn equal_urgency_goes_to_the_nearer_room_first() {
    let mut sim = triage_tower(62, GameMode::Modern);
    let near = dirty_room(&mut sim, 2, X0, None);
    let far = dirty_room(&mut sim, 8, X0, None);
    assert_eq!(dispatch(&mut sim), [near, far]);
}

#[test]
fn the_same_tower_dispatches_in_the_same_order_every_run() {
    let once = || {
        let mut sim = triage_tower(63, GameMode::Modern);
        dirty_room(&mut sim, 3, X0, Some(1));
        dirty_room(&mut sim, 5, X0, Some(1));
        dirty_room(&mut sim, 4, X0, Some(2));
        dispatch(&mut sim)
    };
    let a = once();
    assert_eq!(a.len(), 3);
    assert_eq!(once(), a);
}

#[test]
fn equal_scores_fall_to_the_lower_room_id() {
    let mut sim = triage_tower(65, GameMode::Modern);
    let a = dirty_room(&mut sim, 5, X0, Some(1));
    let b = dirty_room(&mut sim, 5, X0 + 4, Some(1));
    assert!(a < b);
    // One maid per floor: only the tiebreak winner goes.
    assert_eq!(dispatch(&mut sim), [a]);
}

#[test]
fn unreachable_rooms_sort_last_and_are_reported() {
    let mut sim = triage_tower(66, GameMode::Modern);
    for floor in 9..=10 {
        slab(&mut sim, floor);
    }
    let reachable = dirty_room(&mut sim, 3, X0, None);
    dirty_room(&mut sim, 9, X0, Some(2));
    dirty_room(&mut sim, 10, X0, Some(2));
    assert_eq!(dispatch(&mut sim), [reachable]);
    assert!(sim
        .log
        .iter()
        .any(|e| e.text.contains("Housekeeping can't reach 2 dirty room(s)")));
}

#[test]
fn a_day_of_dirt_outweighs_nine_floors_and_loses_to_eleven() {
    // Nine floors: 1 * 10 - 9 = 1 beats a fresh room at the crew's floor.
    let mut sim = triage_tower(67, GameMode::Modern);
    for floor in 9..=11 {
        slab(&mut sim, floor);
    }
    stairs(&mut sim, X0, 8);
    stairs(&mut sim, X0 + 8, 9);
    stairs(&mut sim, X0, 10);
    let near = dirty_room(&mut sim, 2, X0, None);
    let nine = dirty_room(&mut sim, 11, X0 + 24, Some(1));
    assert_eq!(dispatch(&mut sim)[..2], [nine, near]);
    // Eleven floors: 1 * 10 - 11 = -1 loses to the fresh room.
    let mut sim = triage_tower(68, GameMode::Modern);
    for floor in 9..=13 {
        slab(&mut sim, floor);
    }
    for floor in 8..=12 {
        stairs(&mut sim, X0 + (floor % 2) * 8, floor);
    }
    let near = dirty_room(&mut sim, 2, X0, None);
    let eleven = dirty_room(&mut sim, 13, X0 + 24, Some(1));
    assert_eq!(dispatch(&mut sim)[..2], [near, eleven]);
}

#[test]
fn classic_serves_rooms_in_placement_order_however_dirty() {
    let mut sim = triage_tower(64, GameMode::Classic);
    let first = dirty_room(&mut sim, 2, X0, None);
    let older = dirty_room(&mut sim, 8, X0, Some(2));
    assert_eq!(dispatch(&mut sim), [first, older]);
}
