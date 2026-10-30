//! Tests for the rooms `remove_facility` keeps: housekeeping and the lobby.
use super::*;
use crate::clock::GameMode;

/// A lobby on floor 1 and a floor of tiles on 2, in `mode`.
fn tower_in(mode: GameMode) -> Simulation {
    let mut sim = Simulation::new_game(1, mode);
    for x in 10..40 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        assert!(sim.tower.place(Kind::Floor, 2, x).ok);
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
