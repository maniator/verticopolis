//! The core simulation suite, transport editing: cars are clamped to one
//! through eight for every elevator kind, a shaft resizes and is placed
//! over rooms, an extend lays the floor it climbs or digs into (several
//! stories at once, the missing columns of a partial one) but refuses a
//! floor that could never be supported and an unbuilt sky lobby, capacity
//! follows the cars, and express stops unserve the floors they skip.
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;

use super::seeded_game;
use super::simulation_economy::X0;

const SHAFT_WIDTH: i64 = 4;

/// Floors 2 to 10, twenty tiles wide, over the starter lobby.
fn base(seed: u32) -> Simulation {
    let mut sim = seeded_game(seed, GameMode::Classic);
    for floor in 2..=10 {
        for i in 0..20 {
            sim.tower.place(Kind::Floor, floor, X0 + i);
        }
    }
    sim
}

fn shaft(sim: &mut Simulation, kind: Kind, x: i64, bottom: i64, top: i64) -> i64 {
    assert!(sim.build_transport(kind, x, bottom, top).ok, "{kind:?}");
    sim.tower.transports.last().unwrap().id
}

fn span(sim: &Simulation, id: i64) -> (i64, i64) {
    let t = sim.tower.transports.iter().find(|t| t.id == id).unwrap();
    (t.bottom, t.top)
}

fn floored(sim: &Simulation, floor: i64, from: i64) -> bool {
    (0..SHAFT_WIDTH).all(|i| sim.tower.structure_kind_at(floor, from + i) == Some(Kind::Floor))
}

#[test]
fn cars_are_added_and_clamped_to_one_through_eight_for_every_elevator_kind() {
    let mut sim = base(1);
    let id = shaft(&mut sim, Kind::ElevatorStandard, X0, 1, 6);
    let start = sim.tower.transports[0].cars;
    assert!(sim.tower.set_cars(id, start + 1));
    let t = &sim.tower.transports[0];
    assert_eq!(
        (t.cars, t.car_positions.len() as i64),
        (start + 1, start + 1)
    );
    sim.tower.set_cars(id, 99);
    assert_eq!(sim.tower.transports[0].cars, 8);
    sim.tower.set_cars(id, 0);
    assert_eq!(sim.tower.transports[0].cars, 1);

    let mut kinds = base(3);
    kinds.star = 3;
    let mut x = X0;
    for kind in [
        Kind::ElevatorStandard,
        Kind::ElevatorService,
        Kind::ElevatorExpress,
    ] {
        let id = shaft(&mut kinds, kind, x, 1, 6);
        kinds.tower.set_cars(id, 99);
        let t = kinds.tower.transports.iter().find(|t| t.id == id).unwrap();
        assert_eq!((t.kind, t.cars), (kind, 8));
        x += kind.facility().width + 1;
    }
}

#[test]
fn a_shaft_resizes_over_rooms_and_is_placed_over_them() {
    let mut sim = base(2);
    let id = shaft(&mut sim, Kind::ElevatorStandard, X0, 1, 6);
    assert!(sim.tower.resize_transport(id, 1, 8).ok);
    assert_eq!(span(&sim, id).1, 8);
    assert!(sim.tower.place(Kind::Office, 9, X0).ok);
    assert!(sim.tower.resize_transport(id, 1, 9).ok);
    assert_eq!(span(&sim, id).1, 9);

    let mut over = base(2);
    assert!(over.tower.place(Kind::Office, 3, X0).ok);
    assert!(over.build_transport(Kind::ElevatorStandard, X0, 1, 6).ok);
}

#[test]
fn an_extend_lays_the_floor_it_climbs_into_one_or_several_stories() {
    let mut sim = base(2);
    let id = shaft(&mut sim, Kind::ElevatorStandard, X0, 1, 6);
    assert!(sim.tower.resize_transport(id, 1, 10).ok);
    let up = sim.tower.resize_transport(id, 1, 11);
    assert!(up.ok);
    assert_eq!(up.floor_tiles_created, SHAFT_WIDTH);
    assert_eq!(span(&sim, id).1, 11);
    assert!(floored(&sim, 11, X0));

    let mut jump = base(2);
    let id = shaft(&mut jump, Kind::ElevatorStandard, X0, 1, 10);
    let up = jump.tower.resize_transport(id, 1, 13);
    assert!(up.ok);
    assert_eq!(up.floor_tiles_created, 3 * SHAFT_WIDTH);
    assert!((11..=13).all(|floor| floored(&jump, floor, X0)));
}

