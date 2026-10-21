//! Tests for the tenant family of the diagnostics facts (#1215): each
//! section's gate and fields on constructed towers and the binding's id
//! handling. The memos and the read-only proof are in `memo_tests.rs`.

use super::tenant::nearest_buildable_lobby_slot;
use super::{facts_json, DiagnosticFacts};
use crate::clock::GameMode;
use crate::facilities::{Kind, LOT_WIDTH};
use crate::sim::Simulation;
use crate::tower::UnitState;

pub(super) const C: i64 = LOT_WIDTH / 2;

/// A full lobby row, floor slabs on 2..=top and a centered standard
/// elevator with 8 cars stopping at every floor.
pub(super) fn served_tower(mode: GameMode, top: i64) -> Simulation {
    let mut sim = Simulation::new_game(7, mode);
    sim.money = 1e12;
    sim.star = 3;
    for x in 0..LOT_WIDTH {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    for f in 2..=top {
        for x in 0..LOT_WIDTH {
            assert!(sim.tower.place(Kind::Floor, f, x).ok);
        }
    }
    assert!(sim.build_transport(Kind::ElevatorStandard, C, 1, top).ok);
    let id = sim.tower.transports[0].id;
    assert!(sim.tower.set_cars(id, 8));
    sim
}

/// Place `kind` and set its state, satisfaction and rent; returns its id.
pub(super) fn tenant(
    sim: &mut Simulation,
    kind: Kind,
    floor: i64,
    x: i64,
    state: UnitState,
    satisfaction: f64,
) -> i64 {
    let r = sim.tower.place(kind, floor, x);
    assert!(r.ok, "{kind:?} at {floor},{x}: {:?}", r.reason);
    let id = r.unit_id.unwrap();
    let u = sim.tower.get_unit_mut(id).unwrap();
    u.state = state;
    u.satisfaction = satisfaction;
    if state != UnitState::Empty {
        u.ever_occupied = true;
    }
    id
}

pub(super) fn facts(sim: &mut Simulation, id: i64) -> DiagnosticFacts {
    sim.diagnostic_facts(id).expect("a unit")
}

#[test]
fn unknown_and_malformed_ids_answer_nothing() {
    let mut sim = served_tower(GameMode::Modern, 3);
    let id = tenant(&mut sim, Kind::Office, 2, 10, UnitState::Occupied, 1.0);
    // Unit 1 exists (the first lobby tile), so a malformed id that wrapped or
    // truncated onto 1 would answer.
    assert!(facts_json(&mut sim, Some(1.0)).is_some());
    for bad in [
        None,
        Some(f64::NAN),
        Some(f64::INFINITY),
        Some(1.5),
        Some(1.0 + f64::EPSILON),
        Some(0.0),
        Some(-1.0),
        Some(4_294_967_297.0),
        Some(1e300),
        Some(9_999_999.0),
    ] {
        assert_eq!(facts_json(&mut sim, bad), None, "{bad:?}");
    }
    let shaft = sim.tower.transports[0].id as f64;
    assert_eq!(
        facts_json(&mut sim, Some(shaft)),
        None,
        "a shaft is not a unit"
    );
    let text = facts_json(&mut sim, Some(id as f64)).expect("a unit");
    assert!(
        text.starts_with(&format!(r#"{{"id":{id},"kind":"office","mode":"modern""#)),
        "{text}"
    );
}

#[test]
fn a_floor_tile_carries_no_tenant_section() {
    let mut sim = served_tower(GameMode::Classic, 3);
    let tile = sim.tower.unit_at(2, 5).unwrap().id;
    let f = facts(&mut sim, tile);
    assert_eq!(f.kind, "floor");
    assert_eq!(
        serde_json::to_string(&f).unwrap(),
        format!(r#"{{"id":{tile},"kind":"floor","mode":"classic"}}"#)
    );
}

#[test]
fn access_reads_each_connection_state() {
    let mut sim = served_tower(GameMode::Modern, 6);
    // Floor 7 is split by a gap at 60..100 and the shaft (at C) stops there,
    // so the left run is cut off; floor 8 has no stop at all.
    for x in (0..60).chain(100..LOT_WIDTH) {
        assert!(sim.tower.place(Kind::Floor, 7, x).ok);
    }
    for x in 100..LOT_WIDTH {
        assert!(sim.tower.place(Kind::Floor, 8, x).ok);
    }
    let lift = sim.tower.transports[0].id;
    assert!(sim.tower.resize_transport(lift, 1, 7).ok);
    let near = tenant(&mut sim, Kind::Office, 3, C + 6, UnitState::Occupied, 1.0);
    let cut = tenant(&mut sim, Kind::Office, 7, 10, UnitState::Occupied, 1.0);
    let lone = tenant(&mut sim, Kind::Office, 8, 120, UnitState::Occupied, 1.0);
    assert_eq!(facts(&mut sim, near).access, Some("reachable"));
    assert_eq!(facts(&mut sim, cut).access, Some("cutOff"));
    assert_eq!(facts(&mut sim, lone).access, Some("notConnected"));
}

#[test]
fn a_ground_connected_floor_no_rider_reaches_reads_no_route() {
    // Floor 5 is split by a gap, a lift climbs 1..5 on its left and another
    // 5..8 on its right: floor 7 is connected floor by floor, but no rider
    // can walk the gap between the shafts.
    let mut sim = served_tower(GameMode::Modern, 4);
    let centered = sim.tower.transports[0].id;
    assert!(sim.tower.remove_transport(centered).is_some());
    for x in (0..C - 10).chain(C + 10..LOT_WIDTH) {
        assert!(sim.tower.place(Kind::Floor, 5, x).ok);
    }
    for f in 6..=8 {
        for x in C + 10..LOT_WIDTH {
            assert!(sim.tower.place(Kind::Floor, f, x).ok);
        }
    }
    assert!(sim.build_transport(Kind::ElevatorStandard, 20, 1, 5).ok);
    assert!(
        sim.build_transport(Kind::ElevatorStandard, LOT_WIDTH - 30, 5, 8)
            .ok
    );
    let stranded = tenant(&mut sim, Kind::Office, 7, C + 30, UnitState::Occupied, 1.0);
    assert_eq!(facts(&mut sim, stranded).access, Some("noRoute"));
}

#[test]
fn no_rate_reads_occupied_or_off_the_market() {
    let mut sim = served_tower(GameMode::Modern, 3);
    let held = tenant(&mut sim, Kind::Office, 2, 10, UnitState::Occupied, 1.0);
    let empty = tenant(&mut sim, Kind::Office, 3, 10, UnitState::Empty, 1.0);
    for id in [held, empty] {
        sim.tower.get_unit_mut(id).unwrap().no_rate = true;
    }
    assert_eq!(facts(&mut sim, held).no_rate, Some("occupied"));
    assert_eq!(facts(&mut sim, empty).no_rate, Some("offMarket"));
    let plain = tenant(&mut sim, Kind::Office, 2, C + 20, UnitState::Occupied, 1.0);
    assert_eq!(facts(&mut sim, plain).no_rate, None);
}

#[test]
fn the_long_walk_is_flagged_for_offices_and_apartments_only() {
    let mut sim = served_tower(GameMode::Modern, 3);
    let far = tenant(&mut sim, Kind::Office, 2, 0, UnitState::Occupied, 1.0);
    let near = tenant(&mut sim, Kind::Office, 3, C + 6, UnitState::Occupied, 1.0);
    let condo = tenant(&mut sim, Kind::Condo, 3, 0, UnitState::Occupied, 1.0);
    assert!(facts(&mut sim, far).far_walk);
    assert!(!facts(&mut sim, near).far_walk);
    let flat = tenant(
        &mut sim,
        Kind::RentalApartment,
        3,
        30,
        UnitState::Occupied,
        1.0,
    );
    assert!(
        facts(&mut sim, flat).far_walk,
        "the Apartment feels W1 (#502)"
    );
    assert!(
        !facts(&mut sim, condo).far_walk,
        "a condo feels no W1 drain"
    );
}

#[test]
fn the_slot_search_walks_only_legal_free_slots_nearer_than_the_lobby() {
    let sim = Simulation::new_game(1, GameMode::Modern);
    assert_eq!(nearest_buildable_lobby_slot(&sim.tower, 1), None);
    assert_eq!(
        nearest_buildable_lobby_slot(&sim.tower, 2),
        None,
        "the ground is nearer"
    );
    assert_eq!(nearest_buildable_lobby_slot(&sim.tower, 10), Some(15));
    assert_eq!(
        nearest_buildable_lobby_slot(&sim.tower, 22),
        Some(15),
        "7 floors to 15 beats 8 to 30 (no two slots tie: the interval is odd)"
    );
    assert_eq!(nearest_buildable_lobby_slot(&sim.tower, 99), Some(90));
}

#[test]
fn lobby_distance_names_the_slot_and_the_work_it_needs() {
    let mut sim = served_tower(GameMode::Modern, 10);
    let low = tenant(&mut sim, Kind::Office, 10, 10, UnitState::Occupied, 1.0);
    let f = facts(&mut sim, low)
        .lobby
        .expect("floor 10 is 9 from the ground");
    assert_eq!(f.distance, 9);
    let slot = f.slot.expect("15 is nearer");
    assert_eq!(slot.floor, 15);
    assert!(
        slot.needs_support,
        "15 sits more than a story above floor 10"
    );
    assert!(!slot.clear_first && !slot.on_slot);
    // Build up to 16 with a room on 15: the slot now needs clearing first.
    for f in 11..=16 {
        for x in 0..LOT_WIDTH {
            assert!(sim.tower.place(Kind::Floor, f, x).ok);
        }
    }
    let on = tenant(&mut sim, Kind::Office, 15, 10, UnitState::Occupied, 1.0);
    let slot = facts(&mut sim, low).lobby.unwrap().slot.unwrap();
    assert!(!slot.needs_support && slot.clear_first && !slot.on_slot);
    // Floor 15 is 14 from the ground; with the lift run up to it, the unit
    // there sits on the slot itself.
    let lift = sim.tower.transports[0].id;
    assert!(sim.tower.resize_transport(lift, 1, 16).ok);
    let s = facts(&mut sim, on)
        .lobby
        .expect("14 floors out")
        .slot
        .unwrap();
    assert!(s.on_slot && !s.clear_first && !s.needs_support);
    let near = tenant(&mut sim, Kind::Office, 3, 10, UnitState::Occupied, 1.0);
    assert_eq!(
        facts(&mut sim, near).lobby,
        None,
        "near the ground: no drain"
    );
}

#[test]
fn classic_lobby_distance_sinks_only_in_the_very_far_band() {
    let mut sim = served_tower(GameMode::Classic, 14);
    let far = tenant(&mut sim, Kind::Condo, 9, 10, UnitState::Occupied, 1.0);
    let very = tenant(&mut sim, Kind::Condo, 14, 10, UnitState::Occupied, 1.0);
    let f = facts(&mut sim, far).lobby.unwrap();
    assert!(!f.sinking, "the far band caps without eroding");
    let v = facts(&mut sim, very).lobby.unwrap();
    assert!(
        v.sinking,
        "the very-far band erodes past the served recovery"
    );
}

#[test]
fn main_gripe_names_rent_and_stays_off_for_content_or_leaving_tenants() {
    let mut sim = served_tower(GameMode::Modern, 3);
    let gouged = tenant(&mut sim, Kind::Office, 2, C + 6, UnitState::Occupied, 0.3);
    sim.tower.get_unit_mut(gouged).unwrap().rent = Some(20_000.0);
    let g = facts(&mut sim, gouged)
        .gripe
        .expect("unhappy and over market");
    assert_eq!(g.cause, "rent");
    assert_eq!((g.binding, g.adjacent, g.coverage), (None, None, None));
    let content = tenant(&mut sim, Kind::Office, 3, C + 6, UnitState::Occupied, 0.9);
    sim.tower.get_unit_mut(content).unwrap().rent = Some(20_000.0);
    assert_eq!(facts(&mut sim, content).gripe, None, "above GRIPE_WARN");
    let leaving = tenant(&mut sim, Kind::Office, 3, C + 30, UnitState::Vacating, 0.1);
    sim.tower.get_unit_mut(leaving).unwrap().rent = Some(20_000.0);
    assert_eq!(
        facts(&mut sim, leaving).gripe,
        None,
        "the notice block speaks instead"
    );
}

#[test]
fn a_noise_gripe_carries_its_sources() {
    let mut sim = served_tower(GameMode::Modern, 3);
    let condo = tenant(&mut sim, Kind::Condo, 2, C + 6, UnitState::Occupied, 0.3);
    let shop_x = C + 6 + Kind::Condo.facility().width;
    tenant(
        &mut sim,
        Kind::FastFood,
        2,
        shop_x,
        UnitState::Occupied,
        1.0,
    );
    let g = facts(&mut sim, condo).gripe.expect("a noisy neighbor");
    assert_eq!(g.cause, "noise");
    assert_eq!((g.adjacent, g.club), (Some(true), Some(false)));
}

#[test]
fn wont_lease_names_the_gate_cause_and_the_carrying_cost() {
    let mut sim = served_tower(GameMode::Modern, 3);
    let spot = tenant(&mut sim, Kind::Office, 2, C + 6, UnitState::Empty, 1.0);
    sim.tower.get_unit_mut(spot).unwrap().rent = Some(20_000.0);
    let w = facts(&mut sim, spot)
        .wont_lease
        .expect("a gouged spot erodes out");
    assert_eq!(w.gripe.map(|g| g.cause), Some("rent"));
    assert_eq!(w.carry, 700.0, "the Modern overhead (catalog economy)");
    let fair = tenant(&mut sim, Kind::Office, 3, C + 6, UnitState::Empty, 1.0);
    assert_eq!(
        facts(&mut sim, fair).wont_lease,
        None,
        "a well-placed spot fills"
    );
    sim.tower.get_unit_mut(spot).unwrap().no_rate = true;
    assert_eq!(
        facts(&mut sim, spot).wont_lease,
        None,
        "off the market is its own line"
    );
}

#[test]
fn the_carrying_cost_is_overhead_plus_a_condos_hold_tax() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let mut sim = served_tower(mode, 3);
        let condo = tenant(&mut sim, Kind::Condo, 2, 10, UnitState::Empty, 1.0);
        sim.tower.get_unit_mut(condo).unwrap().rent = Some(160_000.0);
        let priced = sim.tower.get_unit(condo).unwrap().clone();
        // At the default price (no rent set) and for a kind with no hold tax.
        sim.tower.get_unit_mut(condo).unwrap().rent = None;
        let default = sim.tower.get_unit(condo).unwrap().clone();
        let office = tenant(&mut sim, Kind::Office, 3, 10, UnitState::Empty, 1.0);
        let office = sim.tower.get_unit(office).unwrap().clone();
        let got = (
            sim.carrying_cost(&priced),
            sim.carrying_cost(&default),
            sim.carrying_cost(&office),
        );
        // Modern: the $700 overhead plus 1.5% of $160,000 ($2,400), and the
        // condo's default asking price is that same $160,000.
        let want = match mode {
            GameMode::Classic => (0.0, 0.0, 0.0),
            GameMode::Modern => (3_100.0, 3_100.0, 700.0),
        };
        assert_eq!(got, want, "{mode:?}");
    }
}

#[test]
fn the_notice_counts_down_and_never_goes_negative() {
    let mut sim = served_tower(GameMode::Modern, 3);
    let id = tenant(&mut sim, Kind::Office, 2, C + 6, UnitState::Vacating, 0.2);
    let now = sim.clock.minutes;
    {
        let u = sim.tower.get_unit_mut(id).unwrap();
        u.vacate_reason = Some("rent");
        u.vacate_at = Some(now + 90.0);
    }
    let n = facts(&mut sim, id).notice.unwrap();
    assert_eq!(
        (n.reason, n.minutes_left, n.satisfaction, n.keep_at),
        ("rent", 90.0, 0.2, 0.4)
    );
    sim.tower.get_unit_mut(id).unwrap().vacate_at = Some(now - 5.0);
    assert_eq!(facts(&mut sim, id).notice.unwrap().minutes_left, 0.0);
    sim.tower.get_unit_mut(id).unwrap().vacate_reason = None;
    assert_eq!(facts(&mut sim, id).notice, None, "no reason, no block");
}

#[test]
fn a_room_past_a_lobby_on_the_last_slot_finds_no_slot() {
    let mut sim = served_tower(GameMode::Modern, 3);
    for f in 4..=99 {
        for x in 0..LOT_WIDTH {
            assert!(sim.tower.place(Kind::Floor, f, x).ok);
        }
    }
    for x in 0..LOT_WIDTH {
        assert!(sim.tower.place(Kind::Lobby, 90, x).ok);
    }
    assert!(sim.build_transport(Kind::ElevatorExpress, C + 30, 1, 99).ok);
    let express = sim.tower.transports.last().unwrap().id;
    assert!(sim.tower.clear_stops(express));
    for f in [1, 90] {
        assert!(sim.tower.set_stop(express, f, true));
    }
    assert!(
        sim.build_transport(Kind::ElevatorStandard, C + 60, 90, 99)
            .ok
    );
    let top = tenant(&mut sim, Kind::Office, 99, 10, UnitState::Occupied, 1.0);
    let lobby = facts(&mut sim, top).lobby.expect("9 floors past the lobby");
    assert_eq!((lobby.distance, lobby.slot.clone()), (9, None));
    // The copy reads `slot === null` as "no buildable slot".
    assert!(serde_json::to_string(&lobby)
        .unwrap()
        .ends_with(r#""slot":null}"#));
}

#[test]
fn walkway_bindings_name_their_class_and_the_elevator_stop() {
    // With no attribution passed, the binding is named from the kinds that
    // stop on the floor, which pins the names the crowd rarely reaches (the
    // attributed path is compared on the TypeScript towers).
    let probe = |sim: &mut Simulation, floor: i64| {
        let id = tenant(sim, Kind::Office, floor, 10, UnitState::Empty, 1.0);
        let u = sim.tower.get_unit(id).unwrap().clone();
        let g = sim.gripe_facts(&u, "congestion", None, None);
        (g.binding, g.elevator_here)
    };
    // Each probed floor sits inside the lift's run, so its stop can drop.
    let mut sim = served_tower(GameMode::Modern, 5);
    let lift = sim.tower.transports[0].id;
    assert!(sim.build_transport(Kind::Stairs, C + 60, 3, 4).ok);
    assert!(sim.build_transport(Kind::Escalator, C + 80, 3, 4).ok);
    assert!(sim.tower.set_stop(lift, 4, false));
    assert_eq!(probe(&mut sim, 2), (Some("elevator"), None));
    assert_eq!(probe(&mut sim, 4), (Some("walkways"), Some(false)));
    let mut esc = served_tower(GameMode::Modern, 4);
    let lift = esc.tower.transports[0].id;
    assert!(esc.build_transport(Kind::Escalator, C + 40, 2, 3).ok);
    assert!(esc.tower.set_stop(lift, 3, false));
    assert_eq!(probe(&mut esc, 3), (Some("escalator"), Some(false)));
}
