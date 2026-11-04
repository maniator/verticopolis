//! The fixture edits rewrite a finished export where the importer's own walk
//! says a block sits. These build files with the real encoder and check each
//! edit against what the importer reads back, so an encoder change fails here
//! and not on the PC.

use std::path::Path;

use serde_json::Value;

use super::export::build_tdt;
use super::fixtures::*;
use super::format::TDT_PERSON_RECORD_SIZE;
use super::parse::parse_tdt;
use super::referee::read_lock;
use super::tables::{HOTEL_INFESTED_FLAG, HOTEL_STAY_VACANT};
use super::types::TdtElevator;

/// A locked export case with standard, service and express shafts and rooms.
fn lock_save() -> Value {
    lock_case("export-transports")
}

fn lock_case(id: &str) -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../conformance/tdt-cases.json");
    let lock = read_lock(&path).expect("the lock reads");
    lock.export
        .into_iter()
        .find(|c| c.id == id)
        .and_then(|c| c.save)
        .unwrap_or_else(|| panic!("the lock has an {id} case that embeds its save"))
}

fn export_of(save: &Value) -> Vec<u8> {
    build_tdt(save).expect("the tower exports").bytes
}

/// Every shaft the importer finds, as `(kind, x, bottom, top)`, sorted.
fn shafts_of(bytes: &[u8]) -> Vec<(String, i64, i64, i64)> {
    let parsed = parse_tdt(bytes, "FIXTURE.TDT").expect("the file imports");
    let mut shafts: Vec<_> = parsed.save["transports"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|t| {
            t["kind"]
                .as_str()
                .is_some_and(|k| k.starts_with("elevator"))
        })
        .map(|t| {
            (
                t["kind"].as_str().unwrap().to_string(),
                t["x"].as_i64().unwrap(),
                t["bottom"].as_i64().unwrap(),
                t["top"].as_i64().unwrap(),
            )
        })
        .collect();
    shafts.sort();
    shafts
}

#[test]
fn the_decoder_reports_every_shaft_record_in_table_order_with_express_last() {
    let base = export_of(&lock_save());
    let shafts = read_blocks(&base).unwrap().elevators;
    assert!(shafts.len() > 2);
    let first_express = shafts
        .iter()
        .position(is_express)
        .expect("an express shaft");
    assert!(shafts[first_express..].iter().all(is_express));
    // The records tile the table from its first slot, one after another.
    assert!(shafts
        .windows(2)
        .all(|w| w[0].record.end == w[1].record.start));
}

#[test]
fn reimports_the_same_tower_after_the_person_block_changes_size() {
    let base = export_of(&lock_save());
    let own = person_record_count(&base).unwrap();
    let want = parse_tdt(&base, "BASE.TDT").unwrap();
    for count in [0, own, MAX_PERSON_RECORDS] {
        let variant = with_person_records(&base, count).unwrap();
        assert_eq!(person_record_count(&variant).unwrap(), count);
        let grown = (count as isize - own as isize) * TDT_PERSON_RECORD_SIZE as isize;
        assert_eq!(variant.len() as isize, base.len() as isize + grown);
        let back = parse_tdt(&variant, "VARIANT.TDT").unwrap();
        assert_eq!(back.warnings, want.warnings);
        assert_eq!(back.save["units"], want.save["units"]);
        assert_eq!(back.save["transports"], want.save["transports"]);
    }
}

#[test]
fn refuses_a_person_record_count_the_format_cannot_carry() {
    let base = export_of(&lock_save());
    let err = with_person_records(&base, MAX_PERSON_RECORDS + 1).unwrap_err();
    assert!(err.contains("outside"), "{err}");
}

#[test]
fn moves_express_shafts_to_the_front_and_keeps_every_shaft() {
    let base = export_of(&lock_save());
    let front = with_express_first(&base).unwrap();
    assert_eq!(front.len(), base.len());
    assert_ne!(front, base);
    let shafts = read_blocks(&front).unwrap().elevators;
    assert!(is_express(&shafts[0]));
    let last_express = shafts.iter().rposition(is_express).unwrap();
    assert!(shafts[..=last_express].iter().all(is_express));
    assert_eq!(shafts_of(&front), shafts_of(&base));
}

