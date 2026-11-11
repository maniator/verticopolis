//! The review-fix regressions: Security unlocks at two stars so a tower
//! climbs to three by play, a Security office under construction does not
//! meet the gate, the 1994 build caps (one Metro, one Wedding Hall, 24
//! pooled shafts across all three elevator kinds, 64 pooled walkways), a
//! raw removal of the hall still calls off the VIP, a shop earns at most
//! its headline daily figure, recycling lifts commercial income, treasure
//! is one find per tile across a reload, and a forged car count loads
//! clamped. Selling the hall cancels the VIP through
//! `charges_tests::remove_facility_cancels_the_vip_with_the_last_wedding_hall`;
//! the served-floor cache through
//! `tower_reads_tests::is_floor_served_follows_every_shaft_edit`.
use serde_json::Value;

use crate::clock::GameMode;
use crate::economy::commercial_daily_income;
use crate::facilities::{Kind, LOT_WIDTH, MAX_FLOOR};
use crate::load::deserialize;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{seeded_game, MID as C};

const W: i64 = LOT_WIDTH;
const OFFICE_WIDTH: i64 = 9;

fn lay(sim: &mut Simulation, kind: Kind, floor: i64, half: Option<i64>) {
    let (left, right) = match half {
        Some(h) => ((C - h).max(0), (C + h + 1).min(W)),
        None => (0, W),
    };
    for x in (C..right).chain((left..C).rev()) {
        sim.tower.place(kind, floor, x);
    }
}

fn structured(seed: u32, top: i64, half: Option<i64>, mode: GameMode) -> Simulation {
    let mut sim = seeded_game(seed, mode);
    sim.money = 1e9;
    lay(&mut sim, Kind::Lobby, 1, half);
    for floor in 2..=top {
        lay(&mut sim, Kind::Floor, floor, half);
    }
    sim
}

fn served(seed: u32, top: i64) -> Simulation {
    let mut sim = structured(seed, top, None, GameMode::Classic);
    assert!(
        sim.build_transport(Kind::ElevatorStandard, W - 6, 1, top.min(30))
            .ok
    );
    let id = sim.tower.transports[0].id;
    sim.tower.set_cars(id, 8);
    sim
}

fn occupy(sim: &mut Simulation, kind: Kind, floor: i64, x: i64) -> Option<i64> {
    let id = sim.tower.place(kind, floor, x).unit_id?;
    sim.tower.get_unit_mut(id).unwrap().state = UnitState::Occupied;
    Some(id)
}

#[test]
fn security_unlocks_at_two_stars_and_a_tower_climbs_to_three_by_play() {
    let mut sim = structured(1, 11, None, GameMode::Classic);
    for x in [70, 200, 330] {
        assert!(sim.build_transport(Kind::ElevatorStandard, x, 1, 11).ok);
    }
    for id in sim
        .tower
        .transports
        .iter()
        .map(|t| t.id)
        .collect::<Vec<_>>()
    {
        sim.tower.set_cars(id, 8);
    }
    for floor in 2..=10 {
        for x in (0..=W - OFFICE_WIDTH).step_by(OFFICE_WIDTH as usize) {
            sim.build(Kind::Office, floor, x);
        }
    }
    for _ in 0..4000 {
        if sim.population() >= 1000 {
            break;
        }
        sim.tick(60.0);
    }
    assert!(sim.population() >= 1000);
    assert_eq!(sim.star, 2, "Security gates three stars");
    assert!(sim.is_unlocked(Kind::Security));
    assert!(sim.build(Kind::Security, 11, 0).ok);
    assert!(sim.build(Kind::Security, 11, 100).ok);
    for _ in 0..300 {
        if sim.star >= 3 {
            break;
        }
        sim.tick(60.0);
    }
    assert_eq!(sim.star, 3);
}

