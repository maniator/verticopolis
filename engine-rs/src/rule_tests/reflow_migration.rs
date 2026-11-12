//! The version 1 to 2 canon-width reflow: a parking chain is resized with
//! every space still chained and the ramp column anchored, a widened room
//! shoves its neighbor just clear, an over-full floor stays valid, a boxed-in
//! room keeps its legacy footprint, a floor that would float stays at legacy
//! widths, padded tiles are bare structure, two ramps on a floor do not
//! overlap, a current save is untouched, a dense strip reaches canon with no
//! overlap, and the real towerone_6 save migrates within those rules.
//!
//! Loader edge cases on version 1 saves are covered by the loader table
//! (`load::loader_cases`, the `legacy-v1-*` and `version-absent-v1-reflow`
//! cases) and by `load_fidelity_tests::{the_v1_checks_skip_a_nan_column_and_a_far_floor,
//! the_reflow_pads_from_a_floored_next_id_only_on_the_lot}`; parking over
//! many floors by `load_assemble_tests::legacy_parking_on_many_floors_reflows_without_a_scan_per_floor`.
use std::collections::HashMap;

use serde_json::{json, Value};

use crate::clock::GameMode;
use crate::facilities::{Kind, LOT_WIDTH};
use crate::load::{deserialize, floating_structure_count, reflow_v1_to_v2};
use crate::sim::{Simulation, PLAIN_SAVE_VERSION};
use crate::tower::Unit;

use super::{fixture_save, legacy_save, pave};

fn v1(units: Vec<Value>) -> Simulation {
    deserialize(&legacy_save(1, units, vec![])).expect("the save loads")
}

fn room(kind: &str, floor: i64, x: i64, width: i64) -> Value {
    json!({ "kind": kind, "floor": floor, "x": x, "width": width })
}

fn width(kind: Kind) -> i64 {
    kind.facility().width
}

fn rooms(sim: &Simulation) -> Vec<&Unit> {
    sim.tower
        .units
        .iter()
        .filter(|u| !u.kind.is_structural())
        .collect()
}

fn of(sim: &Simulation, kind: Kind) -> Vec<&Unit> {
    sim.tower.units.iter().filter(|u| u.kind == kind).collect()
}

/// No two room footprints share a tile on a shared story.
fn assert_no_overlap(rooms: &[&Unit]) {
    for (i, a) in rooms.iter().enumerate() {
        for b in &rooms[i + 1..] {
            let floors = a.floor < b.floor + b.kind.floors() && b.floor < a.floor + a.kind.floors();
            let xs = a.x < b.x + b.width && b.x < a.x + a.width;
            assert!(
                !(floors && xs),
                "{:?}@{}:{} overlaps {:?}@{}:{}",
                a.kind,
                a.floor,
                a.x,
                b.kind,
                b.floor,
                b.x
            );
        }
    }
}

/// Footprints sorted by x, each starting at or after the last one's end.
fn assert_in_a_row(mut spans: Vec<(i64, i64)>, contiguous: bool) {
    spans.sort();
    for w in spans.windows(2) {
        let end = w[0].0 + w[0].1;
        if contiguous {
            assert_eq!(w[1].0, end, "{spans:?}");
        } else {
            assert!(w[1].0 >= end, "{spans:?}");
        }
    }
}

#[test]
fn a_parking_chain_reaches_canon_widths_chained_with_the_ramp_anchored() {
    let mut units = pave("lobby", 1, 0, 60);
    units.extend(pave("floor", 0, 0, 60));
    units.push(room("parkingRamp", 0, 20, 6));
    for x in [26, 32, 38] {
        units.push(room("parking", 0, x, 6));
    }
    let sim = v1(units);
    let ramp = of(&sim, Kind::ParkingRamp)[0];
    let spaces = of(&sim, Kind::Parking);
    assert_eq!(ramp.width, width(Kind::ParkingRamp));
    assert!(spaces.iter().all(|s| s.width == width(Kind::Parking)));
    assert_eq!(ramp.x, 20);
    assert_eq!(sim.tower.functional_parking_spots(), 3);
    let mut spans: Vec<(i64, i64)> = spaces.iter().map(|u| (u.x, u.width)).collect();
    spans.push((ramp.x, ramp.width));
    assert_in_a_row(spans, true);
}

