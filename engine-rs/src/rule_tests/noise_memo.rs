//! The noise memo: `noise_afflicted` is a revision-keyed memo over
//! `noise_afflicted_fresh`, so the two agree after every edit, every layout
//! edit moves the revision, and the memo never reaches a save or the undo
//! fingerprint. Placement and demolition parity, a swap that keeps the unit
//! count, and state blindness are pinned by
//! `tower_index_tests::{the_noise_memo_matches_the_fresh_scan_after_every_edit,
//! the_noise_memo_follows_a_swap_that_keeps_the_unit_count,
//! unit_state_is_not_an_input_to_the_noise_memo}`. This file holds the
//! multi-story source, the band edges, the shields, the revision edge and
//! the save.
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::load::deserialize;
use crate::satisfaction::{HOTEL_NOISE_TILES, OFFICE_NOISE_TILES};
use crate::sim::Simulation;
use crate::tower::Tower;

use super::{lay_row, put, unit};

/// A full-width lobby, floors 2..=top and a standard elevator at x 3.
fn served(top: i64) -> Simulation {
    let mut sim = Simulation::new_game(7, GameMode::Classic);
    sim.money = 1e12;
    sim.star = 5;
    lay_row(&mut sim, Kind::Lobby, 1);
    for floor in 2..=top {
        lay_row(&mut sim, Kind::Floor, floor);
    }
    assert!(sim.build_transport(Kind::ElevatorStandard, 3, 1, top).ok);
    sim
}

/// Every unit reads the same from the memo as from a fresh scan.
fn assert_parity(sim: &mut Simulation) {
    for i in 0..sim.tower.units.len() {
        let u = sim.tower.units[i].clone();
        let fresh = sim.noise_afflicted_fresh(&u);
        assert_eq!(sim.noise_afflicted(&u), fresh, "unit {}", u.id);
    }
}

fn afflicted(sim: &mut Simulation, id: i64) -> bool {
    let u = unit(sim, id).clone();
    sim.noise_afflicted(&u)
}

fn width(kind: Kind) -> i64 {
    kind.facility().width
}

#[test]
fn a_cinema_is_heard_on_its_upper_story_until_it_goes() {
    let mut sim = served(6);
    let cinema = put(&mut sim, Kind::Cinema, 4, 100);
    let upstairs = put(&mut sim, Kind::Office, 5, 100 + width(Kind::Cinema) + 3);
    assert_parity(&mut sim);
    assert!(
        afflicted(&mut sim, upstairs),
        "beside the cinema's second story"
    );
    assert!(sim.tower.remove_unit(cinema).is_some());
    assert_parity(&mut sim);
    assert!(!afflicted(&mut sim, upstairs));
}

#[test]
fn the_bands_end_at_eleven_tiles_for_an_office_and_twenty_one_for_a_guest_room() {
    let mut sim = served(4);
    let at_edge = put(&mut sim, Kind::Office, 2, 40);
    put(
        &mut sim,
        Kind::FastFood,
        2,
        40 + width(Kind::Office) + OFFICE_NOISE_TILES,
    );
    let past_edge = put(&mut sim, Kind::Office, 3, 40);
    put(
        &mut sim,
        Kind::FastFood,
        3,
        40 + width(Kind::Office) + OFFICE_NOISE_TILES + 1,
    );
    let room = put(&mut sim, Kind::HotelSingle, 4, 40);
    put(
        &mut sim,
        Kind::Office,
        4,
        40 + width(Kind::HotelSingle) + HOTEL_NOISE_TILES,
    );
    assert_parity(&mut sim);
    assert!(
        afflicted(&mut sim, at_edge),
        "a gap of exactly 11 is in the band"
    );
    assert!(!afflicted(&mut sim, past_edge), "a gap of 12 is past it");
    assert!(
        afflicted(&mut sim, room),
        "a gap of exactly 21 is in the guest band"
    );
}

#[test]
fn an_open_air_gap_shields_until_the_floor_is_bridged() {
    let mut sim = Simulation::new_game(9, GameMode::Classic);
    sim.money = 1e12;
    sim.star = 5;
    lay_row(&mut sim, Kind::Lobby, 1);
    lay_row(&mut sim, Kind::Floor, 2);
    for x in (40..=51).chain(55..=75) {
        put(&mut sim, Kind::Floor, 3, x);
    }
    let island = put(&mut sim, Kind::Office, 3, 40);
    put(&mut sim, Kind::FastFood, 3, 56);
    assert_parity(&mut sim);
    assert!(
        !afflicted(&mut sim, island),
        "noise does not cross open air"
    );
    for x in 52..=54 {
        put(&mut sim, Kind::Floor, 3, x);
    }
    assert_parity(&mut sim);
    assert!(afflicted(&mut sim, island), "the bridged floor carries it");
}

