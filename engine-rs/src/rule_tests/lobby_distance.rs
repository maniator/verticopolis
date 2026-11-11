//! The graduated lobby-distance drain (#394), the second half of the
//! `walkingPenalties` suite: its edges come from the lobby ladder, so the
//! deepest floor between two lobbies is free, a far tenant is capped and a
//! very-far one wears down to a `lobbyFar` notice in Classic, Modern is
//! gentler, and every capped floor's advice can be followed. The drain's
//! values per mode are pinned by `catalog::tests::each_mode_matches_the_lock`;
//! the card's slot advice by `diagnostics::tenant_tests::{lobby_distance_names_the_slot_and_the_work_it_needs,
//! a_room_past_a_lobby_on_the_last_slot_finds_no_slot,
//! classic_lobby_distance_sinks_only_in_the_very_far_band}`.
use crate::clock::GameMode;
use crate::facilities::{Kind, LOBBY_INTERVAL, MAX_FLOOR};
use crate::rules::{LOBBY_FAR_CAP, LOBBY_VERY_FAR_CAP};
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::walking_penalties::{content, hours, served};
use super::{put, seat, unit, MID};

fn sat(sim: &Simulation, id: i64) -> f64 {
    unit(sim, id).satisfaction
}

#[test]
fn the_deepest_floor_between_two_lobbies_is_free_of_the_drain() {
    let mut sim = served(9, GameMode::Classic, 8, 3);
    let mid_block = content(&mut sim, Kind::Office, 8, 40);
    hours(&mut sim, 40);
    assert!(
        sat(&sim, mid_block) > 0.9,
        "7 floors up: no cap, no erosion"
    );
    assert_eq!(unit(&sim, mid_block).state, UnitState::Occupied);
}

#[test]
fn classic_caps_a_far_tenant_without_evicting_it() {
    let mut sim = served(7, GameMode::Classic, 10, 3);
    let near = content(&mut sim, Kind::Office, 2, 40);
    let far = content(&mut sim, Kind::Office, 9, 40);
    hours(&mut sim, 40);
    assert!(sat(&sim, far) <= LOBBY_FAR_CAP + 1e-9);
    assert!(
        sat(&sim, far) > LOBBY_FAR_CAP - 0.05,
        "it recovers up to the cap"
    );
    assert_eq!(unit(&sim, far).state, UnitState::Occupied);
    assert!(sat(&sim, near) > 0.9);
}

#[test]
fn classic_wears_a_very_far_office_or_condo_down_to_a_lobby_far_notice() {
    for (seed, kind) in [(8, Kind::Office), (21, Kind::Condo)] {
        let mut sim = served(seed, GameMode::Classic, 14, 3);
        let id = put(&mut sim, kind, 13, 40);
        seat(&mut sim, id, UnitState::Occupied, 0.1);
        hours(&mut sim, 40);
        let u = unit(&sim, id);
        assert_eq!(u.state, UnitState::Vacating, "{kind:?}");
        assert_eq!(u.extras().vacate_reason, Some("lobbyFar"), "{kind:?}");
    }
}

#[test]
fn classic_holds_a_very_far_office_or_guest_room_under_the_very_far_ceiling() {
    for (seed, kind, state) in [
        (11, Kind::Office, UnitState::Occupied),
        (22, Kind::HotelSingle, UnitState::Occupied),
    ] {
        let mut sim = served(seed, GameMode::Classic, 14, 3);
        let id = put(&mut sim, kind, 13, 40);
        seat(&mut sim, id, state, 1.0);
        hours(&mut sim, 5);
        assert!(sat(&sim, id) <= LOBBY_VERY_FAR_CAP + 1e-9, "{kind:?}");
        if kind == Kind::Office {
            assert_eq!(unit(&sim, id).state, UnitState::Occupied);
        }
    }
}

