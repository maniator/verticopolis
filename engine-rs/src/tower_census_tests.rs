//! Tests for the room census in `tower_index.rs` (#1239): `count_kind` and
//! the Classic escalator office rule equal the walks over every unit they
//! replaced, after each kind of layout edit.

use crate::clock::GameMode;
use crate::facilities::{Kind, FACILITIES};
use crate::sim::Simulation;
use crate::tower::{Tower, UnitState};

fn must(placed: crate::tower::PlaceResult) -> i64 {
    assert!(placed.ok, "{:?}", placed.reason);
    placed.unit_id.unwrap_or(-1)
}

/// A lobby on floor 1 and floor tiles on floors 2 to 4, x 100 to 139.
fn stacked() -> Tower {
    let mut tower = Tower::new();
    let lobby = Kind::Lobby.facility().width;
    for x in (100..140).step_by(lobby as usize) {
        must(tower.place(Kind::Lobby, 1, x));
    }
    for floor in 2..=4 {
        for x in 100..140 {
            must(tower.place(Kind::Floor, floor, x));
        }
    }
    tower
}

/// `count_kind` and the escalator office test as the walks over every unit
/// answered them before the census (#1239).
fn walked_count(tower: &Tower, kind: Kind) -> i64 {
    tower.units.iter().filter(|u| u.kind == kind).count() as i64
        + tower.transports.iter().filter(|t| t.kind == kind).count() as i64
}

fn walked_office_on(tower: &Tower, floor: i64) -> bool {
    tower
        .units
        .iter()
        .any(|u| u.kind == Kind::Office && u.floor == floor)
}

/// Every kind and every floor equals its walk, and the second read (a memo
/// hit) gives the same answer.
fn assert_census_matches_walks(tower: &Tower) {
    for _ in 0..2 {
        for f in FACILITIES.iter() {
            assert_eq!(tower.count_kind(f.kind), walked_count(tower, f.kind));
        }
        for floor in -2..=8 {
            assert_eq!(tower.has_office_on(floor), walked_office_on(tower, floor));
        }
    }
}

#[test]
fn the_census_follows_every_place_remove_and_shaft_edit() {
    let mut tower = stacked();
    assert_census_matches_walks(&tower);
    let office = must(tower.place(Kind::Office, 2, 100));
    assert_census_matches_walks(&tower);
    assert!(tower.has_office_on(2));
    let medical = must(tower.place(Kind::Medical, 3, 100));
    must(tower.place(Kind::Medical, 4, 100));
    assert_eq!(tower.count_kind(Kind::Medical), 2);
    assert_census_matches_walks(&tower);
    // Shafts are counted live, not from the census.
    must(tower.place_transport(Kind::ElevatorStandard, 102, 1, 4));
    must(tower.place_transport(Kind::ElevatorExpress, 114, 1, 4));
    must(tower.place_transport(Kind::Escalator, 126, 3, 4));
    assert_eq!(tower.count_kind(Kind::ElevatorStandard), 1);
    assert_census_matches_walks(&tower);
    let shaft = tower.transports[0].id;
    assert!(tower.remove_transport(shaft).is_some());
    assert_census_matches_walks(&tower);
    assert!(tower.remove_unit(medical).is_some());
    assert_eq!(tower.count_kind(Kind::Medical), 1);
    assert_census_matches_walks(&tower);
    // A swap that keeps the unit count: the office goes and a tile comes,
    // with no read in between, so only the revision tells.
    let count = tower.units.len();
    assert!(tower.remove_unit(office).is_some());
    must(tower.place(Kind::Floor, 5, 100));
    assert_eq!(tower.units.len(), count);
    assert!(!tower.has_office_on(2));
    assert_census_matches_walks(&tower);
    // Unit state is not an input: a gutted or burning office still counts.
    let office = must(tower.place(Kind::Office, 3, 120));
    for state in [UnitState::Construction, UnitState::Gutted, UnitState::Fire] {
        tower.get_unit_mut(office).unwrap().state = state;
        assert!(tower.has_office_on(3), "{state:?}");
        assert_census_matches_walks(&tower);
    }
}

