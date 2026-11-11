//! Modern's hotel late checkout (#304), from the retired
//! `hotelLateCheckout.integration.test.ts`: Classic checks every guest out
//! at 08:00 and the late checkout does nothing; Modern holds round(0.2 x N)
//! asleep rooms in tower order (no draw), charges each room once across the
//! two checkouts, dirties the held rooms in a 14:00 to 17:00 window without
//! re-running the morning's housekeeping latch, sends their guests to lunch,
//! lifts the midday census by exactly those rooms without moving the star,
//! and a maid turns the late rooms over like any others. The no-maid half
//! stays in `hotelLateCheckoutEngine.integration.test.ts` on the Rust engine,
//! and the nightly price is
//! `catalog::charge_tests::each_rent_cadence_collects_the_quoted_price`.
use std::collections::HashSet;

use crate::clock::GameMode;
use crate::econ::rent_of;
use crate::facilities::Kind;
use crate::rules::HOTEL_DAYTIME_PRESENCE;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{at_time, place_seated, shaft, strip_tower};

const ROOMS: usize = 10;
const HOTEL: Kind = Kind::HotelSingle;
const HOTEL_FLOORS: [i64; 2] = [2, 3];

/// A strip to floor 4, an elevator at x 38, a restaurant on floor 4 and
/// `rooms` asleep hotel singles on floors 2 and 3 from x 10.
fn hotel_tower(mode: GameMode, rooms: usize, seed: u32) -> Simulation {
    let mut sim = strip_tower(seed, mode, 40, 4);
    sim.money = 1_000_000.0;
    sim.star = 3;
    shaft(&mut sim, Kind::ElevatorStandard, 38, 1, 4);
    place_seated(&mut sim, Kind::Restaurant, 4, 0, UnitState::Occupied, 0);
    let width = HOTEL.facility().width;
    let mut placed = 0;
    for floor in HOTEL_FLOORS {
        let mut x = 10;
        while x + width <= 40 && placed < rooms {
            place_seated(&mut sim, HOTEL, floor, x, UnitState::Asleep, 0);
            placed += 1;
            x += width;
        }
    }
    assert_eq!(placed, rooms);
    sim
}

fn rooms_in(sim: &Simulation, state: UnitState) -> Vec<i64> {
    sim.tower
        .units
        .iter()
        .filter(|u| u.kind == HOTEL && u.state == state)
        .map(|u| u.id)
        .collect()
}

fn held(rooms: usize) -> usize {
    (HOTEL_DAYTIME_PRESENCE * rooms as f64).round() as usize
}

#[test]
fn only_modern_holds_hotel_guests_into_the_day() {
    assert_eq!(GameMode::Classic.hotel_daytime_presence(), 0.0);
    let modern = GameMode::Modern.hotel_daytime_presence();
    assert!(modern > 0.0 && modern < 1.0);
}

#[test]
fn classic_checks_every_guest_out_in_the_morning() {
    let mut sim = hotel_tower(GameMode::Classic, ROOMS, 2024);
    sim.hotel_checkout();
    assert!(rooms_in(&sim, UnitState::Asleep).is_empty());
    assert_eq!(rooms_in(&sim, UnitState::Dirty).len(), ROOMS);
    let money = sim.money;
    sim.hotel_late_checkout();
    assert_eq!(
        sim.money, money,
        "the late checkout does nothing in Classic"
    );
}

#[test]
fn modern_holds_a_rounded_fifth_of_the_rooms() {
    for (rooms, kept) in [(1, 0), (2, 0), (5, 1), (ROOMS, 2)] {
        assert_eq!(held(rooms), kept, "the premise for {rooms} rooms");
        let mut sim = hotel_tower(GameMode::Modern, rooms, 2024);
        sim.hotel_checkout();
        assert_eq!(
            rooms_in(&sim, UnitState::Asleep).len(),
            kept,
            "{rooms} rooms"
        );
        assert_eq!(rooms_in(&sim, UnitState::Dirty).len(), rooms - kept);
    }
}

#[test]
fn the_held_rooms_follow_tower_order_whatever_the_seed() {
    let held_ids = |seed| {
        let mut sim = hotel_tower(GameMode::Modern, ROOMS, seed);
        sim.hotel_checkout();
        rooms_in(&sim, UnitState::Asleep)
    };
    assert_eq!(held_ids(1), held_ids(999));
}

#[test]
fn an_empty_hotel_holds_nobody_and_earns_nothing() {
    let mut sim = hotel_tower(GameMode::Modern, ROOMS, 2024);
    for u in sim.tower.units.iter_mut().filter(|u| u.kind == HOTEL) {
        u.state = UnitState::Empty;
    }
    let money = sim.money;
    sim.hotel_checkout();
    sim.hotel_late_checkout();
    assert!(rooms_in(&sim, UnitState::Asleep).is_empty());
    assert_eq!(sim.money, money);
}

