//! The FAQ parity rules, part one: the canon star ladder (four stars wants
//! Medical, recycling demand met, two suites and a favorable VIP; five
//! wants a Metro), hotel guests count toward the rating only below four
//! stars and never lift a tower to five, office noise wears on a nearby
//! hotel and condo (a lessee leaves, an owner on a short spell stays, and
//! removing the office lets a condo on notice recover), and the VIP's
//! suite stay needs its parking space and counts its visits on a five-day
//! throttle that survives a reload. Part two is `faq_complete_mechanics.rs`.
//! A dirty room with no housekeeping turning infested and spreading is
//! `rule_tests::infestation::{a_room_left_dirty_turns_infested_on_its_last_checkout,
//! only_an_infested_room_spreads_to_its_clean_neighbor}`.
use crate::clock::GameMode;
use crate::facilities::{Kind, LOT_WIDTH};
use crate::load::deserialize;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{seeded_game, MID as C};

const W: i64 = LOT_WIDTH;
const OFFICE_WIDTH: i64 = 9;

pub(super) fn lay(sim: &mut Simulation, kind: Kind, floor: i64) {
    for x in (C..W).chain((0..C).rev()) {
        sim.tower.place(kind, floor, x);
    }
}

fn set(sim: &mut Simulation, id: i64, state: UnitState) {
    sim.tower.get_unit_mut(id).unwrap().state = state;
}

/// Fills whole floors from `floor` with occupied offices until the
/// population reaches `target`; returns the next empty floor.
fn add_offices(sim: &mut Simulation, mut floor: i64, target: i64) -> i64 {
    while sim.tower.total_population() < target && floor <= 100 {
        lay(sim, Kind::Floor, floor);
        let mut x = 0;
        while x + OFFICE_WIDTH <= W && sim.tower.total_population() < target {
            let placed = sim.tower.place(Kind::Office, floor, x);
            assert!(placed.ok, "{:?}", placed.reason);
            let id = placed.unit_id.unwrap();
            set(sim, id, UnitState::Occupied);
            x += OFFICE_WIDTH;
        }
        floor += 1;
    }
    floor
}

fn tower_with_pop(seed: u32, target: i64) -> (Simulation, i64) {
    let mut sim = seeded_game(seed, GameMode::Classic);
    sim.money = 1e12;
    lay(&mut sim, Kind::Lobby, 1);
    let next = add_offices(&mut sim, 2, target);
    (sim, next)
}

/// Medical, two Security offices and two suites on a new floor `top`.
fn amenities(sim: &mut Simulation, top: i64) {
    lay(sim, Kind::Floor, top);
    for (kind, x) in [
        (Kind::Medical, 0),
        (Kind::Security, 60),
        (Kind::Security, 100),
        (Kind::HotelSuite, 30),
        (Kind::HotelSuite, 45),
    ] {
        assert!(sim.tower.place(kind, top, x).ok, "{kind:?}");
    }
}

/// Recycling centers `from..to` in a row on `floor`.
fn recycling(sim: &mut Simulation, floor: i64, from: i64, to: i64) {
    let width = Kind::Recycling.facility().width;
    for i in from..to {
        assert!(sim.tower.place(Kind::Recycling, floor, i * width).ok);
    }
}

#[test]
fn four_stars_want_recycling_demand_met_beside_the_other_gates() {
    let (mut sim, top) = tower_with_pop(1, 5200);
    sim.star = 3;
    amenities(&mut sim, top);
    sim.evaluate_star();
    assert_eq!(sim.star, 3, "no recycling and no VIP yet");
    lay(&mut sim, Kind::Floor, 0);
    lay(&mut sim, Kind::Floor, -1);
    recycling(&mut sim, -1, 0, 1);
    sim.vip_favorable = true;
    assert!(!sim.recycling_demand_met());
    sim.evaluate_star();
    assert_eq!(sim.star, 3, "built is not enough: demand must be met");
    recycling(&mut sim, -1, 1, 3);
    assert!(sim.recycling_demand_met());
    sim.evaluate_star();
    assert_eq!(sim.star, 4);
}

#[test]
fn five_stars_want_a_metro() {
    let (mut sim, top) = tower_with_pop(2, 10200);
    sim.star = 4;
    sim.vip_favorable = true;
    amenities(&mut sim, top);
    for floor in (-5..=0).rev() {
        lay(&mut sim, Kind::Floor, floor);
    }
    recycling(&mut sim, -2, 0, 5);
    sim.evaluate_star();
    assert_eq!(sim.star, 4);
    assert!(sim.tower.place(Kind::Metro, -5, 0).ok);
    sim.evaluate_star();
    assert_eq!(sim.star, 5);
}

