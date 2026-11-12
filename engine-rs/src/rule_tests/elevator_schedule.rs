//! The elevator schedule as saved state (#305 phase 1) and the hourly
//! demand rings it is authored from: an authored schedule round-trips, an
//! absent one writes nothing, stairs never keep one, a forged one is
//! hardened, a version 6 save migrates with none, homes snap to stops on
//! every stop edit (fresh stops, lower floor on a tie, one way), and each day
//! type samples into its own ring, origins included, with a midnight drain
//! filed under yesterday.
//!
//! Already covered: the coerce rules row by row by the loader cases
//! `transport-schedule-garbage`, `schedule-rows-wrong-length` and
//! `schedule-nonfinite-tunables` (`load::loader_cases`); a set home on a
//! skipped floor by `tower::tests::new_schedules_still_snap_homes_to_served_floors`
//! and `schedule_authoring_tests::a_home_on_a_skipped_floor_snaps_to_the_nearest_served_one`;
//! the ring blend and prune by `telemetry::tests::a_first_sample_lands_whole_and_later_ones_blend`
//! and `telemetry::tests::a_negligible_floor_is_pruned_and_hours_wrap`.
use serde_json::json;

use crate::clock::{CalendarKind, GameMode};
use crate::facilities::Kind;
use crate::load::{deserialize, migrate_save};
use crate::schedule::SCHEDULE_HOURS;
use crate::sim::{Simulation, PLAIN_SAVE_VERSION};
use crate::tower::{Transport, UnitState};

const WIDTH: i64 = 24;
const TOP: i64 = 8;
const DAY: f64 = 1440.0;
const HOUR: f64 = 60.0;

