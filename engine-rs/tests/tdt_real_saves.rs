//! Four real SimTower saves from 1997, contributed by Reddit user u/invokes
//! with their consent (r/SimTower thread, 2026-10-29); see
//! `conformance/fixtures/tdt-reddit/README.md` and issue #1491. The TypeScript
//! importer reads the same files in
//! `src/tests/integration/tdtRealSaves.integration.test.ts` and must agree.

use std::path::PathBuf;

use verticopolis_engine::tdt::import_tdt;

/// (file, elevator shafts, walkway flights, whether the shafts were found by
/// shape because the elevator table is sized by a rule no layout has).
const SAVES: [(&str, usize, usize, bool); 4] = [
    ("TOWER1.TDT", 15, 1, false),
    ("TOWER2.TDT", 24, 31, true),
    ("TOWER3.TDT", 11, 29, false),
    ("TOWER4.TDT", 18, 29, false),
];

#[test]
fn the_real_1997_saves_bring_over_their_own_elevators_and_stairways() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("conformance")
        .join("fixtures")
        .join("tdt-reddit");
    for (name, shafts, flights, searched) in SAVES {
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
        let searched_note = warnings
            .iter()
            .any(|w| w.contains("found by searching the file"));
        assert_eq!(searched_note, searched, "{name} warnings: {warnings:?}");
        assert!(
            warnings
                .iter()
                .all(|w| !w.contains("rebuilt from the floor")),
            "{name} warnings: {warnings:?}"
        );
    }
}