#[test]
fn a_widened_room_shoves_its_neighbor_just_clear() {
    let mut units = pave("floor", 2, 0, 60);
    units.push(room("fastFood", 2, 0, 12));
    units.push(room("office", 2, 12, 9));
    let sim = v1(units);
    let ff = of(&sim, Kind::FastFood)[0];
    let office = of(&sim, Kind::Office)[0];
    assert_eq!((ff.x, ff.width), (0, 16));
    assert!(office.x >= ff.x + ff.width);
    assert_eq!(office.width, 9);
}

#[test]
fn a_floor_too_full_for_canon_widths_still_loads_valid() {
    let mut units = pave("floor", 2, 0, LOT_WIDTH);
    let mut x = 0;
    while x + 12 <= LOT_WIDTH {
        units.push(room("fastFood", 2, x, 12));
        x += 12;
    }
    let sim = v1(units);
    assert_eq!(sim.serialize()["version"], PLAIN_SAVE_VERSION);
    let spans: Vec<(i64, i64)> = of(&sim, Kind::FastFood)
        .iter()
        .map(|u| (u.x, u.width))
        .collect();
    assert!(spans.iter().all(|(x, w)| x + w <= LOT_WIDTH));
    assert_in_a_row(spans, false);
}

#[test]
fn a_boxed_in_room_keeps_its_legacy_footprint() {
    let mut units = pave("floor", -1, 0, 60);
    units.extend(pave("floor", 0, 0, 60));
    units.push(room("recycling", -1, 20, 20)); // two stories: reaches floor 0
    units.push(room("restaurant", 0, 0, 16));
    let sim = v1(units);
    let rest = of(&sim, Kind::Restaurant)[0];
    let rec = of(&sim, Kind::Recycling)[0];
    assert_eq!((rest.x, rest.width), (0, 16), "legacy width kept");
    assert!(rest.x + rest.width <= rec.x);
}

#[test]
fn a_floor_that_would_float_stays_at_legacy_widths() {
    let mut units = pave("floor", 1, 0, 30);
    units.extend(pave("floor", 2, 0, 30));
    units.extend(pave("floor", 3, 0, 30));
    units.push(room("restaurant", 3, 0, 16));
    units.push(room("office", 3, 16, 9));
    let sim = v1(units);
    let save = sim.serialize();
    assert_eq!(save["version"], PLAIN_SAVE_VERSION);
    assert_eq!(floating_structure_count(&save), 0);
    assert!(rooms(&sim).iter().all(|r| r.x + r.width <= 30));
}

#[test]
fn tiles_paved_for_a_widened_room_are_bare_structure() {
    let mut units = pave("floor", 1, 0, 60);
    units.extend(pave("floor", 2, 0, 60));
    units.extend(pave("floor", 3, 0, 25));
    units.push(room("restaurant", 3, 0, 16));
    units.push(room("office", 3, 16, 9));
    let out = reflow_v1_to_v2(&legacy_save(1, units, vec![]));
    let paved: Vec<&Value> = out["units"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|u| u["kind"] == "floor" && u["floor"] == 3 && u["x"].as_i64().unwrap() >= 25)
        .collect();
    assert!(!paved.is_empty());
    assert!(paved.iter().all(|u| u["state"] == "empty"), "{paved:?}");
}

