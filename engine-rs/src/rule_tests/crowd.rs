//! The crowd's routing and its spawn and motion loop, from the retired
//! `crowd.integration.test.ts`: routes over one shaft, a transfer, a stair
//! hop and the trivial and missing routes; a rider delivered to a floor the
//! demand model never calls; who spawns when (closed venues, an unstaffed
//! office, a weekend office tower); a rider whose car is trimmed away; and
//! the tick moving the crowd on its own. The route memo's refresh after
//! each layout edit is also `crowd::graph::tests::the_memo_follows_each_layout_edit`.
//! The suite's `reset` case is n/a in Rust: there is no `Crowd::reset`, a
//! load builds a fresh `Crowd::new`.
use crate::clock::GameMode;
use crate::crowd::motion::advance;
use crate::crowd::spawn::{make_person, spawn_step};
use crate::crowd::{PState, CROWD_SECONDS_PER_MINUTE};
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::sim_loop::Weather;
use crate::tower::UnitState;

use super::{at_time, place_seated, shaft, strip_tower};

const WIDTH: i64 = 40;
/// The commuter suites' elevator column.
const SHAFT_X: i64 = 4;

/// A 40-wide lobby and floors up to `top`, one standard elevator at x 4.
fn tower_with_elevator(top: i64) -> (Simulation, i64) {
    let mut sim = strip_tower(1, GameMode::Classic, WIDTH, top);
    let id = shaft(&mut sim, Kind::ElevatorStandard, SHAFT_X, 1, top);
    (sim, id)
}

/// Opens the doors of every elevator car standing on a floor, as the
/// dispatch does for a parked car. `pump` moves no cars, so it opens them
/// itself, or nobody could board.
fn open_standing_cars(sim: &mut Simulation) {
    let mut open = Vec::new();
    for t in sim.tower.transports.iter().filter(|t| t.kind.is_elevator()) {
        for (i, &pos) in t.car_positions.iter().enumerate() {
            if pos.fract() == 0.0 {
                open.push((t.id, i as i64, pos as i64));
            }
        }
    }
    open.sort_unstable();
    sim.crowd.open_cars = open;
}

/// `crowd.update(dt, tower, clock)`: one spawn step and one motion step on
/// a clear day, with no cars moved (the ones standing on a floor open).
fn pump(sim: &mut Simulation, dt_sec: f64, steps: usize) {
    for _ in 0..steps {
        open_standing_cars(sim);
        let population = sim.tower.total_population();
        spawn_step(
            &mut sim.crowd,
            dt_sec,
            &mut sim.tower,
            &sim.clock,
            Some(Weather::Clear),
            population,
        );
        advance(&mut sim.crowd, dt_sec, &mut sim.tower);
    }
}

#[test]
fn a_route_between_two_floors_rides_one_shaft() {
    let (mut sim, id) = tower_with_elevator(10);
    let r = sim.crowd.route(&sim.tower, 1, 8, None, None).unwrap();
    assert_eq!((r.floors[0], *r.floors.last().unwrap()), (1, 8));
    assert_eq!(r.shafts, vec![id]);
}

#[test]
fn a_route_follows_a_shaft_built_after_the_first_search() {
    let mut sim = strip_tower(1, GameMode::Classic, WIDTH, 8);
    assert!(sim.crowd.route(&sim.tower, 1, 6, None, None).is_none());
    shaft(&mut sim, Kind::ElevatorStandard, SHAFT_X, 1, 8);
    assert!(sim.crowd.route(&sim.tower, 1, 6, None, None).is_some());
}

#[test]
fn a_same_floor_route_is_trivial_and_an_unbuilt_floor_has_none() {
    let (mut sim, _) = tower_with_elevator(10);
    let r = sim.crowd.route(&sim.tower, 5, 5, None, None).unwrap();
    assert_eq!((r.floors, r.shafts), (vec![5], vec![]));
    assert!(sim.crowd.route(&sim.tower, 1, 50, None, None).is_none());
}

#[test]
fn a_trip_past_a_sky_lobby_transfers_there() {
    let mut sim = strip_tower(1, GameMode::Classic, WIDTH, 30);
    for x in 0..WIDTH {
        let tile = sim.tower.unit_at(15, x).unwrap().id;
        sim.tower.remove_unit(tile);
        assert!(sim.tower.place(Kind::Lobby, 15, x).ok);
    }
    let lower = shaft(&mut sim, Kind::ElevatorStandard, SHAFT_X, 1, 15);
    let upper = shaft(&mut sim, Kind::ElevatorStandard, 10, 15, 30);
    let r = sim.crowd.route(&sim.tower, 1, 30, None, None).unwrap();
    assert_eq!(r.shafts, vec![lower, upper]);
    assert!(r.floors.contains(&15));
}

#[test]
fn a_one_floor_hop_climbs_the_stairs() {
    let mut sim = strip_tower(1, GameMode::Classic, WIDTH, 2);
    let stairs = shaft(&mut sim, Kind::Stairs, SHAFT_X, 1, 2);
    let r = sim.crowd.route(&sim.tower, 1, 2, None, None).unwrap();
    assert_eq!((r.floors, r.shafts), (vec![1, 2], vec![stairs]));
}