#[test]
fn a_security_office_under_construction_does_not_meet_the_three_star_gate() {
    let mut sim = served(2, 12);
    for floor in 2..=11 {
        for x in (0..=W - OFFICE_WIDTH).step_by(OFFICE_WIDTH as usize) {
            occupy(&mut sim, Kind::Office, floor, x);
        }
    }
    assert!(sim.population() >= 1000);
    sim.star = 2;
    assert!(sim.build(Kind::Security, 12, 0).ok);
    assert!(sim.build(Kind::Security, 12, 100).ok);
    sim.evaluate_star();
    assert_eq!(sim.star, 2);
    for _ in 0..50 {
        if sim.count_operational(Kind::Security) >= 2 {
            break;
        }
        sim.tick(60.0);
    }
    sim.evaluate_star();
    assert_eq!(sim.star, 3);
}

#[test]
fn one_metro_and_one_wedding_hall_whose_flag_follows_what_stands() {
    let mut sim = structured(3, 6, None, GameMode::Classic);
    for floor in [0, -1, -2] {
        lay(&mut sim, Kind::Floor, floor, None);
    }
    assert!(sim.tower.place(Kind::Metro, -2, 0).ok);
    assert!(!sim.tower.place(Kind::Metro, -2, 0).ok);
    assert!(!sim.tower.place(Kind::Metro, -2, 100).ok);

    let mut modern = structured(5, MAX_FLOOR, None, GameMode::Modern);
    modern.star = 5;
    assert!(modern.build(Kind::WeddingHall, MAX_FLOOR, C).ok);
    assert_eq!(modern.tower.built_wedding_hall, Some(true));
    assert!(!modern.build(Kind::WeddingHall, MAX_FLOOR, C + 20).ok);
    assert!(modern.sell_at(MAX_FLOOR, C));
    assert_ne!(modern.tower.built_wedding_hall, Some(true));
}

#[test]
fn every_elevator_kind_shares_one_24_shaft_pool_apart_from_the_walkways() {
    let mut sim = served(4, 6);
    sim.star = 3;
    let kinds = [
        Kind::ElevatorService,
        Kind::ElevatorExpress,
        Kind::ElevatorStandard,
    ];
    let mut placed = 1;
    for i in 0..40 {
        if sim.build_transport(kinds[i % 3], i as i64 * 5, 1, 6).ok {
            placed += 1;
        }
    }
    assert_eq!(placed, 24);
    let shafts: Vec<Kind> = sim
        .tower
        .transports
        .iter()
        .map(|t| t.kind)
        .filter(|k| k.is_elevator())
        .collect();
    assert_eq!(shafts.len(), 24);
    for kind in kinds {
        assert!(shafts.contains(&kind), "{kind:?} counts in the pool");
    }
    assert!(sim.build_transport(Kind::Stairs, 200, 1, 2).ok);
}

#[test]
fn stairs_and_escalators_share_one_64_link_pool_apart_from_the_elevators() {
    let mut sim = structured(5, 6, None, GameMode::Classic);
    sim.star = 3;
    let kinds = [Kind::Stairs, Kind::Escalator];
    let mut placed = 0;
    for i in 0..68 {
        let bottom = if i < 34 { 1 } else { 3 };
        if sim
            .build_transport(kinds[i % 2], (i as i64 % 34) * 8, bottom, bottom + 1)
            .ok
        {
            placed += 1;
        }
    }
    assert_eq!(placed, 64);
    let links: Vec<Kind> = sim
        .tower
        .transports
        .iter()
        .map(|t| t.kind)
        .filter(|k| matches!(k, Kind::Stairs | Kind::Escalator))
        .collect();
    assert_eq!(links.len(), 64);
    assert!(links.contains(&Kind::Stairs) && links.contains(&Kind::Escalator));
    assert!(sim.build_transport(Kind::ElevatorStandard, 330, 1, 2).ok);
}

#[test]
fn a_raw_removal_of_the_wedding_hall_still_calls_off_the_inspection() {
    let mut sim = structured(10, MAX_FLOOR, Some(30), GameMode::Classic);
    sim.star = 5;
    assert!(sim.build(Kind::WeddingHall, MAX_FLOOR, C).ok);
    let hall = sim
        .tower
        .units_of_kind(Kind::WeddingHall)
        .next()
        .unwrap()
        .id;
    assert!(sim.tower.remove_unit(hall).is_some());
    let before = sim.log.len();
    for _ in 0..20 {
        sim.tick(24.0 * 60.0);
    }
    assert!(!sim.log[before..]
        .iter()
        .any(|e| e.text.contains("unimpressed")));
    assert_eq!(sim.vip_visit_day, -1.0);
}