/// One standard elevator over floors 1 to 8, 24 tiles wide, Modern.
fn tower_with_elevator() -> Simulation {
    let mut sim = Simulation::new(2024, GameMode::Modern, CalendarKind::RealWorld, false);
    sim.money = 10_000_000.0;
    for x in 0..WIDTH {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    for floor in 2..=TOP {
        for x in 0..WIDTH {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorStandard, 0, 1, TOP)
            .ok
    );
    sim
}

fn shaft(sim: &Simulation) -> &Transport {
    &sim.tower.transports[0]
}

fn round_trip(sim: &Simulation) -> Simulation {
    deserialize(&sim.serialize()).expect("the save loads")
}

fn homes(sim: &Simulation) -> Vec<i64> {
    shaft(sim)
        .schedule
        .as_ref()
        .unwrap()
        .home_floors
        .clone()
        .unwrap()
}

#[test]
fn a_save_is_stamped_with_the_current_version() {
    assert_eq!(PLAIN_SAVE_VERSION, 7);
    assert_eq!(tower_with_elevator().serialize()["version"], 7);
}

#[test]
fn an_authored_schedule_round_trips_intact() {
    let mut sim = tower_with_elevator();
    let id = shaft(&sim).id;
    assert!(sim.tower.set_cars(id, 4));
    let weekday: Vec<i64> = (0..SCHEDULE_HOURS as i64)
        .map(|h| if (8..18).contains(&h) { 4 } else { 1 })
        .collect();
    let authored = json!({
        "activeCars": { "weekday": weekday, "weekend": vec![1; SCHEDULE_HOURS] },
        "waitingCarResponse": 5.0,
        "standardFloorDeparture": 12.0,
        "homeFloors": [1, 1, 8, 8],
    });
    let before = sim.tower.revision;
    assert!(sim.tower.set_schedule(id, &authored));
    assert!(
        sim.tower.revision > before,
        "the stop caches are invalidated"
    );
    let written = shaft(&sim).schedule.clone().unwrap();
    assert_eq!(written.to_json(), authored, "in range, so nothing coerced");
    let back = round_trip(&sim);
    assert_eq!(shaft(&back).schedule.as_ref(), Some(&written));
}

#[test]
fn an_orphaned_home_snaps_to_the_nearest_stop_one_way() {
    let mut sim = tower_with_elevator();
    let id = shaft(&sim).id;
    assert_eq!(shaft(&sim).cars, 2);
    assert!(sim.tower.set_schedule(
        id,
        &json!({ "homeFloors": [5, 1], "waitingCarResponse": 3 })
    ));
    // Warm the stops cache first: the edit must snap against fresh stops.
    assert!(sim.tower.stops_of(shaft(&sim)).contains(&5));
    assert!(sim.tower.set_stop(id, 5, false));
    assert_eq!(homes(&sim), [4, 1]);
    // Serving the floor again does not move the home back.
    assert!(sim.tower.set_stop(id, 5, true));
    assert_eq!(homes(&sim), [4, 1]);
    let s = shaft(&sim).schedule.as_ref().unwrap();
    assert_eq!(s.waiting_car_response, Some(3.0), "the rest is untouched");
}

#[test]
fn homes_snap_on_the_express_lock_and_a_tie_goes_to_the_lower_floor() {
    let mut sim = tower_with_elevator();
    let id = shaft(&sim).id;
    assert!(sim.tower.set_schedule(id, &json!({ "homeFloors": [5, 1] })));
    sim.tower.set_express_stops(id);
    assert_eq!(homes(&sim), [8, 1], "5 snaps to the nearer end, 8");
    assert!(sim.tower.clear_stops(id));
    assert!(sim.tower.set_schedule(id, &json!({ "homeFloors": [4, 1] })));
    assert!(sim.tower.set_stop(id, 4, false));
    assert_eq!(homes(&sim), [3, 1], "3 and 5 are one away each");
}

#[test]
fn a_shaft_without_a_schedule_writes_and_loads_none() {
    let sim = tower_with_elevator();
    assert!(shaft(&sim).schedule.is_none());
    let save = sim.serialize();
    assert!(save["transports"][0].get("schedule").is_none());
    assert!(!save.to_string().contains("\"schedule\""));
    assert!(shaft(&round_trip(&sim)).schedule.is_none());
}

#[test]
fn a_forged_schedule_on_stairs_is_dropped() {
    let mut sim = tower_with_elevator();
    assert!(sim.tower.place_transport(Kind::Stairs, 16, 1, 2).ok);
    let mut save = sim.serialize();
    let stairs = save["transports"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|t| t["kind"] == "stairs")
        .unwrap();
    stairs["schedule"] = json!({ "waitingCarResponse": 4, "activeCars": { "weekday": [1, 2, 3] } });
    let back = deserialize(&save).unwrap();
    let stairs = back
        .tower
        .transports
        .iter()
        .find(|t| t.kind == Kind::Stairs)
        .unwrap();
    assert!(stairs.schedule.is_none());
}

#[test]
fn a_forged_schedule_is_hardened_at_the_load() {
    let sim = tower_with_elevator();
    let cars = shaft(&sim).cars;
    let mut save = sim.serialize();
    save["transports"][0]["schedule"] = json!({
        "activeCars": { "weekday": [-9, 999, null] },
        "waitingCarResponse": 10_000,
        "standardFloorDeparture": -50,
        "homeFloors": [0, 9999, 4],
    });
    let back = deserialize(&save).unwrap();
    let s = shaft(&back).schedule.clone().unwrap();
    let weekday = s.weekday.unwrap();
    assert_eq!(weekday.len(), SCHEDULE_HOURS);
    assert!(
        weekday.iter().all(|&n| (0..=cars).contains(&n)),
        "{weekday:?}"
    );
    assert!(s.waiting_car_response.unwrap() <= 30.0);
    assert_eq!(s.standard_floor_departure, Some(0.0));
    assert!(s.home_floors.unwrap().iter().all(|f| (1..=TOP).contains(f)));
}

#[test]
fn a_version_6_save_migrates_to_the_current_version_with_no_schedule() {
    let mut legacy = tower_with_elevator().serialize();
    legacy["version"] = json!(6);
    for t in legacy["transports"].as_array_mut().unwrap() {
        t.as_object_mut().unwrap().remove("schedule");
    }
    assert_eq!(migrate_save(&legacy)["version"], PLAIN_SAVE_VERSION);
    let back = deserialize(&legacy).unwrap();
    assert_eq!(back.serialize()["version"], PLAIN_SAVE_VERSION);
    assert!(shaft(&back).schedule.is_none());
}

fn hourly(sim: &Simulation, id: i64) -> (Vec<f64>, Vec<f64>) {
    let r = sim.telemetry.hourly.get(&id).expect("a demand ring");
    (r.weekday.clone(), r.weekend.clone())
}

#[test]
fn each_day_type_samples_into_its_own_ring_both_ways() {
    let mut sim = tower_with_elevator();
    let id = shaft(&sim).id;
    sim.tower.transports[0].car_load = Some(vec![5.0, 5.0]);
    sim.clock.minutes = 8.0 * HOUR; // day 0, a weekday
    sim.sample_elevator_util();
    let (weekday, weekend) = hourly(&sim, id);
    assert!(weekday[8] > 0.0);
    assert_eq!(weekend[8], 0.0);
    sim.tower.transports[0].car_load = Some(vec![1.0, 1.0]);
    sim.clock.minutes = 5.0 * DAY + 8.0 * HOUR; // day 5, Saturday
    sim.sample_elevator_util();
    let (weekday_after, weekend) = hourly(&sim, id);
    assert!(weekend[8] > 0.0);
    assert_eq!(
        weekday_after[8], weekday[8],
        "the weekday ring is untouched"
    );
}

#[test]
fn the_canon_calendar_splits_its_weekend_day_too() {
    let mut sim = Simulation::new(2024, GameMode::Classic, CalendarKind::Canon, false);
    for x in 0..WIDTH {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        assert!(sim.tower.place(Kind::Floor, 2, x).ok);
    }
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorStandard, 0, 1, 2)
            .ok
    );
    let id = shaft(&sim).id;
    sim.tower.transports[0].car_load = Some(vec![4.0, 4.0]);
    sim.clock.minutes = 2.0 * DAY + 9.0 * HOUR; // the canon weekend day
    assert!(sim.clock.is_weekend());
    sim.sample_elevator_util();
    let (weekday, weekend) = hourly(&sim, id);
    assert!(weekend[9] > 0.0);
    assert_eq!(weekday[9], 0.0);
}

