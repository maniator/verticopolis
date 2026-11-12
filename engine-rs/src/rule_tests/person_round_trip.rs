//! Per-person meal round trips, from the retired
//! `personRoundTrip.integration.test.ts`: a diner leaving thins their room's
//! visible head count (never its place_seated count), a same-floor trip walks, the
//! overlay drains once everyone is back, a bulldozed origin strands no one
//! (before or during the return leg), the dwell runs 30 to 60 game minutes
//! before the route turns for home, an unreachable venue draws nobody, the
//! eaters count at the venue they were sent to, and a lone fast food never
//! holds more than its catalog population.
//!
//! Also covered: the visible-occupants rows are
//! `tower_query_state::tests::visible_occupants_is_occupants_minus_out_for_meal_floored_at_zero`
//! (plus the negative row below); the overlay resetting on a load is
//! `rule_tests::person_census::a_load_starts_every_crowd_tally_at_zero_and_stamps_version_7`;
//! the crowd cap through a lunch is
//! `rule_tests::meal_cadence::the_crowd_cap_holds_through_a_lunch_peak`; the
//! arrival clamp and the spawn-side filter at a full venue are the Rust-run
//! `personRoundTripVenueCap.integration.test.ts`.
use crate::clock::GameMode;
use crate::crowd::{PState, CROWD_SECONDS_PER_MINUTE};
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{at_time, place_seated, shaft, strip_tower};

const OFFICE_STAFF: i64 = 6;
const VENUE_FLOOR: i64 = 5;
/// From 11:00 to 16:55: past lunch and the sales-call window's stragglers,
/// short of the 17:00 dinner window.
const LUNCH_AND_STRAGGLERS: usize = 355;

/// A Modern strip to floor 5, one elevator, a staffed office on floor 2
/// and a fast food on floor 5.
fn office_and_fast_food() -> (Simulation, i64, i64) {
    let mut sim = strip_tower(2024, GameMode::Modern, 40, 5);
    shaft(&mut sim, Kind::ElevatorStandard, 4, 1, 5);
    let office = place_seated(
        &mut sim,
        Kind::Office,
        2,
        10,
        UnitState::Occupied,
        OFFICE_STAFF,
    );
    let food = place_seated(
        &mut sim,
        Kind::FastFood,
        VENUE_FLOOR,
        0,
        UnitState::Occupied,
        6,
    );
    (sim, office, food)
}

/// The office and the fast food on the same floor 2.
fn same_floor() -> (Simulation, i64) {
    let mut sim = strip_tower(2024, GameMode::Modern, 40, 3);
    shaft(&mut sim, Kind::ElevatorStandard, 4, 1, 3);
    let office = place_seated(
        &mut sim,
        Kind::Office,
        2,
        30,
        UnitState::Occupied,
        OFFICE_STAFF,
    );
    place_seated(&mut sim, Kind::FastFood, 2, 0, UnitState::Occupied, 6);
    (sim, office)
}

fn out_for_meal(sim: &Simulation, id: i64) -> i64 {
    sim.tower.get_unit(id).unwrap().out_for_meal.unwrap_or(0)
}

/// Ticks up to 30 minutes from noon until the office's visible head count
/// dips, and checks the dip is the overlay, not the seats.
fn assert_a_diner_leaves(sim: &mut Simulation, office: i64) {
    at_time(sim, 0, 12);
    let start = sim.tower.get_unit(office).unwrap().visible_occupants();
    assert!(start > 0);
    let dipped = (0..30).any(|_| {
        sim.tick(1.0);
        sim.tower.get_unit(office).unwrap().visible_occupants() < start
    });
    assert!(dipped, "no diner left within 30 minutes");
    assert!(out_for_meal(sim, office) > 0);
    assert_eq!(sim.tower.get_unit(office).unwrap().occupants, OFFICE_STAFF);
}

#[test]
fn negative_occupants_read_as_nobody_visible() {
    let (mut sim, office, _) = office_and_fast_food();
    sim.tower.get_unit_mut(office).unwrap().occupants = -1;
    assert_eq!(sim.tower.get_unit(office).unwrap().visible_occupants(), 0);
}

