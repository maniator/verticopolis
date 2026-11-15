//! The writer folds plain floor tiles that follow each other into runs, and
//! only those; unfolding the runs gives back the list a version 10 writer
//! wrote, in its order.
use super::*;
use crate::clock::GameMode;
use crate::load::{deserialize, each_listed_unit};
use crate::load_stream::load_save_text;
use crate::sim::Simulation;
use serde_json::{json, Value};

/// A new game with a lobby from x 90 to 210 and floor tiles laid on
/// `floor` (2 or 3) from `from` up to `to`.
fn with_floor(floor: i64, from: i64, to: i64) -> Simulation {
    let mut sim = Simulation::new_game(7, GameMode::Classic);
    for x in 90..210 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok, "lobby x {x}");
    }
    if floor == 3 {
        for x in 90..210 {
            assert!(sim.tower.place(Kind::Floor, 2, x).ok, "floor 2 x {x}");
        }
    }
    for x in from..to {
        assert!(
            sim.tower.place(Kind::Floor, floor, x).ok,
            "floor {floor} x {x}"
        );
    }
    sim
}

/// The save's `units` with every run unfolded.
fn unfolded(save: &Value) -> Vec<Value> {
    let mut out = Vec::new();
    for e in save["units"].as_array().unwrap() {
        each_listed_unit(e, true, |u| {
            out.push(u.clone());
            true
        });
    }
    out
}

/// What a version 10 writer listed: every unit's own entry, in list order.
fn plain(sim: &Simulation) -> Vec<Value> {
    sim.tower.units.iter().map(Unit::serialize).collect()
}

#[test]
fn a_row_of_floor_tiles_is_one_entry_with_its_run() {
    let sim = with_floor(2, 100, 160);
    let save = sim.serialize();
    let runs: Vec<&Value> = save["units"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|u| u.get(FLOOR_RUN_KEY).is_some())
        .collect();
    assert_eq!(runs.len(), 1, "one run");
    assert_eq!(runs[0][FLOOR_RUN_KEY], json!(60));
    assert_eq!(runs[0]["x"], json!(100));
    assert_eq!(runs[0]["floor"], json!(2));
    assert_eq!(save["version"], json!(FLOOR_RUN_SAVE_VERSION));
}

#[test]
fn unfolding_the_runs_gives_back_the_plain_list_in_order() {
    let mut sim = with_floor(2, 90, 210);
    // A gap, a second floor, and a tile laid back into the gap later, so
    // its id is out of step with its neighbors.
    for x in 100..140 {
        assert!(sim.tower.place(Kind::Floor, 3, x).ok);
    }
    for x in 150..170 {
        assert!(sim.tower.place(Kind::Floor, 3, x).ok);
    }
    assert!(sim.tower.place(Kind::Floor, 3, 145).ok);
    let save = sim.serialize();
    assert!(save["units"].as_array().unwrap().len() < sim.tower.units.len());
    assert_eq!(unfolded(&save), plain(&sim));
    assert_eq!(sim.save_text(), save.to_string(), "the text and the tree");
}

#[test]
fn a_tile_out_of_id_order_keeps_its_place_in_the_list() {
    let mut sim = with_floor(2, 100, 120);
    // Move a middle tile to the end of the list, as an undo can leave it.
    let moved = sim.tower.units.remove(sim.tower.units.len() - 10);
    sim.tower.units.push(moved);
    let save = sim.serialize();
    assert_eq!(unfolded(&save), plain(&sim));
    let back = deserialize(&save).unwrap();
    let ids = |s: &Simulation| {
        s.tower
            .units
            .iter()
            .map(|u| (u.id, u.x))
            .collect::<Vec<_>>()
    };
    assert_eq!(ids(&back), ids(&sim));
}

#[test]
fn a_floor_tile_with_a_fact_of_its_own_keeps_its_own_entry() {
    let mut sim = with_floor(2, 100, 110);
    let i = sim
        .tower
        .units
        .iter()
        .position(|u| u.kind == Kind::Floor && u.x == 105)
        .unwrap();
    sim.tower.units[i].label = "Mezzanine".into();
    let save = sim.serialize();
    let entries = save["units"].as_array().unwrap();
    assert!(entries
        .iter()
        .any(|u| u["x"] == json!(105) && u["label"] == json!("Mezzanine")));
    assert!(entries.iter().all(|u| u
        .get(FLOOR_RUN_KEY)
        .is_none_or(|r| r.as_i64() == Some(5) || r.as_i64() == Some(4))));
    assert_eq!(unfolded(&save), plain(&sim));
}

