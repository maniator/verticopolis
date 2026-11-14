//! An express elevator stops at every basement floor it passes, in both
//! modes, as the original's did (the SimTower wiki), and above ground only
//! at the lobbies. A basement stop is the player's to turn off, and a save
//! keeps that choice; a save from before this rule, whose express skipped
//! the basements, loads with every basement stop on.
use serde_json::Value;

use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::load::{deserialize, deserialize_tdt};
use crate::sim::Simulation;

use super::{lay_row, MID};

const MODES: [GameMode; 2] = [GameMode::Classic, GameMode::Modern];
/// The sky lobby the express climbs to.
const SKY: i64 = 15;
/// The lowest basement, B4.
const DEEPEST: i64 = -3;

/// A full-width ground lobby, floors 2 to 14, a sky lobby on 15 and four
/// basements (B1 to B4, floors 0 to -3), with no transport.
fn tower(mode: GameMode) -> Simulation {
    let mut sim = Simulation::new_game(11, mode);
    sim.money = 1e12;
    // An express unlocks at three stars.
    sim.star = 3;
    lay_row(&mut sim, Kind::Lobby, 1);
    for floor in 2..SKY {
        lay_row(&mut sim, Kind::Floor, floor);
    }
    lay_row(&mut sim, Kind::Lobby, SKY);
    for floor in (DEEPEST..=0).rev() {
        lay_row(&mut sim, Kind::Floor, floor);
    }
    sim
}

fn shaft(sim: &mut Simulation, kind: Kind, bottom: i64, top: i64) -> i64 {
    let r = sim.build_transport(kind, MID, bottom, top);
    assert!(r.ok, "{kind:?} {bottom}..{top}: {:?}", r.reason);
    sim.tower.transports.last().unwrap().id
}

fn stops(sim: &Simulation, id: i64) -> Vec<i64> {
    let t = sim.tower.get_transport(id).unwrap();
    (t.bottom..=t.top).filter(|&f| t.stops_at(f)).collect()
}

/// The floors a new express from B4 to the sky lobby stops at.
const ALL_BASEMENTS: [i64; 6] = [DEEPEST, -2, -1, 0, 1, SKY];

#[test]
fn a_new_express_stops_at_every_basement_floor_and_the_lobbies() {
    for mode in MODES {
        let mut sim = tower(mode);
        let id = shaft(&mut sim, Kind::ElevatorExpress, DEEPEST, SKY);
        assert_eq!(stops(&sim, id), ALL_BASEMENTS, "{mode:?}");
    }
}

#[test]
fn a_basement_stop_turns_off_and_on_but_a_plain_floor_above_stays_off() {
    for mode in MODES {
        let mut sim = tower(mode);
        let id = shaft(&mut sim, Kind::ElevatorExpress, DEEPEST, SKY);
        assert!(sim.tower.set_stop(id, -1, false), "{mode:?}");
        assert_eq!(stops(&sim, id), [DEEPEST, -2, 0, 1, SKY], "{mode:?}");
        assert!(sim.tower.set_stop(id, -1, true), "{mode:?}");
        assert_eq!(stops(&sim, id), ALL_BASEMENTS, "{mode:?}");
        assert!(
            !sim.tower.set_stop(id, 5, true),
            "{mode:?}: floor 5 has no lobby"
        );
        assert_eq!(stops(&sim, id), ALL_BASEMENTS, "{mode:?}");
    }
}

#[test]
fn an_express_extended_down_stops_at_the_basements_it_now_passes() {
    for mode in MODES {
        let mut sim = tower(mode);
        let id = shaft(&mut sim, Kind::ElevatorExpress, 1, SKY);
        assert_eq!(stops(&sim, id), [1, SKY], "{mode:?}");
        assert!(sim.tower.resize_transport(id, DEEPEST, SKY).ok, "{mode:?}");
        assert_eq!(stops(&sim, id), ALL_BASEMENTS, "{mode:?}");
    }
}

#[test]
fn express_stops_on_another_elevator_still_keep_to_the_lobbies() {
    for mode in MODES {
        let mut sim = tower(mode);
        let id = shaft(&mut sim, Kind::ElevatorStandard, DEEPEST, 14);
        sim.tower.set_express_stops(id);
        assert_eq!(stops(&sim, id), [DEEPEST, 1, 14], "{mode:?}");
    }
}

