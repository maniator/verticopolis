//! The core simulation suite, events and service: a fire empties its room
//! and is contained to a gutted shell, a bomb threat costs little with
//! Security and dearly without, a car climbs to the floor that wants it, a
//! Metro relieves the elevators, and digging the basement can turn up
//! treasure.
use crate::clock::GameMode;
use crate::facilities::{Kind, LOT_WIDTH};
use crate::tower::UnitState;

use super::seeded_game;
use super::simulation_economy::{built_tower, X0};

#[test]
fn a_fire_empties_its_room_and_ends_as_a_gutted_shell() {
    let mut sim = built_tower(11);
    assert!(sim.build(Kind::Office, 2, X0).ok);
    let office = sim.tower.unit_at(2, X0).unwrap().id;
    {
        let u = sim.tower.get_unit_mut(office).unwrap();
        u.state = UnitState::Occupied;
        u.ever_occupied = true;
    }
    assert!(sim.population() > 0);
    sim.start_fire();
    assert_eq!(sim.tower.get_unit(office).unwrap().state, UnitState::Fire);
    assert_eq!(sim.events.count(), 1);
    assert_eq!(sim.population(), 0);
    sim.star = 4;
    for i in 40..80 {
        sim.tower.place(Kind::Lobby, 1, X0 + i);
        sim.tower.place(Kind::Floor, 2, X0 + i);
    }
    assert!(sim.tower.place(Kind::Security, 2, X0 + 12).ok);
    assert!(
        sim.tower
            .place(Kind::Medical, 2, X0 + 12 + Kind::Security.facility().width)
            .ok
    );
    for _ in 0..60 {
        if sim.events.count() == 0 {
            break;
        }
        sim.tick(24.0 * 60.0);
    }
    assert_eq!(sim.events.count(), 0);
    assert_eq!(sim.tower.get_unit(office).unwrap().state, UnitState::Gutted);
    assert_eq!(sim.population(), 0);
}

#[test]
fn security_turns_a_bomb_threat_into_a_cheap_sweep() {
    let mut safe = built_tower(5);
    assert!(safe.tower.place(Kind::Security, 2, X0).ok);
    let before = safe.money;
    safe.bomb_threat();
    assert!(safe.money >= before - 5_000.0 && safe.money < before);

    let mut exposed = built_tower(5);
    let before = exposed.money;
    exposed.bomb_threat();
    assert!(exposed.money <= before - 15_000.0);
}

#[test]
fn a_car_climbs_to_the_floor_with_riders_and_stays_in_its_shaft() {
    let mut sim = seeded_game(1, GameMode::Classic);
    for floor in 2..=10 {
        for i in 0..12 {
            sim.tower.place(Kind::Floor, floor, X0 + i);
        }
    }
    assert!(sim.build_transport(Kind::ElevatorStandard, X0, 1, 10).ok);
    let office = sim.tower.place(Kind::Office, 8, X0).unit_id.unwrap();
    sim.tower.get_unit_mut(office).unwrap().state = UnitState::Occupied;
    sim.tower.transports[0].car_positions[0] = 1.0;
    sim.tower.transports[0].car_dir[0] = 1;
    let mut highest: f64 = 1.0;
    for _ in 0..400 {
        sim.tick(1.0);
        highest = highest.max(sim.tower.transports[0].car_positions[0]);
    }
    assert!(highest > 6.0 && highest <= 8.0, "{highest}");
}

#[test]
fn a_metro_relieves_elevator_congestion() {
    let mut sim = seeded_game(3, GameMode::Classic);
    for floor in 2..=20 {
        for i in 0..30 {
            sim.tower.place(Kind::Floor, floor, X0 + i);
        }
    }
    assert!(sim.build_transport(Kind::ElevatorStandard, X0, 1, 20).ok);
    let shaft = sim.tower.transports[0].id;
    assert!(sim.tower.set_cars(shaft, 1));
    for floor in 2..=20 {
        for i in (0..=21).step_by(9) {
            let id = sim
                .tower
                .place(Kind::Office, floor, X0 + i)
                .unit_id
                .expect("every office fits");
            sim.tower.get_unit_mut(id).unwrap().state = UnitState::Occupied;
        }
    }
    const OFFICES: usize = 19 * 3;
    let built = sim
        .tower
        .units
        .iter()
        .filter(|u| u.kind == Kind::Office)
        .count();
    assert_eq!(built, OFFICES);
    let before = sim.congestion();
    for floor in [0, -1, -2] {
        for x in (X0..LOT_WIDTH).chain((0..X0).rev()) {
            sim.tower.place(Kind::Floor, floor, x);
        }
    }
    assert!(sim.tower.place(Kind::Metro, -2, 0).ok);
    assert!(sim.congestion() < before);
}

#[test]
fn digging_basement_rooms_can_turn_up_treasure() {
    let mut sim = seeded_game(42, GameMode::Classic);
    sim.star = 3;
    sim.money = 1e7;
    for i in 0..120 {
        sim.tower.place(Kind::Floor, 0, X0 + i);
    }
    let mut built = 0;
    for i in (0..=114).step_by(6) {
        if sim.build(Kind::Parking, 0, X0 + i).ok {
            built += 1;
        }
    }
    assert!(built > 10);
    assert!(sim
        .log
        .iter()
        .any(|e| e.text.to_lowercase().contains("treasure")));
}
