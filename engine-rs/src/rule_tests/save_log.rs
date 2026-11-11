//! The bulletin log in a save, from the engine half of the retired
//! `saveMetadataLog.integration.test.ts` (its storage half, the write-time
//! stamps and the real slot and file paths, stays there on the Rust engine).
//! The log's tail rides the save, capped at the ring's own size so an undo
//! never trims scrollback; a load hardens whatever a file says the log is.
use crate::clock::GameMode;
use crate::load::{decode_vctower, deserialize};
use crate::sim::{LogKind, Simulation, LOG_RING_CAP, LOG_SAVE_CAP};
use serde_json::{json, Value};

/// The longest line a load keeps, in UTF-16 units as the game counts them.
const LOG_TEXT_CAP: usize = 400;

/// A new game with its bulletin emptied (a new game posts a welcome line).
fn fresh() -> Simulation {
    let mut sim = Simulation::new_game(1, GameMode::Classic);
    sim.log.clear();
    sim
}

fn texts(sim: &Simulation) -> Vec<String> {
    sim.log.iter().map(|e| e.text.clone()).collect()
}

/// A fresh game's save with `log` in place of its own.
fn with_log(log: Value) -> Simulation {
    let mut save = fresh().serialize();
    save["log"] = log;
    deserialize(&save).expect("loads")
}

#[test]
fn the_tail_rides_the_save_capped_at_the_ring_and_an_empty_log_writes_no_key() {
    assert_eq!(LOG_SAVE_CAP, LOG_RING_CAP, "an undo never trims scrollback");
    let mut sim = fresh();
    assert!(sim.serialize().get("log").is_none());
    let overflow = 40;
    for i in 0..LOG_SAVE_CAP + overflow {
        let kind = if i % 2 == 1 {
            LogKind::Good
        } else {
            LogKind::Info
        };
        sim.emit(&format!("line {i}"), kind);
    }
    assert_eq!(sim.log.len(), LOG_SAVE_CAP, "the ring keeps the cap");
    let save = sim.serialize();
    let log = save["log"].as_array().expect("a log");
    assert_eq!(log.len(), LOG_SAVE_CAP);
    assert_eq!(log[0]["text"], format!("line {overflow}"));
    assert_eq!(
        log[LOG_SAVE_CAP - 1]["text"],
        format!("line {}", LOG_SAVE_CAP + overflow - 1)
    );
    // Everything the ring held survives the round trip.
    assert_eq!(texts(&deserialize(&save).unwrap()), texts(&sim));
}

#[test]
fn a_reload_restores_the_bulletin_and_never_replays_it() {
    let mut sim = fresh();
    sim.emit("VIP arriving Thursday.", LogKind::Info);
    sim.emit("Office leased.", LogKind::Good);
    let loaded = deserialize(&sim.serialize()).unwrap();
    assert_eq!(texts(&loaded), ["VIP arriving Thursday.", "Office leased."]);
    let kinds: Vec<LogKind> = loaded.log.iter().map(|e| e.kind).collect();
    assert_eq!(kinds, [LogKind::Info, LogKind::Good]);
    assert_eq!(loaded.log_seq, 0, "restored lines never toast");
}

#[test]
fn junk_padding_cannot_evict_the_real_entries() {
    let mut log = vec![
        json!({ "minute": 1, "text": "real one", "kind": "info" }),
        json!({ "minute": 2, "text": "real two", "kind": "good" }),
    ];
    log.extend(std::iter::repeat_n(Value::Null, 400));
    assert_eq!(
        texts(&with_log(Value::Array(log))),
        ["real one", "real two"]
    );
}

#[test]
fn truncation_never_tears_an_astral_character_in_half() {
    // 399 ASCII characters, then emoji whose surrogate pair straddles the cap.
    let text = format!("{}{}", "x".repeat(LOG_TEXT_CAP - 1), "\u{1F3D7}\u{1F3D7}");
    let sim = with_log(json!([{ "minute": 0, "text": text, "kind": "info" }]));
    assert_eq!(sim.log[0].text, "x".repeat(LOG_TEXT_CAP - 1));
}

#[test]
fn a_hostile_log_is_hardened_on_load() {
    assert!(with_log(json!("not an array")).log.is_empty());
    assert!(with_log(json!(42)).log.is_empty());
    assert!(with_log(json!([null, 7, "line", [], { "minute": 3 }]))
        .log
        .is_empty());
    let one = with_log(json!([
        { "minute": "soon", "text": "x".repeat(10_000), "kind": "explosive" },
        { "minute": 12, "text": 99, "kind": "good" },
    ]));
    assert_eq!(one.log.len(), 1, "a line with no string text drops");
    assert_eq!(one.log[0].minute, 0.0);
    assert_eq!(one.log[0].text.len(), LOG_TEXT_CAP);
    assert_eq!(one.log[0].kind, LogKind::Info);
    let flood: Vec<Value> = (0..100_000)
        .map(|i| json!({ "minute": i, "text": format!("l{i}"), "kind": "info" }))
        .collect();
    let flood = with_log(Value::Array(flood));
    assert_eq!(
        flood.log.len(),
        LOG_RING_CAP,
        "the newest lines, at the ring cap"
    );
    assert_eq!(flood.log[LOG_RING_CAP - 1].text, "l99999");
}

#[test]
fn the_pre_log_fixture_loads_with_only_the_classic_pricing_snap_bulletin() {
    let text = include_str!("../../../conformance/fixtures/towerone_6.vctower");
    let data = decode_vctower(text).expect("decodes");
    assert!(data.get("log").is_none());
    // The fixture's Classic rents snap onto the 1994 rate levels once.
    let first = deserialize(&data).expect("loads");
    assert_eq!(
        texts(&first),
        ["Classic pricing: rents snapped to the four 1994 rate levels. Condos can now sell for as little as $50,000."]
    );
    assert_eq!(first.log[0].kind, LogKind::Info, "bulletin only");
    let again = deserialize(&first.serialize()).expect("reloads");
    assert_eq!(texts(&again), texts(&first), "a second load adds nothing");
}
