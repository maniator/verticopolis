//! Nine real SimTower saves from 1997, contributed by Reddit user u/invokes
//! with their consent (r/SimTower thread, 2026-10-29); see
//! `conformance/fixtures/tdt-reddit/README.md` and issue #1491. The TypeScript
//! importer reads the same files in
//! `src/tests/integration/tdtRealSaves.integration.test.ts` and must agree.

use std::path::PathBuf;

use verticopolis_engine::tdt::import_tdt;

/// (file, elevator shafts, walkway flights). Every file reads straight
/// through its elevator table, express shafts included.
const SAVES: [(&str, usize, usize); 9] = [
    ("TOWER1.TDT", 15, 1),
    ("TOWER2.TDT", 24, 30),
    ("TOWER3.TDT", 11, 29),
    ("TOWER4.TDT", 18, 29),
    ("TOWER5.TDT", 7, 7),
    ("TOWER6.TDT", 23, 64),
    ("TOWER7.TDT", 24, 64),
    ("TOWER8.TDT", 0, 0),
    ("MYTOWER.TDT", 24, 37),
];

#[test]
fn the_real_1997_saves_bring_over_their_own_elevators_and_stairways() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("conformance")
        .join("fixtures")
        .join("tdt-reddit");
    for (name, shafts, flights) in SAVES {
        let bytes = std::fs::read(dir.join(name)).expect("fixture");
        let (json, warnings) = import_tdt(&bytes, name).expect("imports");
        let save: serde_json::Value = serde_json::from_str(&json).expect("save json");
        let transports = save["transports"].as_array().expect("transports");
        let walkways = transports
            .iter()
            .filter(|t| matches!(t["kind"].as_str(), Some("stairs" | "escalator")))
            .count();
        assert_eq!(transports.len() - walkways, shafts, "{name} shafts");
        assert_eq!(walkways, flights, "{name} flights");
        assert!(
            warnings
                .iter()
                .all(|w| !w.contains("found by searching the file")),
            "{name} warnings: {warnings:?}"
        );
        assert!(
            warnings
                .iter()
                .all(|w| !w.contains("rebuilt from the floor")),
            "{name} warnings: {warnings:?}"
        );
    }
}

/// (file, people SimTower counts in offices, people it counts in condos), from
/// the PC's per-class table for the nine saves (TOWER4's block is the same shape
/// as the rest and totals 4,515; only the PC's lookup script missed it).
const RESIDENTS: [(&str, i64, i64); 8] = [
    ("TOWER1.TDT", 528, 423),
    ("TOWER2.TDT", 1284, 915),
    ("TOWER3.TDT", 1620, 0),
    ("TOWER4.TDT", 1620, 1131),
    ("TOWER5.TDT", 648, 0),
    ("TOWER6.TDT", 1272, 162),
    ("TOWER7.TDT", 1428, 462),
    ("MYTOWER.TDT", 1842, 624),
];

#[test]
fn offices_and_condos_arrive_with_the_people_the_file_counts() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("conformance")
        .join("fixtures")
        .join("tdt-reddit");
    for (name, offices, condos) in RESIDENTS {
        let bytes = std::fs::read(dir.join(name)).expect("fixture");
        let (json, _) = import_tdt(&bytes, name).expect("imports");
        let save: serde_json::Value = serde_json::from_str(&json).expect("save json");
        let people = |kind: &str| -> i64 {
            save["units"]
                .as_array()
                .expect("units")
                .iter()
                .filter(|u| u["kind"] == kind && u["state"] == "occupied")
                .map(|u| u["occupants"].as_i64().expect("occupants"))
                .sum()
        };
        assert_eq!(people("office"), offices, "{name} offices");
        assert_eq!(people("condo"), condos, "{name} condos");
    }
}

/// (file, single, twin and suite rooms holding guests). Each is the file's
/// hotel guest line divided by the room's complement (1, 2, 2), the rooms in
/// the checked-in or asleep stay state.
const GUEST_ROOMS: [(&str, i64, i64, i64); 9] = [
    ("TOWER1.TDT", 0, 0, 0),
    ("TOWER2.TDT", 180, 242, 81),
    ("TOWER3.TDT", 0, 11, 13),
    ("TOWER4.TDT", 18, 122, 140),
    ("TOWER5.TDT", 0, 0, 0),
    ("TOWER6.TDT", 0, 7, 27),
    ("TOWER7.TDT", 0, 0, 0),
    ("TOWER8.TDT", 0, 0, 0),
    ("MYTOWER.TDT", 0, 0, 0),
];

#[test]
fn hotel_rooms_arrive_with_guests_exactly_where_the_file_counts_them() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("conformance")
        .join("fixtures")
        .join("tdt-reddit");
    for (name, singles, twins, suites) in GUEST_ROOMS {
        let bytes = std::fs::read(dir.join(name)).expect("fixture");
        let (json, _) = import_tdt(&bytes, name).expect("imports");
        let save: serde_json::Value = serde_json::from_str(&json).expect("save json");
        let with_guests = |kind: &str| -> i64 {
            save["units"]
                .as_array()
                .expect("units")
                .iter()
                .filter(|u| u["kind"] == kind && u["state"] == "asleep")
                .count() as i64
        };
        assert_eq!(with_guests("hotelSingle"), singles, "{name} singles");
        assert_eq!(with_guests("hotelDouble"), twins, "{name} twins");
        assert_eq!(with_guests("hotelSuite"), suites, "{name} suites");
    }
}

/// Left edges of the stalls on one floor of an imported save, with the ramp's.
fn parking_row(save: &serde_json::Value, floor: i64) -> (Vec<i64>, Vec<i64>) {
    let at = |kind: &str| -> Vec<i64> {
        let mut xs: Vec<i64> = save["units"]
            .as_array()
            .expect("units")
            .iter()
            .filter(|u| u["kind"] == kind && u["floor"] == floor)
            .map(|u| u["x"].as_i64().expect("x"))
            .collect();
        xs.sort();
        xs
    };
    (at("parking"), at("parkingRamp"))
}

fn import_save(name: &str) -> serde_json::Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("conformance")
        .join("fixtures")
        .join("tdt-reddit")
        .join(name);
    let bytes = std::fs::read(path).expect("fixture");
    let (json, _) = import_tdt(&bytes, name).expect("imports");
    serde_json::from_str(&json).expect("save json")
}

#[test]
fn tower7_stalls_beside_short_paving_pieces_reach_their_ramp() {
    // The file leaves a 3-tile and a 1-tile paving piece on this row, and
    // still counts every stall on it as connected.
    let save = import_save("TOWER7.TDT");
    let (stalls, ramps) = parking_row(&save, -4);
    assert_eq!(ramps, vec![150]);
    assert_eq!(&stalls[..4], &[134, 138, 142, 146]);
}

#[test]
fn tower1_stalls_a_whole_row_away_from_the_ramp_stay_where_the_file_put_them() {
    // The file counts these 8 stalls as disconnected: 56 tiles of paving.
    let save = import_save("TOWER1.TDT");
    let (stalls, ramps) = parking_row(&save, -4);
    assert_eq!(ramps, vec![145]);
    assert_eq!(stalls, vec![161, 221]);
}