#[test]
fn each_room_is_charged_once_across_the_two_checkouts() {
    let mut sim = hotel_tower(GameMode::Modern, ROOMS, 2024);
    let rent = rent_of(HOTEL, None, false);
    let kept = held(ROOMS) as f64;
    let start = sim.money;
    sim.hotel_checkout();
    let morning = sim.money;
    assert_eq!(morning - start, (ROOMS as f64 - kept) * rent);
    sim.hotel_late_checkout();
    assert_eq!(sim.money - morning, kept * rent);
    let settled = sim.money;
    sim.hotel_late_checkout();
    assert_eq!(sim.money, settled, "a second firing charges nothing");
}

/// The late checkout dirties the held rooms without the morning's
/// housekeeping latch: yesterday's shift stays as the morning set it and no
/// morning-dirtied room ages a dirty day.
#[test]
fn the_afternoon_checkout_does_not_rerun_the_morning_housekeeping() {
    let mut sim = hotel_tower(GameMode::Modern, ROOMS, 2024);
    sim.hotel_checkout();
    let latched = sim.housekeeping.yesterday;
    assert!(!rooms_in(&sim, UnitState::Asleep).is_empty());
    sim.hotel_late_checkout();
    assert_eq!(rooms_in(&sim, UnitState::Dirty).len(), ROOMS);
    assert_eq!(sim.housekeeping.yesterday, latched);
    for u in sim.tower.units.iter().filter(|u| u.kind == HOTEL) {
        assert_eq!(
            u.extras().dirty_days,
            None,
            "room {} aged a dirty day",
            u.id
        );
    }
}

/// The hotel-origin trips that start in the first lunch hour after the
/// morning checkout.
fn hotel_lunch_trips(mode: GameMode) -> usize {
    let mut sim = hotel_tower(mode, ROOMS, 2024);
    sim.hotel_checkout();
    at_time(&mut sim, 0, 12);
    sim.update_presence();
    let mut seen: HashSet<i64> = sim.crowd.people.iter().map(|p| p.id).collect();
    let mut trips = 0;
    for _ in 0..60 {
        sim.tick(1.0);
        for p in &sim.crowd.people {
            if seen.insert(p.id) && HOTEL_FLOORS.contains(&p.floors[0]) {
                trips += 1;
            }
        }
    }
    trips
}

#[test]
fn held_guests_go_to_lunch_in_modern_and_classic_has_none() {
    assert!(hotel_lunch_trips(GameMode::Modern) > 0);
    assert_eq!(hotel_lunch_trips(GameMode::Classic), 0);
}

/// Whether the held rooms are still asleep after one tick that lands in
/// `hour` with the hourly pass forced.
fn still_held_after_hour(hour: i64) -> bool {
    let mut sim = hotel_tower(GameMode::Modern, ROOMS, 2024);
    sim.hotel_checkout();
    assert!(!rooms_in(&sim, UnitState::Asleep).is_empty());
    at_time(&mut sim, 0, hour);
    sim.last_hour = -1;
    sim.tick(1.0);
    !rooms_in(&sim, UnitState::Asleep).is_empty()
}

/// A reload or a coarse catch-up that skips 14:00 still checks the held
/// rooms out, anywhere from 14:00 to 16:59.
#[test]
fn the_late_checkout_runs_across_its_afternoon_window() {
    for (hour, held) in [
        (13, true),
        (14, false),
        (15, false),
        (16, false),
        (17, true),
    ] {
        assert_eq!(still_held_after_hour(hour), held, "hour {hour}");
    }
}

#[test]
fn the_midday_lift_is_exactly_the_held_rooms_and_moves_no_star() {
    let midday = |mode| {
        let mut sim = hotel_tower(mode, ROOMS, 2024);
        sim.evaluate_star();
        let star = sim.star;
        sim.hotel_checkout();
        at_time(&mut sim, 0, 12);
        sim.update_presence();
        sim.evaluate_star();
        assert_eq!(sim.star, star, "{mode:?}: the held rooms flip no star");
        (
            sim.population(),
            rooms_in(&sim, UnitState::Asleep).len() as i64,
        )
    };
    let (modern, kept) = midday(GameMode::Modern);
    let (classic, none) = midday(GameMode::Classic);
    assert_eq!((kept, none), (held(ROOMS) as i64, 0));
    assert_eq!(modern - classic, kept * HOTEL.facility().population);
}

#[test]
fn a_maid_turns_a_late_room_over_like_any_other() {
    let mut sim = strip_tower(2024, GameMode::Modern, 40, 2);
    sim.money = 1_000_000.0;
    sim.star = 3;
    shaft(&mut sim, Kind::ElevatorStandard, 38, 1, 2);
    for x in [0, 4, 8, 12] {
        place_seated(&mut sim, HOTEL, 2, x, UnitState::Asleep, 0);
    }
    place_seated(&mut sim, Kind::Housekeeping, 2, 20, UnitState::Occupied, 0);
    sim.hotel_checkout();
    assert_eq!(rooms_in(&sim, UnitState::Asleep).len(), 1, "one late room");
    sim.hotel_late_checkout();
    let dirty = rooms_in(&sim, UnitState::Dirty).len();
    assert_eq!(dirty, 4);
    for hour in 15..19 {
        at_time(&mut sim, 0, hour);
        sim.last_hour = -1;
        sim.tick(60.0);
    }
    assert!(
        rooms_in(&sim, UnitState::Dirty).len() < dirty,
        "the maid cleaned"
    );
}
