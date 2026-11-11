//! The spatial model the phase-2 review brought in: the loop runs every
//! hour and day it passes over, congestion is read per floor and per shaft,
//! fire services cover a radius and lower the outbreak chance only while
//! operational, a well-zoned TOWER survives the real hourly clock and wins,
//! an unreachable hotel churns out, a suite houses two, and idle cars rest
//! at the lobby. The TypeScript `v1` model (one sampled hour per tick,
//! tower-wide coverage) is n/a in Rust, which has only this model.
use crate::clock::GameMode;
use crate::facilities::{Kind, LOT_WIDTH, MAX_FLOOR};
use crate::sim::Simulation;
use crate::star::TOWER_POPULATION;
use crate::tower::UnitState;

use super::MID as C;

const W: i64 = LOT_WIDTH;
const OFFICE_WIDTH: i64 = 9;

fn lay(sim: &mut Simulation, kind: Kind, floor: i64) {
    for x in (C..W).chain((0..C).rev()) {
        sim.tower.place(kind, floor, x);
    }
}

#[test]
fn every_hour_and_day_a_long_tick_passes_over_runs_once() {
    let mut sim = Simulation::new_game(1, GameMode::Classic);
    sim.tick(60.0);
    let base = sim.on_hour_runs;
    let day0 = sim.clock.day();
    sim.tick(5.0 * 60.0);
    assert_eq!(sim.on_hour_runs - base, 5);
    sim.tick(24.0 * 60.0);
    assert_eq!(sim.on_hour_runs - base, 5 + 24);
    assert_eq!(sim.clock.day(), day0 + 1);

    let mut odd = Simulation::new_game(2, GameMode::Classic);
    let start = odd.clock.minutes;
    odd.tick(247.0);
    assert_eq!(odd.clock.minutes, start + 247.0, "sub-stepping is exact");
}

fn cluster_tower(seed: u32, top: i64) -> Simulation {
    let mut sim = Simulation::new_game(seed, GameMode::Classic);
    sim.money = 1e9;
    lay(&mut sim, Kind::Lobby, 1);
    for floor in 2..=top {
        lay(&mut sim, Kind::Floor, floor);
    }
    sim
}

fn fill_floor(sim: &mut Simulation, floor: i64, count: usize) {
    let mut placed = 0;
    let mut x = 0;
    while x + OFFICE_WIDTH <= W && placed < count {
        let r = sim.tower.place(Kind::Office, floor, x);
        if let Some(id) = r.unit_id {
            sim.tower.get_unit_mut(id).unwrap().state = UnitState::Occupied;
            placed += 1;
        }
        x += OFFICE_WIDTH;
    }
    assert_eq!(placed, count, "floor {floor} holds the requested offices");
}

/// A one-car standard shaft at `x` from `bottom` to `top`.
fn weak_shaft(sim: &mut Simulation, x: i64, bottom: i64, top: i64) {
    assert!(
        sim.build_transport(Kind::ElevatorStandard, x, bottom, top)
            .ok
    );
    let id = sim.tower.transports.last().unwrap().id;
    assert!(sim.tower.set_cars(id, 1));
}

fn congestion_at(sim: &Simulation, floor: i64) -> f64 {
    *sim.spatial_congestion_by_floor()
        .get(&floor)
        .unwrap_or(&0.0)
}

#[test]
fn a_parallel_shaft_relieves_a_congested_band() {
    let mut sim = cluster_tower(1, 10);
    for floor in 2..=10 {
        fill_floor(&mut sim, floor, 18);
    }
    weak_shaft(&mut sim, W - 6, 1, 10);
    let before = congestion_at(&sim, 8);
    assert!(before > 1.0, "{before}");
    weak_shaft(&mut sim, W - 12, 1, 10);
    assert!(congestion_at(&sim, 8) < before * 0.6);
}

#[test]
fn a_distant_cluster_on_its_own_shaft_leaves_another_clusters_congestion_alone() {
    let mut sim = cluster_tower(2, 30);
    weak_shaft(&mut sim, W - 6, 1, 10);
    weak_shaft(&mut sim, W - 12, 10, 30);
    for floor in 2..=9 {
        fill_floor(&mut sim, floor, 18);
    }
    let alone = congestion_at(&sim, 8);
    for floor in 11..=30 {
        fill_floor(&mut sim, floor, 18);
    }
    assert!((congestion_at(&sim, 8) - alone).abs() < 1e-9);
    assert!(congestion_at(&sim, 25) > 0.0);
}

