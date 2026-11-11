//! Modern's demographic routines (#397), from the retired
//! `demographicRoutines.integration.test.ts`: the school run (condo to lobby
//! from 07:00, lobby to condo from 15:00, weekdays only) and the midday
//! sales call (office to lobby and back from 10:00 to 15:00), with Classic
//! and an unoccupied tower drawing none. The suite pinned the window
//! constants by name; here the windows are pinned by what each hour draws.
use std::collections::HashSet;

use crate::clock::GameMode;
use crate::crowd::motion::advance;
use crate::crowd::spawn::spawn_step;
use crate::crowd::{PState, CROWD_SECONDS_PER_MINUTE};
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::sim_loop::Weather;
use crate::tower::UnitState;

use super::{at_time, place_seated, shaft, strip_tower};

const SCHOOL_RUN: &str = "schoolRun";
const SALES_CALL: &str = "salesCall";
const OFFICE_FLOOR: i64 = 2;
const CONDO_FLOORS: [i64; 2] = [3, 4];
const LOBBY: i64 = 1;
const SATURDAY: i64 = 5;

/// A 40-wide strip to floor 5 with one elevator, three offices on floor 2
/// and four condos on floors 3 and 4, and no food venue, so every tagged
/// person comes from the routines. `occupy` staffs the offices and leaves
/// one resident home in each condo.
fn routine_tower(mode: GameMode, occupy: bool) -> Simulation {
    let mut sim = strip_tower(2024, mode, 40, 5);
    shaft(&mut sim, Kind::ElevatorStandard, 4, 1, 5);
    let (state, staff, home) = if occupy {
        (UnitState::Occupied, Kind::Office.facility().population, 1)
    } else {
        (UnitState::Empty, 0, 0)
    };
    for x in [8, 18, 28] {
        place_seated(&mut sim, Kind::Office, OFFICE_FLOOR, x, state, staff);
    }
    for floor in CONDO_FLOORS {
        for x in [8, 24] {
            place_seated(&mut sim, Kind::Condo, floor, x, state, home);
        }
    }
    sim
}

/// One routine-tagged person as first seen.
struct Tagged {
    routine: &'static str,
    origin: i64,
    dest: i64,
    origin_kind: Option<Kind>,
}

#[derive(Default)]
struct Pumped {
    tagged: Vec<Tagged>,
    sales_dwell_seen: bool,
    sales_return_seen: bool,
    origin_thinned: bool,
}

impl Pumped {
    fn count(&self, routine: &str) -> usize {
        self.tagged.iter().filter(|t| t.routine == routine).count()
    }
}

/// Ticks `minutes` one game-minute at a time, noting every new tagged person.
fn pump(sim: &mut Simulation, minutes: usize) -> Pumped {
    let mut out = Pumped::default();
    let mut seen = HashSet::new();
    for _ in 0..minutes {
        sim.tick(1.0);
        for p in &sim.crowd.people {
            let Some(routine) = p.routine else { continue };
            if seen.insert(p.id) {
                out.tagged.push(Tagged {
                    routine,
                    origin: p.floors[0],
                    dest: *p.floors.last().unwrap(),
                    origin_kind: p
                        .origin_unit_id
                        .and_then(|id| sim.tower.get_unit(id))
                        .map(|u| u.kind),
                });
            }
            out.sales_dwell_seen |= routine == SALES_CALL && p.state == PState::Dwelling;
            out.sales_return_seen |= routine == SALES_CALL && p.returning;
        }
        out.origin_thinned |= sim
            .tower
            .units
            .iter()
            .any(|u| u.out_for_meal.unwrap_or(0) > 0);
    }
    out
}

/// Minutes a quiet-hour run spans: the step that ends a full hour already
/// reads the next hour's clock, so a run stops short of it.
const WITHIN_THE_HOUR: usize = 55;

fn pumped_at(mode: GameMode, day: i64, hour: i64, minutes: usize) -> Pumped {
    let mut sim = routine_tower(mode, true);
    at_time(&mut sim, day, hour);
    pump(&mut sim, minutes)
}

#[test]
fn the_routine_weights_are_modern_only_probabilities() {
    let (school, sales) = GameMode::Modern.demographic_routines();
    assert!(school > 0.0 && sales > 0.0 && sales <= 1.0);
    assert_eq!(GameMode::Classic.demographic_routines(), (0.0, 0.0));
}

