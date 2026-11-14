//! A meal venue's head count (fast food, restaurant, food hall) mirrors the
//! diners inside it (`customers_in`), as an attendance venue's does. That
//! tally is never saved, so the mirror must not outlive it: a save leaves it
//! out, a load and an undo start it at 0, and the statistical elevator
//! estimate skips it because the diners ride as real people. A closed venue
//! still draws whoever is finishing a meal inside. A retail shop, which no
//! trip reaches yet, keeps its saved head count.
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::load::deserialize;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{at_time, place_seated, shaft, strip_tower};

const FOOD_FLOOR: i64 = 2;
const SHOP_FLOOR: i64 = 3;
const HOTEL_FLOOR: i64 = 4;

/// A Modern strip to floor 5 with an elevator at x 36, an open fast food on
/// floor 2, an open shop drawing its full house on floor 3 and an asleep
/// hotel single on floor 4. Returns the sim, the fast food and the shop.
fn food_tower() -> (Simulation, i64, i64) {
    let mut sim = strip_tower(2024, GameMode::Modern, 40, 5);
    shaft(&mut sim, Kind::ElevatorStandard, 36, 1, 5);
    let food = place_seated(
        &mut sim,
        Kind::FastFood,
        FOOD_FLOOR,
        0,
        UnitState::Occupied,
        0,
    );
    let full = Kind::Shop.facility().population;
    let shop = place_seated(
        &mut sim,
        Kind::Shop,
        SHOP_FLOOR,
        0,
        UnitState::Occupied,
        full,
    );
    let guests = Kind::HotelSingle.facility().population;
    place_seated(
        &mut sim,
        Kind::HotelSingle,
        HOTEL_FLOOR,
        0,
        UnitState::Asleep,
        guests,
    );
    (sim, food, shop)
}

/// Seats `n` diners at `id` the way a counted arrival does.
fn seat(sim: &mut Simulation, id: i64, n: i64) {
    let (u, at) = sim.tower.marked_by_id(id).unwrap();
    u.set_customers_in(at, Some(n));
    u.sync_visitor_occupants(at);
}

fn occupants(sim: &Simulation, id: i64) -> i64 {
    sim.tower.get_unit(id).unwrap().occupants
}

#[test]
fn only_attendance_and_meal_venues_count_their_visitors() {
    for kind in [
        Kind::FastFood,
        Kind::Restaurant,
        Kind::FoodHall,
        Kind::Cinema,
        Kind::PartyHall,
    ] {
        assert!(kind.counts_visitors(), "{kind:?}");
    }
    for kind in [
        Kind::Shop,
        Kind::BoutiqueBay,
        Kind::Office,
        Kind::HotelSingle,
    ] {
        assert!(!kind.counts_visitors(), "{kind:?}");
    }
}

#[test]
fn the_diner_mirror_stays_out_of_the_save_and_loads_at_zero() {
    let (mut sim, food, shop) = food_tower();
    seat(&mut sim, food, 5);
    assert_eq!(occupants(&sim, food), 5);
    let save = sim.serialize();
    let record = |save: &serde_json::Value, id: i64| {
        save["units"]
            .as_array()
            .unwrap()
            .iter()
            .find(|u| u["id"].as_i64() == Some(id))
            .unwrap()
            .clone()
    };
    assert!(
        record(&save, food).get("occupants").is_none(),
        "the save leaves it out"
    );
    let back = deserialize(&save).unwrap();
    let loaded = back.tower.get_unit(food).unwrap();
    assert_eq!((loaded.customers_in, loaded.occupants), (None, 0));
    // The shop's head count is its own rule, so it saves and loads.
    let full = Kind::Shop.facility().population;
    assert_eq!(record(&save, shop)["occupants"].as_i64(), Some(full));
    assert_eq!(back.tower.get_unit(shop).unwrap().occupants, full);
}

#[test]
fn an_older_save_with_a_diner_head_count_loads_it_at_zero() {
    // Saves written before this rule carry a fast food's full head count.
    let (sim, food, _) = food_tower();
    let mut save = sim.serialize();
    let units = save["units"].as_array_mut().unwrap();
    let rec = units
        .iter_mut()
        .find(|u| u["id"].as_i64() == Some(food))
        .unwrap();
    rec["occupants"] = serde_json::json!(Kind::FastFood.facility().population);
    let back = deserialize(&save).unwrap();
    assert_eq!(back.tower.get_unit(food).unwrap().occupants, 0);
}

#[test]
fn an_undone_meal_venue_comes_back_with_nobody_inside() {
    let (mut sim, food, shop) = food_tower();
    seat(&mut sim, food, 5);
    let returned = sim.tower.get_unit(food).unwrap().returning();
    assert_eq!((returned.customers_in, returned.occupants), (None, 0));
    let full = Kind::Shop.facility().population;
    assert_eq!(
        sim.tower.get_unit(shop).unwrap().returning().occupants,
        full
    );
}

#[test]
fn a_closed_meal_venue_draws_the_diners_still_inside() {
    let (mut sim, food, _) = food_tower();
    at_time(&mut sim, 0, 3);
    assert!(!Kind::FastFood.is_open_at(3));
    seat(&mut sim, food, 2);
    sim.update_presence();
    assert_eq!(occupants(&sim, food), 2, "the presence pass keeps them");
    sim.collect_traffic_income();
    assert_eq!(occupants(&sim, food), 2, "the traffic pass keeps them");
    seat(&mut sim, food, 0);
    sim.update_presence();
    assert_eq!(occupants(&sim, food), 0, "and empties when they leave");
}

#[test]
fn seated_diners_add_no_statistical_elevator_demand() {
    let (mut sim, food, _) = food_tower();
    seat(&mut sim, food, Kind::FastFood.facility().population);
    assert!(occupants(&sim, food) > 0);
    sim.elevators.accumulate(&sim.tower, 10.0, 1.45);
    assert_eq!(
        sim.elevators.waiting_at(FOOD_FLOOR),
        0.0,
        "the diners' floor"
    );
    assert!(
        sim.elevators.waiting_at(SHOP_FLOOR) > 0.0,
        "the shop's stand-ins still wait"
    );
    assert!(
        sim.elevators.waiting_at(HOTEL_FLOOR) > 0.0,
        "the hotel guest waits"
    );
}
