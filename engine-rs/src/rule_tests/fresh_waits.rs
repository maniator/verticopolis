//! Fresh commute waits (#2021): a floor's average commute wait goes with
//! the people who waited it, so new tenants on an emptied floor start from
//! no wait, and a saved tower keeps and forgets the same averages.
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::load::deserialize;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::MID;

const C: i64 = MID - 15;
const OFFICE_FLOOR: i64 = 5;
const BARE_FLOOR: i64 = 3;
const JAM: f64 = 500.0;

/// Lobby and floors 2 to 6, an office on 5 in `state`, one elevator, and a
/// jammed average on the office floor and on a floor with no rooms.
fn tower_with_jams(state: UnitState) -> (Simulation, i64) {
    let mut sim = Simulation::new_game(11, GameMode::Classic);
    sim.money = 1e9;
    for x in C..C + 30 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        for floor in 2..=6 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    let id = sim
        .tower
        .place(Kind::Office, OFFICE_FLOOR, C)
        .unit_id
        .unwrap();
    sim.tower.get_unit_mut(id).unwrap().state = state;
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorStandard, C + 20, 1, 6)
            .ok
    );
    for floor in [OFFICE_FLOOR, BARE_FLOOR] {
        sim.crowd.commute_wait_by_floor.insert(floor, JAM);
    }
    (sim, id)
}

fn average(sim: &Simulation, floor: i64) -> Option<f64> {
    sim.crowd.commute_wait_by_floor.get(&floor).copied()
}

#[test]
fn a_floor_keeps_its_waits_while_someone_works_there_and_forgets_them_once_empty() {
    let (mut sim, id) = tower_with_jams(UnitState::Occupied);
    let revision = sim.crowd.commute_revision;
    sim.update_satisfaction();
    assert_eq!(average(&sim, OFFICE_FLOOR), Some(JAM), "the office stays");
    assert_eq!(average(&sim, BARE_FLOOR), None, "nobody there");
    assert_ne!(sim.crowd.commute_revision, revision, "hosts see the change");
    sim.tower.get_unit_mut(id).unwrap().state = UnitState::Empty;
    sim.update_satisfaction();
    assert_eq!(average(&sim, OFFICE_FLOOR), None, "the tenant left");
    assert_eq!(
        sim.commute_wait_congestion(OFFICE_FLOOR),
        0.0,
        "the next tenant starts from no wait"
    );
    // In play a new tenant goes from Empty straight to Occupied.
    sim.tower.get_unit_mut(id).unwrap().state = UnitState::Occupied;
    sim.update_satisfaction();
    assert_eq!(average(&sim, OFFICE_FLOOR), None, "nothing to inherit");
}

#[test]
fn an_imported_room_still_moving_in_does_not_inherit_the_old_jam() {
    let (mut sim, _) = tower_with_jams(UnitState::MovingIn);
    sim.update_satisfaction();
    assert_eq!(average(&sim, OFFICE_FLOOR), None);
}

#[test]
fn a_saved_tower_keeps_the_averages_and_forgets_the_same_floors() {
    let (mut sim, _) = tower_with_jams(UnitState::Occupied);
    let mut loaded = deserialize(&sim.serialize()).unwrap();
    assert_eq!(average(&loaded, OFFICE_FLOOR), Some(JAM));
    assert_eq!(average(&loaded, BARE_FLOOR), Some(JAM));
    sim.update_satisfaction();
    loaded.update_satisfaction();
    assert_eq!(
        loaded.crowd.commute_stress_json(),
        sim.crowd.commute_stress_json()
    );
}
