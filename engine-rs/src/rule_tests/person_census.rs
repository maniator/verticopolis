//! The population census and the meal overlay, from the retired
//! `personCensus.integration.test.ts`: `associated_population` sums the
//! transient out-for-meal overlay over present rooms (hotel origins left
//! out on request), population and the rating census stay on the room
//! census, a bulldozed origin leaves no ghost, shops, fast food and
//! restaurants count yesterday's visitors (live customers never), a forged
//! or saved tally loads at zero, and the save stamps version 7.
//!
//! Also covered: a party hall's and theatre's set audience is
//! `economy::upkeep_audience_tests::{an_open_hall_and_theatre_count_their_audience_after_their_first_night,
//! an_open_theatre_adds_its_audience_to_the_population}`, and the census
//! share against the population is
//! `view::marks_tests::the_census_share_sums_to_the_population`.
//! `Crowd.mealAssociatedPopulation` is n/a in Rust: there is no crowd-side
//! copy, the one read is `Tower::associated_population`.
use serde_json::Value;

use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::load::deserialize;
use crate::sim::{Simulation, PLAIN_SAVE_VERSION};
use crate::tower::UnitState;

use super::{at_time, place_seated, shaft, strip_tower};

/// A Modern strip to floor 5, one elevator, a staffed office (6) on floor 2
/// and a fast food on floor 5.
fn office_and_fast_food() -> (Simulation, i64, i64) {
    let mut sim = strip_tower(2024, GameMode::Modern, 40, 5);
    shaft(&mut sim, Kind::ElevatorStandard, 4, 1, 5);
    let office = place_seated(&mut sim, Kind::Office, 2, 10, UnitState::Occupied, 6);
    let food = place_seated(&mut sim, Kind::FastFood, 5, 0, UnitState::Occupied, 6);
    (sim, office, food)
}

/// An asleep (present) hotel single with one guest on floor 4.
fn add_hotel(sim: &mut Simulation) -> i64 {
    place_seated(sim, Kind::HotelSingle, 4, 0, UnitState::Asleep, 1)
}

fn set_out(sim: &mut Simulation, id: i64, out: i64) {
    sim.tower.get_unit_mut(id).unwrap().out_for_meal = Some(out);
}

fn set_visitors(sim: &mut Simulation, id: i64, n: u8) {
    sim.tower.get_unit_mut(id).unwrap().visitors_yest = Some(n);
}

fn set_customers(sim: &mut Simulation, id: i64, n: i64) {
    sim.tower.get_unit_mut(id).unwrap().customers_in = Some(n);
}

#[test]
fn the_meal_overlay_sums_over_present_rooms() {
    let (mut sim, office, _) = office_and_fast_food();
    assert_eq!(sim.tower.associated_population(false), 0);
    set_out(&mut sim, office, 2);
    assert_eq!(sim.tower.associated_population(false), 2);
    let hotel = add_hotel(&mut sim);
    set_out(&mut sim, hotel, 3);
    assert_eq!(sim.tower.associated_population(false), 5);
    assert_eq!(
        sim.tower.associated_population(true),
        2,
        "hotel origins left out"
    );
    sim.tower.get_unit_mut(office).unwrap().state = UnitState::Construction;
    assert_eq!(
        sim.tower.associated_population(true),
        0,
        "a room not present adds nothing"
    );
}

#[test]
fn diners_out_add_nothing_to_the_population_or_the_rating_census() {
    let (mut sim, office, _) = office_and_fast_food();
    let hotel = add_hotel(&mut sim);
    let base = sim.tower.total_population();
    sim.star = 4;
    let rating = sim.rating_population();
    set_out(&mut sim, office, 2);
    set_out(&mut sim, hotel, 3);
    assert_eq!(sim.population(), base);
    assert_eq!(sim.tower.get_unit(office).unwrap().occupants, 6);
    assert_eq!(
        sim.rating_population(),
        rating,
        "4 stars: hotel guests excluded"
    );
    assert!(
        sim.population() > rating,
        "the hotel guest counts on the HUD only"
    );
    sim.star = 1;
    assert_eq!(sim.rating_population(), sim.population(), "below 4 stars");
}