#[test]
fn a_shop_earns_at_most_its_headline_daily_figure() {
    let mut sim = served(7, 3);
    sim.star = 3;
    assert!(sim.build(Kind::Shop, 2, 0).ok);
    let shop = sim.tower.unit_at(2, 0).unwrap().id;
    sim.tower.get_unit_mut(shop).unwrap().state = UnitState::Occupied;
    for x in [20, 32, 44, 56] {
        assert!(occupy(&mut sim, Kind::Office, 2, x).is_some());
    }
    let before = sim.money;
    for _ in 0..16 {
        sim.tick(60.0);
    }
    let earned = sim.money - before;
    assert!(earned > 0.0);
    assert!(earned <= commercial_daily_income(sim.mode, Kind::Shop).unwrap());
}

fn noon_shop_income(with_recycling: bool) -> f64 {
    let mut sim = Simulation::new_game(1, GameMode::Classic);
    sim.star = 5;
    for x in 0..40 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        assert!(sim.tower.place(Kind::Floor, 2, x).ok);
    }
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorStandard, 4, 1, 2)
            .ok
    );
    occupy(&mut sim, Kind::Shop, 2, 0).unwrap();
    for x in [20, 30] {
        occupy(&mut sim, Kind::Office, 2, x).unwrap();
    }
    if with_recycling {
        for x in 0..40 {
            sim.tower.place(Kind::Floor, 0, x);
            sim.tower.place(Kind::Floor, -1, x);
        }
        assert!(sim.tower.place(Kind::Recycling, -1, 0).ok);
    }
    sim.clock.minutes = 12.0 * 60.0;
    sim.money = 0.0;
    sim.collect_traffic_income();
    sim.money
}

#[test]
fn recycling_lifts_commercial_income() {
    assert!(noon_shop_income(true) > noon_shop_income(false));
}

fn treasure_finds(sim: &Simulation, from: usize) -> usize {
    sim.log[from..]
        .iter()
        .filter(|e| e.text.to_lowercase().contains("treasure"))
        .count()
}

fn basement_strip(seed: u32) -> Simulation {
    let mut sim = seeded_game(seed, GameMode::Classic);
    sim.star = 3;
    sim.money = 1e8;
    for x in 0..40 {
        sim.tower.place(Kind::Floor, 0, C - 20 + x);
    }
    sim
}

#[test]
fn treasure_is_one_find_per_tile_even_across_a_reload() {
    let mut sim = basement_strip(42);
    for _ in 0..40 {
        sim.build(Kind::Parking, 0, C - 20);
        sim.sell_at(0, C - 20);
    }
    assert!(treasure_finds(&sim, 0) <= 1);

    let mut dug = basement_strip(42);
    assert!(dug.build(Kind::Parking, 0, C - 20).ok);
    let mut loaded = deserialize(&dug.serialize()).unwrap();
    loaded.money = 1e8;
    let before = loaded.log.len();
    for _ in 0..40 {
        loaded.sell_at(0, C - 20);
        loaded.build(Kind::Parking, 0, C - 20);
    }
    assert_eq!(treasure_finds(&loaded, before), 0);
    assert!(loaded.excavated.contains(&format!("0:{}", C - 20)));
}

#[test]
fn a_forged_car_count_loads_clamped_and_the_loop_runs() {
    let sim = served(8, 6);
    let mut raw = sim.serialize();
    // `JSON.stringify` writes a NaN count as null.
    raw["transports"][0]["cars"] = Value::Null;
    let mut loaded = deserialize(&raw).unwrap();
    // A count that is not a number reads as none, inside the 0..=8 clamp.
    let cars = loaded.tower.transports[0].cars;
    assert_eq!(cars, 0);
    assert_eq!(loaded.tower.transports[0].car_positions.len() as i64, cars);
    loaded.tick(60.0);
}
