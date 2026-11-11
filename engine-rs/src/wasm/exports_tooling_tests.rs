use serde_json::Value;

use super::*;
use crate::clock::GameMode;
use crate::sim::Simulation;

fn json(text: &str) -> Value {
    serde_json::from_str(text).expect("the member answers JSON")
}

/// A lobby and one floor above it, placed through the members under test.
fn with_floor() -> Engine {
    let mut e = Engine::of(Simulation::new_game(7, GameMode::Modern));
    for x in 150..200 {
        assert_eq!(json(&e.place_bare("lobby", 1, x))["ok"], true);
        assert_eq!(json(&e.place_bare("floor", 2, x))["ok"], true);
    }
    e
}

#[test]
fn place_is_the_bare_placement_and_answers_the_new_id() {
    let mut e = with_floor();
    let money = e.sim.money;
    let r = json(&e.place_bare("office", 2, 160));
    assert_eq!(r["ok"], true);
    let id = r["unitId"].as_i64().expect("a placed room carries its id");
    // No charge and no log line: the placement is the tower's own.
    assert_eq!(e.sim.money, money);
    let record = json(&e.unit_record(id as i32).expect("the room is in the tower"));
    assert_eq!(record["kind"], "office");
    assert_eq!(record["x"], 160);
    let taken = json(&e.place_bare("office", 2, 160));
    assert_eq!(taken["ok"], false);
    assert!(taken["reason"].is_string());
    assert!(taken.get("unitId").is_none());
    assert_eq!(
        json(&e.place_bare("castle", 2, 170))["reason"],
        "Unknown facility."
    );
}

#[test]
fn place_transport_answers_the_shaft_id() {
    let mut e = with_floor();
    let r = json(&e.place_transport_bare("elevatorStandard", 152, 1, 2));
    assert_eq!(r["ok"], true);
    let id = r["transportId"]
        .as_i64()
        .expect("a placed shaft carries its id");
    assert!(r.get("unitId").is_none());
    assert_eq!(json(&e.transport_record(id as i32).unwrap())["bottom"], 1);
    assert_eq!(
        json(&e.place_transport_bare("castle", 160, 1, 2))["ok"],
        false
    );
    assert!(e.transport_record(-1).is_none());
}

#[test]
fn the_reads_answer_the_tower() {
    let mut e = with_floor();
    let id = json(&e.place_bare("office", 2, 160))["unitId"]
        .as_i64()
        .unwrap();
    assert_eq!(json(&e.room_at(2, 161).unwrap())["id"], id);
    assert!(
        e.room_at(2, 190).is_none(),
        "a floor tile is structure, not a room"
    );
    assert_eq!(e.structure_kind_at(1, 150).as_deref(), Some("lobby"));
    assert_eq!(e.structure_kind_at(2, 190).as_deref(), Some("floor"));
    assert!(e.structure_kind_at(3, 150).is_none());
    assert!(e.floor_has_lobby(1));
    assert!(!e.floor_has_lobby(2));
    assert!(e.is_floor_served(1));
    assert!(!e.is_floor_served(2));
    assert_eq!(
        json(&e.place_transport_bare("stairs", 152, 1, 2))["ok"],
        true
    );
    assert!(e.is_floor_served(2));
    assert_eq!(e.highest_floor(), 2.0);
    assert!(e.unit_record(-5).is_none());
}