fn first_origin(sim: &mut Simulation, minutes: usize) -> i64 {
    for _ in 0..minutes {
        sim.tick(1.0);
        if let Some(id) = sim.crowd.people.iter().find_map(|p| p.origin_unit_id) {
            return id;
        }
    }
    panic!("no round-tripper left a room in {minutes} minutes");
}

#[test]
fn a_bulldozed_origin_leaves_no_ghost_in_the_census() {
    let (mut sim, _, _) = office_and_fast_food();
    at_time(&mut sim, 0, 12);
    let origin = first_origin(&mut sim, 30);
    assert!(sim.tower.remove_unit(origin).is_some());
    for _ in 0..180 {
        sim.tick(1.0);
    }
    assert_eq!(sim.tower.associated_population(false), 0);
    assert_eq!(sim.population(), sim.tower.total_population());
}

#[test]
fn the_lunch_rush_moves_the_overlay_and_never_the_population() {
    let (mut sim, _, food) = office_and_fast_food();
    at_time(&mut sim, 0, 11);
    let base = sim.tower.total_population();
    let (mut overlay, mut eating) = (false, false);
    for _ in 0..180 {
        sim.tick(1.0);
        overlay |= sim.tower.associated_population(false) > 0;
        eating |= sim.tower.get_unit(food).unwrap().customers_in.unwrap_or(0) > 0;
        assert_eq!(sim.population(), base, "live eaters are not the census");
    }
    assert!(overlay && eating);
    // The one elevator is crowded at lunch, so the last eater gets home some
    // time in the next few hours; until then the overlay counts them.
    for _ in 0..240 {
        if sim.tower.associated_population(false) == 0 {
            break;
        }
        sim.tick(1.0);
        assert_eq!(sim.population(), base, "live eaters are not the census");
    }
    assert_eq!(sim.tower.associated_population(false), 0);
    assert_eq!(sim.population(), base);
}

#[test]
fn a_shop_fast_food_or_restaurant_counts_yesterdays_visitors() {
    let (mut sim, _, food) = office_and_fast_food();
    sim.tower.get_unit_mut(food).unwrap().customers_in = None;
    assert_eq!(sim.tower.total_population(), 6, "the office alone");
    set_visitors(&mut sim, food, 5);
    assert_eq!(sim.tower.total_population(), 11);
    set_customers(&mut sim, food, 9);
    assert_eq!(
        sim.tower.total_population(),
        11,
        "live eaters are not the census"
    );
    set_visitors(&mut sim, food, 10);
    for star in 1..=5 {
        sim.star = star;
        assert_eq!(sim.rating_population(), 16, "star {star}");
    }
    sim.tower.get_unit_mut(food).unwrap().state = UnitState::Empty;
    assert_eq!(
        sim.tower.total_population(),
        6,
        "a vacant venue adds nothing"
    );

    for mode in [GameMode::Classic, GameMode::Modern] {
        let mut sim = strip_tower(2024, mode, 40, 3);
        let rest = place_seated(&mut sim, Kind::Restaurant, 2, 0, UnitState::Occupied, 0);
        let shop = place_seated(&mut sim, Kind::Shop, 3, 0, UnitState::Occupied, 0);
        set_visitors(&mut sim, rest, 12);
        set_visitors(&mut sim, shop, 8);
        assert_eq!(sim.tower.total_population(), 20, "{mode:?}");
    }
}

