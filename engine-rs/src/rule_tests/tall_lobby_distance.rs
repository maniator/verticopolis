//! A tall lobby (#308) counts as a lobby on every story its hall fills, so
//! the floors just above it are as near a lobby as the floors above a
//! one-story lobby. The reported case: a Steak House straight over a
//! three-story sky lobby said it was too far from a lobby and lost half its
//! trade.
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;

use super::{lay_row, put};

/// A Modern tower with a one-story ground lobby, plain floors 2 to 14, a
/// sky lobby `height` stories high on floor 15 and plain floors from the
/// story above the hall up to 22, all across the lot.
fn modern_sky_hall(height: i64) -> Simulation {
    let mut sim = Simulation::new_game(1, GameMode::Modern);
    sim.money = 1e9;
    sim.star = 5;
    lay_row(&mut sim, Kind::Lobby, 1);
    for floor in 2..=14 {
        lay_row(&mut sim, Kind::Floor, floor);
    }
    sim.with_lobby_height(height, |sim| lay_row(sim, Kind::Lobby, 15));
    assert_eq!(sim.tower.lobby_height(15), height);
    for floor in 15 + height..=22 {
        lay_row(&mut sim, Kind::Floor, floor);
    }
    sim
}

/// The card's "too far from a lobby" fact, as the frontend reads it. The
/// hourly takings halve on the same distance (`collect_traffic_income`).
fn lobby_far(sim: &mut Simulation, id: i64) -> Option<bool> {
    let facts = serde_json::to_value(sim.service_diagnostic_facts(id).unwrap()).unwrap();
    facts["commercial"]["lobbyFar"].as_bool()
}

#[test]
fn the_floor_over_a_tall_sky_lobby_is_next_to_it() {
    let sim = modern_sky_hall(3);
    let distance = |floor| sim.tower.nearest_lobby_floor_distance(floor);
    // The hall fills 15 to 17; the floors above count from 17.
    assert_eq!(distance(16), 0);
    assert_eq!(distance(17), 0);
    assert_eq!(distance(18), 1);
    assert_eq!(distance(19), 2);
    assert_eq!(distance(20), 3);
    // Below the hall nothing changes.
    assert_eq!(distance(13), 2);
    assert_eq!(distance(9), 6);
}

#[test]
fn a_one_story_sky_lobby_still_counts_from_its_own_floor() {
    let sim = modern_sky_hall(1);
    assert_eq!(sim.tower.nearest_lobby_floor_distance(16), 1);
    assert_eq!(sim.tower.nearest_lobby_floor_distance(18), 3);
}

#[test]
fn a_restaurant_over_a_tall_sky_lobby_is_not_too_far_from_it() {
    let mut sim = modern_sky_hall(3);
    let over = put(&mut sim, Kind::Restaurant, 18, 100);
    let two_up = put(&mut sim, Kind::Shop, 19, 100);
    let three_up = put(&mut sim, Kind::Shop, 20, 100);
    assert_eq!(lobby_far(&mut sim, over), Some(false), "just over the hall");
    assert_eq!(lobby_far(&mut sim, two_up), Some(false), "two floors over");
    assert_eq!(
        lobby_far(&mut sim, three_up),
        Some(true),
        "three floors over"
    );
    // The same restaurant over a one-story sky lobby is three floors away.
    let mut low = modern_sky_hall(1);
    let far = put(&mut low, Kind::Restaurant, 18, 100);
    assert_eq!(lobby_far(&mut low, far), Some(true));
}

#[test]
fn a_tall_ground_lobby_counts_to_its_top_story_in_classic() {
    let mut sim = Simulation::new_game(1, GameMode::Classic);
    sim.with_lobby_height(3, |sim| lay_row(sim, Kind::Lobby, 1));
    assert_eq!(sim.tower.lobby_height(1), 3);
    let distance = |floor| sim.tower.nearest_lobby_floor_distance(floor);
    assert_eq!(distance(2), 0);
    assert_eq!(distance(3), 0);
    assert_eq!(distance(4), 1);
    assert_eq!(distance(5), 2);
    assert_eq!(distance(6), 3);
    // Basements still count from the lobby's own floor.
    assert_eq!(distance(0), 1);
    assert_eq!(distance(-2), 3);
}
