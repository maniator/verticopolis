//! The tower-wide meal cadence, from the retired
//! `mealCadence.integration.test.ts`: the four meal windows and their
//! venues, the condo's 0.3 meal weight, the housekeeping shift gate, and who
//! actually eats when (no meal trips at night, office lunches on weekdays
//! only, condos and hotels on weekends too, housekeepers inside their
//! shift), with the crowd cap holding through a lunch peak.
use std::collections::HashSet;

use crate::clock::{resolve_calendar, CalendarKind, Clock, GameMode};
use crate::crowd::meals::{meal_window_for, staff_on_shift, MealOrigin, MealWindow};
use crate::crowd::MAX_PEOPLE;
use crate::demand::compute_demand_map;
use crate::economy::{
    commercial_daily_income, weekend_multiplier, TRAFFIC_FACTOR_MIN, TRAFFIC_FACTOR_SPAN,
};
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{at_time, place_seated, shaft, strip_tower};

const SATURDAY: i64 = 5;
const CLOSED_HOUR: i64 = 3;
const LUNCH_HOUR: i64 = 12;
const EVENING_HOUR: i64 = 18;
const OFFICE_FLOOR: i64 = 2;
const CONDO_FLOOR: i64 = 3;
const HOTEL_FLOOR: i64 = 4;
const VENUE_FLOOR: i64 = 5;

/// A Modern strip to floor 5 with one elevator, an office, a condo, a hotel
/// room, a fast food and a restaurant, every room occupied with nobody
/// seated yet.
fn mixed_tower() -> Simulation {
    let mut sim = strip_tower(2024, GameMode::Modern, 40, 5);
    shaft(&mut sim, Kind::ElevatorStandard, 4, 1, 5);
    for (kind, floor, x) in [
        (Kind::Office, OFFICE_FLOOR, 10),
        (Kind::Condo, CONDO_FLOOR, 10),
        (Kind::HotelSingle, HOTEL_FLOOR, 10),
        (Kind::FastFood, VENUE_FLOOR, 0),
        (Kind::Restaurant, VENUE_FLOOR, 16),
    ] {
        place_seated(&mut sim, kind, floor, x, UnitState::Occupied, 0);
    }
    sim
}

fn set_office_staff(sim: &mut Simulation, occupants: i64) {
    for u in sim
        .tower
        .units
        .iter_mut()
        .filter(|u| u.kind == Kind::Office)
    {
        u.occupants = occupants;
    }
}

/// The origin floor of each trip that first appears during `minutes` ticks.
fn new_trip_origins(sim: &mut Simulation, minutes: usize) -> Vec<(i64, i64)> {
    let mut seen: HashSet<i64> = sim.crowd.people.iter().map(|p| p.id).collect();
    let mut trips = Vec::new();
    for _ in 0..minutes {
        sim.tick(1.0);
        for p in &sim.crowd.people {
            if seen.insert(p.id) {
                trips.push((p.floors[0], *p.floors.last().unwrap()));
            }
        }
    }
    trips
}

#[test]
fn each_hour_falls_in_its_meal_window() {
    for hour in 0..24 {
        let want = match hour {
            6..=8 => Some(MealWindow::Breakfast),
            11..=13 => Some(MealWindow::Lunch),
            17..=19 => Some(MealWindow::Dinner),
            21..=23 => Some(MealWindow::LateNight),
            _ => None,
        };
        assert_eq!(meal_window_for(hour), want, "hour {hour}");
        let calendar = resolve_calendar(GameMode::Modern, CalendarKind::RealWorld);
        let clock = Clock::new((hour * 60) as f64, calendar);
        assert_eq!(
            want == Some(MealWindow::Lunch),
            clock.is_lunch(),
            "the lunch window is the clock's lunch at {hour}"
        );
    }
}

#[test]
fn the_windows_name_their_venues_and_the_condo_eats_at_three_tenths() {
    let fast_food_only: &[Kind] = &[Kind::FastFood];
    let sit_down: &[Kind] = &[Kind::FastFood, Kind::Restaurant, Kind::FoodHall];
    let late: &[Kind] = &[Kind::FastFood, Kind::Cinema];
    for (window, bounds, venues) in [
        (MealWindow::Breakfast, (6, 9), fast_food_only),
        (MealWindow::Lunch, (11, 14), sit_down),
        (MealWindow::Dinner, (17, 20), sit_down),
        (MealWindow::LateNight, (21, 24), late),
    ] {
        assert_eq!((window.bounds(), window.venues()), (bounds, venues));
    }
    assert_eq!(MealOrigin::Condo.weight(), 0.3);
    for full in [MealOrigin::Office, MealOrigin::Hotel, MealOrigin::Staff] {
        assert_eq!(full.weight(), 1.0, "{full:?}");
    }
}

