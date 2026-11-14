//! Shops and restaurants take real customers from outside the tower
//! (`crowd::walk_ins`): each hour books its share of the day's visitors,
//! each one comes in at the ground lobby (or a Metro platform), rides to the
//! venue, and counts in Today's patronage at the door. The venue draws only
//! who is inside, and the walk-ins never crowd the tenants' sample out.
use crate::clock::GameMode;
use crate::crowd::{PState, MAX_PEOPLE};
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{at_time, place_seated, shaft, strip_tower};

const SHOP_FLOOR: i64 = 4;

/// A Classic strip to floor 4 with an elevator at x 36, a row of staffed
/// offices on floor 2 (the shop's demand) and an open shop on floor 4.
/// Returns the sim and the shop.
fn shop_tower(seed: u32) -> (Simulation, i64) {
    let mut sim = strip_tower(seed, GameMode::Classic, 40, SHOP_FLOOR);
    sim.star = 3;
    shaft(&mut sim, Kind::ElevatorStandard, 36, 1, SHOP_FLOOR);
    let staff = Kind::Office.facility().population;
    for x in [0, 9, 18, 27] {
        place_seated(&mut sim, Kind::Office, 2, x, UnitState::Occupied, staff);
    }
    let shop = place_seated(&mut sim, Kind::Shop, SHOP_FLOOR, 0, UnitState::Occupied, 0);
    (sim, shop)
}

fn shop_customers(sim: &Simulation, shop: i64) -> (i64, i64, f64) {
    let u = sim.tower.get_unit(shop).unwrap();
    (
        u.customers_in.unwrap_or(0),
        u.occupants,
        u.extras().patronage_today.unwrap_or(0.0),
    )
}

#[test]
fn shoppers_walk_in_from_the_lobby_and_count_at_the_door() {
    let (mut sim, shop) = shop_tower(7);
    at_time(&mut sim, 0, 10);
    let mut seen = std::collections::HashSet::new();
    let mut arrived = std::collections::HashSet::new();
    for _ in 0..(3 * 60) {
        sim.tick(1.0);
        for p in sim.crowd.people.iter().filter(|p| p.walk_in) {
            if seen.insert(p.id) {
                assert_eq!(p.floor, 1, "a walk-in first stands in the lobby");
                assert_eq!(p.meal_venue_id, Some(shop));
            }
            if p.state == PState::Dwelling {
                arrived.insert(p.id);
            }
        }
        let (inside, drawn, _) = shop_customers(&sim, shop);
        assert_eq!(drawn, inside, "the shop draws who is inside");
        // Inside means there now: a shopper on the way home is out.
        let browsing = sim
            .crowd
            .people
            .iter()
            .filter(|p| p.state == PState::Dwelling && p.venue_unit_id == Some(shop))
            .count() as i64;
        assert_eq!(inside, browsing, "the shop counts only who is in it");
    }
    assert!(!arrived.is_empty(), "shoppers reached the shop");
    let (_, _, patronage) = shop_customers(&sim, shop);
    assert_eq!(
        patronage,
        arrived.len() as f64,
        "Today's patronage is who came"
    );
}

/// A shop on floor 2 under `office_floors` floors of offices. Returns the
/// day's walk-ins booked for it (10:00 to 20:00, each hour's bookings read
/// on their own) and its demand fraction.
fn day_of_bookings(office_floors: i64) -> (usize, f64) {
    let top = 2 + office_floors;
    let mut sim = strip_tower(11, GameMode::Classic, 40, top);
    shaft(&mut sim, Kind::ElevatorStandard, 36, 1, top);
    let shop = place_seated(&mut sim, Kind::Shop, 2, 0, UnitState::Occupied, 0);
    let staff = Kind::Office.facility().population;
    for floor in 3..=top {
        for x in [0, 9, 18, 27] {
            place_seated(&mut sim, Kind::Office, floor, x, UnitState::Occupied, staff);
        }
    }
    let frac = crate::demand::compute_demand_map(&mut sim).fraction_by_unit[&shop];
    let mut booked = 0;
    for hour in 10..21 {
        at_time(&mut sim, 0, hour);
        sim.crowd.walk_ins.clear();
        sim.collect_traffic_income();
        booked += sim
            .crowd
            .walk_ins
            .iter()
            .filter(|w| w.unit_id == shop)
            .count();
    }
    (booked, frac)
}

