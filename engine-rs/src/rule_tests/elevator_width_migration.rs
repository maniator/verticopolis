//! The canon elevator widths and the version 4 to 5 shaft widening: a
//! standard or service shaft is 4 tiles and an express 6; a legacy narrow
//! shaft grows right in place, else shifts left up to the width it lacks,
//! never off the lot or into a neighbor (judged on the loader's coerced
//! geometry and on each earlier widen's new footprint), and keeps its legacy
//! width when boxed in. Walkways, canon-width shafts and entries the loader
//! drops pass through. The loader's side (re-widening on every load, the
//! forged-width clamp, the flood cap, the overlap drop, the right-edge
//! clamp) and the SixSeven fixture are in `elevator_width_migration_load`.
//! The step being the only version 7 change is pinned by
//! `load_stream_tests::the_version_7_step_is_the_shaft_widening`.
use serde_json::{json, Value};

use crate::facilities::{Kind, LOT_WIDTH};
use crate::load::{deserialize, migrate_save, widen_legacy_elevator_shafts};
use crate::sim::{Simulation, PLAIN_SAVE_VERSION};

use super::legacy_save;

/// A transport entry: a one-car 3-wide standard shaft over floors 1 to 10
/// unless `fields` says otherwise.
pub(super) fn shaft(fields: Value) -> Value {
    let mut t = json!({
        "kind": "elevatorStandard", "x": 0, "width": 3, "bottom": 1, "top": 10,
        "cars": 1, "carPositions": [1], "carDir": [0], "load": 0,
    });
    for (k, v) in fields.as_object().unwrap() {
        t[k] = v.clone();
    }
    t
}

/// A version 4 save holding `transports`, ids from 1 unless one is given.
pub(super) fn v4(transports: Vec<Value>) -> Value {
    let transports = transports
        .into_iter()
        .enumerate()
        .map(|(i, mut t)| {
            t.as_object_mut()
                .unwrap()
                .entry("id")
                .or_insert(json!(i + 1));
            t
        })
        .collect();
    legacy_save(4, vec![], transports)
}

/// The widened transports of a version 4 save.
fn widened(transports: Vec<Value>) -> Vec<Value> {
    let out = widen_legacy_elevator_shafts(&v4(transports));
    out["transports"].as_array().unwrap().clone()
}

/// The transports a save holds once loaded and saved again.
pub(super) fn loaded_transports(save: &Value) -> Vec<Value> {
    let sim = deserialize(save).expect("the save loads");
    sim.serialize()["transports"].as_array().unwrap().clone()
}

/// The `(x, width)` of a transport entry.
pub(super) fn foot(t: &Value) -> (i64, i64) {
    (t["x"].as_i64().unwrap(), t["width"].as_i64().unwrap())
}

/// True when two entries share a column on a shared floor (a shared end
/// floor counts, as it does for elevators).
pub(super) fn collide(a: &Value, b: &Value) -> bool {
    let ((ax, aw), (bx, bw)) = (foot(a), foot(b));
    let floors = |t: &Value| (t["bottom"].as_i64().unwrap(), t["top"].as_i64().unwrap());
    let ((ab, at), (bb, bt)) = (floors(a), floors(b));
    ax < bx + bw && bx < ax + aw && ab <= bt && bb <= at
}

