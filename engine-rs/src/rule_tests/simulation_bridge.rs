//! The core simulation suite, the auto-floor bridge: a room, a floor tile
//! or a lobby dropped beside a neighbor on its story fills the gap (either
//! side, any width, in either mode, every story of a tall room, lobby tiles
//! on a lobby floor), the bridge is charged and a drop that cannot pay for
//! it builds nothing, the ground and the basement rescue a detached tile
//! through it, and the rescue never stands in for a sky lobby's support.
//! The quoted price of a brush is also `lobbyFloorCharge.integration.test.ts`
//! and `build_tests::{a_bridge_is_still_planned_at_each_bound,
//! an_upper_story_bridges_over_the_tiles_the_story_below_plans}`.
use crate::clock::GameMode;
use crate::facilities::{Kind, LOBBY_INTERVAL};
use crate::sim::Simulation;

use super::seeded_game;
use super::simulation_economy::X0;

const LF: i64 = LOBBY_INTERVAL;

fn game(mode: GameMode) -> Simulation {
    let mut sim = seeded_game(7, mode);
    sim.money = 1e7;
    sim
}

fn kinds(sim: &Simulation, floor: i64, from: i64, to: i64) -> Vec<Option<Kind>> {
    (from..to)
        .map(|i| sim.tower.structure_kind_at(floor, X0 + i))
        .collect()
}

fn all(sim: &Simulation, floor: i64, from: i64, to: i64, kind: Kind) -> bool {
    kinds(sim, floor, from, to).iter().all(|k| *k == Some(kind))
}

fn bare(sim: &Simulation, floor: i64, dx: i64) -> bool {
    sim.tower.structure_kind_at(floor, X0 + dx).is_none()
}

fn floor_cost() -> f64 {
    Kind::Floor.facility().cost
}

fn lobby_cost() -> f64 {
    Kind::Lobby.facility().cost
}

#[test]
fn two_rooms_on_a_story_are_joined_by_floor_from_either_side_in_either_mode() {
    for (mode, first, second) in [
        (GameMode::Classic, 0, 15),
        (GameMode::Classic, 15, 0),
        (GameMode::Modern, 0, 15),
    ] {
        let mut sim = game(mode);
        assert!(sim.build(Kind::Office, 2, X0 + first).ok);
        assert!(bare(&sim, 2, 11));
        assert!(sim.build(Kind::Office, 2, X0 + second).ok);
        assert!(all(&sim, 2, 9, 15, Kind::Floor), "{mode:?} {first}");
        assert!(bare(&sim, 2, 30), "the bridge spans the gap alone");
    }
}

#[test]
fn the_bridge_has_no_distance_cap() {
    let mut sim = game(GameMode::Classic);
    assert!(sim.build(Kind::Office, 2, X0).ok);
    assert!(sim.build(Kind::Office, 2, X0 + 30).ok);
    assert!(all(&sim, 2, 9, 30, Kind::Floor));
}

#[test]
fn a_room_bridge_is_charged_and_an_unaffordable_one_builds_nothing() {
    let mut sim = game(GameMode::Classic);
    assert!(sim.build(Kind::Office, 2, X0).ok);
    let quote = sim.can_build(Kind::Office, 2, X0 + 15);
    assert_eq!(
        quote.cost,
        Kind::Office.facility().cost + (9.0 + 6.0) * floor_cost()
    );
    sim.money = quote.cost - 1.0;
    assert!(!sim.build(Kind::Office, 2, X0 + 15).ok);
    assert_eq!(sim.money, quote.cost - 1.0);
    assert!(bare(&sim, 2, 11));
    sim.money = quote.cost;
    assert!(sim.build(Kind::Office, 2, X0 + 15).ok);
    assert_eq!(sim.money, 0.0);
}

#[test]
fn a_lone_room_pays_only_its_own_floor() {
    let mut sim = game(GameMode::Classic);
    let before = sim.money;
    assert!(sim.build(Kind::Office, 2, X0).ok);
    let office = Kind::Office.facility();
    assert_eq!(
        before - sim.money,
        office.cost + office.width as f64 * floor_cost()
    );
    assert!(bare(&sim, 2, 12));
}

/// A support column under floor `LF` at `X0`, `width` tiles wide.
fn column_to_sky_lobby(sim: &mut Simulation, width: i64) {
    for floor in 2..LF {
        for i in 0..width {
            sim.tower.place(Kind::Floor, floor, X0 + i);
        }
    }
}

#[test]
fn two_sky_lobbies_are_joined_by_lobby_tiles() {
    let mut sim = game(GameMode::Classic);
    column_to_sky_lobby(&mut sim, 10);
    assert!(sim.build(Kind::Lobby, LF, X0).ok);
    assert!(sim.build(Kind::Lobby, LF, X0 + 7).ok);
    assert!(all(&sim, LF, 1, 7, Kind::Lobby));
}

