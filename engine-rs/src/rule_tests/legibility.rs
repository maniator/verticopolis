//! Legibility: a floor a shaft serves but only a long stair climb reaches
//! is stranded, the advisory says so once per crossing, the stranded scope
//! counts what can be rented, and hotels leave the rating population at four
//! stars. The parking chain (chained spaces count, isolated or rampless ones
//! do not) is pinned by
//! `tower_reads_tests::the_parking_flood_seeds_from_the_ramps_alone`; the
//! served-but-unreachable read and the stats report's stranded list by
//! `panels::tests::a_floor_only_a_long_stair_climb_reaches_is_stranded`. The
//! move-in half of the suite is in `rule_tests::legibility_move_ins`.
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::panels::stats::TOWER_STATS;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{lay_row, put, seat, MID as C};

/// The advisory's text, which the log carries.
pub(super) const STRANDED_NUDGE: &str = "reachable only by a long stair climb";

pub(super) fn nudges(sim: &Simulation) -> usize {
    sim.log
        .iter()
        .filter(|e| e.text.contains(STRANDED_NUDGE))
        .count()
}

pub(super) const DAY: f64 = 24.0 * 60.0;

/// A Classic tower to floor 45: a standard elevator from the lobby to 30,
/// then single stair flights from 30 to 45, so floor 40 is served but ten
/// flights up; `lobby_30` puts a sky lobby on 30.
pub(super) fn stair_strand(seed: u32, lobby_30: bool) -> Simulation {
    let mut sim = Simulation::new_game(seed, GameMode::Classic);
    sim.money = 1e12;
    lay_row(&mut sim, Kind::Lobby, 1);
    for floor in 2..=45 {
        let kind = if lobby_30 && floor == 30 {
            Kind::Lobby
        } else {
            Kind::Floor
        };
        lay_row(&mut sim, kind, floor);
    }
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorStandard, C, 1, 30)
            .ok
    );
    for floor in 30..45 {
        assert!(
            sim.tower
                .place_transport(Kind::Stairs, C + 20, floor, floor + 1)
                .ok
        );
    }
    sim
}

/// `stair_strand` with an occupied office on floor 40.
fn stranded_tenant(seed: u32) -> Simulation {
    let mut sim = stair_strand(seed, false);
    let office = put(&mut sim, Kind::Office, 40, C + 30);
    seat(&mut sim, office, UnitState::Occupied, 1.0);
    sim
}

#[test]
fn a_long_climb_strands_a_served_floor_until_an_elevator_reaches_it() {
    let mut sim = stranded_tenant(3);
    assert!(sim.floor_reachable(1));
    assert!(sim.tower.is_floor_served(40));
    assert!(!sim.floor_reachable(40));
    assert!(sim.stranded_floors(false).contains(&40));
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorStandard, C - 10, 30, 45)
            .ok
    );
    assert!(sim.floor_reachable(40));
    assert!(!sim.stranded_floors(false).contains(&40));
}

#[test]
fn a_reachable_floor_is_never_stranded() {
    let mut sim = Simulation::new_game(4, GameMode::Classic);
    sim.money = 1e12;
    lay_row(&mut sim, Kind::Lobby, 1);
    lay_row(&mut sim, Kind::Floor, 2);
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorStandard, C, 1, 2)
            .ok
    );
    let office = put(&mut sim, Kind::Office, 2, 0);
    seat(&mut sim, office, UnitState::Occupied, 1.0);
    assert_eq!(sim.stranded_floors(false), Vec::<i64>::new());
}

#[test]
fn the_advisory_fires_once_per_crossing() {
    let mut sim = stranded_tenant(5);
    sim.tick(DAY);
    assert_eq!(nudges(&sim), 1, "fired on the crossing");
    sim.tick(DAY);
    assert_eq!(nudges(&sim), 1, "still stranded: no repeat");
}

#[test]
fn the_local_chain_reaches_every_band_and_a_broken_link_strands_the_island() {
    let mut sim = Simulation::new_game(16, GameMode::Classic);
    sim.money = 1e12;
    lay_row(&mut sim, Kind::Lobby, 1);
    for floor in 2..=45 {
        let kind = if floor == 15 || floor == 30 {
            Kind::Lobby
        } else {
            Kind::Floor
        };
        lay_row(&mut sim, kind, floor);
    }
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorStandard, C, 1, 15)
            .ok
    );
    let middle = sim
        .tower
        .place_transport(Kind::ElevatorStandard, C + 6, 15, 30)
        .unit_id
        .unwrap();
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorStandard, C + 12, 30, 45)
            .ok
    );
    let all_reachable = |sim: &mut Simulation| (2..=45).all(|f| sim.floor_reachable(f));
    assert!(all_reachable(&mut sim), "three local links, uncapped");
    let express = sim
        .tower
        .place_transport(Kind::ElevatorExpress, C + 20, 1, 45)
        .unit_id
        .unwrap();
    assert!(sim.tower.remove_transport(express).is_some());
    assert!(all_reachable(&mut sim), "the express was a convenience");
    assert!(sim.tower.remove_transport(middle).is_some());
    assert!(sim.floor_reachable(15), "the ground band");
    assert!(!sim.floor_reachable(30), "served from above but cut off");
    assert!(!sim.floor_reachable(45));
}

#[test]
fn hotels_leave_the_rating_population_at_four_stars() {
    let mut sim = Simulation::new_game(6, GameMode::Classic);
    sim.money = 1e12;
    lay_row(&mut sim, Kind::Lobby, 1);
    lay_row(&mut sim, Kind::Floor, 2);
    let width = Kind::HotelSingle.facility().width;
    for i in 0..40 {
        let r = sim.tower.place(Kind::HotelSingle, 2, i * width);
        if let Some(id) = r.unit_id {
            seat(&mut sim, id, UnitState::Asleep, 1.0);
        }
    }
    sim.star = 3;
    assert_eq!(sim.rating_population(), sim.population());
    sim.star = 4;
    assert!(sim.rating_population() < sim.population());
}

#[test]
fn the_stats_count_every_parking_space_and_the_flood_only_the_chained_ones() {
    let mut sim = Simulation::new_game(7, GameMode::Classic);
    sim.money = 1e12;
    lay_row(&mut sim, Kind::Lobby, 1);
    lay_row(&mut sim, Kind::Floor, 0);
    let at = TOWER_STATS
        .iter()
        .position(|&k| k == "parkingSpaces")
        .unwrap();
    assert_eq!(sim.tower_stats_record()[at], 0.0);
    put(&mut sim, Kind::ParkingRamp, 0, C);
    put(
        &mut sim,
        Kind::Parking,
        0,
        C + Kind::ParkingRamp.facility().width,
    );
    put(&mut sim, Kind::Parking, 0, C + 100);
    assert_eq!(sim.tower_stats_record()[at], 2.0);
    assert_eq!(sim.tower.functional_parking_set().len(), 1);
}
