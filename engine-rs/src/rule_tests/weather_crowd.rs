//! Rain thins the crowd (#430), from the retired
//! `weatherCrowd.integration.test.ts`: the spawn layer draws fewer people on
//! a rainy day, reading the weather the loop passes rather than the clock's
//! day hash; retail keeps the rain multiplier on its takings (fast food
//! 0.5 x 0.6 with no metro), an attendance venue does not, and a cinema's
//! audience over a rainy afternoon is smaller. That rain lowers commercial
//! income at all is also the Rust-run `faqWeatherEngine.integration.test.ts`.
use crate::clock::{Clock, GameMode};
use crate::crowd::spawn::spawn_step;
use crate::crowd::MAX_PEOPLE;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::sim_loop::{weather_for, Weather};
use crate::tower::UnitState;

use super::{at_time, place_seated, shaft, strip_tower};

/// A clear day by the weather hash, and a rainy one a week later (the same
/// weekday, so only the weather differs).
const CLEAR_DAY: i64 = 3;
const RAIN_DAY: i64 = 10;
const SOURCE_FLOORS: [i64; 4] = [4, 5, 6, 7];
const SPAWN_SECONDS: usize = 90;

/// A Modern strip to floor 7, one elevator, and an occupied office and
/// condo on each of `sources`; floors 2 and 3 stay clear for a cinema.
fn populated_tower(seed: u32, sources: &[i64]) -> Simulation {
    let mut sim = strip_tower(seed, GameMode::Modern, 40, 7);
    sim.star = 5;
    shaft(&mut sim, Kind::ElevatorStandard, 0, 1, 7);
    for &floor in sources {
        let staff = Kind::Office.facility().population;
        place_seated(&mut sim, Kind::Office, floor, 0, UnitState::Occupied, staff);
        let household = Kind::Condo.facility().population;
        place_seated(
            &mut sim,
            Kind::Condo,
            floor,
            12,
            UnitState::Occupied,
            household,
        );
    }
    sim
}

/// The people the spawn layer alone puts on the move in 90 one-second
/// steps at 08:00 on `day`, told the weather is `weather`.
fn spawned_over(day: i64, weather: Weather) -> usize {
    let mut sim = populated_tower(4242, &SOURCE_FLOORS);
    sim.weather = weather;
    let clock = Clock::new(((day * 24 + 8) * 60) as f64, sim.clock.calendar);
    for _ in 0..SPAWN_SECONDS {
        let population = sim.tower.total_population();
        spawn_step(
            &mut sim.crowd,
            1.0,
            &mut sim.tower,
            &clock,
            Some(sim.weather),
            population,
        );
    }
    sim.crowd.people.len()
}

#[test]
fn a_rainy_day_draws_fewer_people_than_a_clear_one() {
    assert_eq!(weather_for(CLEAR_DAY), Weather::Clear);
    assert_eq!(weather_for(RAIN_DAY), Weather::Rain);
    let clear = spawned_over(CLEAR_DAY, weather_for(CLEAR_DAY));
    let rain = spawned_over(RAIN_DAY, weather_for(RAIN_DAY));
    assert!(
        clear > 20 && clear < MAX_PEOPLE,
        "a sample the cap does not clip: {clear}"
    );
    assert!(rain < clear, "{rain} in the rain against {clear}");
    assert!(
        rain as f64 > clear as f64 * 0.4,
        "thinned, not wiped out: {rain}"
    );
}

#[test]
fn the_crowd_thins_on_the_weather_it_is_passed() {
    let clear = spawned_over(CLEAR_DAY, Weather::Clear);
    let rain = spawned_over(CLEAR_DAY, Weather::Rain);
    assert!(clear > 20);
    assert!(
        rain < clear,
        "{rain} told rain on a clear-hash day against {clear}"
    );
}

/// One noon hour of `kind`'s takings on a Modern lot, to the fraction.
fn venue_hour_income(kind: Kind, weather: Weather, customers: Option<i64>) -> f64 {
    let mut sim = strip_tower(1, GameMode::Modern, 40, 3);
    sim.star = 5;
    sim.money = 0.0;
    shaft(&mut sim, Kind::ElevatorStandard, 0, 1, 3);
    let venue = place_seated(&mut sim, kind, 2, 5, UnitState::Occupied, 0);
    sim.tower.get_unit_mut(venue).unwrap().customers_in = customers;
    at_time(&mut sim, 0, 12);
    sim.weather = weather;
    sim.collect_traffic_income();
    sim.money + sim.tower.get_unit(venue).unwrap().pending_income
}

#[test]
fn retail_still_pays_the_rain_multiplier() {
    let clear = venue_hour_income(Kind::FastFood, Weather::Clear, None);
    let rain = venue_hour_income(Kind::FastFood, Weather::Rain, None);
    assert!(clear > 0.0);
    let expected = clear * 0.5 * 0.6;
    assert!((rain - expected).abs() < 1e-6, "{rain} against {expected}");
}

#[test]
fn an_attendance_venue_earns_the_same_in_the_rain_at_the_same_fill() {
    let full = Kind::Cinema.attendance_cap();
    let clear = venue_hour_income(Kind::Cinema, Weather::Clear, full);
    let rain = venue_hour_income(Kind::Cinema, Weather::Rain, full);
    assert!(clear > 0.0);
    assert_eq!(rain, clear);
}

/// The cinema's place_seated-minutes over four afternoon hours on `day`, drawn from
/// one office and condo, so the house does not sit at its cap.
fn cinema_seat_minutes(day: i64) -> i64 {
    let mut sim = populated_tower(909, &[4]);
    let cinema = place_seated(&mut sim, Kind::Cinema, 2, 4, UnitState::Occupied, 0);
    at_time(&mut sim, day, 12);
    sim.weather = weather_for(day);
    let mut seat_minutes = 0;
    for _ in 0..4 * 60 {
        sim.tick(1.0);
        seat_minutes += sim
            .tower
            .get_unit(cinema)
            .unwrap()
            .customers_in
            .unwrap_or(0);
    }
    seat_minutes
}

#[test]
fn a_rainy_afternoon_fills_the_cinema_less() {
    let clear = cinema_seat_minutes(CLEAR_DAY);
    let rain = cinema_seat_minutes(RAIN_DAY);
    assert!(clear > 0);
    assert!(
        rain < clear,
        "{rain} place_seated-minutes in the rain against {clear}"
    );
}