#[test]
fn hotel_guests_count_for_the_rating_only_below_four_stars() {
    let mut sim = seeded_game(3, GameMode::Classic);
    sim.money = 1e12;
    lay(&mut sim, Kind::Lobby, 1);
    lay(&mut sim, Kind::Floor, 2);
    for i in 0..50 {
        let placed = sim.tower.place(Kind::HotelSingle, 2, i * 4);
        assert!(placed.ok, "{:?}", placed.reason);
        let id = placed.unit_id.unwrap();
        set(&mut sim, id, UnitState::Asleep);
    }
    sim.star = 3;
    assert!(sim.rating_population() > 0);
    sim.star = 4;
    assert_eq!(sim.rating_population(), 0);
}

#[test]
fn a_three_star_tower_never_reaches_five_on_hotel_guests() {
    let (mut sim, mut floor) = tower_with_pop(7, 9000);
    sim.star = 3;
    let occupants = sim.tower.total_population();
    assert!((5000..10_000).contains(&occupants));
    let suite = Kind::HotelSuite.facility().width;
    while sim.tower.total_population() < 10_200 && floor <= 100 {
        lay(&mut sim, Kind::Floor, floor);
        let mut x = 0;
        while x + suite <= W && sim.tower.total_population() < 10_200 {
            let placed = sim.tower.place(Kind::HotelSuite, floor, x);
            assert!(placed.ok, "{:?}", placed.reason);
            let id = placed.unit_id.unwrap();
            set(&mut sim, id, UnitState::Asleep);
            x += suite;
        }
        floor += 1;
    }
    assert!(
        sim.rating_population() >= 10_000,
        "a three-star read counts guests"
    );
    amenities(&mut sim, floor);
    sim.vip_favorable = true;
    for f in (-8..=0).rev() {
        lay(&mut sim, Kind::Floor, f);
    }
    recycling(&mut sim, -2, 0, 6);
    assert!(sim.recycling_demand_met());
    assert!(sim.tower.place(Kind::Metro, -8, 0).ok);
    sim.evaluate_star();
    assert_eq!(sim.star, 4, "five stars count occupants only");

    let target = sim.tower.total_population() - sim.rating_population() + 10_200;
    add_offices(&mut sim, floor + 1, target);
    recycling(&mut sim, -4, 0, 4);
    assert!(sim.recycling_demand_met());
    assert!(sim.rating_population() >= 10_000);
    sim.evaluate_star();
    assert_eq!(sim.star, 5);
}

/// A served floor 2 with an office at `C` and a home beside it.
fn noisy_floor(seed: u32, mode: GameMode) -> (Simulation, i64) {
    let mut sim = seeded_game(seed, mode);
    sim.money = 1e9;
    lay(&mut sim, Kind::Lobby, 1);
    lay(&mut sim, Kind::Floor, 2);
    assert!(sim.build_transport(Kind::ElevatorStandard, C, 1, 2).ok);
    (sim, C)
}

#[test]
fn a_hotel_inside_the_office_noise_band_loses_satisfaction() {
    let (mut sim, c) = noisy_floor(4, GameMode::Classic);
    assert!(sim.tower.place(Kind::Office, 2, c).ok);
    let near = sim
        .tower
        .place(Kind::HotelDouble, 2, c + OFFICE_WIDTH)
        .unit_id
        .unwrap();
    let far = sim
        .tower
        .place(Kind::HotelDouble, 2, c + 40)
        .unit_id
        .unwrap();
    for id in [near, far] {
        let u = sim.tower.get_unit_mut(id).unwrap();
        u.state = UnitState::Asleep;
        u.satisfaction = 1.0;
    }
    for _ in 0..6 {
        sim.tick(60.0);
    }
    let sat = |id| sim.tower.get_unit(id).unwrap().satisfaction;
    assert!(sat(near) < sat(far));
}

/// A Modern sold condo flush right of an office at x 0 on a served floor.
fn condo_by_an_office() -> (Simulation, i64, i64) {
    let mut sim = seeded_game(2, GameMode::Modern);
    sim.money = 1e9;
    sim.star = 1;
    lay(&mut sim, Kind::Lobby, 1);
    lay(&mut sim, Kind::Floor, 2);
    assert!(sim.build_transport(Kind::ElevatorStandard, C, 1, 2).ok);
    let office = sim.tower.place(Kind::Office, 2, 0).unit_id.unwrap();
    let condo = sim
        .tower
        .place(Kind::Condo, 2, OFFICE_WIDTH)
        .unit_id
        .unwrap();
    let u = sim.tower.get_unit_mut(condo).unwrap();
    u.state = UnitState::Occupied;
    u.ever_occupied = true;
    u.satisfaction = 1.0;
    (sim, office, condo)
}

