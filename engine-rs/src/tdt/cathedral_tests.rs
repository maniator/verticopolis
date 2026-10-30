//! The cathedral in a .TDT file: five stacked parts that stand on floor 100
//! (bottom part, type 40) and rise through floor 104 (top part, type 36).

use serde_json::{json, Value};

use super::export::build_tdt;
use super::format::{parse_tdt_binary, TDT_FLOOR_OFFSET};
use super::parse::parse_tdt;
use crate::clock::GameMode;
use crate::sim::Simulation;

const HALL_X: i64 = 180;
const HALL_WIDTH: i64 = 28;

/// A Classic save holding only the floor slabs under a wedding hall on floor 100.
fn hall_save() -> Value {
    let mut save = Simulation::new_game(7, GameMode::Classic).serialize();
    let tile = |id: i64, floor: i64, x: i64| {
        json!({"id": id, "kind": "floor", "floor": floor, "x": x, "width": 1, "state": "empty",
            "satisfaction": 1, "occupants": 0, "everOccupied": false, "pendingIncome": 0,
            "label": "Floor"})
    };
    let mut units = vec![];
    let mut id = 1;
    for x in HALL_X..HALL_X + HALL_WIDTH {
        for floor in [99, 100] {
            units.push(tile(id, floor, x));
            id += 1;
        }
    }
    units.push(
        json!({"id": id, "kind": "weddingHall", "floor": 100, "x": HALL_X,
        "width": HALL_WIDTH, "state": "empty", "satisfaction": 1, "occupants": 0,
        "everOccupied": false, "pendingIncome": 0, "label": "Wedding Hall"}),
    );
    save["units"] = Value::Array(units);
    save["nextId"] = json!(id + 1);
    save["star"] = json!(5);
    save
}

/// The part types on each floor of the file, as (our floor, type) pairs.
fn parts_in(bytes: &[u8]) -> Vec<(i64, i64)> {
    let tower = parse_tdt_binary(bytes).expect("the exported file reads");
    let mut parts = vec![];
    for floor in &tower.floors {
        for t in &floor.tenants {
            if (36..=40).contains(&t.type_id.abs()) {
                assert_eq!((t.left, t.right), (HALL_X, HALL_X + HALL_WIDTH));
                parts.push((floor.index - TDT_FLOOR_OFFSET, t.type_id));
            }
        }
    }
    parts
}

#[test]
fn the_exported_cathedral_stands_on_floor_100_and_rises_to_104() {
    let built = build_tdt(&hall_save()).expect("exports");
    assert_eq!(
        parts_in(&built.bytes),
        vec![(100, 40), (101, 39), (102, 38), (103, 37), (104, 36)]
    );
}

#[test]
fn a_cathedral_survives_a_trip_through_export_and_import() {
    let built = build_tdt(&hall_save()).expect("exports");
    let back = parse_tdt(&built.bytes, "TOWER.TDT").expect("imports");
    let halls: Vec<&Value> = back.save["units"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|u| u["kind"] == "weddingHall")
        .collect();
    assert_eq!(halls.len(), 1, "one hall, not one per part");
    assert_eq!(
        (
            halls[0]["floor"].as_i64(),
            halls[0]["x"].as_i64(),
            halls[0]["width"].as_i64()
        ),
        (Some(100), Some(HALL_X), Some(HALL_WIDTH))
    );
    assert_eq!(back.save["builtWeddingHall"], json!(true));
}

#[test]
fn a_room_under_the_hall_does_not_shorten_its_stack() {
    // The cathedral rises above floor 100, so what stands below it never cuts parts off.
    let expected = vec![(100, 40), (101, 39), (102, 38), (103, 37), (104, 36)];
    for state in ["occupied", "gutted"] {
        let mut save = hall_save();
        save["units"].as_array_mut().unwrap().push(json!({
            "id": 900, "kind": "cinema", "floor": 98, "x": HALL_X, "width": 31, "state": state,
            "satisfaction": 1, "occupants": 0, "everOccupied": true, "pendingIncome": 0,
            "label": "Movie Theater"}));
        save["nextId"] = json!(901);
        let built = build_tdt(&save).expect("exports");
        assert_eq!(parts_in(&built.bytes), expected, "cinema {state}");
    }
}
