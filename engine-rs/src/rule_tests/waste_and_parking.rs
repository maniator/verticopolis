//! Waste and parking: recycling capacity grows per center and gates four
//! stars on demand met, the bins fill through the day from the morning
//! truck, parking demand counts offices and one space per suite from
//! parking's unlock star, cars park by day and by night, and recycling
//! lifts commercial income. A burning center processes nothing is also
//! checked by `wasm_port_render_tests::the_fills_and_the_parking_set_read_the_simulation`.
use crate::clock::GameMode;
use crate::demand::RECYCLING_POP_PER_CENTER;
use crate::facilities::{Kind, LOT_WIDTH};
use crate::services::GARBAGE_COLLECT_HOUR;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::MID as C;

const OFFICE_WIDTH: i64 = 9;
const RAMP_WIDTH: i64 = 16;
const SPACE_WIDTH: i64 = 4;

fn lay(sim: &mut Simulation, kind: Kind, floor: i64) {
    for x in (C..LOT_WIDTH).chain((0..C).rev()) {
        sim.tower.place(kind, floor, x);
    }
}

fn must_place(sim: &mut Simulation, kind: Kind, floor: i64, x: i64) -> i64 {
    let placed = sim.tower.place(kind, floor, x);
    assert!(placed.ok, "{kind:?} at {floor}/{x}: {:?}", placed.reason);
    placed.unit_id.unwrap()
}

fn occupy(sim: &mut Simulation, kind: Kind, floor: i64, x: i64, state: UnitState) -> i64 {
    let id = must_place(sim, kind, floor, x);
    sim.tower.get_unit_mut(id).unwrap().state = state;
    id
}

/// `offices` occupied offices and `centers` recycling centers in the basement.
fn office_tower(offices: usize, centers: i64) -> Simulation {
    let mut sim = Simulation::new_game(11, GameMode::Classic);
    sim.money = 1e12;
    lay(&mut sim, Kind::Lobby, 1);
    let mut placed = 0;
    let mut floor = 2;
    while placed < offices {
        lay(&mut sim, Kind::Floor, floor);
        let mut x = 0;
        while x + OFFICE_WIDTH <= LOT_WIDTH && placed < offices {
            occupy(&mut sim, Kind::Office, floor, x, UnitState::Occupied);
            placed += 1;
            x += OFFICE_WIDTH;
        }
        floor += 1;
    }
    lay(&mut sim, Kind::Floor, 0);
    lay(&mut sim, Kind::Floor, -1);
    for i in 0..centers {
        must_place(&mut sim, Kind::Recycling, -1, i * 20);
    }
    sim
}

#[test]
fn capacity_grows_per_center_and_demand_met_flips_at_the_threshold() {
    let mut sim = office_tower(500, 1);
    assert_eq!(sim.tower.total_population(), 3000);
    assert_eq!(sim.recycling_capacity(), RECYCLING_POP_PER_CENTER);
    assert!(!sim.recycling_demand_met());
    must_place(&mut sim, Kind::Recycling, -1, 40);
    assert_eq!(sim.recycling_capacity(), 2.0 * RECYCLING_POP_PER_CENTER);
    assert!(sim.recycling_demand_met());
}

#[test]
fn the_bins_empty_at_the_truck_fill_through_the_day_and_cap_when_over_capacity() {
    let mut sim = office_tower(500, 1);
    sim.clock.minutes = 10.0 * 1440.0 + GARBAGE_COLLECT_HOUR * 60.0;
    assert_eq!(sim.recycling_fill(), 0.0);
    sim.clock.advance(6.0 * 60.0);
    let noon = sim.recycling_fill();
    assert!(noon > 0.2 && noon < 0.5, "{noon}");
    sim.clock.advance(17.0 * 60.0);
    assert_eq!(sim.recycling_fill(), 1.0);

    let mut small = office_tower(100, 1);
    small.clock.minutes = 10.0 * 1440.0 + GARBAGE_COLLECT_HOUR * 60.0 - 1.0;
    assert!(
        small.recycling_fill() < 0.3,
        "an under-capacity tower never fills"
    );
}

#[test]
fn a_center_under_construction_or_on_fire_processes_nothing() {
    for state in [UnitState::Construction, UnitState::Fire] {
        let mut sim = office_tower(100, 1);
        let center = sim.tower.units_of_kind(Kind::Recycling).next().unwrap().id;
        sim.tower.get_unit_mut(center).unwrap().state = state;
        assert_eq!(sim.recycling_capacity(), 0.0);
        assert!(!sim.recycling_demand_met());
    }
}

fn parking_floor(sim: &mut Simulation, spaces: i64) {
    lay(sim, Kind::Floor, 0);
    must_place(sim, Kind::ParkingRamp, 0, C);
    for i in 0..spaces {
        must_place(sim, Kind::Parking, 0, C + RAMP_WIDTH + i * SPACE_WIDTH);
    }
}