/// An occupied office on floor 5 whose staff the cars board.
fn busy_office(sim: &mut Simulation) {
    let id = sim.tower.place(Kind::Office, 5, 2).unit_id.unwrap();
    let u = sim.tower.get_unit_mut(id).unwrap();
    u.state = UnitState::Occupied;
    u.occupants = 8;
}

/// `sim.elevators.update(tower, 1, 3)` with no crowd calls, `steps` times.
fn board(sim: &mut Simulation, steps: usize) {
    let calls = crate::crowd::ElevatorCalls::default();
    let (hour, weekend) = (sim.clock.hour(), sim.clock.is_weekend());
    for _ in 0..steps {
        sim.elevators.accumulate(&sim.tower, 1.0, 3.0);
        sim.elevators
            .move_cars(&mut sim.tower, 1.0, &calls, hour, weekend);
    }
}

fn origin_mass(slot: &indexmap::IndexMap<i64, f64>) -> f64 {
    slot.values().sum()
}

#[test]
fn boardings_fold_into_the_hour_they_happened_in() {
    let mut sim = tower_with_elevator();
    let id = shaft(&sim).id;
    busy_office(&mut sim);
    sim.clock.minutes = 8.0 * HOUR;
    board(&mut sim, 240);
    sim.clock.minutes = 9.0 * HOUR;
    sim.sample_elevator_util();
    let rings = sim.telemetry.origins.get(&id).unwrap();
    let slot = rings.weekday[8].clone();
    assert!(!slot.is_empty(), "filed under the hour that ended");
    assert!(rings.weekday[9].is_empty());
    assert!(rings.weekend[8].is_empty());
    assert!(
        slot.get(&5).copied().unwrap_or(0.0) > 0.0,
        "a non-lobby origin"
    );
    assert!(slot.keys().all(|f| (1..=TOP).contains(f)));
    // The drain cleared the tally: re-sampling the 08:00 slot only decays it.
    let mass = origin_mass(&slot);
    sim.clock.minutes = 10.0 * HOUR;
    sim.sample_elevator_util();
    sim.clock.minutes = 9.0 * HOUR;
    sim.sample_elevator_util();
    let after = origin_mass(&sim.telemetry.origins.get(&id).unwrap().weekday[8]);
    assert!(after < mass, "{after} against {mass}");
}

#[test]
fn a_midnight_drain_files_under_yesterdays_last_hour_and_day_type() {
    let mut sim = tower_with_elevator();
    let id = shaft(&sim).id;
    busy_office(&mut sim);
    sim.clock.minutes = 6.0 * DAY + 23.0 * HOUR; // Sunday 23:00
    assert!(sim.clock.is_weekend());
    board(&mut sim, 60);
    sim.clock.minutes = 7.0 * DAY; // Monday 00:00
    assert!(!sim.clock.is_weekend());
    sim.sample_elevator_util();
    let rings = sim.telemetry.origins.get(&id).unwrap();
    assert!(!rings.weekend[23].is_empty());
    assert!(rings.weekday[23].is_empty());
    assert!(rings.weekday[0].is_empty());
}
