//! `load_vctower_text` (#1225) against today's import path, `decode_vctower`,
//! `override_mode`, `deserialize` and `mark_founder_from_loaded_file`: the
//! same game or the same message, with and without a mode set.
use base64::Engine as _;
use serde_json::{json, Value};

use super::edits::relabeled;
use super::tests::{built, fingerprint, patched};
use super::*;
use crate::load::{decode_vctower, encode_vctower, TOWER_FILE_MAGIC};

/// Today's import path on the same file.
fn today(text: &str, mode: Option<&str>) -> Result<Simulation, String> {
    let mut raw = decode_vctower(text)?;
    if let Some(m) = mode {
        override_mode(&mut raw, m)?;
    }
    let mut sim = deserialize(&raw)?;
    mark_founder_from_loaded_file(&mut sim, &raw);
    Ok(sim)
}

/// Checks `load_vctower_text` against today's path on one file, an hour of
/// play included, and returns whether the streamed reader took it.
fn same(text: &str, mode: Option<&str>) -> bool {
    check(text, mode, 30).is_some()
}

/// `same` with `steps` two-minute steps of play, returning the streamed game.
fn check(text: &str, mode: Option<&str>, steps: usize) -> Option<Simulation> {
    match (read_vctower(text, mode), today(text, mode)) {
        (Ok((mut fast, took)), Ok(mut slow)) => {
            assert_eq!(fingerprint(&fast), fingerprint(&slow), "{mode:?}");
            for _ in 0..steps {
                fast.tick(2.0);
                slow.tick(2.0);
            }
            assert_eq!(
                fingerprint(&fast),
                fingerprint(&slow),
                "{mode:?}: after play"
            );
            took.then_some(fast)
        }
        // One side failed: both must, with one message, and the binding's
        // entry gives that message too.
        (fast, slow) => {
            let message = slow.err();
            assert_eq!(fast.err(), message, "{mode:?}");
            assert_eq!(load_vctower_text(text, mode).err(), message, "{mode:?}");
            None
        }
    }
}

/// A save as a `.vctower` file.
fn file(save: &Value) -> String {
    String::from_utf8(encode_vctower(save).unwrap()).unwrap()
}

/// Save text as a `.vctower` file, byte for byte.
fn pack(json: &[u8]) -> String {
    let packed = crate::fflate::deflate_level1(json);
    let b64 = base64::engine::general_purpose::STANDARD.encode(packed);
    format!("{TOWER_FILE_MAGIC}\n{b64}\n")
}

/// Engine saves stream in both modes, with no mode set or either one set,
/// and an unknown mode gives today's message.
#[test]
fn engine_saves_stream_with_any_mode() {
    for save in [built(GameMode::Classic), built(GameMode::Modern)] {
        let text = file(&save);
        for mode in [None, Some("classic"), Some("modern")] {
            assert!(same(&text, mode), "{mode:?} did not stream");
        }
        assert!(!same(&text, Some("arcade")));
        assert!(!same(&text, Some("Classic")));
        // A narrow shaft from before version 7, which the version step widens
        // before the founder mark reads the migrated save.
        let narrow = patched(&save, |m| {
            m["transports"][0]["width"] = json!(2);
            m["transports"][0]["x"] = json!(140);
        });
        let narrow = file(&serde_json::from_str(&narrow).unwrap());
        for mode in [None, Some("modern")] {
            assert!(
                same(&narrow, mode),
                "{mode:?}: a narrow shaft did not stream"
            );
        }
    }
}

/// A set mode stands in for the save's own, which may then be missing or
/// unknown; the version still decides.
#[test]
fn a_set_mode_replaces_the_saves() {
    let save = built(GameMode::Classic);
    for own in [json!("tower"), json!(null), json!(1)] {
        let text =
            file(&serde_json::from_str(&patched(&save, |m| m["mode"] = own.clone())).unwrap());
        assert!(!same(&text, None));
        assert!(same(&text, Some("modern")));
    }
    let unmoded: Value = serde_json::from_str(&patched(&save, |m| {
        m.remove("mode");
    }))
    .unwrap();
    assert!(same(&file(&unmoded), Some("classic")));
    let old: Value = serde_json::from_str(&patched(&save, |m| m["version"] = json!(6))).unwrap();
    assert!(!same(&file(&old), Some("modern")));
    // The save's own mode after `units` declines the streamed read, as it
    // does without a set mode, and today's path sets the mode.
    let late: Value = serde_json::from_str(&patched(&save, |m| {
        let own = m.remove("mode").unwrap();
        m.insert("mode".into(), own);
    }))
    .unwrap();
    let keys: Vec<&String> = late.as_object().unwrap().keys().collect();
    assert!(keys.iter().position(|k| *k == "mode") > keys.iter().position(|k| *k == "units"));
    assert!(!same(&file(&late), Some("modern")));
}