fn floor_two(seed: u32) -> Simulation {
    let mut sim = Simulation::new_game(seed, GameMode::Classic);
    sim.money = 1e12;
    lay(&mut sim, Kind::Lobby, 1);
    lay(&mut sim, Kind::Floor, 2);
    sim
}

#[test]
fn parking_demand_is_zero_below_three_stars_then_counts_offices_and_suites() {
    assert_eq!(Kind::Parking.facility().min_star, 3);
    let mut sim = floor_two(15);
    for i in 0..4 {
        occupy(
            &mut sim,
            Kind::Office,
            2,
            i * OFFICE_WIDTH,
            UnitState::Occupied,
        );
    }
    must_place(&mut sim, Kind::HotelSuite, 2, 40);
    for star in [1, 2] {
        sim.star = star;
        assert_eq!(sim.parking_demand().total, 0.0);
        assert!(!sim.office_parking_short());
        assert!(!sim.suite_parking_short());
    }
    sim.star = 3;
    let d = sim.parking_demand();
    assert_eq!((d.offices, d.suites, d.total), (1.0, 1.0, 2.0));
    assert!(sim.office_parking_short());
    assert!(sim.suite_parking_short());
}

#[test]
fn demand_sums_both_and_suites_take_their_spaces_first() {
    let mut sim = floor_two(12);
    sim.star = 3;
    for i in 0..4 {
        occupy(
            &mut sim,
            Kind::Office,
            2,
            i * OFFICE_WIDTH,
            UnitState::Occupied,
        );
    }
    for i in 0..3 {
        must_place(&mut sim, Kind::HotelSuite, 2, 40 + i * 12);
    }
    let d = sim.parking_demand();
    assert_eq!(
        d.office_pop,
        4.0 * Kind::Office.facility().population as f64
    );
    assert_eq!(d.offices, 1.0, "one space per four offices");
    assert_eq!(d.suites, 3.0);
    assert_eq!(d.total, d.offices + d.suites);
    parking_floor(&mut sim, 3);
    assert!(!sim.suite_parking_short());
    assert!(sim.office_parking_short(), "the suites took every space");
}

#[test]
fn a_suite_is_short_only_while_working_spaces_are_fewer_than_suites() {
    let mut sim = floor_two(13);
    sim.star = 3;
    must_place(&mut sim, Kind::HotelSuite, 2, 0);
    assert!(sim.suite_parking_short());
    parking_floor(&mut sim, 1);
    assert!(!sim.suite_parking_short());
}

#[test]
fn office_cars_park_on_weekday_hours_and_suite_cars_overnight() {
    let mut sim = floor_two(14);
    sim.star = 3;
    for i in 0..4 {
        occupy(
            &mut sim,
            Kind::Office,
            2,
            i * OFFICE_WIDTH,
            UnitState::Occupied,
        );
    }
    let suite = occupy(&mut sim, Kind::HotelSuite, 2, 40, UnitState::Empty);
    parking_floor(&mut sim, 4);
    let spots = sim.tower.functional_parking_spots() as f64;
    sim.clock.minutes = 12.0 * 60.0;
    assert!(sim.parking_usage(spots) > 0.0, "Monday noon");
    sim.tower.get_unit_mut(suite).unwrap().state = UnitState::Asleep;
    sim.clock.minutes = 23.0 * 60.0;
    assert!(sim.parking_usage(spots) > 0.0, "a sleeping guest's car");
    sim.tower.get_unit_mut(suite).unwrap().state = UnitState::Empty;
    sim.clock.minutes = 5.0 * 1440.0 + 12.0 * 60.0;
    assert_eq!(sim.parking_usage(spots), 0.0, "Saturday noon");
}

fn shop_income(with_recycling: bool) -> f64 {
    let mut sim = floor_two(15);
    sim.star = 3;
    assert!(sim.build_transport(Kind::ElevatorStandard, C, 1, 2).ok);
    for i in 0..6 {
        occupy(&mut sim, Kind::Office, 2, 20 + i * 10, UnitState::Occupied);
    }
    occupy(&mut sim, Kind::Shop, 2, 0, UnitState::Occupied);
    if with_recycling {
        lay(&mut sim, Kind::Floor, 0);
        lay(&mut sim, Kind::Floor, -1);
        must_place(&mut sim, Kind::Recycling, -1, 0);
    }
    sim.clock.minutes = 10.0 * 60.0;
    let before = sim.money;
    for _ in 0..8 {
        sim.tick(60.0);
    }
    sim.money - before
}

#[test]
fn a_recycling_center_lifts_commercial_income() {
    assert!(shop_income(true) > shop_income(false));
}
