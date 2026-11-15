//! Several ground lobbies on one lot (owner, 2026-11-14): Modern lays a
//! ground lobby apart from the tower, the front door of another tower, and
//! sells ground lobby tiles, keeping the tower's last one. Classic keeps one
//! tower: a ground tile has to touch what stands, and no lobby tile sells.

use super::{GROUND_LOBBY_STAYS, LOBBY_PERMANENT};
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::gameplay::RemovalMethod;
use crate::sim::Simulation;

const NOT_CONNECTED: &str = "Floors and lobbies must connect to the existing tower.";

/// A rich tower in `mode` with a ground lobby over 100..124 and bridging
/// set to `bridge` (Classic always bridges).
fn lot(mode: GameMode, bridge: bool) -> Simulation {
    let mut sim = Simulation::new_game(1, mode);
    sim.money = 1e9;
    sim.star = 5;
    let tiles: Vec<i64> = (100..124).collect();
    assert_eq!(sim.paint_brush(Kind::Lobby, 1, &tiles).placed, 24);
    if sim.auto_bridge != bridge {
        sim.toggle_auto_bridge();
    }
    sim
}

/// The ground floor's runs of structure, as (first, last) tiles.
fn ground_runs(sim: &Simulation) -> Vec<(i64, i64)> {
    sim.tower.segment_runs(1).to_vec()
}

fn bulldoze(sim: &mut Simulation, x: i64) -> Option<String> {
    let id = sim.tower.unit_at(1, x).unwrap().id;
    let r = sim.remove_facility(id, RemovalMethod::Bulldoze);
    if r.ok {
        assert!(!sim.tower.has_structure(1, x), "x {x} sold");
    }
    r.reason
}

#[test]
fn modern_lays_a_second_ground_lobby_apart_with_bridging_off() {
    let mut sim = lot(GameMode::Modern, false);
    let r = sim.build(Kind::Lobby, 1, 200);
    assert!(r.ok, "{:?}", r.reason);
    // The Floor tool on the ground floor lays lobby, so it opens one too.
    let r = sim.build(Kind::Floor, 1, 300);
    assert!(r.ok, "{:?}", r.reason);
    assert_eq!(sim.tower.unit_at(1, 300).unwrap().kind, Kind::Lobby);
    let tiles: Vec<i64> = (201..210).collect();
    assert_eq!(sim.paint_brush(Kind::Lobby, 1, &tiles).placed, 9);
    assert_eq!(ground_runs(&sim), vec![(100, 123), (200, 209), (300, 300)]);
    assert_eq!(sim.tower.lobby_tile_count(1), 24 + 10 + 1);
}

#[test]
fn only_a_lobby_stands_apart_on_the_ground() {
    // Plain floor placed straight on the ground floor (a tool never does)
    // and basement still have to touch the tower.
    let sim = lot(GameMode::Modern, false);
    for (kind, floor) in [(Kind::Floor, 1), (Kind::Floor, 0)] {
        let r = sim.tower.can_place(kind, floor, 200);
        assert_eq!(r.reason.as_deref(), Some(NOT_CONNECTED), "{kind:?} {floor}");
    }
    assert!(sim.tower.can_place(Kind::Lobby, 1, 200).ok);
}

#[test]
fn classic_keeps_one_ground_lobby() {
    // Classic always bridges, so a far lobby joins the one that stands.
    let mut sim = lot(GameMode::Classic, true);
    assert!(sim.build(Kind::Lobby, 1, 200).ok);
    assert_eq!(ground_runs(&sim), vec![(100, 200)]);
    // A tile put straight on open ground has nothing to stand on.
    let r = sim.tower.can_place(Kind::Lobby, 1, 300);
    assert_eq!(r.reason.as_deref(), Some(NOT_CONNECTED));
    assert_eq!(bulldoze(&mut sim, 200).as_deref(), Some(LOBBY_PERMANENT));
}

#[test]
fn modern_splits_a_bridged_ground_lobby_with_the_bulldozer() {
    let mut sim = lot(GameMode::Modern, true);
    assert!(sim.build(Kind::Lobby, 1, 200).ok);
    assert_eq!(ground_runs(&sim), vec![(100, 200)]);
    let money = sim.money;
    for x in 150..160 {
        assert_eq!(bulldoze(&mut sim, x), None, "x {x}");
    }
    assert_eq!(sim.money - money, 10.0 * Kind::Lobby.resale_refund());
    assert_eq!(ground_runs(&sim), vec![(100, 149), (160, 200)]);
}

#[test]
fn modern_keeps_the_last_ground_lobby_tile() {
    let mut sim = Simulation::new_game(1, GameMode::Modern);
    sim.money = 1e9;
    assert!(sim.build(Kind::Lobby, 1, 100).ok);
    assert!(sim.build(Kind::Lobby, 1, 101).ok);
    assert_eq!(bulldoze(&mut sim, 101), None);
    assert_eq!(bulldoze(&mut sim, 100).as_deref(), Some(GROUND_LOBBY_STAYS));
    // A second tower's lobby leaves the first one free to go.
    if sim.auto_bridge {
        sim.toggle_auto_bridge();
    }
    assert!(sim.build(Kind::Lobby, 1, 200).ok);
    assert_eq!(bulldoze(&mut sim, 100), None);
    assert_eq!(bulldoze(&mut sim, 200).as_deref(), Some(GROUND_LOBBY_STAYS));
}

#[test]
fn a_tall_ground_hall_tile_is_the_last_tile_only_alone() {
    // A tall ground hall tile is one unit one tile wide, whatever its
    // stories, so the count of ground lobby tiles it weighs is its width.
    let mut sim = Simulation::new_game(1, GameMode::Modern);
    sim.money = 1e9;
    let laid = sim.with_lobby_height(3, |sim| sim.paint_brush(Kind::Lobby, 1, &[100, 101]));
    assert_eq!(laid.placed, 2, "{:?}", laid.reason);
    let refund = Kind::Lobby.resale_refund() * 3.0;
    let money = sim.money;
    assert_eq!(bulldoze(&mut sim, 101), None);
    assert_eq!(sim.money - money, refund);
    assert_eq!(bulldoze(&mut sim, 100).as_deref(), Some(GROUND_LOBBY_STAYS));
}
