//! The core simulation suite, sky lobbies and the ground concourse: a
//! lobby claims its story the moment it lands (only lobby tiles after
//! that, no room on or across it, in both modes), rooms block a sky lobby
//! but bare floor upgrades in place, an unclaimed sky floor takes plain
//! floor, the Floor tool lays lobby on the ground floor (founding a Classic
//! tower, charging nothing on a lobby already there, building nothing it
//! cannot pay for), a legacy bare ground tile loads unchanged, lobby tiles
//! are permanent to the player though the engine's own rollback may remove
//! them, and escalators follow the mode's rules. The mode's preview flag is
//! `catalog::rules_tests::each_mode_states_its_rules`; lobby permanence in
//! both modes also `charges_removal_tests::lobby_tiles_cannot_be_removed_in_either_mode`.
//! The tower holding the Simulation's own rule set is a TypeScript object
//! identity seam, n/a in Rust (the tower reads the mode it was given).
use crate::clock::GameMode;
use crate::facilities::{Kind, LOBBY_INTERVAL};
use crate::load::deserialize;
use crate::sim::Simulation;

use super::seeded_game;
use super::simulation_economy::X0;

const SKY: i64 = LOBBY_INTERVAL;
const ONLY_LOBBY: &str = "Sky lobbies are concourses. Only lobby tiles go here.";
const ROOM_ON_SKY_LOBBY: &str = "This room would sit on a sky lobby. Move it up or down a story.";
const ROOMS_FIRST: &str = "Clear the rooms here first, then place your sky lobby.";
const LOBBY_PERMANENT: &str =
    "Lobby tiles are permanent. The 1994 game does not let you remove them.";

/// Floors 2 to `top`, forty tiles wide, over the starter lobby.
fn tower_to(mode: GameMode, top: i64) -> Simulation {
    let mut sim = seeded_game(7, mode);
    sim.money = 1e12;
    for floor in 2..=top {
        for i in 0..40 {
            sim.tower.place(Kind::Floor, floor, X0 + i);
        }
    }
    sim
}

fn reason(sim: &mut Simulation, kind: Kind, floor: i64, x: i64) -> Option<String> {
    let r = sim.build(kind, floor, x);
    assert!(!r.ok, "{kind:?} at {floor}/{x} was built");
    r.reason
}

#[test]
fn a_lobby_claims_its_story_and_only_lobby_goes_there_after_in_both_modes() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let mut sim = tower_to(mode, SKY - 1);
        assert!(!sim.tower.floor_has_lobby(SKY));
        assert!(sim.build(Kind::Lobby, SKY, X0).ok);
        assert!(sim.tower.floor_has_lobby(SKY));
        assert_eq!(
            reason(&mut sim, Kind::Floor, SKY, X0 + 20).as_deref(),
            Some(ONLY_LOBBY)
        );
    }
}

#[test]
fn no_room_sits_on_or_spans_a_claimed_sky_lobby() {
    let mut sim = tower_to(GameMode::Classic, SKY - 1);
    sim.star = 5;
    assert!(sim.build(Kind::Lobby, SKY, X0).ok);
    assert_eq!(
        reason(&mut sim, Kind::Office, SKY, X0 + 20).as_deref(),
        Some(ROOM_ON_SKY_LOBBY)
    );
    assert_eq!(
        reason(&mut sim, Kind::Cinema, SKY - 1, X0 + 5).as_deref(),
        Some(ROOM_ON_SKY_LOBBY)
    );
}

#[test]
fn rooms_block_a_sky_lobby_but_bare_floor_upgrades_in_place() {
    let mut rooms = tower_to(GameMode::Classic, SKY);
    rooms.star = 5;
    assert!(
        rooms
            .build_transport(Kind::ElevatorStandard, X0 + 20, 1, SKY)
            .ok
    );
    assert!(rooms.tower.place(Kind::Office, SKY, X0).ok);
    assert_eq!(
        reason(&mut rooms, Kind::Lobby, SKY, X0 + 20).as_deref(),
        Some(ROOMS_FIRST)
    );

    let mut bare = tower_to(GameMode::Classic, SKY);
    assert!(!bare.tower.floor_has_lobby(SKY));
    assert!(bare.build(Kind::Lobby, SKY, X0).ok);
    assert_eq!(bare.tower.structure_kind_at(SKY, X0), Some(Kind::Lobby));
    assert!(bare.tower.floor_has_lobby(SKY));
}

