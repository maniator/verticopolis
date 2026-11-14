//! A save that folds its floor rows into runs (version 11) is the same game
//! as the plain save that lists every tile on its own (what a version 10
//! writer wrote). Each player tower below is written both ways as a real
//! `.vctower` file, each file is loaded through both loaders, and all four
//! games must hold the same state and crowd, save back to the same files,
//! and stay in lockstep hour after hour as they play.
use super::fixture_save;
use crate::canonical::digest;
use crate::load::{decode_vctower, deserialize, encode_vctower, stamp_save};
use crate::load_stream::load_vctower_text;
use crate::save_floor_runs::lists_a_floor_run;
use crate::sim::Simulation;
use crate::snapshot::state_view;
use serde_json::Value;

/// The state and crowd hashes the conformance lock records.
fn hashes(sim: &Simulation) -> (String, String) {
    (digest(&state_view(sim)), digest(&sim.crowd.view()))
}

/// `save` stamped and written as `.vctower` file text.
fn file(mut save: Value) -> String {
    stamp_save(&mut save, "lockstep", 1_763_140_000_000.0).expect("stamps");
    String::from_utf8(encode_vctower(&save).expect("encodes")).expect("text")
}

/// Plays the four games `hours` hours and answers how many hourly checks
/// found all four in the same state.
fn the_same_game(fixture: &str, hours: usize) -> usize {
    let sim = deserialize(&fixture_save(fixture)).expect("the fixture loads");
    assert!(
        lists_a_floor_run(&sim.tower.units),
        "{fixture} has floor rows"
    );
    let (plain, folded) = (sim.serialize_unfolded(), sim.serialize());
    let listed = |s: &Value| s["units"].as_array().map_or(0, Vec::len);
    assert!(
        listed(&folded) * 2 < listed(&plain),
        "{fixture}: runs fold most of its {} entries",
        listed(&plain)
    );
    let (plain_file, folded_file) = (file(plain), file(folded));
    let load_tree = |f: &str| deserialize(&decode_vctower(f).expect("decodes")).expect("loads");
    let load_streamed = |f: &str| load_vctower_text(f, None).expect("loads");
    let mut games = [
        load_tree(&plain_file),
        load_tree(&folded_file),
        load_streamed(&plain_file),
        load_streamed(&folded_file),
    ];
    // Loaded, every game saves back to the same two files.
    for (i, g) in games.iter().enumerate() {
        assert_eq!(
            file(g.serialize_unfolded()),
            plain_file,
            "{fixture}: game {i}"
        );
        assert_eq!(file(g.serialize()), folded_file, "{fixture}: game {i}");
    }
    let start = hashes(&games[0]);
    assert_eq!(
        start.0,
        digest(&state_view(&sim)),
        "{fixture}: the tower it was written from"
    );
    let mut matched = 0;
    for hour in 0..=hours {
        let expected = hashes(&games[0]);
        for (i, g) in games.iter().enumerate().skip(1) {
            assert_eq!(
                hashes(g),
                expected,
                "{fixture}: game {i} after {hour} hours"
            );
        }
        matched += 1;
        for g in games.iter_mut() {
            for _ in 0..4 {
                g.tick(15.0);
            }
        }
    }
    assert_ne!(hashes(&games[0]).0, start.0, "{fixture}: the games played");
    matched
}

#[test]
fn a_modern_tower_with_floor_runs_plays_the_same_game() {
    assert_eq!(the_same_game("split-tower", 24), 25);
}

#[test]
fn a_classic_tower_with_floor_runs_plays_the_same_game() {
    assert_eq!(the_same_game("sixseven_2", 12), 13);
}
