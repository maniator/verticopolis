//! The parking a `.TDT` export writes (#307): the stall table, each stall's
//! index into it, the connected list and the ramp column in the header.

use serde_json::{json, Value};

use super::*;
use crate::clock::GameMode;
use crate::sim::Simulation;
use crate::tdt::export::build_tdt;
use crate::tdt::format::{
    parse_tdt_binary, TDT_CLINIC_LIST_SIZE, TDT_FLOOR_OFFSET, TDT_PARKING_SIZE,
    TDT_ROUTING_TAIL_SIZE, TDT_STAIR_RECORD_SIZE, TDT_STAIR_SLOTS, TDT_STAMP_SIZE,
};

const RAMP_X: i64 = 100;
const B1: i64 = 0;
const B2: i64 = -1;

fn unit(id: i64, kind: &str, floor: i64, x: i64, width: i64) -> Value {
    json!({ "id": id, "kind": kind, "floor": floor, "x": x, "width": width,
        "state": "occupied", "satisfaction": 1, "occupants": 0, "everOccupied": true,
        "pendingIncome": 0 })
}

/// A 3-star Classic save with the given units.
fn save_with(units: Vec<Value>) -> Value {
    let mut save = Simulation::new_game(7, GameMode::Classic).serialize();
    save["nextId"] = json!(units.len() + 1);
    save["units"] = Value::Array(units);
    save["star"] = json!(3);
    save
}

/// A column at x 100: on B1 the ramp, two stalls chained to its right and a
/// third four tiles further on; on B2 a ramp with one stall touching its
/// left side.
fn column_save() -> Value {
    save_with(vec![
        unit(1, "parkingRamp", B1, RAMP_X, 16),
        unit(2, "parking", B1, RAMP_X + 16, 4),
        unit(3, "parking", B1, RAMP_X + 20, 4),
        unit(4, "parking", B1, RAMP_X + 28, 4),
        unit(5, "parkingRamp", B2, RAMP_X, 16),
        unit(6, "parking", B2, RAMP_X - 4, 4),
    ])
}

/// Where the routing tail and the parking block start in one of our exports.
fn blocks_at(bytes: &[u8]) -> (usize, usize) {
    let tail_at = bytes.len() - TDT_STAMP_SIZE - TDT_ROUTING_TAIL_SIZE;
    let stairs_at = tail_at - TDT_STAIR_SLOTS * TDT_STAIR_RECORD_SIZE;
    (tail_at, stairs_at - TDT_CLINIC_LIST_SIZE - TDT_PARKING_SIZE)
}

fn u16_at(bytes: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([bytes[at], bytes[at + 1]])
}

#[test]
fn each_stall_has_a_table_record_naming_its_floor_and_id() {
    let bytes = build_tdt(&column_save()).expect("exports").bytes;
    let (tail_at, _) = blocks_at(&bytes);
    let table = &bytes[tail_at + STALL_TABLE_IN_ROUTING_TAIL..];
    let b2 = (B2 + TDT_FLOOR_OFFSET) as u8;
    let b1 = (B1 + TDT_FLOOR_OFFSET) as u8;
    // B2's stall (id 0, left of its ramp), then B1's three (ids 1 to 3,
    // right of theirs), then empty records to the end.
    assert_eq!(&table[..6], &[b2, 0, 0, 0, 0, 0]);
    assert_eq!(&table[6..12], &[b1, 1, 0, 0, 0, 0]);
    assert_eq!(&table[12..18], &[b1, 2, 0, 0, 0, 0]);
    assert_eq!(&table[18..24], &[b1, 3, 0, 0, 0, 0]);
    for slot in 4..TDT_STALL_SLOTS {
        let at = slot * 6;
        assert_eq!(&table[at..at + 6], &[0xff, 0, 0, 0, 0, 0], "slot {slot}");
    }
}

#[test]
fn each_stall_record_points_at_its_table_record() {
    let bytes = build_tdt(&column_save()).expect("exports").bytes;
    let tower = parse_tdt_binary(&bytes).expect("reads");
    let mut indexes = vec![];
    for floor in &tower.floors {
        for t in floor.tenants.iter().filter(|t| t.type_id == STALL_TYPE) {
            indexes.push((
                floor.index - TDT_FLOOR_OFFSET,
                t.left,
                t.variant + 256 * t.row_high,
            ));
        }
    }
    assert_eq!(
        indexes,
        vec![
            (B2, RAMP_X - 4, 0),
            (B1, RAMP_X + 16, 1),
            (B1, RAMP_X + 20, 2),
            (B1, RAMP_X + 28, 3)
        ]
    );
}

#[test]
fn the_connected_list_names_table_records_of_stalls_chained_to_a_ramp() {
    let bytes = build_tdt(&column_save()).expect("exports").bytes;
    let (_, parking_at) = blocks_at(&bytes);
    // The B1 stall four tiles past its neighbor is not chained.
    let list: Vec<u16> = (0..5).map(|k| u16_at(&bytes, parking_at + k * 2)).collect();
    assert_eq!(list, vec![3, 0, 1, 2, 0]);
    let tower = parse_tdt_binary(&bytes).expect("reads");
    assert_eq!(tower.tail.parking_connected, Some(3));
}

#[test]
fn the_header_names_the_b1_ramp_column_or_none() {
    let bytes = build_tdt(&column_save()).expect("exports").bytes;
    assert_eq!(u16_at(&bytes, TDT_HEADER_PARKING_COLUMN_AT), RAMP_X as u16);
    let none = build_tdt(&save_with(vec![])).expect("exports").bytes;
    assert_eq!(u16_at(&none, TDT_HEADER_PARKING_COLUMN_AT), 0xffff);
}

#[test]
fn a_chain_reaches_out_both_ways_and_breaks_at_a_gap() {
    let spans = [
        (0.0, 4.0, STALL_TYPE),
        (4.0, 8.0, STALL_TYPE),
        (8.0, 24.0, RAMP_TYPE),
        (24.0, 28.0, STALL_TYPE),
        (29.0, 33.0, STALL_TYPE),
        (33.0, 40.0, 1),
    ];
    assert_eq!(
        linked_to_a_ramp(&spans),
        vec![true, true, false, true, false, false]
    );
}

#[test]
fn connected_stalls_take_the_first_records() {
    // B2's stall sits four tiles from its ramp, so B1's connected stall,
    // written after it, still takes record 0.
    let save = save_with(vec![
        unit(1, "parkingRamp", B1, RAMP_X, 16),
        unit(2, "parking", B1, RAMP_X + 16, 4),
        unit(3, "parkingRamp", B2, RAMP_X, 16),
        unit(4, "parking", B2, RAMP_X - 8, 4),
    ]);
    let bytes = build_tdt(&save).expect("exports").bytes;
    let (tail_at, parking_at) = blocks_at(&bytes);
    let table = &bytes[tail_at + STALL_TABLE_IN_ROUTING_TAIL..];
    let b2 = (B2 + TDT_FLOOR_OFFSET) as u8;
    let b1 = (B1 + TDT_FLOOR_OFFSET) as u8;
    assert_eq!(&table[..12], &[b1, 1, 0, 0, 0, 0, b2, 0, 0, 0, 0, 0]);
    let list: Vec<u16> = (0..3).map(|k| u16_at(&bytes, parking_at + k * 2)).collect();
    assert_eq!(list, vec![1, 0, 0]);
}
