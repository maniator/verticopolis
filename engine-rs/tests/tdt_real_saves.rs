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