#[test]
fn a_lunch_diner_thins_the_visible_office_and_bumps_the_overlay() {
    let (mut sim, office, _) = office_and_fast_food();
    assert_a_diner_leaves(&mut sim, office);
    assert!(sim.tower.meal_overlay_revision > 0);
}

#[test]
fn a_same_floor_diner_walks_out_and_back() {
    let (mut sim, office) = same_floor();
    assert_a_diner_leaves(&mut sim, office);
    let (mut sim, office) = same_floor();
    at_time(&mut sim, 0, 11);
    for _ in 0..LUNCH_AND_STRAGGLERS {
        sim.tick(1.0);
    }
    assert_eq!(out_for_meal(&sim, office), 0);
}

#[test]
fn every_diner_is_back_once_the_stragglers_finish() {
    let (mut sim, office, _) = office_and_fast_food();
    at_time(&mut sim, 0, 11);
    let mut peak = 0;
    for _ in 0..LUNCH_AND_STRAGGLERS {
        sim.tick(1.0);
        peak = peak.max(out_for_meal(&sim, office));
    }
    assert!(peak > 0, "somebody went out");
    assert_eq!(out_for_meal(&sim, office), 0);
}

/// Ticks from noon until a person with an origin room matching `pick`
/// shows up, and returns that room.
fn origin_of(
    sim: &mut Simulation,
    minutes: usize,
    pick: impl Fn(&crate::crowd::Person) -> bool,
) -> i64 {
    at_time(sim, 0, 12);
    for _ in 0..minutes {
        sim.tick(1.0);
        if let Some(id) = sim
            .crowd
            .people
            .iter()
            .filter(|p| pick(p))
            .find_map(|p| p.origin_unit_id)
        {
            return id;
        }
    }
    panic!("no matching round-tripper in {minutes} minutes");
}

fn stranded_from(sim: &Simulation, origin: i64) -> usize {
    sim.crowd
        .people
        .iter()
        .filter(|p| p.origin_unit_id == Some(origin) && p.state != PState::Done)
        .count()
}

#[test]
fn bulldozing_the_origin_mid_dwell_strands_nobody() {
    let (mut sim, _, _) = office_and_fast_food();
    let origin = origin_of(&mut sim, 30, |_| true);
    assert!(sim.tower.remove_unit(origin).is_some());
    for _ in 0..180 {
        sim.tick(1.0);
    }
    assert_eq!(stranded_from(&sim, origin), 0);
}

#[test]
fn bulldozing_the_origin_on_the_return_leg_strands_nobody() {
    let (mut sim, _, _) = office_and_fast_food();
    let origin = origin_of(&mut sim, 90, |p| p.returning && p.state != PState::Done);
    assert!(sim.tower.remove_unit(origin).is_some());
    // Long enough for the returner's ride and for any diner from the same
    // office still at the meal to finish it: a diner mid-meal is not
    // stranded, and leaves when the meal ends.
    let window = MEAL_DWELL_MINUTES.1 as usize + 30;
    for _ in 0..window {
        sim.tick(1.0);
    }
    assert_eq!(stranded_from(&sim, origin), 0);
}

/// A meal's dwell in game minutes, as the design states it.
const MEAL_DWELL_MINUTES: (f64, f64) = (30.0, 60.0);

#[test]
fn an_arriving_diner_dwells_thirty_to_sixty_game_minutes() {
    let (mut sim, _, _) = office_and_fast_food();
    at_time(&mut sim, 0, 12);
    let mut timers = std::collections::HashMap::new();
    for _ in 0..90 {
        sim.tick(1.0);
        for p in sim
            .crowd
            .people
            .iter()
            .filter(|p| p.state == PState::Dwelling)
        {
            timers.entry(p.id).or_insert(p.dwell_seconds_left.unwrap());
        }
    }
    assert!(timers.len() >= 5, "only {} diners sat down", timers.len());
    let (lo, hi) = MEAL_DWELL_MINUTES;
    // One crowd step may already have run off a timer when it is first seen.
    let shortest = lo * CROWD_SECONDS_PER_MINUTE - CROWD_SECONDS_PER_MINUTE;
    let longest = hi * CROWD_SECONDS_PER_MINUTE;
    for (id, left) in timers {
        assert!((shortest..=longest).contains(&left), "person {id}: {left}");
    }
}

