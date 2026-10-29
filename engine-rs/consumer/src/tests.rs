use super::*;
use std::path::PathBuf;
use verticopolis_engine::scenario::Start;

/// `VC_CONFORMANCE`, or the suite beside this crate in the repository.
/// CI sets it when it runs a copy of this crate from outside the
/// checkout, the way a host in its own repository would.
fn conformance_dir() -> PathBuf {
    std::env::var_os("VC_CONFORMANCE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../conformance"))
}

#[test]
fn the_smoke_run_passes() {
    let r = smoke(SEED).expect("smoke run");
    assert_eq!(r.spent, r.quoted);
    assert!(r.spent > 0.0);
    assert!(r.save_bytes > 0);
    assert!(
        r.population > 0,
        "offices with an elevator fill up in two days"
    );
}

#[test]
fn the_same_seed_and_commands_give_the_same_game() {
    let a = smoke(SEED).expect("first run");
    let b = smoke(SEED).expect("second run");
    assert_eq!(a, b);
}

#[test]
fn the_frame_reads_back_with_people_in_the_tower() {
    let events = event_catalog().unwrap();
    let (mut sim, _, _) = found(7).unwrap();
    edit(&mut sim).unwrap();
    // A new game opens at 7:00; eight hours a frame at a time takes it
    // through the working morning, when the offices fill.
    let mut most = 0;
    for _ in 0..480 {
        advance(&mut sim, 1, &events).unwrap();
        most = most.max(read_frame(&sim).unwrap());
    }
    assert!(most > 0, "no one in the tower all morning");
}

#[test]
fn a_refused_placement_charges_nothing() {
    let (mut sim, _, _) = found(SEED).expect("found");
    let before = sim.money;
    let quote = sim.can_build(Kind::Office, 2, 106);
    assert!(!quote.ok, "the tile is taken");
    let r = sim.build(Kind::Office, 2, 106);
    assert!(!r.ok);
    assert_eq!(r.reason, quote.reason);
    assert_eq!(sim.money, before);
}

#[test]
fn an_unstamped_file_loads_as_a_founders_tower() {
    let (sim, _, _) = found(SEED).expect("found");
    let bytes = encode_vctower(&sim.serialize()).expect("encode");
    let text = std::str::from_utf8(&bytes).expect("utf-8");
    assert!(load_file(text).expect("load").founder);
    let (loaded, _) = round_trip(&sim).expect("round trip");
    assert!(!loaded.founder, "a stamped save keeps its status");
}

#[test]
fn a_damaged_file_is_refused_not_panicked_on() {
    assert!(decode_vctower("VCTOWER1\nnot base64 of a deflated save\n").is_err());
    assert!(decode_vctower("").is_err());
    // A file that decodes but holds damaged fields is not refused: the
    // loader coerces them the way the web game's loader does.
    assert!(deserialize(&serde_json::json!({ "units": "no" })).is_ok());
}

#[test]
fn a_modern_game_starts_with_the_host_settings() {
    use verticopolis_engine::clock::CalendarKind;
    let mut sim = Simulation::new_game_with(SEED, GameMode::Modern, CalendarKind::Canon, true);
    assert!(!sim.auto_bridge, "founded unbridged");
    assert!(
        sim.toggle_auto_bridge(),
        "Modern lets the player switch it back on"
    );
    let cat = catalog(GameMode::Modern);
    assert_eq!(sim.money, cat.economy.starting_money);
    assert!(cat.economy.auto_bridge_toggleable);
}

#[test]
fn a_new_game_scenario_matches_the_lock() {
    let n = replay(&conformance_dir(), "starter-classic").expect("starter-classic");
    assert!(n > 1);
}

#[test]
fn every_scenario_is_found_both_kinds_included() {
    let dir = conformance_dir();
    let ids = scenarios(&dir).expect("scenario dir");
    let files = std::fs::read_dir(dir.join("scenarios"))
        .expect("scenario dir")
        .filter(|e| {
            e.as_ref()
                .is_ok_and(|e| e.path().extension().is_some_and(|x| x == "json"))
        })
        .count();
    assert_eq!(ids.len(), files, "{ids:?}");
    let start = |id: &str| {
        let text = std::fs::read_to_string(dir.join("scenarios").join(format!("{id}.json")))
            .expect("scenario");
        Scenario::parse(&text).expect("parses").start
    };
    assert!(ids
        .iter()
        .any(|id| matches!(start(id), Start::NewGame { .. })));
    assert!(ids
        .iter()
        .any(|id| matches!(start(id), Start::Fixture { .. })));
}

#[test]
fn a_fixture_scenario_matches_the_lock() {
    let n = replay(&conformance_dir(), "star-climb-classic").expect("star-climb-classic");
    assert!(n > 1);
}

#[test]
fn a_lock_entry_without_its_scenario_or_checkpoints_is_an_error() {
    let dir = std::env::temp_dir().join(format!("vc-consumer-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("temp dir");
    let checkpoint =
        serde_json::json!({ "label": "start", "state": "0", "crowd": "0", "events": "0" });
    let lock = serde_json::json!({ "scenarios": { "gone": [checkpoint], "empty": [] } });
    std::fs::write(dir.join("expected.json"), lock.to_string()).expect("lock");
    let gone = replay(&dir, "gone");
    let empty = replay(&dir, "empty");
    let _ = std::fs::remove_dir_all(&dir);
    assert!(
        gone.unwrap_err().contains("cannot read"),
        "the scenario file is read"
    );
    assert!(empty.unwrap_err().contains("no checkpoint"));
}