fn tall_tower(seed: u32) -> Simulation {
    let mut sim = Simulation::new_game(seed, GameMode::Classic);
    sim.money = 1e9;
    lay(&mut sim, Kind::Lobby, 1);
    for floor in 2..=MAX_FLOOR {
        for x in C..W {
            sim.tower.place(Kind::Floor, floor, x);
        }
    }
    sim
}

#[test]
fn a_fire_near_a_station_is_contained_more_often_than_one_far_away() {
    let mut sim = tall_tower(1);
    assert!(sim.tower.place(Kind::Security, 2, C).ok);
    assert!(sim.tower.place(Kind::Medical, 2, C + 16).ok);
    let near = sim.control_chance(3);
    let far = sim.control_chance(100);
    assert!((near - 1.0).abs() < 1e-9, "base, Security and Medical");
    assert!((far - 0.5).abs() < 1e-9, "the base alone");

    let mut spread = tall_tower(3);
    for floor in (5..=95).step_by(15) {
        assert!(spread.tower.place(Kind::Security, floor, C).ok);
    }
    assert!(spread.control_chance(10) > 0.5);
    assert!(spread.control_chance(90) > 0.5);
}

#[test]
fn fire_defense_lowers_the_outbreak_chance_only_while_it_operates() {
    let mut sim = tall_tower(1);
    let bare = sim.fire_chance();
    assert!((bare - 0.025).abs() < 1e-12);
    assert!(sim.tower.place(Kind::Security, 2, C).ok);
    let with_security = sim.fire_chance();
    assert!((with_security - 0.025 * 0.45).abs() < 1e-12);
    assert!(with_security < bare * 0.5);
    assert!(sim.tower.place(Kind::Medical, 2, C + 16).ok);
    assert!((sim.fire_chance() - 0.025 * 0.45 * 0.5).abs() < 1e-12);

    let mut alone = tall_tower(1);
    let security_alone = alone.tower.place(Kind::Security, 2, C).unit_id.unwrap();
    for state in [UnitState::Construction, UnitState::Fire] {
        alone.tower.get_unit_mut(security_alone).unwrap().state = state;
        assert_eq!(alone.fire_chance(), bare);
    }
    alone.tower.get_unit_mut(security_alone).unwrap().state = UnitState::Empty;
    assert!(alone.fire_chance() < bare);
}

#[test]
fn an_unreachable_hotel_churns_out() {
    let mut sim = Simulation::new_game(5, GameMode::Classic);
    for x in C..W {
        sim.tower.place(Kind::Lobby, 1, x);
    }
    for floor in 2..=5 {
        for x in C..W {
            sim.tower.place(Kind::Floor, floor, x);
        }
    }
    sim.star = 2;
    let room = sim.tower.place(Kind::HotelDouble, 5, C).unit_id.unwrap();
    {
        let u = sim.tower.get_unit_mut(room).unwrap();
        u.state = UnitState::Asleep;
        u.satisfaction = 0.3;
    }
    for _ in 0..24 {
        sim.tick(60.0);
    }
    assert_eq!(sim.tower.get_unit(room).unwrap().state, UnitState::Empty);
}

#[test]
fn a_suite_houses_two_as_a_double_does() {
    assert_eq!(Kind::HotelSuite.facility().population, 2);
    assert_eq!(
        Kind::HotelSuite.facility().population,
        Kind::HotelDouble.facility().population
    );
}

#[test]
fn idle_cars_rest_at_the_shafts_lobby_floor() {
    let mut sim = Simulation::new_game(6, GameMode::Classic);
    for x in C..W {
        sim.tower.place(Kind::Lobby, 1, x);
    }
    for floor in 2..=10 {
        for x in C..W {
            sim.tower.place(Kind::Floor, floor, x);
        }
    }
    assert!(sim.build_transport(Kind::ElevatorStandard, C, 1, 10).ok);
    // Park every car up the shaft first, so resting at the lobby is a move
    // the idle cars make rather than where they started.
    const PARKED_FLOOR: f64 = 7.0;
    for p in sim.tower.transports[0].car_positions.iter_mut() {
        *p = PARKED_FLOOR;
    }
    assert!(sim.tower.transports[0]
        .car_positions
        .iter()
        .all(|p| (p - 1.0).abs() >= 0.5));
    for _ in 0..300 {
        sim.tick(1.0);
    }
    let shaft = &sim.tower.transports[0];
    assert!(shaft.car_positions.iter().all(|p| (p - 1.0).abs() < 0.5));
}