#[test]
fn an_unclaimed_sky_floor_takes_plain_floor() {
    let mut sim = tower_to(GameMode::Classic, SKY - 1);
    assert!(sim.build(Kind::Floor, SKY, X0).ok);
    assert_eq!(sim.tower.structure_kind_at(SKY, X0), Some(Kind::Floor));
}

#[test]
fn the_floor_tool_lays_lobby_on_the_ground_at_the_lobby_price() {
    let mut sim = seeded_game(7, GameMode::Classic);
    sim.money = 1e7;
    let before = sim.money;
    assert!(sim.build(Kind::Floor, 1, X0 + 40).ok);
    assert_eq!(sim.tower.structure_kind_at(1, X0 + 40), Some(Kind::Lobby));
    let tile = Kind::Lobby.facility().cost + Kind::Floor.facility().cost;
    assert_eq!(before - sim.money, tile);

    let mut poor = seeded_game(7, GameMode::Classic);
    poor.money = tile - 1.0;
    assert!(!poor.build(Kind::Floor, 1, X0 + 40).ok);
    assert_eq!(poor.tower.structure_kind_at(1, X0 + 40), None);
    assert_eq!(poor.money, tile - 1.0);

    let mut again = seeded_game(7, GameMode::Classic);
    again.money = 1e7;
    assert!(
        !again.build(Kind::Floor, 1, X0).ok,
        "a lobby is already there"
    );
    assert_eq!(again.money, 1e7);
    assert_eq!(again.tower.structure_kind_at(1, X0), Some(Kind::Lobby));
}

#[test]
fn the_floor_tool_founds_an_empty_classic_tower() {
    let mut sim = Simulation::new_game(1, GameMode::Classic);
    assert!(sim.tower.units.is_empty());
    assert!(sim.build(Kind::Floor, 1, X0 + 20).ok);
    assert_eq!(sim.tower.structure_kind_at(1, X0 + 20), Some(Kind::Lobby));
    assert_eq!(sim.tower.units.len(), 1);
}

#[test]
fn a_bare_ground_tile_from_an_old_save_loads_unchanged() {
    let mut sim = seeded_game(7, GameMode::Classic);
    assert!(sim.tower.place(Kind::Floor, 1, X0 + 40).ok);
    assert_eq!(sim.tower.structure_kind_at(1, X0 + 40), Some(Kind::Floor));
    let loaded = deserialize(&sim.serialize()).unwrap();
    assert_eq!(
        loaded.tower.structure_kind_at(1, X0 + 40),
        Some(Kind::Floor)
    );
}

#[test]
fn lobby_tiles_are_permanent_to_the_player_but_not_to_the_engines_rollback() {
    let mut sim = seeded_game(7, GameMode::Classic);
    let lobby = sim.tower.unit_at(1, X0).unwrap().id;
    assert_eq!(sim.tower.removal_reason(lobby), Some(LOBBY_PERMANENT));
    let before = sim.money;
    assert!(!sim.sell_at(1, X0));
    assert_eq!(sim.money, before);
    assert_eq!(sim.tower.unit_at(1, X0).unwrap().kind, Kind::Lobby);
    assert!(sim.tower.remove_unit(lobby).is_some());
    assert!(sim.tower.unit_at(1, X0).is_none());
}

#[test]
fn classic_keeps_escalators_off_office_floors_and_modern_allows_them() {
    let build = |mode: GameMode| {
        let mut sim = seeded_game(7, mode);
        for i in 0..20 {
            assert!(sim.tower.place(Kind::Floor, 2, X0 + i).ok);
        }
        assert!(sim.tower.place(Kind::Office, 2, X0).ok);
        sim.tower.place_transport(Kind::Escalator, X0 + 12, 1, 2)
    };
    let classic = build(GameMode::Classic);
    assert!(!classic.ok);
    assert_eq!(
        classic.reason.as_deref(),
        Some("Escalators can't serve office floors. They link commercial floors only.")
    );
    assert!(build(GameMode::Modern).ok);
}
