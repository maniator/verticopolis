//! The step that spawns the crowd's trips. Housekeepers come in for their
//! shift instead (`crowd/staff_shift.rs`).

use super::{crowd_is_full, spawn_trips};
use crate::clock::Clock;
use crate::crowd::spawn_floors::spawn_floors;
use crate::crowd::walk_ins;
use crate::crowd::Crowd;
use crate::sim_loop::{weather_for, Weather};
use crate::tower::Tower;

/// `spawnStep`. `population` is the tower's `totalPopulation` as the step's
/// dispatch pass summed it; nothing between that pass and this call changes
/// who is present.
pub fn spawn_step(
    crowd: &mut Crowd,
    dt_sec: f64,
    tower: &mut Tower,
    clock: &Clock,
    weather: Option<Weather>,
    population: i64,
) {
    debug_assert_eq!(population, tower.total_population());
    let mut time_rate = 2.2;
    if clock.is_night() {
        time_rate = 0.3;
    } else if clock.is_weekend() {
        time_rate = 1.2;
    }
    let pop_factor = (0.4 + population as f64 / 2000.0).min(3.0);
    let sky = weather.unwrap_or_else(|| weather_for(clock.day()));
    let weather_factor = if sky == Weather::Rain {
        tower.mode.rain_crowd_factor()
    } else {
        1.0
    };
    walk_ins::start_walk_ins(crowd, tower, clock);
    crowd.spawn_acc += dt_sec * time_rate * pop_factor * weather_factor;
    if crowd.spawn_acc < 1.0 {
        return;
    }
    // `spawn_trips` only adds people and returns on `crowd_is_full` before
    // any draw, so a crowd full here skips the lists and drains the
    // accumulator the same (#1143 item 4).
    let floors = (!crowd_is_full(crowd)).then(|| spawn_floors(tower, clock));
    let mut guard = 0;
    while crowd.spawn_acc >= 1.0 && guard < 8 {
        guard += 1;
        crowd.spawn_acc -= 1.0;
        if let Some(floors) = &floors {
            spawn_trips(crowd, tower, clock, floors);
        }
    }
}
