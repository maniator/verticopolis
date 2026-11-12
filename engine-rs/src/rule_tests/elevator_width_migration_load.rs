//! The second half of the retired `elevatorWidthMigration` suite: the
//! widening as the loader applies it. The real SixSeven save (version 4,
//! fifteen transports, nine legacy 3-wide standard shafts) widens every
//! elevator in place with no overlap and survives a load and an hour of
//! play; a kept-legacy shaft heals once its neighbors are gone; a forged
//! over-wide shaft clamps to the catalog; a forged flood is capped at the
//! pools; an overlapping forged shaft is dropped while stacked stairs stay;
//! and a kept-legacy shaft at the right edge loads at its saved x. The
//! widening rules themselves are in `elevator_width_migration`.
use serde_json::{json, Value};

use crate::facilities::{Kind, LOT_WIDTH, POOLED_CAPS};
use crate::load::{deserialize, migrate_save};
use crate::sim::PLAIN_SAVE_VERSION;

use super::elevator_width_migration::{collide, foot, loaded_transports, shaft, v4};
use super::fixture_save;

fn is_elevator(t: &Value) -> bool {
    Kind::parse(t["kind"].as_str().unwrap()).is_some_and(|k| k.is_elevator())
}

/// A version 5 save, so the widths it holds are final.
fn v5(transports: Vec<Value>) -> Value {
    let mut save = v4(transports);
    save["version"] = json!(5);
    save
}

fn assert_no_collision(list: &[Value]) {
    for (i, a) in list.iter().enumerate() {
        for b in &list[i + 1..] {
            assert!(!collide(a, b), "{a} against {b}");
        }
    }
}

#[test]
fn the_sixseven_fixture_is_a_version_4_save_with_nine_legacy_shafts() {
    let data = fixture_save("sixseven_2");
    assert_eq!(data["version"], 4);
    let list = data["transports"].as_array().unwrap();
    assert_eq!(list.len(), 15);
    let legacy = list
        .iter()
        .filter(|t| t["kind"] == "elevatorStandard" && t["width"] == 3)
        .count();
    assert_eq!(legacy, 9);
}

#[test]
fn every_sixseven_elevator_widens_in_place_with_no_overlap() {
    let data = fixture_save("sixseven_2");
    let out = migrate_save(&data);
    assert_eq!(out["version"], PLAIN_SAVE_VERSION);
    let after = out["transports"].as_array().unwrap();
    for t in after.iter().filter(|t| is_elevator(t)) {
        let canon = if t["kind"] == "elevatorExpress" { 6 } else { 4 };
        assert_eq!(foot(t).1, canon, "{t}");
    }
    for (a, b) in after.iter().zip(data["transports"].as_array().unwrap()) {
        assert_eq!(a["x"], b["x"], "every widen grew right");
    }
    assert_no_collision(after);
}

#[test]
fn the_sixseven_save_loads_widened_and_runs_an_hour() {
    let mut sim = deserialize(&fixture_save("sixseven_2")).expect("the fixture loads");
    let saved = sim.serialize();
    assert_eq!(saved["version"], PLAIN_SAVE_VERSION);
    let list = saved["transports"].as_array().unwrap();
    for (kind, w) in [("elevatorStandard", 4), ("elevatorExpress", 6)] {
        let of_kind: Vec<&Value> = list.iter().filter(|t| t["kind"] == kind).collect();
        assert!(!of_kind.is_empty(), "{kind}");
        assert!(of_kind.iter().all(|t| foot(t).1 == w), "{kind}");
    }
    for _ in 0..60 {
        sim.tick(1.0);
    }
}

#[test]
fn a_kept_legacy_shaft_stays_narrow_while_boxed_and_heals_once_freed() {
    let boxed = loaded_transports(&v5(vec![
        shaft(json!({ "kind": "elevatorService", "x": 96, "width": 4 })),
        shaft(json!({ "x": 100 })),
        shaft(json!({ "kind": "elevatorService", "x": 103, "width": 4 })),
    ]));
    assert_eq!(foot(&boxed[1]), (100, 3));
    let freed = loaded_transports(&v5(vec![shaft(json!({ "x": 100 }))]));
    assert_eq!(foot(&freed[0]), (100, 4));
}

#[test]
fn a_forged_over_wide_shaft_clamps_to_the_catalog_and_hides_nothing() {
    let out = loaded_transports(&v5(vec![
        shaft(json!({ "kind": "elevatorService", "x": 0, "width": 300 })),
        shaft(json!({ "kind": "elevatorService", "x": 100, "width": 4 })),
        shaft(json!({ "kind": "elevatorService", "x": 200, "width": 4 })),
        shaft(json!({ "kind": "stairs", "x": 250, "width": 8, "bottom": 1, "top": 2 })),
    ]));
    assert_eq!(out.len(), 4, "nothing dropped behind it");
    assert_eq!(foot(&out[0]), (0, 4));
    assert_eq!(foot(&out[1]), (100, 4));
    assert_eq!(foot(&out[3]), (250, 8));
}

#[test]
fn a_forged_transport_flood_is_capped_at_the_pools() {
    let flood = (0..500)
        .map(|i| {
            shaft(json!({
                "bottom": 1 + (i % 40) * 2, "top": 2 + (i % 40) * 2,
                "x": 4 * (i / 40), "width": 4,
            }))
        })
        .collect();
    let out = loaded_transports(&v5(flood));
    let pools: i64 = POOLED_CAPS.iter().map(|p| p.cap).sum();
    assert_eq!(pools, 24 + 64);
    assert!(out.len() as i64 <= pools, "{} kept", out.len());
}

#[test]
fn an_overlapping_forged_shaft_is_dropped_and_stacked_stairs_stay() {
    let out = loaded_transports(&v5(vec![
        shaft(json!({ "kind": "elevatorService", "x": 100, "width": 4 })),
        shaft(json!({ "kind": "elevatorService", "x": 102, "width": 4, "bottom": 5, "top": 15 })),
        shaft(json!({ "kind": "stairs", "x": 200, "width": 8, "bottom": 1, "top": 2 })),
        shaft(json!({ "kind": "stairs", "x": 200, "width": 8, "bottom": 2, "top": 3 })),
    ]));
    assert_eq!(out.len(), 3);
    assert_eq!(foot(&out[0]), (100, 4));
    assert_eq!(out.iter().filter(|t| t["kind"] == "stairs").count(), 2);
}

#[test]
fn a_kept_legacy_shaft_at_the_right_edge_loads_at_its_saved_x() {
    let out = loaded_transports(&v5(vec![
        shaft(json!({ "kind": "elevatorService", "x": LOT_WIDTH - 7, "width": 4 })),
        shaft(json!({ "x": LOT_WIDTH - 3 })),
    ]));
    assert_eq!(foot(&out[1]), (LOT_WIDTH - 3, 3));
    assert_eq!(foot(&out[0]), (LOT_WIDTH - 7, 4));
    // A forged over-wide shaft still cannot sit past the catalog-width bound.
    let forged = loaded_transports(&v5(vec![shaft(
        json!({ "x": LOT_WIDTH - 3, "width": 400 }),
    )]));
    assert!(foot(&forged[0]).0 <= LOT_WIDTH - 4);
}
