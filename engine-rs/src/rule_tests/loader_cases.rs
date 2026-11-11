//! Relations between the loader conformance cases, from the retired
//! `loaderCases.integration.test.ts`. That suite generated
//! `conformance/loader-cases.json` from the TypeScript loader and checked
//! that the table held its own inputs; with the TypeScript engine gone the
//! table is fixed data, and `load::loader_cases::forged_saves_load_as_the_typescript_loads_them`
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
fn marked_imported_basement_stops_differ_from_legacy_and_modern_coercion() {
    let marked = hash("transport-classic-basement-imported-empty");
    let legacy = hash("transport-classic-basement-legacy-empty");
    assert_ne!(marked, legacy);
    assert_ne!(marked, hash("transport-classic-basement-imported-mixed"));
    assert_eq!(hash("transport-classic-basement-marker-string"), legacy);
    assert_ne!(hash("transport-modern-basement-marker-ignored"), marked);
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
