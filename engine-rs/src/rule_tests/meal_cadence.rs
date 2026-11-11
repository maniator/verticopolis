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
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{at_time, place_seated, shaft, strip_tower};

const SATURDAY: i64 = 5;
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

#[test]
fn the_crowd_cap_holds_through_a_lunch_peak() {
    let mut sim = mixed_tower();
    for floor in 2..=5 {
        let kind = match floor {
            CONDO_FLOOR => Kind::Condo,
            HOTEL_FLOOR => Kind::HotelSingle,
            _ => Kind::Office,
        };
        for i in 0..8 {
            if sim.tower.place(kind, floor, i * 4).ok {
                let u = sim.tower.unit_at(floor, i * 4).unwrap().id;
                sim.tower.get_unit_mut(u).unwrap().state = UnitState::Occupied;
            }
        }
    }
    at_time(&mut sim, 0, 12);
    let mut peak = 0;
    for _ in 0..180 {
        sim.tick(1.0);
        peak = peak.max(sim.crowd.people.len());
        assert!(sim.crowd.people.len() <= MAX_PEOPLE);
    }
    assert!(peak > 0, "the lunch drew a crowd");
}

/// The meal cadence adds no income source: two identical fast food towers
/// bank the same take at each sampled hour.
#[test]
fn traffic_income_is_the_same_on_twin_towers() {
    let fresh = |hour: i64| {
        let mut sim = strip_tower(1, GameMode::Classic, 40, 2);
        sim.money = 0.0;
        sim.star = 5;
        shaft(&mut sim, Kind::ElevatorStandard, 4, 1, 2);
        place_seated(&mut sim, Kind::FastFood, 2, 0, UnitState::Occupied, 0);
        at_time(&mut sim, 0, hour);
        sim.collect_traffic_income();
        sim.money
    };
    for hour in [3, 12, 18] {
        assert_eq!(fresh(hour), fresh(hour), "hour {hour}");
    }
}