#[test]
fn a_cinema_counts_its_set_audience_and_never_its_live_house() {
    let mut sim = strip_tower(2024, GameMode::Modern, 40, 4);
    let cinema = place_seated(&mut sim, Kind::Cinema, 2, 0, UnitState::Occupied, 0);
    set_customers(&mut sim, cinema, 10);
    assert_eq!(sim.tower.total_population(), 0);
    set_visitors(&mut sim, cinema, 80);
    assert_eq!(sim.tower.total_population(), 80);
}

fn unit_mut<'a>(save: &'a mut Value, kind: &str) -> &'a mut Value {
    save["units"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|u| u["kind"] == kind)
        .unwrap()
}

#[test]
fn a_load_starts_every_crowd_tally_at_zero_and_stamps_version_7() {
    let (mut sim, office, food) = office_and_fast_food();
    set_customers(&mut sim, food, 7);
    set_out(&mut sim, office, 3);
    let save = sim.serialize();
    assert_eq!(PLAIN_SAVE_VERSION, 7);
    assert_eq!(save["version"], PLAIN_SAVE_VERSION);
    let back = deserialize(&save).unwrap();
    assert_eq!(back.tower.get_unit(food).unwrap().customers_in, None);
    assert_eq!(back.tower.associated_population(false), 0);

    let mut forged = sim.serialize();
    unit_mut(&mut forged, "fastFood")["customersIn"] = 9999.into();
    unit_mut(&mut forged, "office")["outForMeal"] = (-50).into();
    forged["version"] = 3.into();
    let back = deserialize(&forged).unwrap();
    assert_eq!(back.tower.get_unit(food).unwrap().customers_in, None);
    assert_eq!(back.tower.get_unit(office).unwrap().out_for_meal, None);
    assert_eq!(back.tower.total_population(), 6, "the office alone");
    assert_eq!(
        back.serialize()["version"],
        PLAIN_SAVE_VERSION,
        "a v3 save loads current"
    );
}

#[test]
fn hotel_eaters_subtract_nothing_from_a_venues_daily_visitors() {
    let (mut sim, _, food) = office_and_fast_food();
    set_visitors(&mut sim, food, 10);
    set_customers(&mut sim, food, 10);
    sim.tower.get_unit_mut(food).unwrap().hotel_customers_in = Some(4);
    for star in [3, 4] {
        sim.star = star;
        assert_eq!(sim.rating_population(), 16, "star {star}");
    }
    let cinema = place_seated(&mut sim, Kind::Cinema, 3, 0, UnitState::Occupied, 0);
    let base = sim.rating_population();
    set_customers(&mut sim, cinema, 50);
    sim.tower.get_unit_mut(cinema).unwrap().hotel_customers_in = Some(50);
    assert_eq!(
        sim.rating_population(),
        base,
        "a cinema's forged counters subtract nothing"
    );
}

#[test]
fn a_breakfast_hotel_guest_is_counted_at_the_venue_and_flagged() {
    let mut sim = strip_tower(2024, GameMode::Modern, 40, 3);
    shaft(&mut sim, Kind::ElevatorStandard, 4, 1, 3);
    place_seated(&mut sim, Kind::HotelDouble, 2, 10, UnitState::Asleep, 2);
    let food = place_seated(&mut sim, Kind::FastFood, 3, 0, UnitState::Occupied, 0);
    at_time(&mut sim, 0, 7);
    let tallies = |sim: &Simulation| {
        let u = sim.tower.get_unit(food).unwrap();
        (
            u.customers_in.unwrap_or(0),
            u.hotel_customers_in.unwrap_or(0),
        )
    };
    let mut saw_guest = false;
    for _ in 0..120 {
        sim.tick(1.0);
        let (all, hotel) = tallies(&sim);
        if hotel > 0 {
            saw_guest = true;
            assert!(hotel <= all, "{hotel} hotel eaters of {all}");
            break;
        }
    }
    assert!(saw_guest);
    for _ in 0..240 {
        sim.tick(1.0);
    }
    // The guests have eaten and gone; walk-ins from outside may still be in.
    assert_eq!(tallies(&sim).1, 0);
}
