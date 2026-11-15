//! A Classic express follows the original's rule, measured on SimTower 1.0
//! (the parity run, #1527): it stops at the ground floor, every 15th floor
//! whether or not a lobby is built there, and every basement; it does not
//! stop at an end off those floors; each of its stops can be turned off and
//! no other floor turned on; and it has to be placed reaching the ground
//! floor or a 15th floor. A Modern express keeps stopping at its lobbies and
//! both ends. A save from before the rule loads with the 15th floors the old
//! lobby-only rule skipped turned back on, and keeps a stop the player turned
//! off.
use serde_json::Value;

use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::load::{deserialize, deserialize_tdt};
use crate::sim::Simulation;
use crate::tdt::{export_tdt, import_tdt};

use super::{lay_row, MID};

/// The deepest basement, B5.
const DEEPEST: i64 = -4;

/// A ground lobby, plain floor on 2 to 32 (no sky lobby) and five basements.
fn tower(mode: GameMode) -> Simulation {
    tower_with_sky_lobbies(mode, &[])
}

/// [`tower`] with a sky lobby on each of `sky`.
fn tower_with_sky_lobbies(mode: GameMode, sky: &[i64]) -> Simulation {
    let mut sim = Simulation::new_game(11, mode);
    sim.money = 1e12;
    sim.star = 3;
    lay_row(&mut sim, Kind::Lobby, 1);
    for floor in 2..=32 {
        let kind = if sky.contains(&floor) {
            Kind::Lobby
        } else {
            Kind::Floor
        };
        lay_row(&mut sim, kind, floor);
    }
    for floor in (DEEPEST..=0).rev() {
        lay_row(&mut sim, Kind::Floor, floor);
    }
    sim
}

fn express(sim: &mut Simulation, bottom: i64, top: i64) -> i64 {
    let r = sim.build_transport(Kind::ElevatorExpress, MID, bottom, top);
    assert!(r.ok, "{bottom}..{top}: {:?}", r.reason);
    sim.tower.transports.last().unwrap().id
}

fn stops(sim: &Simulation, id: i64) -> Vec<i64> {
    let t = sim.tower.get_transport(id).unwrap();
    sim.tower.stops_of(t)
}

#[test]
fn a_classic_express_stops_at_the_ground_every_15th_floor_and_every_basement() {
    let mut sim = tower(GameMode::Classic);
    // E1: through plain floor 15, no lobby there; the top end, 19, is passed.
    let id = express(&mut sim, 1, 19);
    assert_eq!(stops(&sim, id), [1, 15]);
    // E2: dragged down to B5, every basement stops.
    assert!(sim.tower.resize_transport(id, DEEPEST, 19).ok);
    assert_eq!(stops(&sim, id), [-4, -3, -2, -1, 0, 1, 15]);
    // Up to a 30th floor end: that end stops.
    assert!(sim.tower.resize_transport(id, DEEPEST, 30).ok);
    assert_eq!(stops(&sim, id), [-4, -3, -2, -1, 0, 1, 15, 30]);
}

#[test]
fn a_modern_express_keeps_to_its_lobbies_and_both_ends() {
    let mut sim = tower(GameMode::Modern);
    let id = express(&mut sim, DEEPEST, 19);
    assert_eq!(stops(&sim, id), [-4, -3, -2, -1, 0, 1, 19]);
}

#[test]
fn a_classic_express_has_to_reach_the_ground_or_a_15th_floor() {
    let mut sim = tower(GameMode::Classic);
    // E4: nothing between the 15th floors can hold one.
    let refused = sim.build_transport(Kind::ElevatorExpress, MID, 16, 21);
    assert!(!refused.ok);
    assert_eq!(
        refused.reason.as_deref(),
        Some("An express elevator has to reach the ground floor or a 15th floor.")
    );
    // E3: spans off a 15th floor at one end are allowed, and that end is
    // passed.
    let high = express(&mut sim, 23, 30);
    assert_eq!(stops(&sim, high), [30]);
    let mid = sim.build_transport(Kind::ElevatorExpress, MID + 20, 11, 19);
    assert!(mid.ok, "{:?}", mid.reason);
    let mid = sim.tower.transports.last().unwrap().id;
    assert_eq!(stops(&sim, mid), [15]);
    // A drag that leaves no ground or 15th floor in the span is refused.
    assert!(!sim.tower.resize_transport(mid, 16, 19).ok);
    // Modern places an express anywhere.
    let mut modern = tower(GameMode::Modern);
    assert!(
        modern
            .build_transport(Kind::ElevatorExpress, MID, 16, 21)
            .ok
    );
}

