//! An Auto elevator never leaves a crowd waiting while its cars stand down.
//! The morning re-tune sizes each hour from the riders the cars carried, and
//! a shaft cut to one car carries no more than one car holds, so its reading
//! could never win the cars back. In 4.12.0 the owner's split tower had its
//! floor 1 to 15 shaft on one car every hour, with about 190 people waiting
//! at its two stops. 4.13.0 ran every car once more people waited than the
//! cars on shift could take in one trip, and split-tower 31 still stood
//! hundreds in its basement lines every weekday morning, since a line short
//! of a trip at a long express waits out a full round trip for each car. Now
//! an Auto shaft runs every car while anyone waits at its stops, and a
//! schedule the player wrote (Auto off) keeps its row.
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
/// that runs one car every hour, with Auto on or off, idled until every
/// car has parked at its home.
fn one_car_shaft(auto_tune: bool) -> (Tower, i64) {
    one_car_shaft_in(GameMode::Modern, auto_tune)
}

fn one_car_shaft_in(mode: GameMode, auto_tune: bool) -> (Tower, i64) {
    let mut sim = strip_tower(3, mode, 20, TOP);
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
    let mut d = ElevatorDispatch::new();
    for _ in 0..300 {
        d.move_cars(&mut sim.tower, 1.0, &ElevatorCalls::default(), NOON, false);
    }
    assert!(
        sim.tower.transports[0].car_dir.iter().all(|&w| w == 0),
        "parked"
    );
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
fn an_auto_shaft_runs_every_car_while_anyone_waits() {
    let (mut tower, id) = one_car_shaft(true);
    assert_eq!(stood_down_after_a_step(&mut tower, id, 1.0), 0, "one rider");
    let more_than_a_car = car_capacity(&tower) + 1.0;
    assert_eq!(stood_down_after_a_step(&mut tower, id, more_than_a_car), 0);
}

#[test]
fn a_quiet_auto_shaft_keeps_its_tuned_count() {
    let (mut tower, id) = one_car_shaft(true);
    let closed = stood_down_after_a_step(&mut tower, id, 0.0);
    assert_eq!(
        closed,
        (CARS - 1) as usize,
        "nobody waits: the row's one car"
    );
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
fn a_classic_shaft_marked_auto_keeps_its_row() {
    // Auto is a Modern assist; a crafted Classic save may still mark it.
    let (mut tower, id) = one_car_shaft_in(GameMode::Classic, true);
    let a_crowd = car_capacity(&tower) * CARS as f64;
    let closed = stood_down_after_a_step(&mut tower, id, a_crowd);
    assert_eq!(closed, (CARS - 1) as usize);
}

#[test]
fn the_fleet_follows_the_line_as_it_appears_clears_and_comes_back() {
    let (mut tower, id) = one_car_shaft(true);
    let (cap, mut d) = (car_capacity(&tower), ElevatorDispatch::new());
    let mut stood_down = |tower: &mut Tower, at: &[(i64, f64)]| {
        let mut calls = ElevatorCalls::default();
        let hall = at.iter().map(|&(floor, n)| (floor, n.into())).collect();
        calls.hall.insert(id, hall);
        d.move_cars(tower, 1.0, &calls, NOON, false);
        d.closed_cars().iter().filter(|&&(s, _)| s == id).count()
    };
    let tuned = (CARS - 1) as usize;
    assert_eq!(stood_down(&mut tower, &[]), tuned, "quiet: the row");
    assert_eq!(
        stood_down(&mut tower, &[(TOP, 1.0)]),
        0,
        "one rider: every car"
    );
    let rush = [(1, cap + 1.0), (8, cap), (TOP, cap)];
    assert_eq!(stood_down(&mut tower, &rush), 0, "a line: every car");
    assert_eq!(stood_down(&mut tower, &[]), tuned, "cleared: the row");
    assert_eq!(
        stood_down(&mut tower, &rush),
        0,
        "the line again: every car"
    );
}

#[test]
fn the_backlog_rule_reads_only_auto_and_whether_anyone_waits() {
    let auto = Schedule::auto_only();
    let mine = Schedule::default();
    let run = |s: Option<&Schedule>, active: usize, waiting: f64| {
        Schedule::cars_while_anyone_waits(s, active, CARS as usize, waiting)
    };
    assert_eq!(run(Some(&auto), 1, 1.0), 8, "one rider: every car");
    assert_eq!(run(Some(&auto), 3, 0.0), 3, "nobody: the row");
    assert_eq!(run(Some(&mine), 1, 500.0), 1, "Auto off: the row");
    assert_eq!(run(None, 2, 500.0), 2, "no schedule: as given");
}

#[test]
fn the_shipped_signature_follows_the_same_rule() {
    // A step down from four cars to one: the old rule kept the cars out.
    let auto = Schedule::auto_only();
    let ways = [1, -1, 1, -1, 0, 0, 0, 0];
    let positions = [3.0, 9.0, 12.0, 6.0, 1.0, 1.0, 1.0, 1.0];
    let fleet = (&positions[..], &ways[..], (1, TOP));
    let cap = Kind::ElevatorStandard.car_capacity();
    let run =
        |waiting: f64| Schedule::cars_for_backlog(Some(&auto), 1, (waiting, cap), fleet, |_| 1);
    assert_eq!(run(0.0), 1, "nobody: the row");
    assert_eq!(run(1.0), 8, "one rider: every car");
    assert_eq!(run(cap + 1.0), 8, "more than a trip: every car");
}

#[test]
fn a_classic_tower_loads_with_auto_off() {
    for (mode, kept) in [(GameMode::Classic, false), (GameMode::Modern, true)] {
        let mut sim = strip_tower(3, mode, 20, TOP);
        let id = shaft(&mut sim, Kind::ElevatorStandard, 4, 1, TOP);
        // A crafted save, or a file opened under another mode, can mark it.
        let t = sim
            .tower
            .transports
            .iter_mut()
            .find(|t| t.id == id)
            .unwrap();
        t.schedule = Some(Schedule::auto_only());
        let loaded = deserialize(&sim.serialize()).expect("the save loads");
        let t = loaded.tower.get_transport(id).expect("the shaft");
        let auto = t.schedule.as_ref().is_some_and(|s| s.auto_tune);
        assert_eq!(auto, kept, "{mode:?}");
        assert_eq!(loaded.tower.runs_an_auto_schedule(), kept, "{mode:?}");
    }
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

/// A Modern tower with one Auto shaft over floors 1 to `TOP` with `CARS`
/// cars whose rows run `on_shift` cars every hour.
fn auto_shaft_running(on_shift: i64) -> (Simulation, i64) {
    let mut sim = strip_tower(5, GameMode::Modern, 20, TOP);
    let id = shaft(&mut sim, Kind::ElevatorStandard, 4, 1, TOP);
    assert!(sim.tower.set_cars(id, CARS));
    let t = sim
        .tower
        .transports
        .iter_mut()
        .find(|t| t.id == id)
        .unwrap();
    t.schedule = Some(Schedule {
        weekday: Some(vec![on_shift; SCHEDULE_HOURS]),
        weekend: Some(vec![on_shift; SCHEDULE_HOURS]),
        auto_tune: true,
        ..Schedule::default()
    });
    (sim, id)
}

/// Samples a weekday's 24 hours with `riders` in line at the lobby and
/// nobody aboard, then runs the next morning's re-tune. Returns the
/// weekday row it writes.
fn retuned_after_a_day_in_line(sim: &mut Simulation, id: i64, riders: i64) -> Vec<i64> {
    let line = crate::crowd::line_count::Line {
        riders,
        oldest: 0.0,
    };
    sim.crowd.shaft_lines.insert((id, 1), line);
    for hour in 0..SCHEDULE_HOURS {
        sim.clock.minutes = hour as f64 * 60.0;
        sim.sample_elevator_util();
    }
    sim.clock.minutes = (24 + crate::schedule_auto::AUTO_TUNE_HOUR) as f64 * 60.0;
    sim.retune_auto_schedules();
    let t = sim.tower.get_transport(id).unwrap();
    t.schedule.as_ref().unwrap().weekday.clone().unwrap()
}

#[test]
fn a_line_at_an_auto_shaft_is_demand_the_morning_re_tune_reads() {
    let (mut sim, id) = auto_shaft_running(1);
    let cap = Kind::ElevatorStandard.car_capacity();
    // Three carloads waiting all day at a shaft cut to one car.
    let row = retuned_after_a_day_in_line(&mut sim, id, 3 * cap as i64);
    let ring = &sim.telemetry.hourly[&id].weekday;
    assert!(ring.iter().all(|&r| r == 3.0 / CARS as f64), "{ring:?}");
    assert!(
        row.iter().all(|&n| n >= 4),
        "three carloads need four cars with room: {row:?}"
    );
}

#[test]
fn a_re_tune_wins_back_cars_from_any_cut_while_a_line_waits() {
    let cap = Kind::ElevatorStandard.car_capacity() as i64;
    for on_shift in 1..CARS {
        let (mut sim, id) = auto_shaft_running(on_shift);
        // One carload more than the cars on shift take in a trip.
        let row = retuned_after_a_day_in_line(&mut sim, id, (on_shift + 1) * cap);
        assert!(
            row.iter().all(|&n| n > on_shift),
            "cut to {on_shift}: {row:?}"
        );
    }
}

#[test]
fn a_quiet_auto_shaft_still_tunes_down() {
    let (mut sim, id) = auto_shaft_running(CARS);
    let row = retuned_after_a_day_in_line(&mut sim, id, 0);
    assert!(
        row.iter().all(|&n| n == 1),
        "nobody rode or waited: {row:?}"
    );
}

#[test]
fn the_split_tower_auto_shaft_keeps_its_line_short_for_a_day() {
    let mut sim = split_tower_29();
    // The save's line clears in its first hour; then a full day, through
    // the 5 AM re-tune and the next morning's rush.
    for _ in 0..60 {
        sim.tick(1.0);
    }
    let mut worst = 0;
    for _ in 0..24 * 60 {
        sim.tick(1.0);
        worst = worst.max(waiting_for(&sim, STARVED_SHAFT));
    }
    // Cut to one car, the line stood near 200 all day; Auto now runs every
    // car once more than a carload waits, so it never grows past a few.
    let three_carloads = 3.0 * Kind::ElevatorStandard.car_capacity();
    assert!((worst as f64) < three_carloads, "the line reached {worst}");
}