#[test]
fn standard_and_service_shafts_are_four_wide_and_the_express_six() {
    assert_eq!(Kind::ElevatorStandard.facility().width, 4);
    assert_eq!(Kind::ElevatorService.facility().width, 4);
    assert_eq!(Kind::ElevatorExpress.facility().width, 6);
    let mut sim = Simulation::new_game(1, crate::clock::GameMode::Classic);
    for x in 40..80 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    for floor in 2..=10 {
        for x in 40..80 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    for (kind, x, w) in [
        (Kind::ElevatorStandard, 42, 4),
        (Kind::ElevatorService, 50, 4),
        (Kind::ElevatorExpress, 60, 6),
    ] {
        let id = sim
            .tower
            .place_transport(kind, x, 1, 10)
            .unit_id
            .expect("placed");
        assert_eq!(sim.tower.get_transport(id).unwrap().width, w, "{kind:?}");
    }
}

#[test]
fn a_lone_narrow_shaft_grows_right_in_place() {
    let out = widened(vec![shaft(json!({ "x": 100 }))]);
    assert_eq!(foot(&out[0]), (100, 4));
    let migrated = migrate_save(&v4(vec![shaft(json!({ "x": 100 }))]));
    assert_eq!(migrated["version"], PLAIN_SAVE_VERSION);
    assert_eq!(foot(&migrated["transports"][0]), (100, 4));
}

#[test]
fn a_shaft_flush_against_a_neighbor_on_the_right_grows_left() {
    let out = widened(vec![
        shaft(json!({ "x": 100 })),
        shaft(json!({ "kind": "elevatorService", "x": 103, "width": 4 })),
    ]);
    assert_eq!(foot(&out[0]), (99, 4));
    assert_eq!(foot(&out[1]), (103, 4));
}

#[test]
fn a_shaft_boxed_in_on_both_sides_keeps_its_legacy_width() {
    let out = widened(vec![
        shaft(json!({ "kind": "elevatorService", "x": 96, "width": 4 })),
        shaft(json!({ "x": 100 })),
        shaft(json!({ "kind": "elevatorService", "x": 103, "width": 4 })),
    ]);
    assert_eq!(foot(&out[1]), (100, 3));
}

#[test]
fn a_shaft_at_the_right_edge_shifts_left_instead_of_running_off_the_lot() {
    let out = widened(vec![shaft(json!({ "x": LOT_WIDTH - 3 }))]);
    assert_eq!(foot(&out[0]), (LOT_WIDTH - 4, 4));
}

#[test]
fn a_shared_end_floor_blocks_a_widen_and_disjoint_floors_do_not() {
    let out = widened(vec![
        shaft(json!({ "x": 100, "bottom": 1, "top": 10 })),
        shaft(json!({ "kind": "elevatorService", "x": 103, "width": 4, "bottom": 10, "top": 20 })),
        shaft(json!({ "x": 200, "bottom": 1, "top": 10 })),
        shaft(json!({ "kind": "elevatorService", "x": 203, "width": 4, "bottom": 11, "top": 20 })),
    ]);
    assert_eq!(foot(&out[0]), (99, 4), "grew left around the shared floor");
    assert_eq!(foot(&out[2]), (200, 4), "disjoint floors: grew right");
}

#[test]
fn collisions_are_judged_on_the_loaders_coerced_geometry() {
    // An inverted span loads as floors 10 to 11; a missing x loads at 0.
    let out = widened(vec![
        shaft(json!({ "x": 100, "bottom": 5, "top": 20 })),
        shaft(json!({ "kind": "elevatorService", "x": 103, "width": 4, "bottom": 10, "top": 1 })),
        shaft(json!({ "x": 1, "bottom": 1, "top": 10 })),
        shaft(
            json!({ "id": 99, "kind": "elevatorService", "x": null, "width": 4, "bottom": 1, "top": 10 }),
        ),
    ]);
    assert_eq!(foot(&out[0]), (99, 4), "blocked right by the coerced span");
    assert_eq!(foot(&out[2]), (1, 3), "already overlapping: never widened");
    let mut save = v4(vec![]);
    save["transports"] = json!(out);
    save["version"] = json!(5);
    let loaded = loaded_transports(&save);
    let a = &loaded[0];
    assert_eq!(foot(a), (99, 4));
    for b in &loaded[1..] {
        assert!(!collide(a, b), "{a} against {b}");
    }
}

#[test]
fn walkways_canon_shafts_and_dropped_entries_pass_through() {
    let dropped =
        json!({ "id": 9, "kind": "notAFacility", "x": 200, "width": 3, "bottom": 1, "top": 5 });
    let out = widened(vec![
        shaft(json!({ "kind": "stairs", "x": 50, "width": 4 })),
        shaft(json!({ "kind": "elevatorExpress", "x": 60, "width": 6 })),
        shaft(json!({ "x": null, "bottom": 1, "top": 5 })),
        dropped.clone(),
    ]);
    assert_eq!(
        (foot(&out[0]), &out[0]["kind"]),
        ((50, 4), &json!("stairs"))
    );
    assert_eq!(foot(&out[1]), (60, 6));
    assert_eq!(foot(&out[2]), (0, 4), "coerced to x 0, then widened there");
    assert_eq!(out[3], dropped);
}

#[test]
fn a_widened_shaft_blocks_later_widens_into_its_new_column() {
    let out = widened(vec![shaft(json!({ "x": 100 })), shaft(json!({ "x": 104 }))]);
    assert_eq!(foot(&out[0]), (100, 4));
    assert_eq!(foot(&out[1]), (104, 4));
    // Here the second shaft's only move is left onto the first's new column.
    let out = widened(vec![
        shaft(json!({ "x": 100 })),
        shaft(json!({ "x": 104 })),
        shaft(json!({ "kind": "elevatorService", "x": 107, "width": 4 })),
    ]);
    assert_eq!(foot(&out[0]), (100, 4));
    assert_eq!(
        foot(&out[1]),
        (104, 3),
        "boxed by the new column and the service shaft"
    );
    for (i, a) in out.iter().enumerate() {
        for b in &out[i + 1..] {
            assert!(!collide(a, b), "{a} against {b}");
        }
    }
}

#[test]
fn every_shift_up_to_the_missing_width_is_tried() {
    let out = widened(vec![
        shaft(json!({ "x": 100, "width": 2 })),
        shaft(json!({ "kind": "elevatorService", "x": 102, "width": 4 })),
    ]);
    assert_eq!(foot(&out[0]), (98, 4));
}

#[test]
fn a_four_wide_express_grows_to_six_shifting_up_to_two_left() {
    let alone = widened(vec![shaft(
        json!({ "kind": "elevatorExpress", "x": 100, "width": 4 }),
    )]);
    assert_eq!(foot(&alone[0]), (100, 6));
    let flush = widened(vec![
        shaft(json!({ "kind": "elevatorExpress", "x": 100, "width": 4 })),
        shaft(json!({ "kind": "elevatorService", "x": 104, "width": 4 })),
    ]);
    assert_eq!(foot(&flush[0]), (98, 6));
    assert_eq!(foot(&flush[1]), (104, 4));
}

#[test]
fn a_boxed_in_express_stays_four_wide_on_the_lot_with_no_overlap() {
    let out = widened(vec![
        shaft(json!({ "kind": "elevatorService", "x": 96, "width": 4 })),
        shaft(json!({ "kind": "elevatorExpress", "x": 100, "width": 4 })),
        shaft(json!({ "kind": "elevatorService", "x": 104, "width": 4 })),
    ]);
    assert_eq!(foot(&out[1]), (100, 4));
    for (i, a) in out.iter().enumerate() {
        let (x, w) = foot(a);
        assert!(x >= 0 && x + w <= LOT_WIDTH);
        for b in &out[i + 1..] {
            assert!(!collide(a, b), "{a} against {b}");
        }
    }
}
