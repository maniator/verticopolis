//! The nine real 1997 saves (see `tdt_real_saves.rs`) through import, export
//! and import again: nothing is lost, the clock and the venue styles come back
//! as they went in, and a second export is the first, byte for byte.

use std::path::PathBuf;

use serde_json::Value;
use verticopolis_engine::tdt::format::{
    POP_HOTEL_SINGLE, POP_HOTEL_TWIN, TDT_CLINIC_LIST_SIZE, TDT_ELEVATORS_TO_STAIRS,
    TDT_FINANCE_POPULATION_AT, TDT_FINANCE_SIZE, TDT_LEGACY_ELEVATORS_TO_STAIRS, TDT_PARKING_SIZE,
    TDT_ROUTING_TAIL_SIZE, TDT_STAIR_RECORD_SIZE, TDT_STAIR_SLOTS, TDT_STAMP_SIZE, TDT_STATS_SIZE,
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

/// Where the stairs table starts in one of our exports.
fn stairs_start(exported: &[u8]) -> usize {
    exported.len()
        - TDT_STAMP_SIZE
        - TDT_ROUTING_TAIL_SIZE
        - TDT_STAIR_SLOTS * TDT_STAIR_RECORD_SIZE
}

fn flights_in(save: &Value) -> usize {
    save["transports"]
        .as_array()
        .expect("transports")
        .iter()
        .filter(|t| matches!(t["kind"].as_str(), Some("stairs" | "escalator")))
        .count()
}

/// Every flight is a single-story record, and the flights fill the table from
/// slot 0 up, the way the game's own saves do.
#[test]
fn an_export_writes_one_single_story_record_per_flight_from_slot_0() {
    for name in SAVES {
        let first = save_of(&fixture(name), name);
        let exported = export_tdt(&first.to_string()).expect("exports");
        let stairs = stairs_start(&exported);
        let flights = flights_in(&first);
        let built: Vec<usize> = (0..TDT_STAIR_SLOTS)
            .filter(|&s| exported[stairs + s * TDT_STAIR_RECORD_SIZE] == 1)
            .collect();
        assert_eq!(built, (0..flights).collect::<Vec<_>>(), "{name}");
        for &slot in &built {
            let kind = exported[stairs + slot * TDT_STAIR_RECORD_SIZE + 1];
            assert!(kind <= 1, "{name}: slot {slot} has multi-story type {kind}");
        }
    }
}

#[test]
fn an_export_puts_the_stairs_table_where_the_game_keeps_it() {
    for name in SAVES {
        let first = save_of(&fixture(name), name);
        let exported = export_tdt(&first.to_string()).expect("exports");
        let stairs = stairs_start(&exported);
        assert_eq!(
            stairs_table_starts_at(&exported, stairs),
            flights_in(&first) > 0,
            "{name}"
        );
        // The clinic list is the last 22 bytes before the table and its count
        // is the header's clinic count at byte 52.
        let list = &exported[stairs - TDT_CLINIC_LIST_SIZE..stairs];
        let count = u16::from_le_bytes([list[0], list[1]]);
        assert_eq!(
            count,
            u16::from_le_bytes([exported[52], exported[53]]),
            "{name}"
        );
        for (i, id) in list[2..].chunks(2).enumerate() {
            let want = if i < count as usize { i as u16 } else { 0 };
            assert_eq!(
                u16::from_le_bytes([id[0], id[1]]),
                want,
                "{name}: clinic {i}"
            );
        }
        // The parking block before it: the connected count, then the stalls
        // numbered from 0.
        let parking = stairs - TDT_CLINIC_LIST_SIZE - TDT_PARKING_SIZE;
        let stalls = u16::from_le_bytes([exported[parking], exported[parking + 1]]);
        for i in 0..stalls as usize {
            let at = parking + 2 + 2 * i;
            assert_eq!(
                u16::from_le_bytes([exported[at], exported[at + 1]]),
                i as u16,
                "{name}"
            );
        }
    }
}

/// The nine real saves: the tail length that follows the stairs table and the
/// flights in it, which sit in the first slots. Measured with the game's own
/// re-saves (TOWER6 and TOWER7 carry 48 more bytes for their named units).
const REAL_STAIRS: [(&str, usize, usize); 9] = [
    ("TOWER1.TDT", 17242, 1),
    ("TOWER2.TDT", 17242, 30),
    ("TOWER3.TDT", 17242, 29),
    ("TOWER4.TDT", 17242, 29),
    ("TOWER5.TDT", 17242, 7),
    ("TOWER6.TDT", 17290, 64),
    ("TOWER7.TDT", 17290, 64),
    ("TOWER8.TDT", 17242, 0),
    ("MYTOWER.TDT", 17242, 37),
];

#[test]
fn the_real_saves_keep_their_flights_packed_from_slot_0_in_the_stairs_table() {
    for (name, tail, flights) in REAL_STAIRS {
        let bytes = fixture(name);
        let stairs = bytes.len() - tail - TDT_STAIR_SLOTS * TDT_STAIR_RECORD_SIZE;
        let built: Vec<usize> = (0..TDT_STAIR_SLOTS)
            .filter(|&s| bytes[stairs + s * TDT_STAIR_RECORD_SIZE] == 1)
            .collect();
        // Flights sit from slot 0 up; TOWER2 leaves slot 20 empty.
        assert_eq!(built.len(), flights, "{name}");
        assert!(built.iter().all(|&s| s <= flights), "{name}: {built:?}");
        // The clinic list ends right before the table: header byte 52 counts it.
        let list = stairs - TDT_CLINIC_LIST_SIZE;
        assert_eq!(
            u16::from_le_bytes([bytes[list], bytes[list + 1]]),
            u16::from_le_bytes([bytes[52], bytes[53]]),
            "{name}"
        );
        // The importer reads every one of them.
        assert_eq!(flights_in(&save_of(&bytes, name)), flights, "{name}");
    }
}

/// A file in the layout our exports had before generation 3: the table 160
/// bytes early, filled from slot 16 and wrapping to slot 0.
fn as_generation_two(exported: &[u8]) -> Vec<u8> {
    let stairs = stairs_start(exported);
    let blocks = stairs - TDT_ELEVATORS_TO_STAIRS;
    let mut old = exported[..blocks + TDT_FINANCE_SIZE].to_vec();
    old.extend_from_slice(
        &exported[blocks + TDT_ELEVATORS_TO_STAIRS - TDT_CLINIC_LIST_SIZE - TDT_PARKING_SIZE..]
            [..TDT_PARKING_SIZE],
    );
    old.extend_from_slice(&[0; 4]);
    assert_eq!(old.len() - blocks, TDT_LEGACY_ELEVATORS_TO_STAIRS);
    let table = TDT_STAIR_SLOTS * TDT_STAIR_RECORD_SIZE;
    for slot in 0..TDT_STAIR_SLOTS {
        let from = stairs + ((slot + 48) % TDT_STAIR_SLOTS) * TDT_STAIR_RECORD_SIZE;
        old.extend_from_slice(&exported[from..from + TDT_STAIR_RECORD_SIZE]);
    }
    old.extend_from_slice(&exported[stairs + table..]);
    old
}

#[test]
fn an_older_export_still_imports_every_flight() {
    for name in SAVES {
        let first = save_of(&fixture(name), name);
        let exported = export_tdt(&first.to_string()).expect("exports");
        let old = as_generation_two(&exported);
        assert_eq!(
            flights_in(&save_of(&old, name)),
            flights_in(&save_of(&exported, name)),
            "{name}"
        );
    }
}

#[test]
fn people_counts_in_the_finance_block_are_not_read_as_a_flight() {
    // 256 single-room guests followed by one twin-room guest put the bytes of a
    // built escalator record (x 256, floor 0) inside the finance block.
    let empty = save_of(&fixture("TOWER8.TDT"), "TOWER8.TDT");
    let mut exported = export_tdt(&empty.to_string()).expect("exports");
    let finance = stairs_start(&exported) - TDT_ELEVATORS_TO_STAIRS + TDT_STATS_SIZE;
    let word = |class: usize| finance + TDT_FINANCE_POPULATION_AT + 4 * class;
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