#[test]
fn a_save_keeps_a_basement_stop_the_player_turned_off() {
    for mode in MODES {
        let mut sim = tower(mode);
        let id = shaft(&mut sim, Kind::ElevatorExpress, DEEPEST, SKY);
        assert!(sim.tower.set_stop(id, -1, false));
        let loaded = deserialize(&sim.serialize()).expect("loads");
        assert_eq!(stops(&loaded, id), [DEEPEST, -2, 0, 1, SKY], "{mode:?}");
    }
}

#[test]
fn a_save_from_the_lobby_only_rule_loads_with_every_basement_stop_on() {
    for mode in MODES {
        let mut sim = tower(mode);
        let id = shaft(&mut sim, Kind::ElevatorExpress, DEEPEST, SKY);
        let mut save = sim.serialize();
        let shaft = save["transports"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|t| t["id"] == id)
            .unwrap();
        // How the old rule wrote it: every floor between the lobbies
        // skipped, the basements included, and no marker.
        let old_skips: Vec<i64> = (-2..=0).chain(2..SKY).collect();
        shaft["skipFloors"] = Value::from(old_skips);
        shaft
            .as_object_mut()
            .unwrap()
            .remove("preserveBasementStops");
        let loaded = deserialize(&save).expect("loads");
        assert_eq!(stops(&loaded, id), ALL_BASEMENTS, "{mode:?}");
        let t = loaded.tower.get_transport(id).unwrap();
        assert!(t.preserve_basement_stops, "{mode:?}: the load marks it");
    }
}

#[test]
fn someone_in_a_basement_rides_the_express_to_the_sky_lobby() {
    for mode in MODES {
        let mut sim = tower(mode);
        let id = shaft(&mut sim, Kind::ElevatorExpress, DEEPEST, SKY);
        let x = Some(MID as f64);
        let route = sim.crowd.route(&sim.tower, -1, SKY, x, x).expect("a route");
        assert_eq!(route.shafts, [id], "{mode:?}");
        assert_eq!(route.floors, [-1, SKY], "{mode:?}");
    }
}

#[test]
fn an_imported_tdt_keeps_its_express_basement_skips_with_no_other_skip() {
    // An express from B4 to the lobby skips no floor above ground, so the
    // load leaves it no skip list; the file's own B2 skip still comes back.
    for mode in MODES {
        let mut sim = tower(mode);
        let id = shaft(&mut sim, Kind::ElevatorExpress, DEEPEST, 1);
        let mut save = sim.serialize();
        let entry = save["transports"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|t| t["id"] == id)
            .unwrap();
        entry["skipFloors"] = Value::from(vec![-1]);
        entry
            .as_object_mut()
            .unwrap()
            .remove("preserveBasementStops");
        let loaded = deserialize_tdt(&save).expect("loads");
        assert_eq!(stops(&loaded, id), [DEEPEST, -2, 0, 1], "{mode:?}");
    }
}

#[test]
fn a_tdt_import_loaded_by_from_save_keeps_its_express_basement_skip() {
    // `importTdt` answers a save for `fromSave`; the importer marks each
    // express so even the plain load keeps the file's own basement skips.
    let mut sim = tower(GameMode::Classic);
    let id = shaft(&mut sim, Kind::ElevatorExpress, DEEPEST, SKY);
    assert!(sim.tower.set_stop(id, -1, false));
    let bytes = crate::tdt::export_tdt(&sim.serialize().to_string()).expect("exports");
    let (json, _) = crate::tdt::import_tdt(&bytes, "BASEMENT.TDT").expect("imports");
    let loaded = deserialize(&serde_json::from_str(&json).unwrap()).expect("loads");
    let express = loaded
        .tower
        .transports
        .iter()
        .find(|t| t.kind == Kind::ElevatorExpress)
        .expect("the express comes back");
    assert!(express.preserve_basement_stops);
    assert_eq!(stops(&loaded, express.id), [DEEPEST, -2, 0, 1, SKY]);
}