#[test]
fn the_morning_school_run_leaves_occupied_condos_for_the_lobby() {
    let run = pumped_at(GameMode::Modern, 0, 7, 60);
    let departures: Vec<&Tagged> = run
        .tagged
        .iter()
        .filter(|t| t.routine == SCHOOL_RUN)
        .collect();
    assert!(!departures.is_empty());
    for d in departures {
        assert!(CONDO_FLOORS.contains(&d.origin) && d.dest == LOBBY);
        assert_eq!(d.origin_kind, Some(Kind::Condo), "keyed to its condo");
    }
}

#[test]
fn the_afternoon_school_run_rides_from_the_lobby_home() {
    let run = pumped_at(GameMode::Modern, 0, 15, 60);
    let returns: Vec<&Tagged> = run
        .tagged
        .iter()
        .filter(|t| t.routine == SCHOOL_RUN)
        .collect();
    assert!(!returns.is_empty());
    for r in returns {
        assert!(r.origin == LOBBY && CONDO_FLOORS.contains(&r.dest));
    }
}

#[test]
fn the_school_run_keeps_to_its_weekday_hours() {
    for hour in [6, 8, 12, 14, 16] {
        let run = pumped_at(GameMode::Modern, 0, hour, WITHIN_THE_HOUR);
        assert_eq!(run.count(SCHOOL_RUN), 0, "weekday hour {hour}");
    }
    let saturday = pumped_at(GameMode::Modern, SATURDAY, 7, 60);
    assert_eq!(saturday.count(SCHOOL_RUN), 0, "no school on a Saturday");
}

#[test]
fn a_midday_sales_call_is_a_round_trip_from_an_office() {
    let run = pumped_at(GameMode::Modern, 0, 12, 150);
    let calls: Vec<&Tagged> = run
        .tagged
        .iter()
        .filter(|t| t.routine == SALES_CALL)
        .collect();
    assert!(!calls.is_empty());
    for c in calls {
        assert!(c.origin == OFFICE_FLOOR && c.dest == LOBBY);
        assert_eq!(c.origin_kind, Some(Kind::Office));
    }
    assert!(run.sales_dwell_seen, "callers dwell off site");
    assert!(run.sales_return_seen, "and ride back");
    assert!(run.origin_thinned, "their office thins while they are out");
}

#[test]
fn sales_calls_keep_to_the_weekday_window() {
    assert!(pumped_at(GameMode::Modern, 0, 10, WITHIN_THE_HOUR).count(SALES_CALL) > 0);
    for hour in [9, 15, 16] {
        let run = pumped_at(GameMode::Modern, 0, hour, WITHIN_THE_HOUR);
        assert_eq!(
            run.count(SALES_CALL),
            0,
            "hour {hour}, offices still staffed"
        );
    }
    let saturday = pumped_at(GameMode::Modern, SATURDAY, 12, 60);
    assert_eq!(
        saturday.count(SALES_CALL),
        0,
        "weekend offices are unstaffed"
    );
}

#[test]
fn classic_draws_no_routine_trips_from_the_same_tower() {
    for hour in [7, 12, 15] {
        let run = pumped_at(GameMode::Classic, 0, hour, 60);
        assert!(run.tagged.is_empty(), "Classic at hour {hour}");
    }
}

/// The crowd alone (no hourly move-ins that could let a room mid-run).
#[test]
fn an_unoccupied_tower_draws_no_routine_trips() {
    for hour in [7, 12, 15] {
        let mut sim = routine_tower(GameMode::Modern, false);
        at_time(&mut sim, 0, hour);
        let mut tagged = 0;
        for _ in 0..60 {
            let population = sim.tower.total_population();
            let dt = CROWD_SECONDS_PER_MINUTE;
            spawn_step(
                &mut sim.crowd,
                dt,
                &mut sim.tower,
                &sim.clock,
                Some(Weather::Clear),
                population,
            );
            advance(&mut sim.crowd, dt, &mut sim.tower);
            sim.clock.advance(1.0);
            tagged += sim
                .crowd
                .people
                .iter()
                .filter(|p| p.routine.is_some())
                .count();
        }
        assert_eq!(tagged, 0, "unoccupied tower at hour {hour}");
    }
}
