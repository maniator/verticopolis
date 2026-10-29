//! The nine real 1997 saves (see `tdt_real_saves.rs`) through import, export
//! and import again: nothing is lost, the clock and the venue styles come back
//! as they went in, and a second export is the first, byte for byte.

use std::path::PathBuf;

use serde_json::Value;
use verticopolis_engine::tdt::format::{
    POP_HOTEL_SINGLE, POP_HOTEL_TWIN, TDT_FINANCE_SIZE, TDT_PARKING_SIZE, TDT_ROUTING_TAIL_SIZE,
    TDT_STAIRS_GAP, TDT_STAIR_FIRST_SLOT, TDT_STAIR_RECORD_SIZE, TDT_STAIR_SLOTS, TDT_STAMP_SIZE,
};
use verticopolis_engine::tdt::tail::stairs_table_starts_at;
use verticopolis_engine::tdt::{export_tdt, import_tdt};

const SAVES: [&str; 9] = [
    "TOWER1.TDT",
    "TOWER2.TDT",
    "TOWER3.TDT",
    "TOWER4.TDT",
    "TOWER5.TDT",
    "TOWER6.TDT",
    "TOWER7.TDT",
    "TOWER8.TDT",
    "MYTOWER.TDT",
];

fn fixture(name: &str) -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("conformance")
        .join("fixtures")
        .join("tdt-reddit")
        .join(name);
    std::fs::read(path).expect("fixture")
}

fn save_of(bytes: &[u8], name: &str) -> Value {
    let (json, _) = import_tdt(bytes, name).expect("imports");
    serde_json::from_str(&json).expect("save json")
}

/// A list of objects as sorted strings, so neither the order nor the ids
/// (which follow the file's order) matter.
fn as_set(list: &Value) -> Vec<String> {
    let mut out: Vec<String> = list
        .as_array()
        .expect("array")
        .iter()
        .map(|v| {
            let mut v = v.clone();
            v.as_object_mut().expect("object").remove("id");
            v.to_string()
        })
        .collect();
    out.sort();
    out
}

#[test]
fn every_real_save_survives_export_and_import_unchanged() {
    for name in SAVES {
        let first = save_of(&fixture(name), name);
        let exported = export_tdt(&first.to_string()).expect("exports");
        let second = save_of(&exported, name);
        assert_eq!(second["minutes"], first["minutes"], "{name} clock");
        assert_eq!(second["money"], first["money"], "{name} money");
        assert_eq!(second["star"], first["star"], "{name} star");
        assert_eq!(
            as_set(&second["units"]),
            as_set(&first["units"]),
            "{name} units"
        );
        assert_eq!(
            as_set(&second["transports"]),
            as_set(&first["transports"]),
            "{name} transports"
        );
    }
}

#[test]
fn an_export_reads_straight_through_with_every_express_shaft_kept() {
    for name in SAVES {
        let first = save_of(&fixture(name), name);
        let exported = export_tdt(&first.to_string()).expect("exports");
        let (json, warnings) = import_tdt(&exported, name).expect("imports");
        let second: Value = serde_json::from_str(&json).expect("save json");
        assert!(
            warnings.iter().all(|w| !w.contains("searching")),
            "{name}: {warnings:?}"
        );
        let express = |save: &Value| {
            save["transports"]
                .as_array()
                .expect("transports")
                .iter()
                .filter(|t| t["kind"] == "elevatorExpress")
                .count()
        };
        assert_eq!(express(&second), express(&first), "{name} express shafts");
    }
}

