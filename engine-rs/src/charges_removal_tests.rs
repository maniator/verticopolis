//! Tests for the rooms `remove_facility` keeps: Classic's permanent rooms and the lobby.
use super::*;
use crate::clock::GameMode;

/// A lobby on floor 1 and a floor of tiles on 2, in `mode`.
fn tower_in(mode: GameMode) -> Simulation {
    let mut sim = Simulation::new_game(1, mode);
    for x in 10..120 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        for floor in 2..=4 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
        sim.tower.place(Kind::Floor, 0, x);
        sim.tower.place(Kind::Floor, -1, x);
    }
    sim.money = 1_000_000.0;
    sim
}

#[test]
fn classic_housekeeping_cannot_be_removed_but_a_gutted_shell_clears() {
    let mut sim = tower_in(GameMode::Classic);
    let hk = sim.tower.place(Kind::Housekeeping, 2, 20).unit_id.unwrap();
    let money = sim.money;
    assert_eq!(
        sim.remove_facility(hk, RemovalMethod::Bulldoze),
        ChargeResult::refuse(HOUSEKEEPING_PERMANENT)
    );
    assert!(sim.tower.get_unit(hk).is_some());
    assert_eq!(sim.money, money);
    sim.tower.get_unit_mut(hk).unwrap().state = UnitState::Gutted;
    assert!(sim.remove_facility(hk, RemovalMethod::Bulldoze).ok);
    assert!(sim.tower.get_unit(hk).is_none());
}

#[test]
fn modern_housekeeping_can_be_sold() {
    let mut sim = tower_in(GameMode::Modern);
    let hk = sim.tower.place(Kind::Housekeeping, 2, 20).unit_id.unwrap();
    assert!(sim.remove_facility(hk, RemovalMethod::Sell).ok);
}

#[test]
fn lobby_tiles_cannot_be_removed_in_either_mode() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let mut sim = tower_in(mode);
        let lobby = sim.tower.unit_at(1, 20).unwrap().id;
        assert!(!sim.remove_facility(lobby, RemovalMethod::Bulldoze).ok);
        assert!(sim.tower.get_unit(lobby).is_some());
    }
}

#[test]
fn classic_keeps_security_recycling_and_the_movie_theater() {
    for (kind, floor, x, reason) in [
        (Kind::Security, 2, 12, SECURITY_PERMANENT),
        (Kind::Recycling, -1, 22, RECYCLING_PERMANENT),
        (Kind::Cinema, 2, 60, CINEMA_PERMANENT),
    ] {
        let mut sim = tower_in(GameMode::Classic);
        let placed = sim.tower.place(kind, floor, x);
        let id = placed
            .unit_id
            .unwrap_or_else(|| panic!("{kind:?}: {:?}", placed.reason));
        assert_eq!(
            sim.remove_facility(id, RemovalMethod::Bulldoze),
            ChargeResult::refuse(reason),
            "{kind:?}"
        );
        assert!(sim.tower.get_unit(id).is_some());
        sim.tower.get_unit_mut(id).unwrap().state = UnitState::Gutted;
        assert!(
            sim.remove_facility(id, RemovalMethod::Bulldoze).ok,
            "{kind:?} shell"
        );
    }
}

#[test]
fn modern_sells_security_recycling_and_the_movie_theater() {
    for (kind, floor, x) in [
        (Kind::Security, 2, 12),
        (Kind::Recycling, -1, 22),
        (Kind::Cinema, 2, 60),
    ] {
        let mut sim = tower_in(GameMode::Modern);
        let placed = sim.tower.place(kind, floor, x);
        let id = placed
            .unit_id
            .unwrap_or_else(|| panic!("{kind:?}: {:?}", placed.reason));
        assert!(sim.remove_facility(id, RemovalMethod::Sell).ok, "{kind:?}");
    }
}