#[test]
fn puts_two_shafts_on_the_same_tiles_and_writes_both_records() {
    let records = |mode| {
        let mut save = lock_save();
        let edit = overlap_first_two_shafts(&mut save, mode).unwrap();
        (edit, read_blocks(&export_of(&save)).unwrap().elevators)
    };
    let (apart, control) = records(Overlap::Apart);
    assert_eq!((apart.shared_tiles, apart.moved_x), (0, apart.anchor_x + 4));
    for (mode, shared) in [(Overlap::Partial, 1), (Overlap::Full, 4)] {
        let (edit, shafts) = records(mode);
        assert_eq!(edit.shared_tiles, shared, "{mode:?}");
        assert_eq!(edit.moved_x, edit.anchor_x + 4 - shared, "{mode:?}");
        // The exporter still writes every record the control writes.
        assert_eq!(shafts.len(), control.len(), "{mode:?}");
        let at = |x: i64| shafts.iter().filter(move |s| s.x == x).collect::<Vec<_>>();
        let (anchor, moved) = (at(edit.anchor_x), at(edit.moved_x));
        assert!(!anchor.is_empty() && !moved.is_empty(), "{mode:?}");
        // Both sit on the same floors.
        let span = |s: &&TdtElevator| (s.bottom_floor, s.top_floor);
        assert_eq!(span(&anchor[0]), span(&moved[moved.len() - 1]), "{mode:?}");
        if mode == Overlap::Full {
            assert_eq!(edit.moved_x, edit.anchor_x);
            assert!(anchor.len() >= 2, "both records sit at the one x");
        }
    }
}

#[test]
fn the_overlap_edit_needs_two_standard_or_service_shafts() {
    let mut save = lock_save();
    let transports = save["transports"].as_array_mut().unwrap();
    transports.retain(|t| t["kind"] != "elevatorStandard");
    let err = overlap_first_two_shafts(&mut save, Overlap::Full).unwrap_err();
    assert!(err.contains("at least two"), "{err}");
}

#[test]
fn each_builder_names_its_files_and_carries_the_edit() {
    let save = lock_save();
    let claim1 = claim1_fixtures(&save).unwrap();
    let names: Vec<_> = claim1.iter().map(|(f, _)| f.name).collect();
    assert_eq!(names, ["OVLAPCTL.TDT", "OVLAP1.TDT", "OVLAPFUL.TDT"]);
    let (claim7, own) = claim7_fixtures(&save).unwrap();
    let counts: Vec<_> = claim7
        .iter()
        .map(|f| person_record_count(&f.bytes).unwrap())
        .collect();
    assert_eq!(counts, [0, own, MAX_PERSON_RECORDS]);
    let (express, built, express_count) = express740_fixtures(&save).unwrap();
    assert_eq!(
        express.iter().map(|f| f.name).collect::<Vec<_>>(),
        ["EXPLAST.TDT", "EXPFIRST.TDT"]
    );
    assert!(express_count >= 1 && built > express_count);
}

#[test]
fn the_infested_files_rewrite_only_the_status_byte_of_three_hotel_rooms() {
    let save = lock_case("export-rent-classes");
    let (files, rooms) = infested1629_fixtures(&save).unwrap();
    assert_eq!(rooms.len(), INFESTED_TEST_ROOMS);
    let names: Vec<_> = files.iter().map(|f| f.name).collect();
    assert_eq!(
        names,
        ["INFCTL.TDT", "INFFLAG.TDT", "INFVAC.TDT", "INFDIRTY.TDT"]
    );
    let control = &files[0].bytes;
    let at: Vec<_> = rooms.iter().map(|r| r.status_at).collect();
    for file in &files[1..] {
        assert_eq!(file.bytes.len(), control.len());
        let differing: Vec<_> = (0..control.len())
            .filter(|&i| file.bytes[i] != control[i])
            .collect();
        assert_eq!(differing, at, "{}", file.name);
    }
    // The decoder reads each rewritten byte back as the status the file holds.
    let rewritten = hotel_rooms(control).unwrap();
    assert!(rewritten
        .iter()
        .take(INFESTED_TEST_ROOMS)
        .map(|r| r.status_at)
        .eq(at.iter().copied()));
    let status = |bytes: &[u8]| at.iter().map(|&i| bytes[i]).collect::<Vec<_>>();
    assert_eq!(
        status(control),
        [HOTEL_STAY_VACANT as u8; INFESTED_TEST_ROOMS]
    );
    assert_eq!(
        status(&files[1].bytes),
        [HOTEL_INFESTED_FLAG as u8; INFESTED_TEST_ROOMS]
    );
    // The importer reads the infested flag back as an infested count.
    assert!(
        parse_tdt(&files[1].bytes, "INFFLAG.TDT")
            .unwrap()
            .counts
            .infested
            >= INFESTED_TEST_ROOMS as i64
    );
}