/// Every flight is a single-story record, and the flights fill the table from
/// slot 16, the way the game's own saves do.
#[test]
fn an_export_writes_one_single_story_record_per_flight_from_slot_16() {
    for name in SAVES {
        let first = save_of(&fixture(name), name);
        let exported = export_tdt(&first.to_string()).expect("exports");
        let table = TDT_STAIR_SLOTS * TDT_STAIR_RECORD_SIZE;
        let stairs = exported.len() - TDT_STAMP_SIZE - TDT_ROUTING_TAIL_SIZE - table;
        let flights = first["transports"]
            .as_array()
            .expect("transports")
            .iter()
            .filter(|t| matches!(t["kind"].as_str(), Some("stairs" | "escalator")))
            .count();
        let built: Vec<usize> = (0..TDT_STAIR_SLOTS)
            .filter(|&s| exported[stairs + s * TDT_STAIR_RECORD_SIZE] == 1)
            .collect();
        assert_eq!(built.len(), flights, "{name}");
        for &slot in &built {
            let kind = exported[stairs + slot * TDT_STAIR_RECORD_SIZE + 1];
            assert!(kind <= 1, "{name}: slot {slot} has multi-story type {kind}");
        }
        if flights > 0 && flights <= TDT_STAIR_SLOTS - TDT_STAIR_FIRST_SLOT {
            assert_eq!(built[0], TDT_STAIR_FIRST_SLOT, "{name}");
        }
    }
}

#[test]
fn an_export_leaves_the_gap_the_game_leaves_before_its_stairs_table() {
    for name in SAVES {
        let first = save_of(&fixture(name), name);
        let exported = export_tdt(&first.to_string()).expect("exports");
        let table = TDT_STAIR_SLOTS * TDT_STAIR_RECORD_SIZE;
        let stairs = exported.len() - TDT_STAMP_SIZE - TDT_ROUTING_TAIL_SIZE - table;
        let walkways = first["transports"]
            .as_array()
            .expect("transports")
            .iter()
            .any(|t| matches!(t["kind"].as_str(), Some("stairs" | "escalator")));
        assert_eq!(
            stairs_table_starts_at(&exported, stairs),
            walkways,
            "{name}"
        );
        assert!(
            exported[stairs - TDT_STAIRS_GAP..stairs]
                .iter()
                .all(|&b| b == 0),
            "{name}: the gap is zeros"
        );
    }
}

/// Where the finance block starts in one of our exports.
fn finance_start(exported: &[u8]) -> usize {
    let table = TDT_STAIR_SLOTS * TDT_STAIR_RECORD_SIZE;
    let stairs = exported.len() - TDT_STAMP_SIZE - TDT_ROUTING_TAIL_SIZE - table;
    stairs - TDT_STAIRS_GAP - TDT_PARKING_SIZE - TDT_FINANCE_SIZE
}

#[test]
fn people_counts_in_the_finance_block_are_not_read_as_a_flight() {
    // 256 single-room guests followed by one twin-room guest put the bytes of a
    // built escalator record (x 256, floor 0) inside the finance block.
    let empty = save_of(&fixture("TOWER8.TDT"), "TOWER8.TDT");
    let mut exported = export_tdt(&empty.to_string()).expect("exports");
    let finance = finance_start(&exported);
    let word = |class: usize| finance + 88 + 4 * class;
    exported[word(POP_HOTEL_SINGLE)..word(POP_HOTEL_SINGLE) + 4]
        .copy_from_slice(&256_i32.to_le_bytes());
    exported[word(POP_HOTEL_TWIN)..word(POP_HOTEL_TWIN) + 4].copy_from_slice(&1_i32.to_le_bytes());
    let back = save_of(&exported, "TOWER8.TDT");
    let walkways = back["transports"]
        .as_array()
        .expect("transports")
        .iter()
        .filter(|t| matches!(t["kind"].as_str(), Some("stairs" | "escalator")))
        .count();
    assert_eq!(walkways, 0, "no phantom escalator from the finance block");
}

#[test]
fn a_second_export_is_the_first_byte_for_byte() {
    for name in SAVES {
        let first = save_of(&fixture(name), name);
        let once = export_tdt(&first.to_string()).expect("exports");
        let again = export_tdt(&save_of(&once, name).to_string()).expect("exports again");
        assert_eq!(once, again, "{name}");
    }
}

#[test]
fn every_shop_restaurant_and_fast_food_has_a_style_on_the_first_import() {
    for name in SAVES {
        let save = save_of(&fixture(name), name);
        for unit in save["units"].as_array().expect("units") {
            if matches!(
                unit["kind"].as_str(),
                Some("shop" | "restaurant" | "fastFood")
            ) {
                assert!(unit["subtype"].is_string(), "{name}: {unit}");
            }
        }
    }
}