#[test]
fn a_day_books_as_many_shoppers_as_demand_sends() {
    let (busy, busy_frac) = day_of_bookings(10);
    let (quiet, quiet_frac) = day_of_bookings(5);
    assert!(busy_frac > quiet_frac && quiet_frac > 0.0);
    // No 1994 cap: the busy shop books far past the original's 25 a day.
    assert!(busy > 100, "{busy} booked");
    // The bookings follow the demand: per unit of it, the two shops book
    // within the hourly traffic draw's spread of each other.
    let (a, b) = (busy as f64 / busy_frac, quiet as f64 / quiet_frac);
    assert!((a / b - 1.0).abs() < 0.2, "{a:.0} against {b:.0}");
}

#[test]
fn walk_ins_leave_room_for_the_tenants_sample() {
    let (mut sim, shop) = shop_tower(3);
    at_time(&mut sim, 0, 12);
    for _ in 0..30 {
        sim.tick(1.0);
    }
    let walk_ins = sim.crowd.people.iter().filter(|p| p.walk_in).count() as i64;
    assert!(walk_ins > 0, "shoppers are on their way to {shop}");
    assert_eq!(sim.crowd.walk_in_count, walk_ins, "the count follows them");
    let sample = sim.crowd.people.len() as i64 - walk_ins;
    assert!(sample <= MAX_PEOPLE as i64);
}

#[test]
fn a_shop_that_closes_takes_no_more_bookings_and_its_shoppers_go_home() {
    let (mut sim, shop) = shop_tower(5);
    at_time(&mut sim, 0, 20);
    for _ in 0..(3 * 60) {
        sim.tick(1.0);
    }
    assert!(!Kind::Shop.is_open_at(sim.clock.hour()));
    assert!(sim.crowd.walk_ins.iter().all(|w| w.unit_id != shop));
    assert!(
        sim.crowd.people.iter().all(|p| !p.walk_in),
        "every shopper has gone home by the lobby"
    );
    assert_eq!(sim.crowd.walk_in_count, 0);
    assert_eq!(shop_customers(&sim, shop).0, 0);
}

#[test]
fn shoppers_split_between_the_lobby_and_a_served_metro_platform() {
    use super::metro_shoppers::{b, metro_tower};
    let mut sim = metro_tower(GameMode::Classic, true);
    for x in [10, 30, 50, 70] {
        let id = super::put(&mut sim, Kind::Office, 2, x);
        sim.tower.get_unit_mut(id).unwrap().state = UnitState::Occupied;
    }
    let shop = super::put(&mut sim, Kind::Shop, b(7), super::MID + 10);
    sim.tower.get_unit_mut(shop).unwrap().state = UnitState::Occupied;
    let (mut by_metro, mut by_lobby) = (0, 0);
    let mut seen = std::collections::HashSet::new();
    for day in 0..3 {
        at_time(&mut sim, day, 10);
        for _ in 0..(11 * 60) {
            sim.tick(1.0);
            for p in sim.crowd.people.iter().filter(|p| p.walk_in) {
                if seen.insert(p.id) {
                    if p.from_metro {
                        by_metro += 1;
                    } else {
                        assert_eq!(p.floor, 1, "the rest come in at the lobby");
                        by_lobby += 1;
                    }
                }
            }
        }
    }
    // The lobby's two elevators carry twice what the platform's one does.
    assert!(
        by_metro > 0 && by_lobby > by_metro,
        "{by_lobby} / {by_metro}"
    );
}
