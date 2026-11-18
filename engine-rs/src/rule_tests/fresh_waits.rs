//! Fresh commute waits (#2021): a floor's average commute wait goes with
//! the people who waited it, so new tenants on an emptied floor start from
//! no wait, and a saved tower keeps and forgets the same averages.
use crate::clock::GameMode;
use crate::crowd::motion::finish;
use crate::crowd::spawn::add;
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

const SHOP_FLOOR: i64 = 4;

/// [`tower_with_jams`] with an open fast food on its own floor and a jammed
/// average there too.
fn tower_with_a_shop_floor_jam() -> (Simulation, i64) {
    let (mut sim, _) = tower_with_jams(UnitState::Occupied);
    let id = sim
        .tower
        .place(Kind::FastFood, SHOP_FLOOR, C)
        .unit_id
        .unwrap();
    sim.tower.get_unit_mut(id).unwrap().state = UnitState::Occupied;
    sim.crowd.commute_wait_by_floor.insert(SHOP_FLOOR, JAM);
    (sim, id)
}

#[test]
fn a_floor_of_shops_keeps_its_waits_only_for_the_hour_they_were_made() {
    let (mut sim, id) = tower_with_a_shop_floor_jam();
    let before = sim.tower.get_unit(id).unwrap().satisfaction;
    sim.update_satisfaction();
    assert!(
        sim.tower.get_unit(id).unwrap().satisfaction < before,
        "this hour's jam still drains the shop"
    );
    assert_eq!(average(&sim, SHOP_FLOOR), None, "and is gone after it");
    assert_eq!(
        average(&sim, OFFICE_FLOOR),
        Some(JAM),
        "the office keeps its own"
    );
    let after = sim.tower.get_unit(id).unwrap().satisfaction;
    sim.update_satisfaction();
    assert!(
        sim.tower.get_unit(id).unwrap().satisfaction >= after,
        "with no new trip the shop stops draining"
    );
}

#[test]
fn a_shop_beside_an_office_leaves_the_office_floor_its_waits() {
    let (mut sim, _) = tower_with_jams(UnitState::Occupied);
    let shop = sim
        .tower
        .place(Kind::FastFood, OFFICE_FLOOR, C + 9)
        .unit_id
        .unwrap();
    sim.tower.get_unit_mut(shop).unwrap().state = UnitState::Occupied;
    sim.update_satisfaction();
    assert_eq!(average(&sim, OFFICE_FLOOR), Some(JAM));
}

/// Finishes a customer's trip home from `SHOP_FLOOR` that ran out of
/// patience after `waited` seconds, the way `motion::finish` records it.
fn gave_up_leaving_the_shops(sim: &mut Simulation, waited: f64) {
    let i = add(&mut sim.crowd, &sim.tower, SHOP_FLOOR, 6, None, None).unwrap();
    let p = &mut sim.crowd.people[i];
    (p.origin_floor, p.trip_wait, p.wait, p.gave_up) = (SHOP_FLOOR, waited, 0.0, true);
    finish(&mut sim.crowd, i, &mut sim.tower);
}

fn congestion_after(sim: &mut Simulation, give_ups: usize) -> f64 {
    for _ in 0..give_ups {
        gave_up_leaving_the_shops(sim, 1.0);
    }
    sim.commute_wait_congestion(SHOP_FLOOR)
}

#[test]
fn one_give_up_does_not_jam_a_quiet_floor_of_shops() {
    let (mut sim, id) = tower_with_a_shop_floor_jam();
    sim.update_satisfaction();
    assert_eq!(average(&sim, SHOP_FLOOR), None, "a fresh hour on the shops");
    let rating = |sim: &Simulation| sim.tower.get_unit(id).unwrap().satisfaction;

    // One rider who gave up counts as twice the limit (#2019), but the
    // floor's average starts from no wait, so it moves only part way (#2435).
    let one = congestion_after(&mut sim, 1);
    assert!(one > 0.0, "the give-up still counts");
    assert!(one < 1.0, "one give-up is not a jam: {one}");
    let before = rating(&sim);
    sim.update_satisfaction();
    assert!(rating(&sim) >= before, "and drains nothing");

    // A run of them in one hour is a jam, and still drains the shop.
    assert_eq!(average(&sim, SHOP_FLOOR), None);
    let run = congestion_after(&mut sim, 5);
    assert!(run > 1.0, "five give-ups in an hour read as jammed: {run}");
    let before = rating(&sim);
    sim.update_satisfaction();
    assert!(rating(&sim) < before, "and drain the shop");
}