#[test]
fn rooms_and_lobbies_are_never_folded() {
    let sim = Simulation::new_game(7, GameMode::Classic);
    let save = sim.serialize();
    for u in save["units"].as_array().unwrap() {
        if u.get(FLOOR_RUN_KEY).is_some() {
            assert_eq!(u["kind"], json!("floor"));
        }
    }
    assert_eq!(unfolded(&save), plain(&sim));
}

#[test]
fn both_loaders_read_a_run_save_as_the_tower_that_wrote_it() {
    let mut sim = with_floor(2, 100, 200);
    for x in 120..180 {
        assert!(sim.tower.place(Kind::Floor, 3, x).ok);
    }
    let text = sim.save_text();
    let tree = deserialize(&sim.serialize()).unwrap();
    let streamed = load_save_text(text.as_bytes()).unwrap();
    assert_eq!(tree.tower.units, sim.tower.units, "the tree loader");
    assert_eq!(streamed.tower.units, sim.tower.units, "the streamed loader");
    assert_eq!(streamed.save_text(), text, "a reload writes the same save");
}

#[test]
fn the_stamp_is_the_run_version_whenever_a_run_is_written() {
    let none = Simulation::new_game(7, GameMode::Classic);
    let lone = with_floor(2, 100, 101);
    let row = with_floor(2, 100, 102);
    for sim in [&none, &lone, &row] {
        let save = sim.serialize();
        let folded = save["units"]
            .as_array()
            .unwrap()
            .iter()
            .any(|u| u.get(FLOOR_RUN_KEY).is_some());
        if folded {
            assert_eq!(save["version"], json!(FLOOR_RUN_SAVE_VERSION));
        }
        assert_eq!(
            lists_a_floor_run(&sim.tower.units),
            save["version"] == json!(FLOOR_RUN_SAVE_VERSION)
        );
    }
    assert!(!lists_a_floor_run(&lone.tower.units));
    assert!(lists_a_floor_run(&row.tower.units));
}

#[test]
fn a_run_stops_at_the_lot_width_the_loader_reads() {
    let sim = with_floor(2, 100, 101);
    let tile = sim
        .tower
        .units
        .iter()
        .find(|u| u.kind == Kind::Floor)
        .unwrap()
        .clone();
    // Tiles past the lot's edge never come out of a load, but the writer
    // still splits a row longer than a run can hold.
    let row: Vec<Unit> = (0..LOT_WIDTH + 25)
        .map(|k| Unit {
            id: tile.id + k,
            x: k,
            ..tile.clone()
        })
        .collect();
    let entries: Vec<Value> = SavedUnits::new(&row).map(|e| e.to_value()).collect();
    let runs: Vec<(i64, i64)> = entries
        .iter()
        .map(|e| (e["x"].as_i64().unwrap(), e[FLOOR_RUN_KEY].as_i64().unwrap()))
        .collect();
    assert_eq!(runs, vec![(0, LOT_WIDTH), (LOT_WIDTH, 25)]);
}

#[test]
fn the_stamp_follows_the_tower_as_it_changes() {
    let mut sim = with_floor(2, 100, 101);
    // The answer is kept per revision, so read it before each edit.
    assert!(!sim.tower.lists_a_floor_run());
    assert_ne!(sim.serialize()["version"], json!(FLOOR_RUN_SAVE_VERSION));
    assert!(sim.tower.place(Kind::Floor, 2, 101).ok);
    assert!(sim.tower.lists_a_floor_run());
    assert_eq!(sim.serialize()["version"], json!(FLOOR_RUN_SAVE_VERSION));
    let last = sim.tower.units.last().unwrap().id;
    assert!(sim.tower.remove_unit(last).is_some());
    assert!(!sim.tower.lists_a_floor_run());
    assert_ne!(sim.serialize()["version"], json!(FLOOR_RUN_SAVE_VERSION));
}

#[test]
fn a_sync_delta_keeps_the_towers_answer() {
    let mut sim = with_floor(2, 100, 140);
    let mut mirror = crate::save_delta::SaveMirror::default();
    let full: Value = serde_json::from_str(&mirror.full(&sim)).unwrap();
    assert_eq!(full["version"], json!(FLOOR_RUN_SAVE_VERSION));
    let key = sim.tower.index_key();
    let delta: Value = serde_json::from_str(&mirror.delta(&mut sim).unwrap()).unwrap();
    assert_eq!(delta["rest"]["version"], json!(FLOOR_RUN_SAVE_VERSION));
    // Writing the rest with the units lent out left the memo on the tower.
    assert_eq!(sim.tower.memo.borrow().floor_run, Some((key, true)));
}