#[test]
fn two_ramps_on_one_floor_do_not_overlap() {
    let mut units = pave("floor", 0, 0, 120);
    units.push(room("parkingRamp", 0, 20, 6));
    units.push(room("parking", 0, 26, 6));
    units.push(room("parkingRamp", 0, 40, 6));
    units.push(room("parking", 0, 46, 6));
    let sim = v1(units);
    let spans: Vec<(i64, i64)> = sim
        .tower
        .units
        .iter()
        .filter(|u| matches!(u.kind, Kind::Parking | Kind::ParkingRamp))
        .map(|u| (u.x, u.width))
        .collect();
    assert_in_a_row(spans, false);
    assert_eq!(sim.tower.functional_parking_spots(), 2);
}

#[test]
fn a_current_save_loads_with_its_units_untouched() {
    let mut sim = Simulation::new_game(7, GameMode::Classic);
    sim.money = 1e9;
    assert!(sim.tower.place(Kind::Lobby, 1, 0).ok);
    let current = sim.serialize();
    assert_eq!(current["version"], PLAIN_SAVE_VERSION);
    let reloaded = deserialize(&current).unwrap().serialize();
    assert_eq!(reloaded["version"], PLAIN_SAVE_VERSION);
    assert_eq!(reloaded["units"].to_string(), current["units"].to_string());
}

#[test]
fn a_dense_legacy_strip_reaches_canon_with_no_overlap() {
    let mut units = pave("floor", 2, 0, 120);
    units.extend(pave("floor", 3, 0, 120));
    units.push(room("restaurant", 2, 0, 16));
    units.push(room("cinema", 2, 16, 24));
    units.push(room("hotelSuite", 2, 40, 12));
    units.push(room("office", 2, 52, 9));
    let sim = v1(units);
    let rooms = rooms(&sim);
    assert_no_overlap(&rooms);
    for r in &rooms {
        assert_eq!(r.width, width(r.kind), "{:?}", r.kind);
    }
}

#[test]
fn the_real_towerone_6_save_migrates_within_the_rules() {
    let raw = fixture_save("towerone_6");
    assert_eq!(raw["version"], 1);
    let raw_units = raw["units"].as_array().unwrap();
    let count = |kind: &str| raw_units.iter().filter(|u| u["kind"] == kind).count();
    let parking_before = count("parking");
    let mut ramps_before: Vec<i64> = raw_units
        .iter()
        .filter(|u| u["kind"] == "parkingRamp")
        .map(|u| u["x"].as_i64().unwrap())
        .collect();
    ramps_before.sort();
    let saved_width: HashMap<i64, i64> = raw_units
        .iter()
        .map(|u| (u["id"].as_i64().unwrap(), u["width"].as_i64().unwrap_or(-1)))
        .collect();
    let sim = deserialize(&raw).expect("the fixture loads");
    let save = sim.serialize();
    assert_eq!(save["version"], PLAIN_SAVE_VERSION);
    let rooms = rooms(&sim);
    // Each room sits at its canon width or the width it was saved at.
    let mut at_canon = 0;
    for r in &rooms {
        let canon = width(r.kind);
        assert!(
            r.width == canon || Some(&r.width) == saved_width.get(&r.id),
            "{:?} {}",
            r.kind,
            r.width
        );
        at_canon += usize::from(r.width == canon);
    }
    assert!(
        at_canon * 100 > rooms.len() * 95,
        "{at_canon} of {}",
        rooms.len()
    );
    assert!(floating_structure_count(&save) <= floating_structure_count(&raw));
    assert_no_overlap(&rooms);
    assert_eq!(of(&sim, Kind::Parking).len(), parking_before);
    assert_eq!(
        sim.tower.functional_parking_spots() as usize,
        parking_before
    );
    let mut ramps_after: Vec<i64> = of(&sim, Kind::ParkingRamp).iter().map(|u| u.x).collect();
    ramps_after.sort();
    assert_eq!(ramps_after, ramps_before);
    assert!(rooms.iter().all(|r| r.x + r.width <= LOT_WIDTH));
}
