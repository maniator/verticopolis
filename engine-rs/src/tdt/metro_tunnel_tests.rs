//! The metro tunnel in a .TDT file (#1503): the original paves a metro
//! platform's row with type 45 on each side of the station (status 0, no
//! logical id), where other rows get the plain floor tile (type 0).

use serde_json::{json, Value};

use super::export::build_tdt;
use super::format::{parse_tdt_binary, TDT_FLOOR_OFFSET};
use super::parse::parse_tdt;
use super::tables::TDT_METRO_TUNNEL;
use super::venue_export::{NO_LOGICAL_ID, PLAIN_FLOOR_TYPE};
use crate::clock::GameMode;
use crate::facilities::LOT_WIDTH;
use crate::sim::Simulation;

const STATION_X: i64 = 208;
const STATION_WIDTH: i64 = 30;
/// The lowest row a .TDT holds (its row 0).
const PLATFORM_FLOOR: i64 = -TDT_FLOOR_OFFSET;
/// The platform record's type, the bottom of the station's three rows.
const TDT_METRO_PLATFORM: i64 = 33;

/// A Classic save with the three lowest rows paved across the lot and a station
/// on the lowest, the way the original's TOWER7 lays it out.
fn station_save() -> Value {
    let mut save = Simulation::new_game(7, GameMode::Classic).serialize();
    let mut units = vec![];
    for (id, floor) in (1..).zip(PLATFORM_FLOOR..PLATFORM_FLOOR + 3) {
        units.push(json!({"id": id, "kind": "floor", "floor": floor, "x": 0,
            "width": LOT_WIDTH, "state": "empty", "satisfaction": 1, "occupants": 0,
            "everOccupied": false, "pendingIncome": 0, "label": "Floor"}));
    }
    units.push(
        json!({"id": 4, "kind": "metro", "floor": PLATFORM_FLOOR, "x": STATION_X,
        "width": STATION_WIDTH, "state": "empty", "satisfaction": 1, "occupants": 0,
        "everOccupied": false, "pendingIncome": 0, "label": "Metro Station"}),
    );
    save["units"] = Value::Array(units);
    save["nextId"] = json!(5);
    save["star"] = json!(3);
    save
}

/// Each record on one of our floors as (left, right, type, status, logical id).
fn records_on(bytes: &[u8], floor: i64) -> Vec<(i64, i64, i64, i64, u8)> {
    let tower = parse_tdt_binary(bytes).expect("the exported file reads");
    let row = tower
        .floors
        .iter()
        .find(|f| f.index == floor + TDT_FLOOR_OFFSET)
        .expect("the floor is in the file");
    let id_at = |status_at: usize| bytes[status_at + 12 - 5];
    let mut records: Vec<_> = (row.tenants.iter())
        .map(|t| (t.left, t.right, t.type_id, t.status, id_at(t.status_at)))
        .collect();
    records.sort();
    records
}

#[test]
fn the_platform_row_is_paved_with_the_tunnel_beside_the_station() {
    let built = build_tdt(&station_save()).expect("exports");
    let records = records_on(&built.bytes, PLATFORM_FLOOR);
    let station_right = STATION_X + STATION_WIDTH;
    let tunnel = |left, right| (left, right, TDT_METRO_TUNNEL, 0, NO_LOGICAL_ID);
    assert_eq!(records.len(), 3, "{records:?}");
    assert_eq!(records[0], tunnel(0, STATION_X));
    let (left, right, type_id, _, _) = records[1];
    assert_eq!(
        (left, right, type_id),
        (STATION_X, station_right, TDT_METRO_PLATFORM)
    );
    assert_ne!(records[1].4, NO_LOGICAL_ID, "the station keeps its id");
    assert_eq!(records[2], tunnel(station_right, LOT_WIDTH));
}

#[test]
fn the_rows_above_the_platform_keep_the_plain_floor_tile() {
    let built = build_tdt(&station_save()).expect("exports");
    for floor in [PLATFORM_FLOOR + 1, PLATFORM_FLOOR + 2] {
        let paving: Vec<_> = (records_on(&built.bytes, floor).into_iter())
            .filter(|r| r.2 == PLAIN_FLOOR_TYPE || r.2 == TDT_METRO_TUNNEL)
            .collect();
        assert_eq!(paving.len(), 2, "floor {floor}: {paving:?}");
        assert!(paving.iter().all(|r| (r.2, r.3) == (PLAIN_FLOOR_TYPE, 2)));
    }
}

#[test]
fn a_tower_with_a_tunnel_imports_as_the_tower_it_came_from() {
    let save = station_save();
    let built = build_tdt(&save).expect("exports");
    let back = parse_tdt(&built.bytes, "TOWER.TDT").expect("imports");
    let paved = |save: &Value| -> Vec<i64> {
        let mut tiles: Vec<i64> = (save["units"].as_array().unwrap().iter())
            .filter(|u| u["kind"] == "floor" && u["floor"] == PLATFORM_FLOOR)
            .flat_map(|u| {
                let x = u["x"].as_i64().unwrap();
                x..x + u["width"].as_i64().unwrap()
            })
            .collect();
        tiles.sort();
        tiles
    };
    assert_eq!(
        paved(&back.save),
        paved(&save),
        "the platform row is paved as before"
    );
    let stations = (back.save["units"].as_array().unwrap().iter())
        .filter(|u| u["kind"] == "metro")
        .count();
    assert_eq!(stations, 1);
}
