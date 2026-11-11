//! The two-story party hall through the loader and the `.TDT` codec: a
//! version 5 save loads with the hall indexed on both stories and the current
//! version stamped, and a built hall exports and imports as one two-story
//! room at its bottom story and catalog width. Placement on a full-width slab
//! is covered by `wedding_hall_tests::the_wedding_hall_needs_a_full_width_floor_slab_under_it`;
//! the venue record by `tdt::venues::tests::a_hall_and_a_theatre_read_with_their_floors_film_and_days`.
use serde_json::{json, Value};

use crate::facilities::Kind;
use crate::load::deserialize;
use crate::sim::SAVE_VERSION;
use crate::tdt::{export_tdt, import_tdt};

use super::{legacy_save, pave};

fn hall_width() -> i64 {
    Kind::PartyHall.facility().width
}

#[test]
fn a_version_5_save_loads_with_the_hall_on_both_stories() {
    let mut units = pave("lobby", 1, 0, 60);
    units.extend(pave("floor", 2, 0, 60));
    units.push(json!({ "kind": "partyHall", "floor": 2, "x": 10, "width": hall_width() }));
    let sim = deserialize(&legacy_save(5, units, vec![])).expect("the save loads");
    assert_eq!(sim.serialize()["version"], SAVE_VERSION);
    let hall = sim
        .tower
        .units
        .iter()
        .find(|u| u.kind == Kind::PartyHall)
        .unwrap();
    assert_eq!(
        sim.tower.room_at(hall.floor, hall.x).map(|u| u.id),
        Some(hall.id)
    );
    assert_eq!(
        sim.tower.room_at(hall.floor + 1, hall.x).map(|u| u.id),
        Some(hall.id)
    );
}

#[test]
fn a_built_hall_exports_and_imports_as_one_two_story_room() {
    let mut units = pave("lobby", 1, 0, 80);
    units.extend(pave("floor", 2, 0, 80));
    units.extend(pave("floor", 3, 0, 80));
    units.push(json!({ "kind": "partyHall", "floor": 2, "x": 40, "width": hall_width() }));
    let mut save = legacy_save(SAVE_VERSION, units, vec![]);
    save["star"] = json!(5);
    let bytes = export_tdt(&save.to_string()).expect("exports");
    let (text, _) = import_tdt(&bytes, "RT.TDT").expect("imports");
    let round: Value = serde_json::from_str(&text).unwrap();
    let halls: Vec<&Value> = round["units"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|u| u["kind"] == "partyHall")
        .collect();
    assert_eq!(halls.len(), 1, "the two halves merge into one hall");
    assert_eq!(halls[0]["floor"], 2);
    assert_eq!(halls[0]["x"], 40);
    assert_eq!(halls[0]["width"], hall_width());
    assert_eq!(Kind::PartyHall.floors(), 2);
}