#[test]
fn a_reload_recounts_the_census() {
    let mut sim = Simulation::new_game(7, GameMode::Classic);
    sim.tower = stacked();
    must(sim.tower.place(Kind::Office, 2, 100));
    must(sim.tower.place(Kind::Cinema, 3, 100));
    must(sim.tower.place_transport(Kind::Stairs, 134, 1, 2));
    assert_census_matches_walks(&sim.tower);
    let loaded = crate::load::deserialize(&sim.serialize()).expect("the save loads");
    assert_census_matches_walks(&loaded.tower);
    assert_eq!(loaded.tower.count_kind(Kind::Cinema), 1);
    assert!(loaded.tower.has_office_on(2));
    // A list assigned wholesale, as a load does, keeps the memo's answer
    // until `reindex` resets it.
    let mut units = sim.tower.units.clone();
    let office = units.iter().position(|u| u.kind == Kind::Office).unwrap();
    units[office].kind = Kind::Security;
    sim.tower.units = units;
    assert!(sim.tower.has_office_on(2));
    sim.tower.reindex();
    assert!(!sim.tower.has_office_on(2));
    assert_eq!(sim.tower.count_kind(Kind::Security), 1);
    assert_census_matches_walks(&sim.tower);
}

/// A tower wide enough for a full pool of shafts: lobbies and two floors
/// across x 0 to 199.
fn wide() -> Tower {
    let mut tower = Tower::new();
    let lobby = Kind::Lobby.facility().width;
    for x in (0..200).step_by(lobby as usize) {
        must(tower.place(Kind::Lobby, 1, x));
    }
    for floor in 2..=3 {
        for x in 0..200 {
            must(tower.place(Kind::Floor, floor, x));
        }
    }
    tower
}

#[test]
fn the_build_caps_and_the_escalator_rule_read_the_census() {
    let mut tower = wide();
    // A single-copy cap refuses once one stands, and frees on removal.
    assert!(tower.cap_reason(Kind::WeddingHall).is_none());
    tower.units.push(tower.units[0].clone());
    let hall = tower.units.len() - 1;
    tower.units[hall].kind = Kind::WeddingHall;
    tower.reindex();
    assert!(tower.cap_reason(Kind::WeddingHall).is_some());
    tower.units.pop();
    tower.reindex();
    assert!(tower.cap_reason(Kind::WeddingHall).is_none());
    // A pooled cap counts the shafts live: 24 elevator shafts fill it.
    let width = Kind::ElevatorStandard.facility().width;
    for i in 0..24 {
        must(tower.place_transport(Kind::ElevatorStandard, i * width, 1, 2));
    }
    assert!(tower.cap_reason(Kind::ElevatorExpress).is_some());
    let shaft = tower.transports[0].id;
    assert!(tower.remove_transport(shaft).is_some());
    assert!(tower.cap_reason(Kind::ElevatorExpress).is_none());
    // The Classic escalator rule follows the office floors.
    tower.allows_escalator_on_office_floors = false;
    assert!(tower.validate_transport(Kind::Escalator, 150, 2, 3).ok);
    let office = must(tower.place(Kind::Office, 2, 100));
    assert!(!tower.validate_transport(Kind::Escalator, 150, 2, 3).ok);
    assert!(tower.remove_unit(office).is_some());
    assert!(tower.validate_transport(Kind::Escalator, 150, 2, 3).ok);
}

#[test]
fn a_transport_kind_held_by_a_unit_keeps_its_count() {
    // A save can hold a shaft kind in its unit list (the loader keeps any
    // kind it can parse). The old walk counted it, so the census must too.
    let mut tower = stacked();
    must(tower.place_transport(Kind::ElevatorStandard, 102, 1, 4));
    let mut forged = tower.units[0].clone();
    forged.kind = Kind::ElevatorStandard;
    tower.units.push(forged);
    tower.reindex();
    assert_eq!(tower.count_kind(Kind::ElevatorStandard), 2);
    assert_census_matches_walks(&tower);
    let pooled = [
        Kind::ElevatorStandard,
        Kind::ElevatorService,
        Kind::ElevatorExpress,
    ];
    let walked: i64 = pooled.iter().map(|&k| walked_count(&tower, k)).sum();
    assert_eq!(walked, 2);
    for kind in pooled {
        assert_eq!(tower.cap_reason(kind), None);
    }
}
