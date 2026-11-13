//! A theatre in a .TDT file: each floor is a 7-tile screen piece (types 35
//! and 34) on the left and an auditorium piece (types 19 and 18) beside it,
//! as the original writes them (#2044), and the import merges them back.

use serde_json::{json, Value};

use super::export::build_tdt;
use super::format::{parse_tdt_binary, TDT_FLOOR_OFFSET};
use super::parse::parse_tdt;
use crate::clock::GameMode;
use crate::sim::Simulation;

const THEATRE_X: i64 = 100;
const THEATRE_WIDTH: i64 = 31;
const THEATRE_FLOOR: i64 = 5;

/// A Classic save holding one theatre showing a film it has run for 3 days.
fn theatre_save() -> Value {
    let mut save = Simulation::new_game(7, GameMode::Classic).serialize();
    save["units"] = json!([{
        "id": 1, "kind": "cinema", "floor": THEATRE_FLOOR, "x": THEATRE_X,
        "width": THEATRE_WIDTH, "state": "occupied", "satisfaction": 1, "occupants": 0,
        "everOccupied": true, "pendingIncome": 0, "label": "Movie Theater", "filmDays": 3}]);
    save["nextId"] = json!(2);
    save["star"] = json!(3);
    save
}

#[test]
fn each_theatre_floor_is_written_as_a_screen_piece_and_an_auditorium() {
    let built = build_tdt(&theatre_save()).expect("exports");
    let tower = parse_tdt_binary(&built.bytes).expect("the exported file reads");
    let mut pieces = vec![];
    for floor in &tower.floors {
        for t in &floor.tenants {
            if [18, 19, 34, 35].contains(&t.type_id.abs()) {
                pieces.push((floor.index - TDT_FLOOR_OFFSET, t.type_id, t.left, t.right));
            }
        }
    }
    let (x, screen_end, end) = (THEATRE_X, THEATRE_X + 7, THEATRE_X + THEATRE_WIDTH);
    let (lower, upper) = (THEATRE_FLOOR, THEATRE_FLOOR + 1);
    assert_eq!(
        pieces,
        vec![
            (lower, 35, x, screen_end),
            (lower, 19, screen_end, end),
            (upper, 34, x, screen_end),
            (upper, 18, screen_end, end),
        ]
    );
}

#[test]
fn a_theatre_survives_a_trip_through_export_and_import() {
    let built = build_tdt(&theatre_save()).expect("exports");
    let back = parse_tdt(&built.bytes, "TOWER.TDT").expect("imports");
    let theatres: Vec<&Value> = back.save["units"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|u| u["kind"] == "cinema")
        .collect();
    assert_eq!(theatres.len(), 1, "one theatre, not one per piece");
    let t = theatres[0];
    assert_eq!(
        (t["floor"].as_i64(), t["x"].as_i64(), t["width"].as_i64()),
        (Some(THEATRE_FLOOR), Some(THEATRE_X), Some(THEATRE_WIDTH))
    );
    assert_eq!(t["filmDays"], json!(3), "the table still finds the theatre");
}