fn wear_onto_notice(sim: &mut Simulation, condo: i64) -> bool {
    for _ in 0..24 * 8 {
        sim.tick(60.0);
        if sim.tower.get_unit(condo).unwrap().state == UnitState::Vacating {
            return true;
        }
    }
    false
}

#[test]
fn a_week_of_office_noise_puts_a_condo_on_notice_and_it_leaves() {
    let (mut sim, _, condo) = condo_by_an_office();
    assert!(wear_onto_notice(&mut sim, condo));
    assert_eq!(
        sim.tower.get_unit(condo).unwrap().extras().vacate_reason,
        Some("noise")
    );
    for _ in 0..24 * 3 {
        sim.tick(60.0);
    }
    assert!(sim
        .log
        .iter()
        .any(|e| e.text.contains("left") && e.text.contains("a noisy neighbor nearby")));
}

#[test]
fn removing_the_office_lets_a_condo_on_notice_recover() {
    let (mut sim, office, condo) = condo_by_an_office();
    assert!(wear_onto_notice(&mut sim, condo));
    assert!(sim.tower.remove_unit(office).is_some());
    for _ in 0..24 {
        sim.tick(60.0);
    }
    let u = sim.tower.get_unit(condo).unwrap();
    assert_eq!(
        (u.state, u.extras().vacate_reason),
        (UnitState::Occupied, None)
    );
}

#[test]
fn a_short_noisy_spell_annoys_an_owner_but_never_puts_it_on_notice() {
    let (mut sim, office, condo) = condo_by_an_office();
    for _ in 0..24 * 4 {
        sim.tick(60.0);
        assert_eq!(
            sim.tower.get_unit(condo).unwrap().state,
            UnitState::Occupied
        );
    }
    assert!(sim.tower.get_unit(condo).unwrap().satisfaction < 0.6);
    assert!(sim.tower.remove_unit(office).is_some());
    for _ in 0..24 {
        sim.tick(60.0);
    }
    let u = sim.tower.get_unit(condo).unwrap();
    assert_eq!(u.state, UnitState::Occupied);
    assert!(u.satisfaction > 0.9);
}

/// A served suite on floor 2 at three stars, optionally with one parking
/// space chained to a ramp.
fn suite_tower(with_parking: bool) -> (Simulation, i64) {
    let (mut sim, c) = noisy_floor(5, GameMode::Classic);
    sim.star = 3;
    if with_parking {
        lay(&mut sim, Kind::Floor, 0);
        assert!(sim.tower.place(Kind::ParkingRamp, 0, c).ok);
        assert!(sim.tower.place(Kind::Parking, 0, c + 16).ok);
    }
    let suite = sim.tower.place(Kind::HotelSuite, 2, 0).unit_id.unwrap();
    (sim, suite)
}

/// Runs `before` hours, puts a happy guest in the suite, then runs three
/// hours across midnight (the VIP's check).
fn guest_night(sim: &mut Simulation, suite: i64, before: usize) {
    for _ in 0..before {
        sim.tick(60.0);
    }
    let u = sim.tower.get_unit_mut(suite).unwrap();
    u.state = UnitState::Asleep;
    u.satisfaction = 1.0;
    for _ in 0..3 {
        sim.tick(60.0);
    }
}

#[test]
fn a_served_suite_with_its_space_earns_the_favorable_review_once() {
    let (mut sim, suite) = suite_tower(true);
    assert!(!sim.vip_favorable);
    assert_eq!(sim.vip_visits, 0);
    guest_night(&mut sim, suite, 15);
    assert!(sim.vip_favorable);
    assert_eq!(sim.vip_visits, 1);
    guest_night(&mut sim, suite, 21);
    assert_eq!(sim.vip_visits, 1, "the VIP stops calling once won over");
}

#[test]
fn without_its_space_the_vip_drives_off_and_counts_on_a_five_day_throttle() {
    let (mut sim, suite) = suite_tower(false);
    guest_night(&mut sim, suite, 15);
    assert!(sim.suite_parking_short());
    assert!(!sim.vip_favorable);
    assert_eq!(sim.vip_visits, 1);
    guest_night(&mut sim, suite, 21);
    assert_eq!(sim.vip_visits, 1, "inside the throttle");

    let mut loaded = deserialize(&sim.serialize()).unwrap();
    let suite = loaded
        .tower
        .units_of_kind(Kind::HotelSuite)
        .next()
        .unwrap()
        .id;
    guest_night(&mut loaded, suite, 21);
    assert_eq!(loaded.vip_visits, 1, "a reload keeps the throttle");
    loaded.last_vip_nag_day = loaded.clock.day() - 5;
    guest_night(&mut loaded, suite, 21);
    assert_eq!(loaded.vip_visits, 2);
}
