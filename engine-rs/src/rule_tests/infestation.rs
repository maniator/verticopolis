//! The cockroach lifecycle: a hotel room dirty past `INFEST_DAYS` checkouts
//! turns infested, is never booked or cleaned, spreads to its neighbor, and
//! goes only by the bulldozer (Classic) or the exterminator (Modern). The
//! exterminator's fees, refusals, billed rooms and reload are
//! `services::tests::booking_mirrors_call_exterminator`,
//! `catalog::charge_tests::the_exterminator_bills_the_quoted_fees` and
//! `extermination_tests`; the coverage card is
//! `panels::tests::housekeeping_coverage_counts_reach_dirt_and_infestation`.
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::housekeeping::INFEST_DAYS;
use crate::load::deserialize;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{seeded_game, MID};

const X0: i64 = MID - 20;

/// Floor 2 over the starter lobby, served by an elevator, at two stars.
fn hotel_tower(seed: u32, mode: GameMode) -> Simulation {
    let mut sim = seeded_game(seed, mode);
    sim.star = 2;
    for i in 0..30 {
        assert!(sim.tower.place(Kind::Floor, 2, X0 + i).ok);
    }
    assert!(sim.build_transport(Kind::ElevatorStandard, X0, 1, 2).ok);
    sim
}

fn hotel(sim: &mut Simulation, x: i64, state: UnitState) -> i64 {
    let id = sim.tower.place(Kind::HotelSingle, 2, x).unit_id.unwrap();
    sim.tower.get_unit_mut(id).unwrap().state = state;
    id
}

fn state(sim: &Simulation, id: i64) -> UnitState {
    sim.tower.get_unit(id).unwrap().state
}

fn hours(sim: &mut Simulation, n: usize) {
    for _ in 0..n {
        sim.tick(60.0);
    }
}

#[test]
fn a_room_left_dirty_turns_infested_on_its_last_checkout() {
    let mut sim = hotel_tower(1, GameMode::Classic);
    let room = hotel(&mut sim, X0, UnitState::Dirty);
    for _ in 0..INFEST_DAYS - 1 {
        sim.hotel_checkout();
        assert_eq!(state(&sim, room), UnitState::Dirty);
    }
    sim.hotel_checkout();
    assert_eq!(state(&sim, room), UnitState::Infested);
}

#[test]
fn dirty_and_infested_rooms_are_never_booked() {
    let mut sim = hotel_tower(2, GameMode::Classic);
    let dirty = hotel(&mut sim, X0, UnitState::Dirty);
    let infested = hotel(&mut sim, X0 + 20, UnitState::Infested);
    hours(&mut sim, 48);
    assert_ne!(state(&sim, dirty), UnitState::Asleep);
    assert_ne!(state(&sim, infested), UnitState::Asleep);
}

#[test]
fn housekeeping_cannot_clean_an_infested_room() {
    let mut sim = hotel_tower(3, GameMode::Classic);
    let room = hotel(&mut sim, X0, UnitState::Infested);
    assert!(sim.tower.place(Kind::Housekeeping, 2, X0 + 10).ok);
    hours(&mut sim, 24);
    assert_eq!(state(&sim, room), UnitState::Infested);
}

#[test]
fn only_an_infested_room_spreads_to_its_clean_neighbor() {
    for (source, spread) in [
        (UnitState::Infested, UnitState::Dirty),
        (UnitState::Dirty, UnitState::Empty),
    ] {
        let mut sim = hotel_tower(4, GameMode::Classic);
        let a = hotel(&mut sim, X0, source);
        let width = sim.tower.get_unit(a).unwrap().width;
        let b = hotel(&mut sim, X0 + width, UnitState::Empty);
        sim.hotel_checkout();
        assert_eq!(state(&sim, b), spread, "next to a {source:?} room");
    }
}

#[test]
fn an_infested_room_on_an_unserved_floor_stays_infested() {
    let mut sim = hotel_tower(14, GameMode::Classic);
    for i in 0..10 {
        assert!(sim.tower.place(Kind::Floor, 3, X0 + i).ok);
    }
    let room = sim.tower.place(Kind::HotelSingle, 3, X0).unit_id.unwrap();
    let unit = sim.tower.get_unit_mut(room).unwrap();
    unit.state = UnitState::Infested;
    unit.satisfaction = 0.0;
    hours(&mut sim, 24);
    assert_eq!(state(&sim, room), UnitState::Infested);
}

#[test]
fn an_infested_room_can_be_bulldozed() {
    let mut sim = hotel_tower(15, GameMode::Classic);
    let room = hotel(&mut sim, X0, UnitState::Infested);
    assert!(sim.sell_at(2, X0));
    assert!(sim.tower.get_unit(room).is_none());
}

#[test]
fn the_exterminator_clears_the_billed_rooms_after_the_next_checkout() {
    let mut sim = hotel_tower(6, GameMode::Modern);
    let a = hotel(&mut sim, X0, UnitState::Infested);
    let b = hotel(&mut sim, X0 + 20, UnitState::Infested);
    let before = sim.money;
    assert_eq!(sim.call_exterminator(), Ok((9000.0, 2)));
    assert_eq!(sim.money, before - 9000.0);
    assert_eq!(
        (state(&sim, a), state(&sim, b)),
        (UnitState::Infested, UnitState::Infested)
    );
    hours(&mut sim, 30);
    assert_eq!(
        (state(&sim, a), state(&sim, b)),
        (UnitState::Empty, UnitState::Empty)
    );
}

#[test]
fn the_dirty_clock_survives_a_reload_and_a_far_future_booking_is_clamped() {
    let mut sim = hotel_tower(8, GameMode::Modern);
    let room = hotel(&mut sim, X0, UnitState::Dirty);
    sim.tower
        .get_unit_mut(room)
        .unwrap()
        .extras_mut()
        .dirty_days = Some(2);
    let loaded = deserialize(&sim.serialize()).unwrap();
    let unit = loaded.tower.get_unit(room).unwrap();
    assert_eq!(
        (unit.state, unit.extras().dirty_days),
        (UnitState::Dirty, Some(2))
    );

    let mut raw = sim.serialize();
    let today = sim.clock.day() as f64;
    raw["exterminationDueDay"] = (today + 9999.0).into();
    assert_eq!(
        deserialize(&raw).unwrap().extermination_due_day,
        Some(today + 1.0)
    );
}

#[test]
fn the_infestation_notice_offers_the_exterminator_only_where_the_mode_has_one() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let mut sim = hotel_tower(1, mode);
        hotel(&mut sim, X0, UnitState::Dirty);
        for _ in 0..INFEST_DAYS {
            sim.hotel_checkout();
        }
        let notice = sim
            .log
            .iter()
            .find(|e| e.text.contains("cockroach-infested"))
            .map(|e| e.text.clone())
            .expect("an infestation notice");
        assert_eq!(
            notice.contains("Call an exterminator"),
            mode.infestation_recovery().is_some(),
            "{mode:?}: {notice}"
        );
        assert!(notice.contains("bulldoze") || notice.contains("Bulldoze"));
    }
}