#[test]
fn a_lobby_tile_between_source_and_tenant_shields_it_after_a_load() {
    // Play cannot put a lobby tile mid-floor on floor 2, but an old save can
    // carry one; the load keeps it and the scan treats it as a shield.
    let build = |shield: bool| -> (Simulation, i64) {
        let mut base = Simulation::new_game(11, GameMode::Classic);
        base.money = 1e12;
        base.star = 5;
        lay_row(&mut base, Kind::Lobby, 1);
        for x in 40..=75 {
            put(&mut base, Kind::Floor, 2, x);
        }
        let office = put(&mut base, Kind::Office, 2, 40);
        put(&mut base, Kind::FastFood, 2, 40 + width(Kind::Office) + 7);
        let shield_x = 40 + width(Kind::Office) + 2;
        let mut raw = base.serialize();
        if shield {
            let tile = raw["units"]
                .as_array_mut()
                .unwrap()
                .iter_mut()
                .find(|u| u["kind"] == "floor" && u["floor"] == 2 && u["x"] == shield_x)
                .expect("the floor tile under the gap");
            tile["kind"] = "lobby".into();
        }
        let sim = deserialize(&raw).unwrap();
        if shield {
            assert_eq!(sim.tower.unit_at(2, shield_x).unwrap().kind, Kind::Lobby);
        }
        (sim, office)
    };
    let (mut shielded, office) = build(true);
    assert_parity(&mut shielded);
    assert!(!afflicted(&mut shielded, office));
    let (mut open, office) = build(false);
    assert_parity(&mut open);
    assert!(afflicted(&mut open, office));
}

/// Runs `edit` on the tower and asserts it moved the revision.
fn bumped<R>(label: &str, t: &mut Tower, edit: impl FnOnce(&mut Tower) -> R) -> R {
    let before = t.revision;
    let out = edit(t);
    assert!(t.revision > before, "{label} kept the revision");
    out
}

#[test]
fn every_layout_edit_moves_the_revision() {
    let mut sim = served(8);
    let t = &mut sim.tower;
    let office = bumped("place", t, |t| {
        t.place(Kind::Office, 2, 60).unit_id.unwrap()
    });
    bumped("remove_unit", t, |t| {
        assert!(t.remove_unit(office).is_some())
    });
    let shaft = bumped("place_transport", t, |t| {
        t.place_transport(Kind::ElevatorStandard, 30, 1, 6)
            .unit_id
            .unwrap()
    });
    bumped("resize_transport", t, |t| {
        assert!(t.resize_transport(shaft, 1, 8).ok)
    });
    bumped("set_cars", t, |t| assert!(t.set_cars(shaft, 3)));
    bumped("set_stop", t, |t| assert!(t.set_stop(shaft, 4, false)));
    bumped("clear_stops", t, |t| assert!(t.clear_stops(shaft)));
    bumped("remove_transport", t, |t| {
        assert!(t.remove_transport(shaft).is_some())
    });
    let express = bumped("place_transport (express)", t, |t| {
        t.place_transport(Kind::ElevatorExpress, 50, 1, 8)
            .unit_id
            .unwrap()
    });
    bumped("set_express_stops", t, |t| t.set_express_stops(express));
    bumped("coerce_express_stops", t, |t| {
        // Drop one skipped floor so the coerce has a stop to take back.
        let tr = t.transports.iter_mut().find(|s| s.id == express).unwrap();
        let skips = tr.skip_floors.as_mut().expect("an express skips floors");
        assert!(skips.pop().is_some(), "the express skipped no floor");
        t.coerce_express_stops();
    });
    bumped("reindex", t, |t| t.reindex());
}

#[test]
fn the_memo_never_reaches_a_save_or_the_undo_fingerprint() {
    let mut sim = served(3);
    let office = put(&mut sim, Kind::Office, 2, 40);
    put(&mut sim, Kind::FastFood, 2, 40 + width(Kind::Office));
    let cold_sig = sim.tower_signature();
    let cold = sim.serialize().to_string();
    assert!(afflicted(&mut sim, office), "warms the memo");
    assert!(!sim.noise_memo.1.is_empty());
    assert_eq!(sim.tower_signature(), cold_sig);
    let warm = sim.serialize().to_string();
    assert_eq!(warm, cold);
    assert!(!warm.contains("noiseMemo"));
    let mut restored = deserialize(&sim.serialize()).unwrap();
    assert!(restored.noise_memo.1.is_empty(), "a load starts cold");
    assert!(afflicted(&mut restored, office));
    assert_parity(&mut restored);
}