#[test]
fn housekeepers_eat_only_on_shift_and_other_staff_always() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let shift = mode.housekeeping_shift();
        for hour in 0..24 {
            let on = hour >= shift.start && hour < shift.end;
            assert_eq!(
                staff_on_shift(Kind::Housekeeping, hour, shift),
                on,
                "{mode:?} {hour}"
            );
            for kind in [Kind::Security, Kind::Medical, Kind::Recycling] {
                assert!(staff_on_shift(kind, hour, shift), "{kind:?} at {hour}");
            }
        }
    }
}

#[test]
fn the_dead_of_night_draws_no_meal_trips() {
    let mut sim = mixed_tower();
    at_time(&mut sim, 0, 3);
    assert!(new_trip_origins(&mut sim, 60).is_empty());
}

#[test]
fn a_staffed_weekday_office_goes_out_to_lunch() {
    let mut sim = mixed_tower();
    set_office_staff(&mut sim, 6);
    at_time(&mut sim, 0, 12);
    let trips = new_trip_origins(&mut sim, 60);
    let staffed = sim
        .tower
        .units
        .iter()
        .any(|u| u.kind == Kind::Office && u.occupants > 0);
    assert!(staffed, "the office is still staffed");
    assert!(trips.contains(&(OFFICE_FLOOR, VENUE_FLOOR)), "{trips:?}");
}

#[test]
fn a_weekend_lunch_draws_nobody_from_the_unstaffed_office() {
    let mut sim = mixed_tower();
    at_time(&mut sim, SATURDAY, 12);
    let trips = new_trip_origins(&mut sim, 60);
    assert!(
        trips.iter().all(|&(from, _)| from != OFFICE_FLOOR),
        "{trips:?}"
    );
    let staffed = sim
        .tower
        .units
        .iter()
        .any(|u| u.kind == Kind::Office && u.occupants > 0);
    assert!(!staffed, "presence leaves weekend offices empty");
}

#[test]
fn condos_and_hotels_still_eat_on_a_weekend() {
    let mut sim = mixed_tower();
    let hotel = sim
        .tower
        .units
        .iter_mut()
        .find(|u| u.kind == Kind::HotelSingle)
        .unwrap();
    hotel.state = UnitState::Asleep;
    at_time(&mut sim, SATURDAY, 21);
    let trips = new_trip_origins(&mut sim, 60);
    let homes = trips
        .iter()
        .filter(|&&(from, _)| from == CONDO_FLOOR || from == HOTEL_FLOOR)
        .count();
    assert!(homes > 0, "{trips:?}");
}

/// A housekeeping room and a fast food, nothing else that eats.
fn housekeeping_origins(hour: i64) -> usize {
    let mut sim = strip_tower(2024, GameMode::Modern, 40, 5);
    shaft(&mut sim, Kind::ElevatorStandard, 4, 1, 5);
    place_seated(
        &mut sim,
        Kind::Housekeeping,
        OFFICE_FLOOR,
        10,
        UnitState::Occupied,
        6,
    );
    place_seated(
        &mut sim,
        Kind::FastFood,
        VENUE_FLOOR,
        0,
        UnitState::Occupied,
        6,
    );
    at_time(&mut sim, 0, hour);
    let trips = new_trip_origins(&mut sim, 60);
    trips
        .iter()
        .filter(|&&(from, _)| from == OFFICE_FLOOR)
        .count()
}

#[test]
fn housekeepers_go_out_for_a_meal_inside_their_shift_only() {
    assert!(housekeeping_origins(12) > 0, "on shift at noon");
    assert_eq!(housekeeping_origins(21), 0, "off shift at 21:00");
}

/// Offices per floor in the lunch-peak tower: a wide strip filled from
/// `LUNCH_FIRST_X` at the office width, with no overlap.
const LUNCH_OFFICES_PER_FLOOR: i64 = 11;
const LUNCH_FIRST_X: i64 = 10;
const LUNCH_STRIP_WIDTH: i64 = 120;
const OFFICE_WIDTH: i64 = 9;
const OFFICE_STAFF: i64 = 6;
/// The lunch-peak tower's food floor: high enough that the offices under it
/// send more diners than the crowd holds (the tower's other trips no longer
/// top the crowd up).
const LUNCH_VENUE_FLOOR: i64 = 12;