/// The founder mark reads the file's `appVersion` and `founder` keys: a
/// file with no `appVersion`, or one from before 2.0, is a founder's tower.
#[test]
fn the_founder_mark() {
    let save = built(GameMode::Modern);
    let variants = [
        (
            patched(&save, |m| {
                m.remove("appVersion");
                m.remove("founder");
            }),
            true,
        ),
        (
            patched(&save, |m| {
                m.insert("appVersion".into(), json!("1.9.4"));
                m.remove("founder");
            }),
            true,
        ),
        (
            patched(&save, |m| {
                m.insert("appVersion".into(), json!("2.0.0"));
                m.remove("founder");
            }),
            false,
        ),
        (
            patched(&save, |m| {
                m.insert("appVersion".into(), json!("2.0.0"));
                m.insert("founder".into(), json!(true));
            }),
            true,
        ),
    ];
    for (text, founder) in variants {
        let v: Value = serde_json::from_str(&text).unwrap();
        for mode in [None, Some("classic")] {
            let sim = check(&file(&v), mode, 0).expect("the file streams");
            assert_eq!(sim.founder, founder, "{mode:?} {text:.120}");
        }
    }
}

/// Files that do not decode, decode to text that does not parse, or hold
/// something other than a saved game give today's message.
#[test]
fn bad_files_give_todays_message() {
    let text = built(GameMode::Classic).to_string();
    let bom = [b"\xEF\xBB\xBF".as_slice(), text.as_bytes()].concat();
    assert!(same(&pack(&bom), None), "a byte order mark is dropped");
    for bad in [
        String::new(),
        "VCTOWER2\nAAAA\n".into(),
        format!("{TOWER_FILE_MAGIC}\n!!!!\n"),
        format!("{TOWER_FILE_MAGIC}\n"),
        pack(b""),
        pack(b"[1]"),
        pack(b"{\"version\":7,\"mode\":\"classic\",\"towerName\":\"\xff\",\"units\":[]}"),
        pack(b"null"),
        pack(&text.as_bytes()[..text.len() / 2]),
        pack(format!("{text} x").as_bytes()),
    ] {
        for mode in [None, Some("modern"), Some("arcade")] {
            assert!(!same(&bad, mode));
        }
    }
}

/// The streamed reader's edge cases through the import path, with no mode set
/// and with one: a lone surrogate escape in a label, a `units` key spelled
/// with an escape, entries that are not units or are oddly shaped, a bad
/// literal inside `units`, and one unit past the cap.
#[test]
fn edge_cases_with_a_set_mode() {
    let save = built(GameMode::Classic);
    let text = save.to_string();
    let odd = patched(&save, |m| {
        let a = m["units"].as_array_mut().unwrap();
        a.insert(0, json!(null));
        a.insert(1, json!({ "kind": "nonsense", "floor": 2, "x": 1 }));
        a.push(json!({ "kind": "office", "floor": "3", "x": 120.6, "rent": "9e3" }));
    });
    let tile = json!({ "kind": "floor", "floor": 50, "x": 0 });
    let over = patched(&save, |m| {
        m["units"] = Value::Array(vec![tile.clone(); UNIT_CAP + 1])
    });
    for (json, streams) in [
        (relabeled(&text, "x\\ud800y"), true),
        (text.replacen("\"units\":[", "\"\\u0075nits\":[", 1), true),
        (odd, true),
        (
            text.replacen("\"kind\":\"floor\"", "\"kind\":\"floor\",\"x\":tru", 1),
            false,
        ),
        (over, false),
    ] {
        let packed = pack(json.as_bytes());
        for mode in [None, Some("modern")] {
            assert_eq!(same(&packed, mode), streams, "{mode:?}: {json:.80}");
        }
    }
}

/// The committed player towers load the same through the import path, as
/// the conformance runs load them, with no mode set and with each one.
#[test]
fn fixture_towers_import_the_same() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../conformance/fixtures");
    let mut paths: Vec<_> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|x| x == "vctower"))
        .collect();
    paths.sort();
    let modes = [None, Some("classic"), Some("modern")];
    let mut took = [0; 3];
    for (i, p) in paths.iter().enumerate() {
        let text = std::fs::read_to_string(p).unwrap();
        let current = decode_vctower(&text).unwrap()["version"] == json!(STREAMED_VERSION as i64);
        // A current tower is read with each mode; an older one, which goes
        // to today's path, with one, to keep the debug build's time down.
        let tried = if current { 0..3 } else { i % 3..i % 3 + 1 };
        for m in tried {
            let streamed = check(&text, modes[m], 0).is_some();
            assert_eq!(streamed, current, "{}: {:?}", p.display(), modes[m]);
            took[m] += usize::from(streamed);
        }
    }
    assert!(took.iter().all(|&n| n > 0), "streamed per mode: {took:?}");
}
