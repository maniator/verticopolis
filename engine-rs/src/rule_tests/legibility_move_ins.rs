//! Legibility, the move-in half: nobody moves in or checks in on a served
//! floor only a long stair climb reaches, move-ins resume once an elevator
//! connects it, a tenant already there stays, and the stranded advisory
//! counts the rentable rooms (still empty ones and a dirty guest room, but
//! not shells), re-arming after each fix. The first half of the suite is in
//! `rule_tests::legibility`.
use crate::facilities::Kind;
use crate::load::deserialize;
use crate::sim::{LogKind, Simulation};
use crate::tower::UnitState;

use super::legibility::{nudges, stair_strand, DAY, STRANDED_NUDGE};
use super::{put, unit, MID as C};

/// Empty rooms on the stranded floor 40 and a control condo on floor 8.
struct Rooms {
    condo_40: i64,
    office_40: i64,
    hotel_40: i64,
    condo_8: i64,
}

fn stranded_rooms(seed: u32) -> (Simulation, Rooms) {
    let mut sim = stair_strand(seed, true);
    let rooms = Rooms {
        condo_40: put(&mut sim, Kind::Condo, 40, 20),
        office_40: put(&mut sim, Kind::Office, 40, 60),
        hotel_40: put(&mut sim, Kind::HotelSingle, 40, 100),
        condo_8: put(&mut sim, Kind::Condo, 8, 20),
    };
    (sim, rooms)
}

/// The elevator from the sky lobby on 30 to 45 that connects floor 40.
fn build_shortcut(sim: &mut Simulation) -> i64 {
    assert!(
        sim.build_transport(Kind::ElevatorStandard, C - 10, 30, 45)
            .ok
    );
    let t = sim
        .tower
        .transports
        .iter()
        .find(|t| t.x == C - 10 && t.bottom == 30);
    t.unwrap().id
}

fn ever_occupied(sim: &Simulation, id: i64) -> bool {
    unit(sim, id).ever_occupied
}

#[test]
fn nobody_moves_in_on_a_stranded_floor_while_a_reachable_one_fills() {
    let (mut sim, r) = stranded_rooms(8);
    assert!(sim.tower.is_floor_served(40));
    sim.tick(7.0 * DAY);
    for id in [r.condo_40, r.office_40, r.hotel_40] {
        assert_eq!(unit(&sim, id).state, UnitState::Empty);
        assert!(!ever_occupied(&sim, id));
    }
    assert!(ever_occupied(&sim, r.condo_8), "demand itself is alive");
}

#[test]
fn move_ins_resume_once_an_elevator_connects_the_floor() {
    let (mut sim, r) = stranded_rooms(9);
    sim.tick(2.0 * DAY);
    assert!(!ever_occupied(&sim, r.condo_40));
    build_shortcut(&mut sim);
    sim.tick(3.0 * DAY);
    assert!(ever_occupied(&sim, r.condo_40));
}

#[test]
fn a_condo_already_sold_on_a_stranded_floor_survives_a_save() {
    let (mut sim, r) = stranded_rooms(10);
    let u = sim.tower.get_unit_mut(r.condo_40).unwrap();
    u.state = UnitState::Occupied;
    u.ever_occupied = true;
    u.rent = Some(160_000.0);
    let mut loaded = deserialize(&sim.serialize()).unwrap();
    loaded.tick(2.0 * DAY);
    assert_eq!(unit(&loaded, r.condo_40).state, UnitState::Occupied);
    assert!(ever_occupied(&loaded, r.condo_40), "no buy-back");
}

#[test]
fn the_advisory_counts_empty_rentable_rooms_as_info_and_latches() {
    let (mut sim, _) = stranded_rooms(11);
    assert!(sim.stranded_floors(true).contains(&40));
    assert_eq!(
        sim.stranded_floors(false),
        Vec::<i64>::new(),
        "nothing leased"
    );
    sim.tick(DAY);
    let entries: Vec<_> = sim
        .log
        .iter()
        .filter(|e| e.text.contains(STRANDED_NUDGE))
        .collect();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].kind, LogKind::Info, "a log line, never a toast");
    sim.tick(DAY);
    assert_eq!(nudges(&sim), 1, "latched");
}

#[test]
fn a_dirty_guest_room_keeps_its_floor_rentable_and_is_never_refilled() {
    let (mut sim, r) = stranded_rooms(12);
    sim.tower.get_unit_mut(r.hotel_40).unwrap().state = UnitState::Dirty;
    for id in [r.condo_40, r.office_40] {
        assert!(sim.tower.remove_unit(id).is_some());
    }
    assert!(sim.stranded_floors(true).contains(&40));
    assert_eq!(
        sim.stranded_floors(false),
        Vec::<i64>::new(),
        "dirty is not leased"
    );
    sim.tick(DAY);
    assert_eq!(unit(&sim, r.hotel_40).state, UnitState::Dirty);
}

#[test]
fn a_floor_of_shells_draws_no_advisory() {
    let (mut sim, r) = stranded_rooms(13);
    let now = sim.clock.minutes;
    sim.tower.get_unit_mut(r.condo_40).unwrap().state = UnitState::Gutted;
    let u = sim.tower.get_unit_mut(r.office_40).unwrap();
    u.state = UnitState::Construction;
    u.extras_mut().complete_at = Some(now + 10.0 * DAY);
    sim.tower.get_unit_mut(r.hotel_40).unwrap().state = UnitState::Fire;
    assert_eq!(sim.stranded_floors(true), Vec::<i64>::new());
    sim.tick(DAY);
    assert_eq!(nudges(&sim), 0);
}

#[test]
fn losing_the_shortcut_stops_move_ins_keeps_tenants_and_nudges_again() {
    let (mut sim, r) = stranded_rooms(14);
    let shortcut = build_shortcut(&mut sim);
    sim.tick(3.0 * DAY);
    assert!(ever_occupied(&sim, r.condo_40));
    assert_eq!(nudges(&sim), 0, "nothing stranded yet");
    assert!(sim.tower.remove_transport(shortcut).is_some());
    assert!(!sim.floor_reachable(40));
    assert!(sim.tower.is_floor_served(40));
    assert!(sim.build(Kind::Condo, 40, 140).ok);
    let late = sim.tower.unit_at(40, 140).unwrap().id;
    sim.tick(3.0 * DAY);
    assert!(ever_occupied(&sim, r.condo_40), "no retroactive eviction");
    assert!(!ever_occupied(&sim, late));
    assert_eq!(unit(&sim, late).state, UnitState::Empty);
    assert_eq!(nudges(&sim), 1, "the advisory announced the shift");
}

#[test]
fn the_advisory_re_arms_after_a_fix_and_fires_again_on_a_relapse() {
    let (mut sim, _) = stranded_rooms(15);
    sim.tick(DAY);
    assert_eq!(nudges(&sim), 1);
    let shortcut = build_shortcut(&mut sim);
    sim.tick(DAY);
    assert_eq!(nudges(&sim), 1, "cleared: no new nudge");
    assert!(sim.tower.remove_transport(shortcut).is_some());
    sim.tick(DAY);
    assert_eq!(nudges(&sim), 2, "a fresh crossing");
}