#[test]
fn the_crowd_cap_holds_through_a_lunch_peak() {
    let mut sim = strip_tower(2024, GameMode::Modern, LUNCH_STRIP_WIDTH, LUNCH_VENUE_FLOOR);
    shaft(&mut sim, Kind::ElevatorStandard, 4, 1, LUNCH_VENUE_FLOOR);
    place_seated(
        &mut sim,
        Kind::FastFood,
        LUNCH_VENUE_FLOOR,
        LUNCH_FIRST_X,
        UnitState::Occupied,
        0,
    );
    place_seated(
        &mut sim,
        Kind::Restaurant,
        LUNCH_VENUE_FLOOR,
        LUNCH_FIRST_X + 30,
        UnitState::Occupied,
        0,
    );
    for floor in OFFICE_FLOOR..LUNCH_VENUE_FLOOR {
        for i in 0..LUNCH_OFFICES_PER_FLOOR {
            let x = LUNCH_FIRST_X + i * OFFICE_WIDTH;
            place_seated(
                &mut sim,
                Kind::Office,
                floor,
                x,
                UnitState::Occupied,
                OFFICE_STAFF,
            );
        }
    }
    let offices = sim
        .tower
        .units
        .iter()
        .filter(|u| u.kind == Kind::Office)
        .count() as i64;
    assert_eq!(
        offices,
        LUNCH_OFFICES_PER_FLOOR * (LUNCH_VENUE_FLOOR - OFFICE_FLOOR)
    );
    assert!(
        (offices * OFFICE_STAFF) as usize > MAX_PEOPLE,
        "the staff outnumber the cap, so lunch can press against it"
    );
    at_time(&mut sim, 0, 12);
    // Walk-ins from outside and venue staff on their way are counted apart
    // from the sample.
    let sample = |sim: &Simulation| {
        sim.crowd
            .people
            .iter()
            .filter(|p| !p.walk_in && !p.commuter)
            .count()
    };
    let mut peak = 0;
    for _ in 0..180 {
        sim.tick(1.0);
        peak = peak.max(sample(&sim));
        assert!(sample(&sim) <= MAX_PEOPLE);
    }
    assert_eq!(peak, MAX_PEOPLE, "the lunch filled the crowd to its cap");
}

/// A fast food beside two staffed offices (so it has demand to draw on), at
/// `hour` of the first day.
fn fast_food_tower(hour: i64) -> (Simulation, i64) {
    let mut sim = strip_tower(1, GameMode::Classic, 40, 2);
    sim.money = 0.0;
    sim.star = 5;
    shaft(&mut sim, Kind::ElevatorStandard, 4, 1, 2);
    let id = place_seated(&mut sim, Kind::FastFood, 2, 0, UnitState::Occupied, 0);
    for x in [20, 29] {
        place_seated(
            &mut sim,
            Kind::Office,
            2,
            x,
            UnitState::Occupied,
            OFFICE_STAFF,
        );
    }
    at_time(&mut sim, 0, hour);
    (sim, id)
}

/// What the hour earned: the cash plus what the shop banked toward its
/// next payout.
fn fast_food_hour(hour: i64) -> f64 {
    let (mut sim, id) = fast_food_tower(hour);
    sim.collect_traffic_income();
    sim.money + sim.tower.get_unit(id).unwrap().pending_income
}

/// The hour's share worked out independently on a twin tower: the daily take
/// over the open hours, times the shop's demand fraction, the weekday factor
/// and the traffic roll the routine will draw next.
fn expected_hour(hour: i64) -> f64 {
    let (mut twin, id) = fast_food_tower(hour);
    let daily =
        commercial_daily_income(GameMode::Classic, Kind::FastFood).expect("fast food earns");
    let open_hours = Kind::FastFood.open_hours_per_day() as f64;
    let frac = compute_demand_map(&mut twin).fraction_by_unit[&id];
    let weekday = weekend_multiplier(GameMode::Classic, Kind::FastFood, twin.clock.is_weekend());
    let roll = TRAFFIC_FACTOR_MIN + twin.rng.clone().next() * TRAFFIC_FACTOR_SPAN;
    daily / open_hours * frac * weekday * roll
}

/// The meal cadence adds no income source: an open hour earns exactly the
/// shop's share of its daily take, and a closed one earns nothing.
#[test]
fn traffic_income_is_the_shops_hourly_share_and_nothing_more() {
    assert_eq!(
        fast_food_hour(CLOSED_HOUR),
        0.0,
        "a closed shop earns nothing"
    );
    for hour in [LUNCH_HOUR, EVENING_HOUR] {
        let earned = fast_food_hour(hour);
        let expected = expected_hour(hour);
        assert!(expected > 0.0, "hour {hour}: the shop has demand");
        assert!(
            (earned - expected).abs() < 1e-9,
            "hour {hour}: earned {earned}, expected {expected}"
        );
    }
}