#[test]
fn a_sky_lobby_bridge_is_charged_with_its_floor() {
    let mut sim = game(GameMode::Classic);
    column_to_sky_lobby(&mut sim, 12);
    assert!(sim.build(Kind::Lobby, LF, X0).ok);
    let quote = sim.can_build(Kind::Lobby, LF, X0 + 7);
    assert_eq!(quote.cost, (lobby_cost() + floor_cost()) * 7.0);
    sim.money = quote.cost - 1.0;
    assert!(!sim.build(Kind::Lobby, LF, X0 + 7).ok);
    assert!(bare(&sim, LF, 3));
    sim.money = quote.cost;
    assert!(sim.build(Kind::Lobby, LF, X0 + 7).ok);
    assert_eq!(sim.money, 0.0);
}

#[test]
fn a_floor_tile_bridges_back_to_its_neighbor_and_pays_for_the_gap() {
    let mut sim = game(GameMode::Classic);
    assert!(sim.build(Kind::Floor, 2, X0).ok);
    let quote = sim.can_build(Kind::Floor, 2, X0 + 6);
    assert_eq!(quote.cost, 6.0 * floor_cost());
    sim.money = quote.cost - 1.0;
    assert!(!sim.build(Kind::Floor, 2, X0 + 6).ok);
    assert!(bare(&sim, 2, 3));
    sim.money = quote.cost;
    assert!(sim.build(Kind::Floor, 2, X0 + 6).ok);
    assert!(all(&sim, 2, 1, 6, Kind::Floor));
}

#[test]
fn a_ground_floor_drop_becomes_lobby_and_bridges_into_the_concourse() {
    let mut sim = game(GameMode::Classic);
    assert!(sim.build(Kind::Floor, 1, X0 + 40).ok);
    assert!(sim.build(Kind::Floor, 1, X0 + 45).ok);
    assert!(all(&sim, 1, 40, 46, Kind::Lobby));

    let mut lobby = game(GameMode::Classic);
    assert!(bare(&lobby, 1, 42));
    assert!(lobby.build(Kind::Lobby, 1, X0 + 45).ok);
    assert!(all(&lobby, 1, 40, 46, Kind::Lobby));
}

#[test]
fn a_ground_lobby_bridge_is_charged_with_its_floor() {
    let mut sim = game(GameMode::Classic);
    let quote = sim.can_build(Kind::Lobby, 1, X0 + 45);
    assert_eq!(quote.cost, (lobby_cost() + floor_cost()) * 6.0);
    sim.money = quote.cost - 1.0;
    assert!(!sim.build(Kind::Lobby, 1, X0 + 45).ok);
    assert!(bare(&sim, 1, 42));
    assert_eq!(sim.money, quote.cost - 1.0);
    sim.money = quote.cost;
    assert!(sim.build(Kind::Lobby, 1, X0 + 45).ok);
    assert_eq!(sim.money, 0.0);
}

#[test]
fn the_basement_rescues_a_detached_tile_and_bridges_rooms_with_floor() {
    let mut sim = game(GameMode::Classic);
    assert!(sim.build(Kind::Floor, 0, X0 + 38).ok, "under the lobby");
    assert!(sim.build(Kind::Floor, 0, X0 + 45).ok, "past it, detached");
    assert!(all(&sim, 0, 39, 45, Kind::Floor));

    let mut parking = game(GameMode::Classic);
    parking.star = 3;
    assert!(parking.build(Kind::Parking, 0, X0).ok);
    assert!(parking.build(Kind::Parking, 0, X0 + 10).ok);
    assert!(all(&parking, 0, 4, 10, Kind::Floor));
}

#[test]
fn a_right_side_basement_bridge_fills_in_one_pass() {
    let mut sim = game(GameMode::Classic);
    sim.star = 3;
    assert!(sim.build(Kind::Parking, 0, X0).ok);
    assert!(sim.build(Kind::Parking, 0, X0 + 20).ok);
    assert!(all(&sim, 0, 4, 20, Kind::Floor));
}

#[test]
fn every_story_of_a_tall_room_is_bridged() {
    let mut sim = game(GameMode::Classic);
    sim.money = 2e7;
    sim.star = 3;
    for floor in 1..=4 {
        for i in 0..65 {
            sim.tower.place(Kind::Floor, floor, X0 + i);
        }
    }
    assert!(sim.build(Kind::Cinema, 5, X0).ok);
    assert!(sim.build(Kind::Cinema, 5, X0 + 34).ok);
    for floor in [5, 6] {
        assert!(all(&sim, floor, 31, 34, Kind::Floor), "floor {floor}");
    }
}

#[test]
fn the_rescue_never_floats_a_lobby_or_stands_in_for_a_sky_lobbys_support() {
    let mut plain = game(GameMode::Classic);
    assert!(!plain.build(Kind::Lobby, 7, X0).ok);
    assert!(bare(&plain, 7, 0));

    let mut sky = game(GameMode::Classic);
    column_to_sky_lobby(&mut sky, 8);
    assert!(sky.build(Kind::Lobby, LF, X0).ok);
    assert!(!sky.build(Kind::Lobby, LF, X0 + 10).ok);
    assert!(bare(&sky, LF, 10) && bare(&sky, LF, 5));
}