const SKY_LOBBIES: [i64; 6] = [15, 30, 45, 60, 75, 90];

/// The zoned 100-floor tower: two express shafts stopping at every sky
/// lobby, three groups of locals per 15-floor band, services up the tower,
/// a Metro, and offices past the TOWER population.
fn zoned_tower() -> Simulation {
    let mut sim = Simulation::new_game(1, GameMode::Classic);
    sim.money = 1e12;
    lay(&mut sim, Kind::Lobby, 1);
    for floor in 2..=MAX_FLOOR {
        let kind = if SKY_LOBBIES.contains(&floor) {
            Kind::Lobby
        } else {
            Kind::Floor
        };
        lay(&mut sim, kind, floor);
    }
    for floor in [0, -1, -2] {
        lay(&mut sim, Kind::Floor, floor);
    }
    sim.star = 5;
    let mut shaft = |kind: Kind, x: i64, bottom: i64, top: i64| {
        assert!(sim.build_transport(kind, x, bottom, top).ok, "{kind:?} {x}");
        let id = sim.tower.transports.last().unwrap().id;
        sim.tower.set_cars(id, 8);
        assert_eq!(sim.tower.transports.last().unwrap().cars, 8);
    };
    shaft(Kind::ElevatorExpress, 350, 1, 100);
    shaft(Kind::ElevatorExpress, 356, 1, 100);
    let bands = [
        (1, 15),
        (15, 30),
        (30, 45),
        (45, 60),
        (60, 75),
        (75, 90),
        (90, 100),
    ];
    for (i, (bottom, top)) in bands.into_iter().enumerate() {
        for group in [40, 187, 334] {
            shaft(
                Kind::ElevatorStandard,
                group + if i % 2 == 1 { 5 } else { 0 },
                bottom,
                top,
            );
        }
    }
    for floor in 2..=100 {
        assert!(sim.crowd.floor_reachable(&sim.tower, floor), "{floor}");
    }
    assert!(sim.tower.place(Kind::Metro, -2, 0).ok);
    for floor in (8..=98).step_by(15) {
        assert!(sim.tower.place(Kind::Security, floor, 60).ok);
    }
    for floor in (8..=98).step_by(24) {
        assert!(sim.tower.place(Kind::Medical, floor, 100).ok);
    }
    let goal = TOWER_POPULATION + 600;
    let mut pop = 0;
    'floors: for floor in 2..=99 {
        if SKY_LOBBIES.contains(&floor) {
            continue;
        }
        let mut x = 16;
        while x + OFFICE_WIDTH <= 350 {
            if pop >= goal {
                break 'floors;
            }
            if let Some(id) = sim.tower.place(Kind::Office, floor, x).unit_id {
                let u = sim.tower.get_unit_mut(id).unwrap();
                u.state = UnitState::Occupied;
                u.ever_occupied = true;
                pop += Kind::Office.facility().population;
            }
            x += OFFICE_WIDTH;
        }
    }
    assert!(pop >= goal, "the offices reach the population goal");
    sim
}

#[test]
fn a_well_zoned_tower_holds_its_people_under_the_hourly_clock_and_wins() {
    let mut sim = zoned_tower();
    assert!(sim.population() >= TOWER_POPULATION);
    assert!(sim.build(Kind::WeddingHall, 100, 100).ok);
    let before = sim.population();
    for _ in 0..8 {
        if sim.evaluated_tower == Some(true) {
            break;
        }
        sim.tick(24.0 * 60.0);
    }
    assert!(sim.population() >= TOWER_POPULATION);
    assert!(sim.population() as f64 >= before as f64 * 0.95);
    assert_eq!(sim.evaluated_tower, Some(true));
    assert_eq!(sim.star, 6);
}