/// A picked-up rider's destination is a live call, so a car carries them
/// to a floor the demand model sees nobody on, and boarding clears the wait.
#[test]
fn a_rider_reaches_a_floor_the_demand_model_never_calls() {
    let (mut sim, _) = tower_with_elevator(10);
    at_time(&mut sim, 0, 12);
    let route = sim.crowd.route(&sim.tower, 1, 7, None, None).unwrap();
    make_person(&mut sim.crowd, &sim.tower, route, 30.0, Some(5));
    let mut delivered = false;
    for _ in 0..400 {
        let calls = sim.crowd.elevator_calls(&sim.tower);
        sim.elevators
            .move_cars(&mut sim.tower, 1.0, &calls, 12, false);
        sim.elevators.swap_closed_cars(&mut sim.crowd.closed_cars);
        sim.elevators.swap_open_cars(&mut sim.crowd.open_cars);
        advance(&mut sim.crowd, CROWD_SECONDS_PER_MINUTE, &mut sim.tower);
        let Some(p) = sim.crowd.people.first() else {
            break;
        };
        if p.state == PState::Riding {
            assert_eq!(p.wait, 0.0, "boarding clears the wait");
        }
        if p.floor == 7 && p.state == PState::ToDest {
            delivered = true;
            break;
        }
    }
    assert!(delivered, "the rider never reached floor 7");
}

#[test]
fn morning_commuters_ride_real_routes_to_built_tiles() {
    let (mut sim, _) = tower_with_elevator(8);
    place_seated(&mut sim, Kind::Office, 5, 0, UnitState::Occupied, 0);
    at_time(&mut sim, 0, 8);
    pump(&mut sim, 0.05, 600);
    assert!(!sim.crowd.people.is_empty());
    assert!((0.0..=1.0).contains(&sim.crowd.frustration));
    for p in &sim.crowd.people {
        assert!(
            p.floors.len() >= 2 && !p.shafts.is_empty(),
            "{:?}",
            p.floors
        );
        assert!((0.0..WIDTH as f64).contains(&p.dest_x), "dest {}", p.dest_x);
    }
}

/// The people a lone room of `kind` with `occupants` draws over 400 short
/// crowd steps at `hour` on `day`.
fn drawn_by(kind: Kind, occupants: i64, day: i64, hour: i64) -> usize {
    let (mut sim, _) = tower_with_elevator(8);
    place_seated(&mut sim, kind, 5, 0, UnitState::Occupied, occupants);
    at_time(&mut sim, day, hour);
    pump(&mut sim, 0.05, 400);
    sim.crowd.people.len()
}

#[test]
fn nobody_visits_a_closed_venue() {
    assert_eq!(
        drawn_by(Kind::FastFood, 0, 0, 3),
        0,
        "fast food is shut at 03:00"
    );
    assert!(
        drawn_by(Kind::FastFood, 0, 0, 12) > 0,
        "and draws visitors at noon"
    );
}

#[test]
fn an_unstaffed_office_sends_nobody_home_in_the_evening() {
    assert_eq!(drawn_by(Kind::Office, 0, 0, 19), 0);
    assert!(drawn_by(Kind::Office, 6, 0, 19) > 0, "a staffed one does");
}

#[test]
fn an_office_tower_draws_no_trips_on_a_weekend() {
    let (mut sim, _) = tower_with_elevator(8);
    place_seated(&mut sim, Kind::Office, 5, 0, UnitState::Occupied, 0);
    at_time(&mut sim, 5, 8);
    assert!(sim.clock.is_weekend());
    pump(&mut sim, 0.05, 400);
    assert!(sim.crowd.people.is_empty());
}

#[test]
fn a_rider_whose_car_is_trimmed_away_steps_off() {
    let (mut sim, ev) = tower_with_elevator(8);
    place_seated(&mut sim, Kind::Office, 5, 0, UnitState::Occupied, 0);
    at_time(&mut sim, 0, 8);
    let mut rider = None;
    for _ in 0..4000 {
        pump(&mut sim, 0.05, 1);
        rider = sim
            .crowd
            .people
            .iter()
            .find(|p| p.state == PState::Riding && p.car_index.is_some())
            .map(|p| p.id);
        if rider.is_some() {
            break;
        }
    }
    let rider = rider.expect("a commuter boarded");
    let cars = sim.tower.get_transport(ev).unwrap().car_positions.len() as i64;
    assert!(cars > 1, "the trim leaves fewer cars");
    // Seat the rider in the last car, a real car the trim then removes.
    let last_car = cars - 1;
    let p = sim.crowd.people.iter_mut().find(|p| p.id == rider).unwrap();
    (p.shaft_id, p.car_index) = (Some(ev), Some(last_car));
    assert!(sim.tower.set_cars(ev, 1));
    let fleet = sim.tower.get_transport(ev).unwrap().car_positions.len();
    assert_eq!(fleet, 1, "the trim left one car");
    pump(&mut sim, 0.05, 1);
    assert!(
        sim.crowd.people.iter().all(|p| p.id != rider),
        "the rider on a missing car stepped off"
    );
    let left = sim.tower.get_transport(ev).unwrap().car_positions.len() as i64;
    for p in &sim.crowd.people {
        if p.state == PState::Riding {
            assert!(p.car_index.unwrap() < left);
        }
    }
}

#[test]
fn the_tick_moves_the_crowd_with_no_renderer() {
    let mut sim = super::seeded_game(1, GameMode::Classic);
    sim.money = 1e9;
    let c = super::MID - 15;
    for x in c..c + 30 {
        sim.tower.place(Kind::Lobby, 1, x);
        for floor in 2..=6 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    let office = place_seated(&mut sim, Kind::Office, 5, c, UnitState::Occupied, 0);
    sim.tower.get_unit_mut(office).unwrap().ever_occupied = true;
    shaft(&mut sim, Kind::ElevatorStandard, c + 20, 1, 6);
    assert!(sim.crowd.people.is_empty());
    for _ in 0..120 {
        sim.tick(1.0);
    }
    assert!(!sim.crowd.people.is_empty());
}