#[test]
fn the_dwell_ends_in_a_ride_from_the_venue_home() {
    let (mut sim, office, _) = office_and_fast_food();
    let origin = origin_of(&mut sim, 30, |p| {
        p.state == PState::Dwelling && p.meal_venue_id.is_some()
    });
    assert_eq!(origin, office);
    let diner = sim
        .crowd
        .people
        .iter()
        .find(|p| {
            p.origin_unit_id == Some(origin)
                && p.state == PState::Dwelling
                && p.meal_venue_id.is_some()
        })
        .map(|p| p.id)
        .expect("a diner from the office is dwelling");
    // Follow that diner until the dwell ends: it must still be in the crowd,
    // now on a returning route from the venue's floor to the office's.
    let mut route_home = None;
    for _ in 0..90 {
        sim.tick(1.0);
        let p = sim
            .crowd
            .people
            .iter()
            .find(|p| p.id == diner)
            .expect("the diner left the crowd when the dwell ended");
        if p.state != PState::Dwelling {
            route_home = Some((p.returning, p.floors[0], *p.floors.last().unwrap()));
            break;
        }
    }
    assert_eq!(route_home, Some((true, VENUE_FLOOR, 2)));
}

#[test]
fn an_unreachable_venue_draws_no_diner() {
    let mut sim = strip_tower(2024, GameMode::Modern, 40, 2);
    for x in 0..40 {
        for floor in 3..=5 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    let office = place_seated(
        &mut sim,
        Kind::Office,
        2,
        10,
        UnitState::Occupied,
        OFFICE_STAFF,
    );
    place_seated(
        &mut sim,
        Kind::FastFood,
        VENUE_FLOOR,
        0,
        UnitState::Occupied,
        6,
    );
    at_time(&mut sim, 0, 12);
    for _ in 0..60 {
        sim.tick(1.0);
        assert_eq!(out_for_meal(&sim, office), 0);
    }
}

#[test]
fn eaters_count_at_the_venue_they_were_sent_to() {
    let (mut sim, _, food) = office_and_fast_food();
    let decoy = place_seated(
        &mut sim,
        Kind::Office,
        VENUE_FLOOR,
        24,
        UnitState::Occupied,
        6,
    );
    at_time(&mut sim, 0, 12);
    let mut saw_eater = false;
    for _ in 0..60 {
        sim.tick(1.0);
        let mut dwelling = 0;
        for p in sim
            .crowd
            .people
            .iter()
            .filter(|p| p.state == PState::Dwelling)
        {
            assert_eq!(p.venue_unit_id, Some(food));
            dwelling += 1;
        }
        let counted = sim
            .crowd
            .people
            .iter()
            .filter(|p| p.venue_unit_id == Some(food))
            .count();
        let venue = sim.tower.get_unit(food).unwrap();
        assert_eq!(venue.customers_in.unwrap_or(0), counted as i64);
        if dwelling > 0 {
            saw_eater = true;
            assert_eq!(
                sim.tower.get_unit(decoy).unwrap().customers_in.unwrap_or(0),
                0
            );
        }
    }
    assert!(saw_eater);
}

#[test]
fn a_heavy_lunch_never_overfills_a_lone_fast_food() {
    let mut sim = strip_tower(2024, GameMode::Modern, 60, 6);
    shaft(&mut sim, Kind::ElevatorStandard, 55, 1, 6);
    for (floor, x) in [(2, 0), (2, 20), (3, 0), (4, 0), (5, 0), (6, 0)] {
        place_seated(
            &mut sim,
            Kind::Office,
            floor,
            x,
            UnitState::Occupied,
            OFFICE_STAFF,
        );
    }
    let food = place_seated(&mut sim, Kind::FastFood, 6, 30, UnitState::Occupied, 0);
    let cap = Kind::FastFood.facility().population;
    at_time(&mut sim, 0, 12);
    let mut peak = 0;
    for _ in 0..180 {
        sim.tick(1.0);
        let inside = sim.tower.get_unit(food).unwrap().customers_in.unwrap_or(0);
        assert!(inside <= cap, "{inside} inside a house of {cap}");
        peak = peak.max(inside);
    }
    assert!(peak > 0, "the crowd used the venue");
}
