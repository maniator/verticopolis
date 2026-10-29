//! Export states the engine cannot hold but a hand-edited or old save can:
//! the exporter's own handling of them, read off the build result directly
//! (a loaded `Engine` normalizes them away first).

use serde_json::{json, Value};
use verticopolis_engine::tdt::export::build_tdt;

fn unit(id: u32, kind: &str, floor: i32, x: i32, width: i32) -> Value {
    json!({ "id": id, "kind": kind, "floor": floor, "x": x, "width": width, "state": "occupied" })
}

fn tower(units: Vec<Value>, transports: Vec<Value>) -> Value {
    json!({
        "version": 7, "mode": "classic", "money": 2_000_000, "star": 2,
        "units": units, "transports": transports,
    })
}

fn flight(kind: &str, x: i32, bottom: i32, id: u32) -> Value {
    json!({ "id": id, "kind": kind, "x": x, "width": 8, "bottom": bottom, "top": bottom + 1,
        "cars": 0, "carPositions": [], "carDir": [], "load": 0 })
}

fn shaft(kind: &str, x: i32, width: i32) -> Value {
    json!({ "id": x, "kind": kind, "x": x, "width": width, "bottom": 1, "top": 10,
        "cars": 1, "carPositions": [1], "carDir": [0], "load": 0 })
}

fn u16_at(bytes: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([bytes[at], bytes[at + 1]])
}

#[test]
fn header_counts_leave_out_burned_and_out_of_range_rooms() {
    let mut burned = unit(3, "recycling", 5, 40, 20);
    burned["state"] = json!("gutted");
    let built = build_tdt(&tower(
        vec![
            unit(1, "lobby", 1, 0, 1),
            unit(2, "recycling", 2, 0, 20),
            burned,
            unit(4, "shop", 8, 0, 12),
            unit(5, "restaurant", 9, 0, 24),
            unit(6, "fastFood", 10, 0, 16),
            unit(7, "shop", 105, 0, 12),
            unit(8, "security", 11, 0, 8),
            unit(9, "partyHall", 12, 0, 24),
            unit(10, "cinema", 13, 0, 31),
        ],
        vec![],
    ))
    .expect("builds");
    assert_eq!(
        u16_at(&built.bytes, 0x2a),
        1,
        "recycling, burned one excluded"
    );
    assert_eq!(
        u16_at(&built.bytes, 0x2e),
        3,
        "commercial, floor 105 shop excluded"
    );
    assert_eq!(u16_at(&built.bytes, 0x30), 1, "security");
    assert_eq!(u16_at(&built.bytes, 0x36), 2, "hall and cinema");
    assert_eq!((built.counts.burned_out, built.counts.out_of_range), (1, 1));
}

#[test]
fn a_vacant_office_that_was_once_rented_loses_its_history() {
    let mut office = unit(9, "office", 3, 10, 9);
    office["state"] = json!("vacant");
    office["everOccupied"] = json!(true);
    let built = build_tdt(&tower(vec![unit(1, "lobby", 1, 0, 1), office], vec![])).expect("builds");
    assert_eq!(built.counts.vacancy_history_lost, 1);
}

#[test]
fn a_room_whose_upper_story_leaves_the_floor_range_is_skipped_and_counted() {
    let built = build_tdt(&tower(
        vec![unit(1, "lobby", 1, 0, 1), unit(2, "cinema", 100, 10, 31)],
        vec![],
    ))
    .expect("builds");
    assert_eq!(built.counts.out_of_range, 1);
    assert!(
        built.top_floor <= 100.0,
        "the skipped story does not widen the floor count"
    );
}

#[test]
fn money_that_is_not_a_number_exports_as_zero() {
    let mut save = tower(vec![unit(1, "lobby", 1, 0, 1)], vec![]);
    save["money"] = Value::Null;
    let built = build_tdt(&save).expect("builds");
    assert_eq!(built.stats.money, 0.0);
}

#[test]
fn a_narrow_shaft_beside_a_neighbor_collides_at_the_fixed_footprint() {
    let colliding = tower(
        vec![unit(1, "lobby", 1, 0, 1)],
        vec![
            shaft("elevatorStandard", 100, 3),
            shaft("elevatorService", 103, 4),
        ],
    );
    assert_eq!(
        build_tdt(&colliding)
            .expect("builds")
            .stats
            .shafts_colliding,
        1
    );
    let clear = tower(
        vec![unit(1, "lobby", 1, 0, 1)],
        vec![
            shaft("elevatorStandard", 100, 3),
            shaft("elevatorService", 105, 4),
        ],
    );
    assert_eq!(build_tdt(&clear).expect("builds").stats.shafts_colliding, 0);
}

#[test]
fn the_flight_collision_scan_reads_the_collapsed_records() {
    let mut transports: Vec<Value> = (0..66)
        .map(|i| flight("stairs", 300, 1 + i, 9_000 + i as u32))
        .collect();
    transports.push(flight("escalator", 304, 1, 9_999));
    let built = build_tdt(&tower(vec![unit(1, "lobby", 1, 0, 1)], transports)).expect("builds");
    assert!(built.stats.shafts_colliding > 0);
}

#[test]
fn forged_transports_drop_or_clamp_the_way_the_importer_sanitizes() {
    let transports = vec![
        json!({ "id": 1, "kind": "office", "x": 10, "width": 4, "bottom": 1, "top": 5,
            "cars": 1, "carPositions": [1], "carDir": [0], "load": 0 }),
        json!({ "id": 2, "kind": "elevatorStandard", "x": 9999, "width": 4, "bottom": -50, "top": 500,
            "cars": null, "carPositions": [null], "carDir": [], "load": 0 }),
        json!({ "id": 3, "kind": "elevatorService", "x": 20, "width": 4, "bottom": 8, "top": 8,
            "cars": 2, "carPositions": [8, 8], "carDir": [0, 0], "load": 0 }),
    ];
    let built = build_tdt(&tower(vec![unit(1, "lobby", 1, 0, 1)], transports)).expect("builds");
    assert_eq!(built.stats.transports_dropped, 2);
    assert_eq!(built.stats.elevators_len, 1);
}