#[test]
fn an_extend_completes_a_partial_floor_behind_the_shaft() {
    let mut sim = base(2);
    let id = shaft(&mut sim, Kind::ElevatorStandard, X0, 1, 10);
    assert!(sim.tower.place(Kind::Floor, 11, X0).ok);
    assert!(sim.tower.place(Kind::Floor, 11, X0 + 1).ok);
    let up = sim.tower.resize_transport(id, 1, 11);
    assert!(up.ok);
    assert_eq!(up.floor_tiles_created, 2);
    assert!(floored(&sim, 11, X0));
}

#[test]
fn an_extend_down_digs_the_basement_floors() {
    let mut sim = base(2);
    let id = shaft(&mut sim, Kind::ElevatorStandard, X0, 1, 6);
    assert!(sim.tower.resize_transport(id, -1, 6).ok);
    assert_eq!(span(&sim, id).0, -1);
    assert!(floored(&sim, 0, X0) && floored(&sim, -1, X0));
}

#[test]
fn an_extend_never_lays_a_floor_that_would_float() {
    let mut sim = seeded_game(2, GameMode::Classic);
    for floor in 2..=6 {
        assert!(sim.tower.place(Kind::Floor, floor, X0).ok);
    }
    let id = shaft(&mut sim, Kind::ElevatorStandard, X0, 1, 6);
    assert!(!sim.tower.resize_transport(id, 1, 7).ok);
    assert_eq!(span(&sim, id).1, 6);
    assert_eq!(
        sim.tower.structure_kind_at(7, X0),
        None,
        "the supported tile is rolled back too"
    );
}

#[test]
fn an_extend_through_an_unbuilt_sky_lobby_asks_for_the_lobby_first() {
    let mut sim = seeded_game(2, GameMode::Classic);
    for floor in 2..=14 {
        for i in 0..SHAFT_WIDTH {
            assert!(sim.tower.place(Kind::Floor, floor, X0 + i).ok);
        }
    }
    let id = shaft(&mut sim, Kind::ElevatorStandard, X0, 1, 14);
    let up = sim.tower.resize_transport(id, 1, 15);
    assert!(!up.ok);
    assert_eq!(
        up.reason.as_deref(),
        Some("Build the sky lobby on floor 15 first, then extend through it.")
    );
    assert_eq!(span(&sim, id).1, 14);
    assert_eq!(sim.tower.structure_kind_at(15, X0), None);
    for i in 0..SHAFT_WIDTH {
        assert!(sim.tower.place(Kind::Lobby, 15, X0 + i).ok);
    }
    assert!(sim.tower.resize_transport(id, 1, 15).ok);
    assert_eq!(span(&sim, id).1, 15);
}

#[test]
fn capacity_follows_the_cars_and_an_empty_tower_has_no_congestion() {
    let mut sim = base(4);
    let id = shaft(&mut sim, Kind::ElevatorStandard, X0, 1, 6);
    sim.tower.set_cars(id, 2);
    let t = &sim.tower.transports[0];
    assert_eq!(Simulation::transport_capacity(t.kind, t.cars), 2.0 * 21.0);
    assert_eq!(sim.congestion(), 0.0);
}

#[test]
fn express_stops_skip_the_floors_between_lobbies_and_unserve_them() {
    let mut sim = base(5);
    let id = shaft(&mut sim, Kind::ElevatorStandard, X0, 1, 8);
    assert!(sim.tower.is_floor_served(3));
    sim.tower.set_express_stops(id);
    let t = sim.tower.transports.iter().find(|t| t.id == id).unwrap();
    assert!(t.stops_at(8));
    assert!(!t.stops_at(3));
    assert!(!sim.tower.is_floor_served(3));
    assert!(sim.tower.is_floor_served(8));
    assert!(sim.tower.clear_stops(id));
    assert!(sim.tower.is_floor_served(3));
}
