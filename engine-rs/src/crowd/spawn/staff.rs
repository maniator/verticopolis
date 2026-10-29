//! Staff spawning and the step that drives it.

use crate::housekeeping::HK_MAIDS_PER_UNIT;

use super::{crowd_is_full, make_person, spawn_trips};
use crate::clock::Clock;
use crate::crowd::spawn_floors::spawn_floors;
use crate::crowd::{Crowd, CROWD_SECONDS_PER_MINUTE};
use crate::sim_loop::{weather_for, Weather};
use crate::tower::Tower;

#[derive(Debug, PartialEq, Eq)]
pub enum StaffSpawn {
    Sent,
    Full,
    NoRoute,
}

pub fn spawn_staff(
    crowd: &mut Crowd,
    tower: &Tower,
    from: i64,
    to: i64,
    dest_x: f64,
    clean_unit_id: i64,
    clean_minutes: f64,
    from_x: Option<f64>,
) -> StaffSpawn {
    if crowd.staff_count >= max_staff_for(tower) {
        return StaffSpawn::Full;
    }
    let Some(r) = crowd.staff_route(tower, from, to, from_x, Some(dest_x)) else {
        return StaffSpawn::NoRoute;
    };
    let i = make_person(crowd, tower, r, dest_x, None);
    let p = &mut crowd.people[i];
    if let Some(fx) = from_x {
        p.x = fx;
    }
    p.staff = true;
    p.clean_unit_id = Some(clean_unit_id);
    p.linger_for = Some(clean_minutes * CROWD_SECONDS_PER_MINUTE);
    crowd.staff_count += 1;
    StaffSpawn::Sent
}

/// `maxStaffFor`. It runs for every staff spawn attempt inside
/// housekeeping's loop over rooms and crews, so the crews come from a
/// memoized count (`Tower::housekeeping_units`, keyed on revision and unit
/// count) where the TypeScript keeps `staffCeiling` per revision (#1143).
pub fn max_staff_for(tower: &Tower) -> i64 {
    tower.housekeeping_units() * HK_MAIDS_PER_UNIT
}

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