#[test]
fn each_classic_express_stop_turns_off_and_no_other_floor_turns_on() {
    let mut sim = tower(GameMode::Classic);
    let id = express(&mut sim, DEEPEST, 19);
    // The Elevator window offers exactly the floors the rule allows.
    let t = sim.tower.get_transport(id).unwrap().clone();
    let toggles: Vec<i64> = (t.bottom..=t.top)
        .filter(|&f| sim.tower.stop_toggles(&t, f, t.stops_at(f)))
        .collect();
    assert_eq!(toggles, [-4, -3, -2, -1, 0, 1, 15]);
    assert!(sim.tower.set_stop(id, -2, false), "B3 off");
    assert!(sim.tower.set_stop(id, 15, false), "15 off");
    assert!(!sim.tower.set_stop(id, 16, true), "16 cannot stop");
    assert!(!sim.tower.set_stop(id, 19, true), "nor can the top end");
    assert_eq!(stops(&sim, id), [-4, -3, -1, 0, 1]);
    // A save keeps the choices.
    let loaded = deserialize(&sim.serialize()).expect("loads");
    assert_eq!(stops(&loaded, id), [-4, -3, -1, 0, 1]);
    // Turning 15 back on works.
    assert!(sim.tower.set_stop(id, 15, true));
    assert_eq!(stops(&sim, id), [-4, -3, -1, 0, 1, 15]);
}

/// The save of a Classic express as the old lobby-only rule left it: 15
/// skipped for having no lobby, 19 an end that always stopped, and no marker.
fn old_rule_save(sim: &Simulation, id: i64, skips: &[f64]) -> Value {
    let mut save = sim.serialize();
    for t in save["transports"].as_array_mut().unwrap() {
        if t["id"].as_i64() == Some(id) {
            let shaft = t.as_object_mut().unwrap();
            shaft.remove("classicExpressStops");
            shaft.insert("skipFloors".into(), serde_json::json!(skips));
        }
    }
    save
}

#[test]
fn a_save_from_before_the_rule_loads_with_its_15th_floors_back_on() {
    // 30 has a sky lobby, so the old rule stopped there and a skip on it
    // would have been the player's.
    let mut sim = tower_with_sky_lobbies(GameMode::Classic, &[30]);
    let id = express(&mut sim, 1, 31);
    let skips: Vec<f64> = (2..31).filter(|&f| f != 30).map(f64::from).collect();
    let loaded = deserialize(&old_rule_save(&sim, id, &skips)).expect("loads");
    assert_eq!(stops(&loaded, id), [1, 15, 30], "15 back on, 31 passed");
    // A lobby floor the player had turned off stays off.
    let mut player_skips = skips.clone();
    player_skips.push(30.0);
    let loaded = deserialize(&old_rule_save(&sim, id, &player_skips)).expect("loads");
    assert_eq!(stops(&loaded, id), [1, 15]);
}

#[test]
fn a_tdt_round_trip_keeps_a_passed_end_and_a_stop_turned_off() {
    let mut sim = tower(GameMode::Classic);
    let id = express(&mut sim, DEEPEST, 19);
    assert!(sim.tower.set_stop(id, 15, false));
    let bytes = export_tdt(&sim.serialize().to_string()).expect("exports");
    let (text, _) = import_tdt(&bytes, "EXPRESS.TDT").expect("imports");
    let save: Value = serde_json::from_str(&text).unwrap();
    let back = deserialize_tdt(&save).expect("loads");
    let shaft = back
        .tower
        .transports
        .iter()
        .find(|t| t.kind == Kind::ElevatorExpress)
        .expect("the express survives");
    assert_eq!(back.tower.stops_of(shaft), [-4, -3, -2, -1, 0, 1]);
}

#[test]
fn a_classic_express_always_keeps_a_stop() {
    // A shaft with no stop would leave its cars standing and its riders with
    // nowhere to get off, so the last stop cannot be turned off.
    let mut sim = tower(GameMode::Classic);
    let high = express(&mut sim, 23, 30);
    assert!(!sim.tower.set_stop(high, 30, false), "its only stop");
    assert_eq!(stops(&sim, high), [30]);
    let id = express(&mut sim, 1, 19);
    assert!(sim.tower.set_stop(id, 15, false));
    assert!(!sim.tower.set_stop(id, 1, false), "the last one left");
    assert_eq!(stops(&sim, id), [1]);
    // A drag that leaves only floors the player turned off brings back the
    // floors the shaft may stop at.
    assert!(sim.tower.set_stop(id, 15, true));
    assert!(sim.tower.set_stop(id, 1, false));
    assert_eq!(stops(&sim, id), [15]);
    assert!(sim.tower.resize_transport(id, 1, 14).ok);
    assert_eq!(stops(&sim, id), [1]);
    // A save whose shaft stops nowhere loads with those floors back on.
    let mut save = sim.serialize();
    for t in save["transports"].as_array_mut().unwrap() {
        if t["id"].as_i64() == Some(id) {
            t["skipFloors"] = serde_json::json!((1..=14).map(f64::from).collect::<Vec<_>>());
        }
    }
    let loaded = deserialize(&save).expect("loads");
    assert_eq!(stops(&loaded, id), [1]);
    // A crafted save whose shaft spans no floor it may stop at stops at its
    // ends.
    for t in save["transports"].as_array_mut().unwrap() {
        if t["id"].as_i64() == Some(id) {
            t["bottom"] = 16.into();
            t["top"] = 21.into();
            t["skipFloors"] = serde_json::json!((16..=21).map(f64::from).collect::<Vec<_>>());
        }
    }
    let loaded = deserialize(&save).expect("loads");
    assert_eq!(stops(&loaded, id), [16, 21]);
}