#[test]
fn a_sky_lobby_beside_the_floor_cancels_the_drain() {
    let mut sim = Simulation::new_game(12, GameMode::Classic);
    sim.money = 1e12;
    sim.star = 1;
    super::lay_row(&mut sim, Kind::Lobby, 1);
    for floor in 2..=20 {
        let kind = if floor == LOBBY_INTERVAL {
            Kind::Lobby
        } else {
            Kind::Floor
        };
        super::lay_row(&mut sim, kind, floor);
    }
    assert!(sim.build_transport(Kind::ElevatorStandard, 3, 1, 20).ok);
    let near_sky = content(&mut sim, Kind::Office, 16, 40);
    assert_eq!(sim.tower.nearest_lobby_floor_distance(16), 1);
    hours(&mut sim, 20);
    assert!(sat(&sim, near_sky) > 0.9);
    assert_eq!(unit(&sim, near_sky).state, UnitState::Occupied);
}

#[test]
fn modern_is_gentler_than_classic_at_the_same_very_far_distance() {
    let run = |mode| {
        let mut sim = served(13, mode, 14, 3);
        let id = content(&mut sim, Kind::Office, 13, 40);
        hours(&mut sim, 40);
        unit(&sim, id).clone()
    };
    let classic = run(GameMode::Classic);
    let modern = run(GameMode::Modern);
    assert!(modern.satisfaction > classic.satisfaction);
    assert!(modern.satisfaction < 1.0, "still capped");
    assert_eq!(modern.state, UnitState::Occupied);
}

#[test]
fn every_capped_floor_of_a_full_lobby_ladder_sits_above_the_last_slot_and_never_erodes() {
    let mut sim = Simulation::new_game(31, GameMode::Classic);
    sim.money = 1e12;
    for floor in 1..=MAX_FLOOR {
        let kind = if floor == 1 || floor % LOBBY_INTERVAL == 0 {
            Kind::Lobby
        } else {
            Kind::Floor
        };
        for x in MID..MID + 40 {
            assert!(sim.tower.place(kind, floor, x).ok, "{kind:?} at {floor}");
        }
    }
    let highest_slot = MAX_FLOOR / LOBBY_INTERVAL * LOBBY_INTERVAL;
    let mut capped = 0;
    for floor in 1..=MAX_FLOOR {
        let distance = sim.tower.nearest_lobby_floor_distance(floor);
        for mode in [GameMode::Classic, GameMode::Modern] {
            let drain = mode.lobby_distance_drain(distance);
            if drain.cap >= 1.0 {
                continue;
            }
            capped += 1;
            assert!(
                floor > highest_slot,
                "floor {floor} caps between two lobbies"
            );
            assert_eq!(
                drain.erosion, 0.0,
                "floor {floor}: the top block caps, never evicts"
            );
        }
    }
    assert!(capped > 0, "the floors past the last slot do cap");
}

#[test]
fn every_capped_floor_beside_a_skipped_slot_names_that_slot() {
    // Lobbies on 1, 15 and 45, with slot 30 left as a plain floor: each
    // capped tenant's card names 30 as the slot that would lift it.
    let mut sim = Simulation::new_game(32, GameMode::Classic);
    sim.money = 1e12;
    for floor in 1..=45 {
        let kind = if floor == 1 || (floor % LOBBY_INTERVAL == 0 && floor != 30) {
            Kind::Lobby
        } else {
            Kind::Floor
        };
        for x in MID..MID + 40 {
            assert!(sim.tower.place(kind, floor, x).ok, "{kind:?} at {floor}");
        }
    }
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorStandard, MID, 1, 30)
            .ok
    );
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorStandard, MID + 6, 15, 45)
            .ok
    );
    let mut capped = 0;
    for floor in 2..=45 {
        let distance = sim.tower.nearest_lobby_floor_distance(floor);
        let caps = [GameMode::Classic, GameMode::Modern]
            .iter()
            .any(|m| m.lobby_distance_drain(distance).cap < 1.0);
        if !caps {
            continue;
        }
        capped += 1;
        let office = put(&mut sim, Kind::Office, floor, MID + 20);
        let slot = sim
            .diagnostic_facts(office)
            .unwrap()
            .lobby
            .and_then(|l| l.slot);
        assert_eq!(slot.map(|s| s.floor), Some(30), "floor {floor}");
    }
    assert!(capped > 0, "the skipped slot bites");
}
