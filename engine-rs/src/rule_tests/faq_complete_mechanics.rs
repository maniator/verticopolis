//! The FAQ parity rules, part two (part one is `faq_complete.rs`): an
//! unguarded bomb levels rooms over several floors, treasure is worth about
//! half a million and is capped per tower, ample parking fills offices
//! faster, an emergency choice pays exactly its quote and survives a
//! reload, the star ladder fits under the TOWER target, a trip of three
//! rides routes, only spaces chained to a ramp park cars (a space stacked
//! over one with no ramp of its own included), the Metro is thirty wide,
//! and booked blockbusters survive a reload. The cinema's film booking per
//! maintenance period is `catalog::charge_tests::film_and_dj_bookings_follow_the_quote`.
use crate::clock::GameMode;
use crate::facilities::{Kind, LOT_WIDTH};
use crate::load::deserialize;
use crate::sim::Simulation;
use crate::star::{STAR_THRESHOLDS, TOWER_POPULATION};
use crate::tower::UnitState;

use super::faq_complete::lay;
use super::{seeded_game, MID as C};

const W: i64 = LOT_WIDTH;
const OFFICE_WIDTH: i64 = 9;
const PARKING_WIDTH: i64 = 6;
const RAMP_WIDTH: i64 = 16;
const SPACE_WIDTH: i64 = 4;

fn occupied(sim: &Simulation, kind: Kind) -> usize {
    sim.tower
        .units
        .iter()
        .filter(|u| u.kind == kind && u.state == UnitState::Occupied)
        .count()
}

#[test]
fn an_unguarded_bomb_levels_several_rooms() {
    let mut sim = seeded_game(9, GameMode::Classic);
    sim.money = 1e9;
    sim.star = 4;
    for floor in 2..=8 {
        lay(&mut sim, Kind::Floor, floor);
        for i in 0..4 {
            let id = sim
                .tower
                .place(Kind::Office, floor, C - 20 + i * OFFICE_WIDTH)
                .unit_id;
            sim.tower.get_unit_mut(id.unwrap()).unwrap().state = UnitState::Occupied;
        }
    }
    let before = occupied(&sim, Kind::Office);
    sim.bomb_threat();
    assert!(before - occupied(&sim, Kind::Office) > 1);
}

fn treasure_lines(sim: &Simulation) -> Vec<String> {
    sim.log
        .iter()
        .filter(|e| e.text.to_lowercase().contains("treasure"))
        .map(|e| e.text.clone())
        .collect()
}

#[test]
fn buried_treasure_is_worth_about_half_a_million() {
    let mut sim = seeded_game(42, GameMode::Classic);
    sim.money = 1e9;
    sim.star = 3;
    for x in 0..60 {
        sim.tower.place(Kind::Floor, 0, C - 30 + x);
    }
    for i in (0..=60 - PARKING_WIDTH).step_by(PARKING_WIDTH as usize) {
        sim.build(Kind::Parking, 0, C - 30 + i);
    }
    let line = treasure_lines(&sim).into_iter().next().expect("a find");
    let amount: f64 = line
        .chars()
        .filter(char::is_ascii_digit)
        .collect::<String>()
        .parse()
        .unwrap();
    assert!((400_000.0..=600_000.0).contains(&amount), "{amount}");
}

#[test]
fn treasure_is_capped_per_tower() {
    let mut sim = seeded_game(42, GameMode::Classic);
    sim.money = 1e9;
    sim.star = 3;
    for floor in (-3..=0).rev() {
        for x in 0..W {
            sim.tower.place(Kind::Floor, floor, x);
        }
    }
    for floor in (-3..=0).rev() {
        for x in (0..=W - PARKING_WIDTH).step_by(PARKING_WIDTH as usize) {
            sim.build(Kind::Parking, floor, x);
        }
    }
    let finds = treasure_lines(&sim).len();
    assert!((1..=3).contains(&finds), "{finds}");
}

/// Offices filled on floors 3 and 4 after twelve hours, beside an occupied
/// floor 2, with or without a long chain of parking.
fn new_offices_filled(with_parking: bool) -> usize {
    let xs: Vec<i64> = (0..=162 - OFFICE_WIDTH)
        .step_by(OFFICE_WIDTH as usize)
        .filter(|&x| x != 81)
        .collect();
    let mut sim = seeded_game(123, GameMode::Classic);
    sim.money = 1e12;
    lay(&mut sim, Kind::Lobby, 1);
    for floor in 2..=4 {
        lay(&mut sim, Kind::Floor, floor);
    }
    assert!(sim.build_transport(Kind::ElevatorStandard, 81, 1, 4).ok);
    let shaft = sim.tower.transports[0].id;
    sim.tower.set_cars(shaft, 8);
    for &x in &xs {
        let id = sim
            .tower
            .place(Kind::Office, 2, x)
            .unit_id
            .expect("an office on floor 2");
        sim.tower.get_unit_mut(id).unwrap().state = UnitState::Occupied;
    }
    for floor in 3..=4 {
        for &x in &xs {
            assert!(
                sim.tower.place(Kind::Office, floor, x).ok,
                "an office on floor {floor}"
            );
        }
    }
    sim.star = 3;
    if with_parking {
        lay(&mut sim, Kind::Floor, 0);
        assert!(sim.tower.place(Kind::ParkingRamp, 0, 0).ok);
        for x in (RAMP_WIDTH..=W - SPACE_WIDTH).step_by(SPACE_WIDTH as usize) {
            assert!(
                sim.tower.place(Kind::Parking, 0, x).ok,
                "a parking space at {x}"
            );
        }
    }
    for _ in 0..12 {
        sim.tick(60.0);
    }
    sim.tower
        .units
        .iter()
        .filter(|u| u.kind == Kind::Office && u.floor >= 3 && u.state == UnitState::Occupied)
        .count()
}

