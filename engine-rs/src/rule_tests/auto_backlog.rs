//! An Auto elevator never leaves a crowd waiting while its cars stand down.
//! The morning re-tune sizes each hour from the riders the cars carried, and
//! a shaft cut to one car carries no more than one car holds, so its reading
//! could never win the cars back. In 4.12.0 the owner's split tower had its
//! floor 1 to 15 shaft on one car every hour, with about 190 people waiting
//! at its two stops. Now an Auto shaft runs every car while more people wait
//! than its cars on shift could take in one trip, and a schedule the player
//! wrote (Auto off) keeps its row.
use crate::clock::GameMode;
use crate::crowd::{ElevatorCalls, PState};
use crate::dispatch::ElevatorDispatch;
use crate::facilities::Kind;
use crate::load::{decode_vctower_bytes, deserialize};
use crate::schedule::{Schedule, SCHEDULE_HOURS};
use crate::sim::Simulation;
use crate::tower::Tower;

use super::{shaft, strip_tower};

const TOP: i64 = 15;
const CARS: i64 = 8;
const NOON: i64 = 12;

/// A Modern shaft over floors 1 to `TOP` with `CARS` cars and a schedule
/// that runs one car every hour, with Auto on or off.
fn one_car_shaft(auto_tune: bool) -> (Tower, i64) {
    let mut sim = strip_tower(3, GameMode::Modern, 20, TOP);
    let id = shaft(&mut sim, Kind::ElevatorStandard, 4, 1, TOP);
    assert!(sim.tower.set_cars(id, CARS));
    let t = sim
        .tower
        .transports
        .iter_mut()
        .find(|t| t.id == id)
        .unwrap();
    t.schedule = Some(Schedule {
        weekday: Some(vec![1; SCHEDULE_HOURS]),
        weekend: Some(vec![1; SCHEDULE_HOURS]),
        auto_tune,
        ..Schedule::default()
    });
    (sim.tower, id)
}

/// `callers` of the crowd waiting at the lobby for shaft `id`.
fn lobby_crowd(id: i64, callers: f64) -> ElevatorCalls {
    let mut calls = ElevatorCalls::default();
    calls
        .hall
        .insert(id, [(1, callers.into())].into_iter().collect());
    calls
}

/// The cars of `id` the schedule stands down after one dispatch step at noon.
fn stood_down_after_a_step(tower: &mut Tower, id: i64, callers: f64) -> usize {
    let mut d = ElevatorDispatch::new();
    d.move_cars(tower, 1.0, &lobby_crowd(id, callers), NOON, false);
    d.closed_cars().iter().filter(|&&(s, _)| s == id).count()
}

fn car_capacity(tower: &Tower) -> f64 {
    tower.transports[0].kind.car_capacity()
}

#[test]
fn an_auto_shaft_runs_every_car_while_more_wait_than_its_cars_take() {
    let (mut tower, id) = one_car_shaft(true);
    let more_than_a_car = car_capacity(&tower) + 1.0;
    assert_eq!(stood_down_after_a_step(&mut tower, id, more_than_a_car), 0);
}

#[test]
fn an_auto_shaft_keeps_its_tuned_count_while_one_car_takes_the_line() {
    let (mut tower, id) = one_car_shaft(true);
    let a_carload = car_capacity(&tower);
    let closed = stood_down_after_a_step(&mut tower, id, a_carload);
    assert_eq!(closed, (CARS - 1) as usize, "the row's one car takes them");
}

#[test]
fn a_schedule_the_player_wrote_keeps_its_row_whatever_waits() {
    let (mut tower, id) = one_car_shaft(false);
    let a_crowd = car_capacity(&tower) * CARS as f64;
    let closed = stood_down_after_a_step(&mut tower, id, a_crowd);
    assert_eq!(
        closed,
        (CARS - 1) as usize,
        "Auto off: the row is the player's"
    );
}

#[test]
fn the_fleet_follows_the_line_as_it_appears_clears_and_comes_back() {
    let (mut tower, id) = one_car_shaft(true);
    let (cap, mut d) = (car_capacity(&tower), ElevatorDispatch::new());
    let mut stood_down = |tower: &mut Tower, callers: f64| {
        d.move_cars(tower, 1.0, &lobby_crowd(id, callers), NOON, false);
        d.closed_cars().iter().filter(|&&(s, _)| s == id).count()
    };
    let tuned = (CARS - 1) as usize;
    assert_eq!(stood_down(&mut tower, 0.0), tuned, "no line: the tuned row");
    assert_eq!(stood_down(&mut tower, cap + 1.0), 0, "a line: every car");
    assert_eq!(
        stood_down(&mut tower, cap),
        tuned,
        "cleared: back to the row"
    );
    assert_eq!(
        stood_down(&mut tower, cap * 2.0),
        0,
        "the line again: every car"
    );
}

/// The 1 to 15 shaft of the owner's split tower, on Auto and re-tuned to one
/// car for every hour of both day types.
const STARVED_SHAFT: i64 = 25498;

fn split_tower_29() -> Simulation {
    let bytes = include_bytes!("../../../conformance/fixtures/regression/split-tower-29.vctower");
    let save = decode_vctower_bytes(bytes).expect("the fixture decodes");
    let sim = deserialize(&save).expect("the fixture loads");
    assert_eq!(sim.tower.mode, GameMode::Modern);
    sim
}

/// The crowd waiting for `id`, at any of its stops.
fn waiting_for(sim: &Simulation, id: i64) -> usize {
    let waiting = |p: &&crate::crowd::Person| p.state == PState::Waiting && p.shaft_id == Some(id);
    sim.crowd.people.iter().filter(waiting).count()
}

#[test]
fn the_split_tower_line_at_the_auto_shaft_clears_within_the_hour() {
    let mut sim = split_tower_29();
    let t = sim.tower.get_transport(STARVED_SHAFT).expect("the shaft");
    let sched = t.schedule.as_ref().expect("its schedule");
    assert!(sched.auto_tune);
    assert_eq!(sched.weekday.as_deref(), Some(&[1; SCHEDULE_HOURS][..]));
    let before = waiting_for(&sim, STARVED_SHAFT);
    assert!(before > 150, "the save's line is there: {before}");
    for _ in 0..60 {
        sim.tick(1.0);
    }
    // With one car the line of about 230 was still about 190 an hour
    // later; with every car back it is gone within the hour.
    let after = waiting_for(&sim, STARVED_SHAFT);
    assert!(after < 40, "{before} waiting fell only to {after}");
}
