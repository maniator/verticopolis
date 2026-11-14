//! Relations between the loader conformance cases, from the retired
//! `loaderCases.integration.test.ts`. That suite generated
//! `conformance/loader-cases.json` from the TypeScript loader and checked
//! that the table held its own inputs; with the TypeScript engine gone the
//! table is fixed data, and `load::loader_cases::forged_saves_load_to_their_recorded_digests`
//! replays every case against its hash. The two tests here hold what the
//! hashes must say about each other, read from the Rust loader itself, so two
//! cases cannot agree or differ for the wrong reason.
use crate::canonical::digest;
use crate::load::deserialize;
use crate::snapshot::state_view;
use serde_json::Value;

const TABLE: &str = include_str!("../../../conformance/loader-cases.json");

/// The Rust loader's hash of the case named `id`; a missing id or a save
/// that does not load fails, since either would make two hashes agree.
fn hash(id: &str) -> String {
    let table: Value = serde_json::from_str(TABLE).expect("loader-cases.json parses");
    let case = table["cases"]
        .as_array()
        .expect("cases")
        .iter()
        .find(|c| c["id"] == id)
        .unwrap_or_else(|| panic!("no loader case {id}"));
    let sim = deserialize(&case["input"]).unwrap_or_else(|e| panic!("{id} loads: {e:?}"));
    digest(&state_view(&sim))
}

#[test]
fn an_express_keeps_its_own_basement_stops_and_drops_the_old_rules() {
    // A marked shaft's basement skips are its own: the imported file's
    // skip at B3 (floor -2) stays.
    let marked = hash("transport-classic-basement-imported-empty");
    assert_ne!(marked, hash("transport-classic-basement-imported-mixed"));
    // A save from before expresses served the basements carries no marker,
    // and its basement skips were the old lobby-only rule's: they go, and
    // the shaft loads as a marked one that stops at every basement floor.
    // A marker that is not `true` counts as none.
    assert_eq!(hash("transport-classic-basement-legacy-skips"), marked);
    assert_eq!(hash("transport-classic-basement-legacy-empty"), marked);
    assert_eq!(hash("transport-classic-basement-marker-string"), marked);
    // Modern follows the same rule.
    assert_eq!(
        hash("transport-modern-basement-legacy-skips"),
        hash("transport-modern-basement-marked-empty")
    );
}

#[test]
fn an_ignored_billed_room_list_loads_as_no_list() {
    // The billed-room cases (#902): a list the loader ignores or empties
    // agrees with its plain counterpart.
    assert_eq!(hash("exterminator-orphan-list"), hash("modern-roundtrip"));
    assert_eq!(hash("exterminator-classic-list"), hash("classic-roundtrip"));
    let invalid = hash("exterminator-invalid-list");
    assert_eq!(hash("exterminator-null-list"), invalid);
    assert_eq!(hash("exterminator-empty-list"), invalid);
    assert_ne!(invalid, hash("exterminator-legacy-list-absent"));
    assert_ne!(
        hash("exterminator-booked-ids"),
        hash("exterminator-empty-list")
    );
}
