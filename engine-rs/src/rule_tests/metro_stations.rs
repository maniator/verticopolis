//! Several metro stations in Modern. SimTower allowed one station, and
//! Classic keeps that. Modern takes up to `MODERN_METRO_STATION_CAP`, all on
//! the first station's row: one line, one tunnel and one platform floor, so
//! the platform's help to nearby shops (`metro_shoppers.rs`) comes from
//! whichever station works and does not reach further with more of them.
//! The station's other help (the business bonus and Modern's parking share)
//! counts once, however many stations stand.
use crate::catalog::catalog;
use crate::clock::{Clock, GameMode};
use crate::crowd::spawn::metro_station_for_platform;
use crate::demand::compute_demand_map;
use crate::facilities::{Kind, MIN_FLOOR, MODERN_METRO_STATION_CAP};
use crate::gameplay::RemovalMethod;
use crate::sim::Simulation;
use crate::sim_loop::Weather;
use crate::tower::UnitState;

use super::stocked_services::lay_basement;
use super::{lay_row, put, MID};

/// SimTower's B10, the tunnel row; the platform is the story above.
const STATION: i64 = MIN_FLOOR;
const PLATFORM: i64 = STATION + 1;

/// The tile columns three stations take, 30 tiles each, apart.
const WEST: i64 = 0;
const MIDDLE: i64 = MID - 15;
const EAST: i64 = 300;

/// A tower with a ground lobby, a basement down to the station's row and,
/// with `first_station`, a station at the west end.
fn basement_tower(mode: GameMode, first_station: bool) -> Simulation {
    let mut sim = Simulation::new_game(1, mode);
    sim.money = 1e12;
    sim.star = 5;
    lay_row(&mut sim, Kind::Lobby, 1);
    lay_basement(&mut sim, STATION);
    if first_station {
        put(&mut sim, Kind::Metro, STATION, WEST);
    }
    sim
}

fn refusal(sim: &mut Simulation, floor: i64, x: i64) -> String {
    let r = sim.tower.place(Kind::Metro, floor, x);
    assert!(!r.ok, "a station at {floor}/{x} was built");
    r.reason.unwrap()
}

#[test]
fn classic_keeps_one_station_and_modern_takes_three() {
    let mut classic = basement_tower(GameMode::Classic, true);
    assert_eq!(
        refusal(&mut classic, STATION, EAST),
        "Only 1 Metro Station allowed per tower."
    );

    let mut modern = basement_tower(GameMode::Modern, true);
    put(&mut modern, Kind::Metro, STATION, MIDDLE);
    put(&mut modern, Kind::Metro, STATION, EAST);
    assert_eq!(modern.tower.count_kind(Kind::Metro), 3);
    assert_eq!(
        refusal(&mut modern, STATION, EAST + 35),
        "Only 3 Metro Stations allowed per tower."
    );
}

#[test]
fn the_catalog_publishes_each_modes_station_cap() {
    let cap = |mode| {
        catalog(mode)
            .facilities
            .iter()
            .find(|f| f.key == "metro")
            .unwrap()
            .build_cap
    };
    assert_eq!(cap(GameMode::Classic), Some(1));
    assert_eq!(cap(GameMode::Modern), Some(MODERN_METRO_STATION_CAP));
    assert_eq!(MODERN_METRO_STATION_CAP, 3);
}

#[test]
fn every_station_stands_on_the_first_stations_row() {
    let mut sim = basement_tower(GameMode::Modern, false);
    // The basement stops at B9, so the first station stands a row higher.
    for x in 0..crate::facilities::LOT_WIDTH {
        let id = sim.tower.unit_at(STATION, x).unwrap().id;
        assert!(sim.tower.remove_unit(id).is_some());
    }
    put(&mut sim, Kind::Metro, STATION + 1, WEST);
    assert_eq!(
        refusal(&mut sim, STATION + 2, EAST),
        "Every metro station runs on the same line. Build it on the first station's row."
    );
    assert!(
        !sim.tower.place(Kind::Metro, STATION, EAST).ok,
        "nor below it"
    );
    put(&mut sim, Kind::Metro, STATION + 1, EAST);
}

#[test]
fn a_second_station_goes_beside_the_first_but_a_shop_still_does_not() {
    let mut sim = basement_tower(GameMode::Modern, true);
    let shop = sim.tower.place(Kind::Shop, STATION, MIDDLE);
    assert!(!shop.ok);
    assert_eq!(
        shop.reason.as_deref(),
        Some("The metro's bottom row is its tunnel.")
    );
    put(&mut sim, Kind::Metro, STATION, MIDDLE);
    // Touching stations are fine: they read as one long platform.
    put(&mut sim, Kind::Metro, STATION, MIDDLE + 30);
}

