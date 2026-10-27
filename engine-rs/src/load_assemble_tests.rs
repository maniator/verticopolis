//! The parts of `deserialize` the streamed reader (#1225) shares:
//! `drop_overlapping_units` against the map of rows it replaced, and
//! `assemble`, which must read nothing from the save's `units`.
use std::collections::HashMap;

use serde_json::{json, Value};

use super::{
    assemble, deserialize, drop_overlapping_units, migrate_save, repair_entity_ids,
    unit_from_value, LOT,
};
use crate::canonical::digest;
use crate::facilities::{FACILITIES, MAX_FLOOR, MIN_FLOOR};
use crate::rng::Rng;
use crate::sim::Simulation;
use crate::snapshot::state_view;
use crate::tower::Unit;

/// `drop_overlapping_units` before #1225, copied line for line from `main` at
/// `4b1e440`: one row per claimed floor in a map, the kept pairs collected
/// into a new vector.
fn by_rows(units: Vec<(Unit, Option<i64>)>) -> Vec<(Unit, Option<i64>)> {
    let mut claimed_structure: HashMap<i64, Vec<u8>> = HashMap::new();
    let mut claimed_rooms: HashMap<i64, Vec<u8>> = HashMap::new();
    let mut out = Vec::new();
    for (u, id) in units {
        let layer = if u.kind.is_structural() {
            &mut claimed_structure
        } else {
            &mut claimed_rooms
        };
        let stories = u.kind.floors();
        let mut free = true;
        'scan: for f in u.floor..u.floor + stories {
            if let Some(row) = layer.get(&f) {
                for i in u.x..u.x + u.width {
                    if row[i as usize] != 0 {
                        free = false;
                        break 'scan;
                    }
                }
            }
        }
        if !free {
            continue;
        }
        for f in u.floor..u.floor + stories {
            let row = layer.entry(f).or_insert_with(|| vec![0u8; LOT as usize]);
            for i in u.x..u.x + u.width {
                row[i as usize] = 1;
            }
        }
        out.push((u, id));
    }
    out
}

/// Random units of every kind, packed into a few floors at the bottom, the
/// middle and the top of the lot so that many overlap, keep the same units
/// and ids through the tile grid as through the rows.
#[test]
fn the_tile_grid_keeps_what_the_rows_kept() {
    assert!(FACILITIES.iter().any(|f| f.kind.floors() > 1));
    let mut rng = Rng::new(1225);
    let (mut kept, mut dropped) = (0, 0);
    for round in 0..300 {
        let band = [MIN_FLOOR, (MIN_FLOOR + MAX_FLOOR) / 2, MAX_FLOOR - 3][round % 3];
        let entries: Vec<Value> = (0..rng.int(1, 200))
            .map(|_| {
                let kind = FACILITIES[rng.int(0, FACILITIES.len() as i64 - 1) as usize].key;
                let x = match rng.int(0, 3) {
                    0 => 0,
                    1 => LOT - 1,
                    _ => rng.int(0, LOT - 1),
                };
                json!({
                    "kind": kind,
                    "floor": band + rng.int(0, 3),
                    "x": x,
                    "width": rng.int(1, 60),
                    "id": rng.int(1, 80),
                })
            })
            .collect();
        let pairs: Vec<_> = entries
            .iter()
            .filter_map(|u| unit_from_value(u, round % 2 == 1))
            .collect();
        let want: Vec<String> = by_rows(pairs.clone())
            .iter()
            .map(|p| format!("{p:?}"))
            .collect();
        let (mut units, mut ids): (Vec<_>, Vec<_>) = pairs.into_iter().unzip();
        let listed = units.len();
        drop_overlapping_units(&mut units, &mut ids);
        let got: Vec<String> = units
            .into_iter()
            .zip(ids)
            .map(|p| format!("{p:?}"))
            .collect();
        assert_eq!(got, want, "round {round}");
        kept += got.len();
        dropped += listed - got.len();
    }
    assert!(
        kept > 1000 && dropped > 1000,
        "{kept} kept, {dropped} dropped"
    );
}

/// What a test can read off a loaded game.
fn fingerprint(sim: &Simulation) -> String {
    format!("{}\n{}", sim.serialize(), digest(&state_view(sim)))
}

/// `assemble` builds the same game whatever the save's `units` holds, since
/// the streamed reader passes a save without it; with the units read as
/// `deserialize` reads them, that game is `deserialize`'s.
#[test]
fn assemble_reads_nothing_from_units() {
    let table: Value =
        serde_json::from_str(include_str!("../../conformance/loader-cases.json")).unwrap();
    let mut seen = 0;
    for case in table["cases"].as_array().unwrap() {
        let raw = &case["input"];
        let Ok(loaded) = deserialize(raw) else {
            continue;
        };
        let data = migrate_save(raw);
        let modern = data.get("mode").and_then(Value::as_str) == Some("modern");
        let listed = data.get("units").and_then(Value::as_array);
        let (units, ids): (Vec<_>, Vec<_>) = listed
            .into_iter()
            .flatten()
            .filter_map(|u| unit_from_value(u, modern))
            .unzip();
        let want = fingerprint(&loaded);
        for units_key in [None, Some(json!([])), Some(json!("x"))] {
            let mut data = data.clone();
            let obj = data.as_object_mut().unwrap();
            match units_key {
                None => obj.remove("units"),
                Some(v) => obj.insert("units".into(), v),
            };
            // The streamed reader passes its migrated save as the save as
            // written too; the founder test reads only keys the migration
            // leaves alone.
            for written in [raw, &data] {
                let sim = assemble(&data, units.clone(), ids.clone(), written);
                assert_eq!(fingerprint(&sim), want, "{}", case["name"]);
            }
        }
        seen += usize::from(listed.is_some_and(|l| !l.is_empty()));
    }
    assert!(seen >= 10, "only {seen} cases with units");
}

/// Unit ids come before transport ids in one id space, as TypeScript's
/// `repairEntityIds([...units, ...transports])` takes them: a transport that
/// repeats a unit's id is the one renumbered, and the result is the same as
/// repairing one list of both, the shape the repair took before #1225.
#[test]
fn ids_are_repaired_units_first() {
    let mut units = vec![Some(5), None, Some(5), Some(2)];
    let mut transports = vec![Some(2), Some(9), None];
    let next = repair_entity_ids(&mut units, &mut transports, None);
    assert_eq!(units, [Some(5), Some(10), Some(11), Some(2)]);
    assert_eq!(transports, [Some(12), Some(9), Some(13)]);
    assert_eq!(next, 14);
    let mut both = vec![Some(5), None, Some(5), Some(2), Some(2), Some(9), None];
    assert_eq!(repair_entity_ids(&mut both, &mut [], None), next);
    assert_eq!(both, [units, transports].concat());
}
