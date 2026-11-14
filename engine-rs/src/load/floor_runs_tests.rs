//! The loader unfolds a run only in a save that writes runs, only on a
//! floor tile, and only for a whole run from 2 to the lot's width.
use super::*;
use crate::load::deserialize;
use crate::load_stream::load_save_text;
use crate::sim::Simulation;

fn count(entry: Value, runs: bool) -> (usize, Vec<(i64, i64)>) {
    let mut seen = Vec::new();
    let n = listed_units(&entry, runs);
    each_listed_unit(&entry, runs, |u| {
        seen.push((
            u["id"].as_i64().unwrap_or(-1),
            u["x"].as_i64().unwrap_or(-1),
        ));
        assert!(
            n == 1 || u.get("run").is_none(),
            "an unfolded tile carries no run"
        );
        true
    });
    (n, seen)
}

#[test]
fn a_run_unfolds_into_its_tiles_in_order() {
    let (n, seen) = count(
        json!({"id": 10, "kind": "floor", "floor": 2, "x": 100, "run": 3}),
        true,
    );
    assert_eq!(n, 3);
    assert_eq!(seen, vec![(10, 100), (11, 101), (12, 102)]);
}

#[test]
fn a_save_before_version_11_reads_a_run_key_as_one_tile() {
    let (n, seen) = count(
        json!({"id": 10, "kind": "floor", "floor": 2, "x": 100, "run": 3}),
        false,
    );
    assert_eq!(n, 1);
    assert_eq!(seen.len(), 1);
    assert!(!reads_floor_runs(Some(10.0)));
    assert!(reads_floor_runs(Some(11.0)));
    assert!(!reads_floor_runs(None));
}

#[test]
fn a_forged_run_stands_for_its_entry_alone() {
    for run in [
        json!(0),
        json!(1),
        json!(-4),
        json!(2.5),
        json!("9"),
        json!(LOT + 1),
        json!(1e300),
    ] {
        let (n, seen) = count(
            json!({"id": 10, "kind": "floor", "floor": 2, "x": 100, "run": run}),
            true,
        );
        assert_eq!((n, seen.len()), (1, 1), "run {run}");
    }
    // Only a floor tile folds; a run on anything else is ignored.
    let (n, _) = count(
        json!({"id": 10, "kind": "lobby", "floor": 1, "x": 100, "run": 5}),
        true,
    );
    assert_eq!(n, 1);
    // A run needs a whole id and x to step.
    let (n, _) = count(
        json!({"kind": "floor", "floor": 2, "x": 100, "run": 5}),
        true,
    );
    assert_eq!(n, 1);
    let (n, _) = count(
        json!({"id": 3, "kind": "floor", "floor": 2, "x": 1.5, "run": 5}),
        true,
    );
    assert_eq!(n, 1);
    // The widest run is the lot.
    let (n, _) = count(
        json!({"id": 1, "kind": "floor", "floor": 2, "x": 0, "run": LOT}),
        true,
    );
    assert_eq!(n, LOT as usize);
}

/// A save of `version` listing one floor run of `run` tiles at x 0 on floor 2.
fn run_save(version: i64, run: i64) -> Value {
    let mut save = Simulation::new_game(3, crate::clock::GameMode::Classic).serialize();
    save["version"] = json!(version);
    save["units"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id": 100_000, "kind": "floor", "floor": 2, "x": 0, "run": run}));
    save
}

#[test]
fn both_loaders_agree_on_a_run_and_on_an_older_save_with_a_run_key() {
    for (version, tiles) in [(11, 50), (10, 1)] {
        let save = run_save(version, 50);
        let tree = deserialize(&save).unwrap();
        let streamed = load_save_text(save.to_string().as_bytes()).unwrap();
        let on_two = |s: &Simulation| {
            s.tower
                .units
                .iter()
                .filter(|u| u.kind == Kind::Floor && u.floor == 2 && u.id >= 100_000)
                .count()
        };
        assert_eq!(on_two(&tree), tiles, "version {version}: the tree loader");
        assert_eq!(
            on_two(&streamed),
            tiles,
            "version {version}: the streamed loader"
        );
        assert_eq!(tree.tower.units, streamed.tower.units, "version {version}");
    }
}

#[test]
fn runs_count_toward_the_unit_cap() {
    let mut save = Simulation::new_game(3, crate::clock::GameMode::Classic).serialize();
    save["version"] = json!(11);
    let units = save["units"].as_array_mut().unwrap();
    let rows = UNIT_CAP / LOT as usize + 1;
    for k in 0..rows {
        units.push(
            json!({"id": 1_000_000 + k * 1000, "kind": "floor", "floor": 2, "x": 0, "run": LOT}),
        );
    }
    let err = deserialize(&save).err().expect("past the cap");
    assert!(err.contains("more than"), "{err}");
    assert_eq!(
        load_save_text(save.to_string().as_bytes()).err(),
        Some(err),
        "the streamed loader refuses in the same words"
    );
}

#[test]
fn the_tdt_export_reads_the_unfolded_list() {
    let save = run_save(11, 40);
    let unfolded: Vec<Cow<'_, Value>> = unfolded_units(&save).unwrap().collect();
    let listed = save["units"].as_array().unwrap().len();
    assert_eq!(unfolded.len(), listed - 1 + 40);
    let tiles: Vec<(i64, i64)> = unfolded
        .iter()
        .filter(|u| u["id"].as_i64() >= Some(100_000))
        .map(|u| (u["id"].as_i64().unwrap(), u["x"].as_i64().unwrap()))
        .collect();
    assert_eq!(tiles, (0..40).map(|k| (100_000 + k, k)).collect::<Vec<_>>());
    assert!(unfolded.iter().all(|u| u.get("run").is_none()));
    // A save from before version 11 lends every entry as it is.
    let old = run_save(10, 40);
    assert!(unfolded_units(&old)
        .unwrap()
        .all(|u| matches!(u, Cow::Borrowed(_))));
}
