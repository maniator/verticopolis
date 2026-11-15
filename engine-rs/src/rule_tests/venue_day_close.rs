//! A shop's and a fast food's day ends at 10:00, when shops open, and a
//! restaurant's at midnight, as in the original (#1500): saves of SimTower
//! taken through a day show a shop's and a fast food's served count change
//! between 10:00 and 11:00 and a restaurant's overnight. A save from before
//! the rule closed every venue at midnight, so it does not close its shops a
//! second time that morning; a `.TDT` saved before 10:00 still has the
//! morning's close to come.
use serde_json::Value;

use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::load::{deserialize, deserialize_tdt};
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{lay_row, put};

/// The day the tests run on, a weekday.
const DAY: i64 = 3;
/// What each venue took on the day it closes, a mark no other path writes.
const TAKINGS: f64 = 17.0;

struct Venues {
    sim: Simulation,
    shop: i64,
    fast_food: i64,
    restaurant: i64,
}

fn venues() -> Venues {
    let mut sim = Simulation::new_game(3, GameMode::Classic);
    sim.money = 1e12;
    lay_row(&mut sim, Kind::Lobby, 1);
    lay_row(&mut sim, Kind::Floor, 2);
    let shop = put(&mut sim, Kind::Shop, 2, 10);
    let fast_food = put(&mut sim, Kind::FastFood, 2, 40);
    let restaurant = put(&mut sim, Kind::Restaurant, 2, 80);
    for id in [shop, fast_food, restaurant] {
        let (u, at) = sim.tower.marked_by_id(id).unwrap();
        u.set_state(at, UnitState::Occupied);
        u.set_visitors_yest(at, Some(10));
        u.extras_mut().patronage_today = Some(TAKINGS);
    }
    Venues {
        sim,
        shop,
        fast_food,
        restaurant,
    }
}

/// Sets the clock to `hour`:00 on `day`, with the loop's hour and day marks
/// on the hour and day before it, as a running game has them.
fn at(sim: &mut Simulation, day: i64, hour: i64) {
    sim.clock.minutes = (day * 1440 + hour * 60) as f64;
    sim.last_hour = hour - 1;
    sim.last_day = day;
}

/// Whether the venue's day has closed: its takings moved to yesterday's.
fn closed(sim: &Simulation, id: i64) -> bool {
    sim.tower.get_unit(id).unwrap().extras().patronage_yest == Some(TAKINGS)
}

#[test]
fn shops_and_fast_food_close_their_day_at_ten_and_restaurants_at_midnight() {
    let Venues {
        mut sim,
        shop,
        fast_food,
        restaurant,
    } = venues();
    sim.morning_venue_day = DAY - 1;
    at(&mut sim, DAY, 9);
    sim.on_hour();
    assert!(
        !closed(&sim, shop) && !closed(&sim, fast_food),
        "not before 10:00"
    );
    at(&mut sim, DAY, 10);
    sim.on_hour();
    assert!(closed(&sim, shop), "the shop closes at 10:00");
    assert!(closed(&sim, fast_food), "so does the fast food");
    assert!(
        !closed(&sim, restaurant),
        "the restaurant waits for midnight"
    );
    assert_eq!(sim.morning_venue_day, DAY);
    // Midnight closes the restaurant and leaves the shops alone.
    sim.tower
        .marked_by_id(shop)
        .unwrap()
        .0
        .extras_mut()
        .patronage_today = Some(3.0);
    at(&mut sim, DAY + 1, 0);
    sim.on_day();
    assert!(
        closed(&sim, restaurant),
        "the restaurant closes at midnight"
    );
    assert!(closed(&sim, shop), "the shop's day did not close again");
}

/// The tower at 05:00 on [`DAY`], its shops' day open since 10:00 the day
/// before, as a save.
fn early_save() -> (Value, Venues) {
    let mut v = venues();
    v.sim.morning_venue_day = DAY - 1;
    at(&mut v.sim, DAY, 5);
    (v.sim.serialize(), v)
}

#[test]
fn a_save_before_ten_closes_the_shops_day_at_ten_after_a_reload() {
    let (save, v) = early_save();
    assert_eq!(save["morningVenueDay"], DAY - 1);
    let mut sim = deserialize(&save).expect("loads");
    at(&mut sim, DAY, 10);
    sim.on_hour();
    assert!(closed(&sim, v.shop));
}

#[test]
fn a_save_from_before_the_rule_does_not_close_the_shops_day_twice() {
    // The old rule closed every venue at midnight and wrote no mark.
    let (mut save, v) = early_save();
    save.as_object_mut().unwrap().remove("morningVenueDay");
    let mut sim = deserialize(&save).expect("loads");
    assert_eq!(sim.morning_venue_day, DAY);
    at(&mut sim, DAY, 10);
    sim.on_hour();
    assert!(!closed(&sim, v.shop), "closed at midnight already");
}

#[test]
fn a_tdt_saved_before_ten_closes_the_shops_day_at_ten() {
    let (mut save, v) = early_save();
    save.as_object_mut().unwrap().remove("morningVenueDay");
    let mut sim = deserialize_tdt(&save).expect("loads");
    at(&mut sim, DAY, 10);
    sim.on_hour();
    assert!(closed(&sim, v.shop));
}

#[test]
fn a_save_after_ten_writes_no_mark() {
    let mut v = venues();
    at(&mut v.sim, DAY, 10);
    v.sim.on_hour();
    assert!(v.sim.serialize().get("morningVenueDay").is_none());
}