#[test]
fn ample_parking_fills_new_offices_faster() {
    assert!(new_offices_filled(true) > new_offices_filled(false));
}

/// A four-star tower of flammable offices, run day by day until the roll
/// raises a choice.
fn tower_with_a_choice() -> Simulation {
    let mut sim = seeded_game(1, GameMode::Classic);
    sim.money = 1e9;
    sim.star = 4;
    lay(&mut sim, Kind::Lobby, 1);
    lay(&mut sim, Kind::Floor, 2);
    assert!(sim.build_transport(Kind::ElevatorStandard, C, 1, 2).ok);
    for x in (0..=180 - OFFICE_WIDTH).step_by(OFFICE_WIDTH as usize) {
        sim.tower.place(Kind::Office, 2, x);
    }
    for _ in 0..600 {
        if sim.events.pending.is_some() {
            break;
        }
        sim.tick(24.0 * 60.0);
    }
    assert!(sim.events.pending.is_some());
    sim
}

#[test]
fn an_accepted_choice_pays_exactly_its_quote() {
    let mut sim = tower_with_a_choice();
    let cost = sim.events.pending.as_ref().unwrap().cost;
    let before = sim.money;
    sim.resolve_choice(true);
    assert_eq!(before - sim.money, cost);
    assert!(sim.events.pending.is_none());
}

#[test]
fn an_unanswered_choice_survives_a_reload() {
    let sim = tower_with_a_choice();
    let loaded = deserialize(&sim.serialize()).unwrap();
    let kind = |s: &Simulation| s.events.pending.as_ref().map(|p| (p.kind, p.cost));
    assert!(kind(&loaded).is_some());
    assert_eq!(kind(&loaded), kind(&sim));
}

#[test]
fn the_five_star_bar_sits_under_the_tower_target_within_the_lot() {
    const { assert!(STAR_THRESHOLDS[5] <= TOWER_POPULATION) };
    const { assert!(TOWER_POPULATION <= 15_100) };
}

#[test]
fn a_trip_of_three_rides_routes() {
    let mut sim = seeded_game(1, GameMode::Classic);
    sim.money = 1e12;
    let x0 = C - 15;
    for x in x0..x0 + 30 {
        sim.tower.place(Kind::Lobby, 1, x);
    }
    for floor in 2..=45 {
        for x in x0..x0 + 30 {
            sim.tower.place(Kind::Floor, floor, x);
        }
    }
    for (dx, bottom, top) in [(0, 1, 15), (6, 15, 30), (12, 30, 45)] {
        assert!(
            sim.tower
                .place_transport(Kind::ElevatorStandard, x0 + dx, bottom, top)
                .ok
        );
    }
    assert!(
        sim.crowd.route(&sim.tower, 1, 25, None, None).is_some(),
        "two rides"
    );
    assert!(
        sim.crowd.route(&sim.tower, 1, 40, None, None).is_some(),
        "three rides"
    );
}

#[test]
fn only_spaces_chained_to_a_ramp_park_cars() {
    let mut sim = seeded_game(4, GameMode::Classic);
    sim.money = 1e12;
    let x0 = C - 20;
    for x in x0..x0 + 140 {
        sim.tower.place(Kind::Lobby, 1, x);
        sim.tower.place(Kind::Floor, 0, x);
    }
    assert!(sim.tower.place(Kind::Parking, 0, x0 + RAMP_WIDTH).ok);
    assert_eq!(sim.tower.functional_parking_spots(), 0, "no ramp yet");
    assert!(sim.tower.place(Kind::ParkingRamp, 0, x0).ok);
    assert!(
        sim.tower
            .place(Kind::Parking, 0, x0 + RAMP_WIDTH + SPACE_WIDTH)
            .ok
    );
    assert!(sim.tower.place(Kind::Parking, 0, x0 + 120).ok);
    assert_eq!(sim.tower.functional_parking_spots(), 2);
}

#[test]
fn a_space_stacked_over_a_ramp_floor_needs_its_own_ramp() {
    let mut sim = seeded_game(4, GameMode::Classic);
    sim.money = 1e12;
    lay(&mut sim, Kind::Lobby, 1);
    for floor in [0, -1, -2] {
        lay(&mut sim, Kind::Floor, floor);
    }
    assert!(sim.tower.place(Kind::ParkingRamp, -2, C).ok);
    assert!(sim.tower.place(Kind::Parking, -2, C + RAMP_WIDTH).ok);
    assert!(sim.tower.place(Kind::Parking, -1, C + RAMP_WIDTH).ok);
    assert_eq!(sim.tower.functional_parking_spots(), 1);
}

#[test]
fn the_metro_is_thirty_tiles_wide() {
    assert_eq!(Kind::Metro.facility().width, 30);
}

#[test]
fn booked_blockbusters_survive_a_reload() {
    let mut sim = seeded_game(3, GameMode::Classic);
    sim.money = 1e12;
    sim.star = 1;
    lay(&mut sim, Kind::Lobby, 1);
    lay(&mut sim, Kind::Floor, 2);
    lay(&mut sim, Kind::Floor, 3);
    assert!(sim.tower.place(Kind::Cinema, 2, 0).ok);
    for _ in 0..48 {
        if !sim.blockbusters.is_empty() {
            break;
        }
        sim.tick(24.0 * 60.0 * 31.0);
    }
    assert!(!sim.blockbusters.is_empty());
    let loaded = deserialize(&sim.serialize()).unwrap();
    assert_eq!(loaded.blockbusters, sim.blockbusters);
    assert_eq!(
        loaded.serialize()["blockbusters"],
        sim.serialize()["blockbusters"]
    );
}
