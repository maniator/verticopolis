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
    ("TOWER2.TDT", 24, 31),
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