#[test]
fn any_station_that_works_lets_shoppers_off_on_the_one_platform() {
    let mut sim = basement_tower(GameMode::Modern, true);
    let east = put(&mut sim, Kind::Metro, STATION, EAST);
    assert_eq!(sim.shopper_metro_platform(), Some(PLATFORM));
    let west = sim.tower.unit_at(STATION, WEST).unwrap().id;
    assert!(sim.remove_facility(west, RemovalMethod::Sell).ok);
    assert_eq!(
        sim.shopper_metro_platform(),
        Some(PLATFORM),
        "the east station still serves the platform"
    );
    let shop = put(&mut sim, Kind::Shop, PLATFORM + 2, 100);
    assert_eq!(
        sim.shopper_arrival_distance(PLATFORM + 2, sim.shopper_metro_platform()),
        2
    );
    assert!(sim.remove_facility(east, RemovalMethod::Sell).ok);
    assert_eq!(sim.shopper_metro_platform(), None);
    assert!(sim.tower.get_unit(shop).is_some());
}

#[test]
fn a_classic_station_still_needs_its_platform_served() {
    let mut sim = basement_tower(GameMode::Classic, true);
    assert_eq!(sim.shopper_metro_platform(), None);
    assert!(
        sim.build_transport(Kind::ElevatorStandard, MID, PLATFORM, 1)
            .ok
    );
    assert_eq!(sim.shopper_metro_platform(), Some(PLATFORM));
}

#[test]
fn more_stations_do_not_stack_the_business_bonus_or_the_parking_share() {
    let read = |stations: &[i64]| {
        let mut sim = basement_tower(GameMode::Modern, false);
        for &x in stations {
            put(&mut sim, Kind::Metro, STATION, x);
        }
        lay_row(&mut sim, Kind::Floor, 2);
        assert!(
            sim.build_transport(Kind::ElevatorStandard, MID, PLATFORM, 2)
                .ok
        );
        for x in [10, 30, 50] {
            let id = put(&mut sim, Kind::Office, 2, x);
            sim.tower.get_unit_mut(id).unwrap().state = UnitState::Occupied;
        }
        let shop = put(&mut sim, Kind::Shop, 2, MID + 10);
        sim.tower.get_unit_mut(shop).unwrap().state = UnitState::Occupied;
        sim.weather = Weather::Clear;
        sim.clock = Clock::new(12.0 * 60.0, sim.clock.calendar);
        let frac = compute_demand_map(&mut sim).fraction_by_unit[&shop];
        (frac, sim.parking_demand_share())
    };
    let none = read(&[]);
    let one = read(&[WEST]);
    let three = read(&[WEST, MIDDLE, EAST]);
    assert!(one.0 > none.0, "one station helps business");
    assert!(one.1 < none.1, "one station eases Modern parking");
    assert_eq!(three.0, one.0, "the business bonus counts once");
    assert_eq!(three.1, one.1, "the parking share counts once");
}

#[test]
fn a_rider_walks_to_the_nearest_station_on_the_platform() {
    let mut sim = basement_tower(GameMode::Modern, true);
    let west = sim.tower.unit_at(STATION, WEST).unwrap().id;
    assert_eq!(
        metro_station_for_platform(&sim.tower, PLATFORM, 340.0),
        Some(west)
    );
    let east = put(&mut sim, Kind::Metro, STATION, EAST);
    let middle = put(&mut sim, Kind::Metro, STATION, MIDDLE);
    assert_eq!(
        metro_station_for_platform(&sim.tower, PLATFORM, 5.0),
        Some(west)
    );
    assert_eq!(
        metro_station_for_platform(&sim.tower, PLATFORM, 340.0),
        Some(east)
    );
    assert_eq!(
        metro_station_for_platform(&sim.tower, PLATFORM, MID as f64),
        Some(middle)
    );
    assert_eq!(
        metro_station_for_platform(&sim.tower, PLATFORM - 1, 5.0),
        None
    );
}

#[test]
fn a_sold_station_beside_another_comes_back_on_undo() {
    let mut sim = basement_tower(GameMode::Modern, true);
    sim.treasures_found = 3.0; // so the dig searches for nothing
    let east = put(&mut sim, Kind::Metro, STATION, EAST);
    sim.begin_undo_journal("Edit");
    assert!(sim.remove_facility(east, RemovalMethod::Sell).ok);
    let sale = sim.end_undo_journal().unwrap();
    sim.apply_undo_step(&sale).unwrap();
    assert_eq!(sim.tower.get_unit(east).map(|u| u.x), Some(EAST));
    assert_eq!(sim.tower.count_kind(Kind::Metro), 2);
}
