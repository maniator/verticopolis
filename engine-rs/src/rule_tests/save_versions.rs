//! A save's round trip, its version ladder and the founder mark, from the
//! engine half of the retired `storage.integration.test.ts`. The founder rule
//! at the file boundary (an unstamped file is a founder's tower, a restore is
//! not) is `wasm_port_files_tests::a_stored_save_without_a_stamp_is_a_founders_and_a_restore_is_not`
//! and `vctower_import_tests::a_real_file_loads_and_an_unstamped_one_is_a_founders_tower`.
use super::save_hardening::sample_game;
use crate::clock::GameMode;
use crate::load::deserialize;
use crate::load::NEWER_SAVE_REFUSAL;
use crate::sim::{Simulation, PLAIN_SAVE_VERSION, SAVE_VERSION};
use serde_json::{json, Value};

/// The newest save version this build writes: 8, for a tower with a tall
/// lobby (#308); a tower without one is still written at 7.
const CURRENT_SAVE_VERSION: i64 = 9;

fn stamped(mut save: Value, app_version: &str) -> Value {
    save["appVersion"] = json!(app_version);
    save
}

fn founder(save: &Value) -> bool {
    deserialize(save).expect("loads").founder
}

#[test]
fn a_played_save_round_trips_without_drift() {
    let sim = sample_game();
    // The per-car arrays are where drift hides, so they must be populated.
    assert!(!sim.tower.transports[0].car_positions.is_empty());
    let first = sim.serialize();
    let second = deserialize(&first).expect("loads").serialize();
    assert_eq!(second, first);
}

#[test]
fn an_old_version_migrates_and_a_newer_one_is_refused_whole() {
    assert_eq!(SAVE_VERSION, CURRENT_SAVE_VERSION);
    assert_eq!(PLAIN_SAVE_VERSION, 7);
    let sim = sample_game();
    let mut save = sim.serialize();
    save["version"] = json!(2);
    let loaded = deserialize(&save).expect("an old save migrates");
    assert_eq!(loaded.money, sim.money);
    assert_eq!(loaded.tower.units.len(), sim.tower.units.len());
    assert_eq!(loaded.serialize()["version"], json!(PLAIN_SAVE_VERSION));
    // A newer build's save could carry fields this loader would drop and the
    // next save would write the loss back, so it is refused (#1603).
    save["version"] = json!(SAVE_VERSION + 1);
    assert_eq!(
        deserialize(&save).err().as_deref(),
        Some(NEWER_SAVE_REFUSAL)
    );
}

#[test]
fn a_unit_of_an_unknown_kind_drops() {
    let sim = sample_game();
    let mut save = sim.serialize();
    let mut bogus = save["units"][0].clone();
    bogus["id"] = json!(99_999);
    bogus["kind"] = json!("spaceport");
    save["units"].as_array_mut().unwrap().push(bogus);
    assert_eq!(
        deserialize(&save).unwrap().tower.units.len(),
        sim.tower.units.len()
    );
}

#[test]
fn a_tower_first_saved_before_2_0_is_a_founders_and_keeps_it() {
    let sim = sample_game();
    assert!(!sim.founder);
    assert!(founder(&stamped(sim.serialize(), "1.99.0")));
    for later in ["2.0.0", "2.4.1"] {
        assert!(!founder(&stamped(sim.serialize(), later)), "{later}");
    }
    // Once marked, the flag carries the status past a 2.0+ restamp.
    let founding = deserialize(&stamped(sim.serialize(), "1.98.0")).unwrap();
    let resaved = founding.serialize();
    assert_eq!(resaved["founder"], json!(true));
    assert!(founder(&stamped(resaved, "2.1.0")));
}

#[test]
fn only_a_founders_tower_writes_the_mark_and_a_load_alone_never_grants_it() {
    let sim = sample_game();
    assert!(sim.serialize().get("founder").is_none(), "no phantom key");
    // An unstamped snapshot (undo, crash report) is not a founder's file.
    let mut save = sim.serialize();
    save.as_object_mut().unwrap().remove("appVersion");
    assert!(!founder(&save));
    for (seed, mode) in [(1, GameMode::Classic), (2, GameMode::Modern)] {
        assert!(
            !Simulation::new_game(seed, mode).founder,
            "a new game is never a founder's"
        );
    }
}
