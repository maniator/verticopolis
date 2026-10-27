//! Tests for the streamed save reader (#1225): it loads every text exactly
//! as `deserialize(&parse_save_json(text))` does, and it takes the saves the
//! game writes.
use super::*;
use crate::canonical::digest;
use crate::clock::{CalendarKind, GameMode};
use crate::facilities::Kind;
use crate::load::{decode_vctower, migrate_save, widen_legacy_elevator_shafts, UNIT_CAP};
use crate::sim::SAVE_VERSION;
use crate::snapshot::state_view;
use serde_json::json;

/// What a load sets that a test can read: the save it writes back, the
/// hashed state and crowd, and the loop state a save does not carry.
pub(super) fn fingerprint(sim: &Simulation) -> String {
    format!(
        "{}\n{} {} {} {:?} {:?} {:?} {} {} {} {} {} {} {}",
        sim.serialize(),
        digest(&state_view(sim)),
        digest(&sim.crowd.view()),
        sim.log_seq,
        sim.constructing,
        sim.events.active,
        sim.weather,
        sim.last_hour,
        sim.last_day,
        sim.last_month,
        sim.last_quarter,
        sim.last_quarter_money,
        sim.founder,
        sim.tower.next_id,
    )
}

/// Today's path on the same text.
fn today(text: &str) -> Result<Simulation, String> {
    let raw = parse_save_json(text.as_bytes()).map_err(|e| e.to_string())?;
    deserialize(&raw)
}

/// Checks the reader against today's path on one text, an hour of play
/// included, and returns whether the streamed reader took it.
pub(super) fn same(text: &str) -> bool {
    check(text, 30).is_some()
}

/// `same` with `steps` two-minute steps of play after the load, returning
/// the streamed game when the reader took the text.
pub(super) fn check(text: &str, steps: usize) -> Option<Simulation> {
    let shown: String = text.chars().take(160).collect();
    // A text the streamed reader declines goes to today's path itself, so
    // its game is today's by construction and only the message is compared.
    let mut fast = match read_save(text.as_bytes()) {
        Ok((sim, true)) => sim,
        Ok((_, false)) => return None,
        Err(e) => {
            assert_eq!(Some(e), today(text).err(), "{shown}");
            return None;
        }
    };
    let mut slow = today(text).unwrap_or_else(|e| panic!("{shown}: today's path: {e}"));
    assert_eq!(fingerprint(&fast), fingerprint(&slow), "{shown}");
    if steps > 0 {
        for _ in 0..steps {
            fast.tick(2.0);
            slow.tick(2.0);
        }
        assert_eq!(
            fingerprint(&fast),
            fingerprint(&slow),
            "{shown}: after play"
        );
    }
    Some(fast)
}

/// A small tower with rooms, an elevator, stairs and an hour of play, as the
/// engine saves it.
pub(super) fn built(mode: GameMode) -> Value {
    let mut sim = Simulation::new(11, mode, CalendarKind::RealWorld, false);
    sim.money = 1e9;
    for x in 100..160 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        for f in 2..=6 {
            assert!(sim.tower.place(Kind::Floor, f, x).ok);
        }
    }
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorStandard, 100, 1, 6)
            .ok
    );
    assert!(sim.tower.place_transport(Kind::Stairs, 150, 1, 2).ok);
    for (kind, floor, x) in [
        (Kind::Office, 2, 110),
        (Kind::Office, 3, 110),
        (Kind::Condo, 4, 110),
        (Kind::FastFood, 2, 130),
    ] {
        assert!(sim.tower.place(kind, floor, x).ok, "{kind:?}");
    }
    for _ in 0..30 {
        sim.tick(2.0);
    }
    sim.serialize()
}

/// The save's top-level keys in a new order: `first` up front, the rest after
/// in their old order.
fn reorder(save: &Value, first: &[&str]) -> String {
    let obj = save.as_object().unwrap();
    let mut out = Map::new();
    for k in first {
        out.insert(k.to_string(), obj[*k].clone());
    }
    for (k, v) in obj {
        if !out.contains_key(k) {
            out.insert(k.clone(), v.clone());
        }
    }
    Value::Object(out).to_string()
}

/// The save with `patch` applied to a copy of its object.
pub(super) fn patched(save: &Value, patch: impl FnOnce(&mut Map<String, Value>)) -> String {
    let mut save = save.clone();
    patch(save.as_object_mut().unwrap());
    save.to_string()
}

/// A new save version brings a migration step this reader does not apply.
#[test]
fn streamed_version_is_the_save_version() {
    assert_eq!(
        SAVE_VERSION as f64, STREAMED_VERSION,
        "SAVE_VERSION moved: review load_stream.rs's migration step before taking the new version"
    );
}

/// On a save this reader takes, the version step is the shaft widening
/// alone, the one step `streamed` applies; a new step for version 7 saves
/// fails this until `streamed` applies it too.
#[test]
fn the_version_7_step_is_the_shaft_widening() {
    let table: Value =
        serde_json::from_str(include_str!("../../conformance/loader-cases.json")).unwrap();
    let mut saves: Vec<Value> = table["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["input"].clone())
        .collect();
    saves.push(built(GameMode::Classic));
    saves.push(built(GameMode::Modern));
    let mut seen = 0;
    for save in saves.iter().filter(|s| is_current(s)) {
        let narrow = patched(save, |m| {
            let first = m.get_mut("transports").and_then(|t| t.get_mut(0));
            if let Some(t) = first.and_then(Value::as_object_mut) {
                t.insert("width".into(), json!(2));
            }
        });
        for raw in [save.clone(), serde_json::from_str(&narrow).unwrap()] {
            assert_eq!(migrate_save(&raw), widen_legacy_elevator_shafts(&raw));
            seen += 1;
        }
    }
    assert!(seen >= 20, "only {seen} current saves");
}

/// A save this reader is meant to take: an object whose version is 7 and
/// whose mode is a game mode, both before `units`, which is an array. (The
/// loader table's inputs are parsed values, so no key repeats.)
fn is_current(save: &Value) -> bool {
    let Some(m) = save.as_object() else {
        return false;
    };
    let at = |k: &str| m.keys().position(|x| x == k);
    let before_units = |k: &str| match at("units") {
        None => true,
        Some(u) => at(k).is_some_and(|i| i < u),
    };
    m.get("version").and_then(Value::as_f64) == Some(STREAMED_VERSION)
        && matches!(
            m.get("mode").and_then(Value::as_str),
            Some("classic" | "modern")
        )
        && before_units("version")
        && before_units("mode")
        && m.get("units")
            .is_none_or(|u| u.as_array().is_some_and(|a| a.len() <= UNIT_CAP))
}

/// The saves the engine writes, in both modes, take the streamed read and
/// load as today's path loads them; so does the engine's own save of that.
#[test]
fn engine_saves_stream_and_load_the_same() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let text = built(mode).to_string();
        assert!(same(&text), "{mode:?}: an engine save did not stream");
        let written = load_save_text(text.as_bytes())
            .unwrap()
            .serialize()
            .to_string();
        assert!(same(&written), "{mode:?}: a reloaded save did not stream");
        let again = load_save_text(written.as_bytes())
            .unwrap()
            .serialize()
            .to_string();
        assert_eq!(
            again, written,
            "{mode:?}: the save changed through a second load"
        );
    }
}

/// Every forged and hand-edited save in the loader table loads the same
/// through both readers, and exactly the current ones stream.
#[test]
fn loader_cases_load_the_same() {
    let table: Value =
        serde_json::from_str(include_str!("../../conformance/loader-cases.json")).unwrap();
    let mut took = 0;
    for case in table["cases"].as_array().unwrap() {
        let input = &case["input"];
        let streams = same(&input.to_string());
        assert_eq!(streams, is_current(input), "{}", case["name"]);
        took += usize::from(streams);
    }
    assert!(took >= 10, "only {took} loader cases streamed");
}

/// The committed player towers load the same (without play, which the
/// debug build is slow at on towers this size), stream when they are
/// current, and save back byte for byte after a streamed load.
#[test]
fn fixture_towers_load_the_same() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../conformance/fixtures");
    let mut paths: Vec<_> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|x| x == "vctower"))
        .collect();
    paths.sort();
    assert!(!paths.is_empty());
    for p in paths {
        let save = decode_vctower(&std::fs::read_to_string(&p).unwrap()).unwrap();
        let text = save.to_string();
        let current = save["version"] == json!(STREAMED_VERSION as i64);
        let took = check(&text, 0);
        assert_eq!(took.is_some(), current, "{}", p.display());
        let written = match took {
            Some(sim) => sim.serialize().to_string(),
            None => today(&text).unwrap().serialize().to_string(),
        };
        let (reread, took) = read_save(written.as_bytes()).unwrap();
        assert!(took, "{}: a written save did not stream", p.display());
        assert_eq!(
            reread.serialize().to_string(),
            written,
            "{}: a written save changed",
            p.display()
        );
    }
}

/// Key order, repeated keys and the version and mode decide whether the
/// reader takes a save; whichever reads it, the game is the same.
#[test]
fn order_version_and_mode() {
    let save = built(GameMode::Classic);
    let text = save.to_string();
    let after_units = |key: &str| {
        let mut keys: Vec<&str> = save
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .filter(|k| *k != key)
            .collect();
        keys.push(key);
        reorder(&save, &keys)
    };
    assert!(!same(&after_units("mode")));
    assert!(!same(&after_units("version")));
    assert!(same(&after_units("transports")));
    assert!(!same(&reorder(&save, &["units", "transports"])));
    let late = |key: &str, value: &str| text.replacen('{', &format!("{{\"{key}\":{value},"), 1);
    assert!(
        same(&late("version", "5")),
        "the save's own version comes last and wins"
    );
    assert!(same(&text.replacen(
        "\"version\":7",
        "\"version\":5,\"version\":7",
        1
    )));
    assert!(!same(&text.replacen(
        "\"version\":7",
        "\"version\":7,\"version\":5",
        1
    )));
    let units = format!("\"units\":{}", save["units"]);
    assert!(!same(&text.replacen(
        &units,
        &format!("{units},{units}"),
        1
    )));
    assert!(!same(&format!(
        "{},\"mode\":\"classic\"}}",
        &text[..text.len() - 1]
    )));
    for version in ["6", "8", "\"7\"", "7.5", "null"] {
        assert!(!same(&patched(&save, |m| {
            m["version"] = serde_json::from_str(version).unwrap();
        })));
    }
    assert!(same(&text.replacen("\"version\":7", "\"version\":7.0", 1)));
    assert!(same(&text.replacen("\"version\":7", "\"version\":7e0", 1)));
    assert!(!same(&patched(&save, |m| {
        m.remove("version");
    })));
    for mode in [json!("tower"), json!(null), json!(1)] {
        assert!(!same(&patched(&save, |m| m["mode"] = mode.clone())));
    }
    assert!(!same(&patched(&save, |m| {
        m.remove("mode");
    })));
    assert!(same(&patched(&save, |m| {
        m.remove("units");
    })));
    assert!(same(&patched(&save, |m| m["mode"] = json!("modern"))));
    // A key given again after `units`, other than the two above: its last
    // value wins, as in a parsed tree.
    let again = |key: &str, value: &str| format!("{},\"{key}\":{value}}}", &text[..text.len() - 1]);
    assert!(same(&again("money", "5")));
    assert!(same(&again("transports", "[]")));
    assert!(same(&again("seed", "\"x\"")));
    // A key spelled as one of serde_json's private ones goes to today's path.
    assert!(!same(&late("$serde_json::private::RawValue", "\"7\"")));
    // A `units` key spelled with an escape is the same key: the count off the
    // text misses it, so the vectors regrow, and the game is the same.
    let escaped = text.replacen("\"units\":[", "\"\\u0075nits\":[", 1);
    assert_eq!(units_hint(escaped.as_bytes()), 0);
    assert!(same(&escaped));
}

/// Entries and shapes inside `units` and `transports`.
#[test]
fn units_and_transports_shapes() {
    let save = built(GameMode::Modern);
    for units in [json!({}), json!("x"), json!(null), json!(3)] {
        assert!(!same(&patched(&save, |m| m["units"] = units.clone())));
    }
    assert!(same(&patched(&save, |m| {
        let a = m["units"].as_array_mut().unwrap();
        a.insert(0, json!(null));
        a.insert(1, json!({ "kind": "nonsense", "floor": 2, "x": 1 }));
        a.insert(2, json!(7));
        a.insert(3, json!([]));
        a.push(json!({ "kind": "office", "floor": "3", "x": 120.6, "rent": "9e3", "label": "\u{1F600}" }));
        a.push(json!({ "kind": "office", "floor": 3, "x": 110 }));
        a.push(json!({ "kind": "condo", "id": -1, "completeAt": "soon", "state": "construction" }));
    })));
    // A narrow shaft from before version 7, which the version step widens.
    let narrow = patched(&save, |m| {
        m["transports"][0]["width"] = json!(2);
        m["transports"][0]["x"] = json!(140);
    });
    assert!(same(&narrow));
    let widened = load_save_text(narrow.as_bytes()).unwrap();
    assert_eq!(
        widened.tower.transports[0].width, 4,
        "the shaft was not widened"
    );
    // Every spelling of version 7 is widened the same way.
    for version in ["7.0", "7e0", "70e-1"] {
        let spelled = narrow.replacen("\"version\":7,", &format!("\"version\":{version},"), 1);
        assert_ne!(spelled, narrow);
        assert!(same(&spelled), "{version}");
    }
    let many: Vec<Value> = (0..100).map(|_| save["transports"][1].clone()).collect();
    assert!(same(&patched(&save, |m| m["transports"] = json!(many))));
    for transports in [json!({}), json!("x"), json!(null)] {
        assert!(same(
            &patched(&save, |m| m["transports"] = transports.clone())
        ));
    }
}

/// Text that does not parse, or only just parses, gives today's message.
#[test]
fn malformed_text_gives_todays_message() {
    let text = built(GameMode::Classic).to_string();
    let deep = format!("{}1{}", "[".repeat(200), "]".repeat(200));
    for bad in [
        String::new(),
        "[]".into(),
        "\"save\"".into(),
        "null".into(),
        format!("\u{FEFF}{text}"),
        format!("{text} x"),
        text[..text.len() / 2].to_string(),
        text.replacen("\"kind\":\"floor\"", "\"kind\":\"floor\",\"x\":1e400", 1),
        text.replacen("\"kind\":\"floor\"", "\"kind\":\"floor\",\"x\":tru", 1),
        text.replacen(
            "\"kind\":\"floor\"",
            &format!("\"kind\":\"floor\",\"deep\":{deep}"),
            1,
        ),
        text.replacen("\"money\":", &format!("\"deep\":{deep},\"money\":"), 1),
    ] {
        assert!(!same(&bad), "{bad:.80}");
    }
}

/// At the unit cap the save streams and loads as today's path loads it,
/// whatever skipped entries sit beside the units; one past it, today's path
/// refuses it.
#[test]
fn the_unit_cap() {
    let save = built(GameMode::Classic);
    let tile = json!({ "kind": "floor", "floor": 50, "x": 0 });
    let mut at_cap = vec![tile.clone(); UNIT_CAP];
    at_cap.insert(0, json!(null));
    at_cap.insert(1, json!({ "kind": "nonsense" }));
    at_cap.push(json!(7));
    let at_cap = patched(&save, |m| m["units"] = Value::Array(at_cap));
    assert!(check(&at_cap, 0).is_some());
    let over = patched(&save, |m| {
        m["units"] = Value::Array(vec![tile.clone(); UNIT_CAP + 1])
    });
    assert!(streamed(over.as_bytes(), None).is_none());
    let refused = today(&over).err();
    assert!(refused.is_some());
    assert_eq!(load_save_text(over.as_bytes()).err(), refused);
}

/// The reservation counts the objects listed directly in the top-level
/// `units`, and nothing else, within what the text's length could hold.
#[test]
fn the_units_count() {
    // Padding keeps these short texts clear of the length bound.
    let hint = |text: &str| units_hint(format!("{text}{}", " ".repeat(4096)).as_bytes());
    assert_eq!(hint(r#"{"units":[]}"#), 0);
    assert_eq!(hint(r#"{"units":[ ]}"#), 0);
    assert_eq!(hint(r#"{"units":[{"k":1}]}"#), 1);
    // An empty object cannot become a unit, so it reserves nothing.
    assert_eq!(hint(r#"{"units":[{},{ },{"k":1},{  }]}"#), 1);
    assert_eq!(hint(r#"{"units":[1,null,"{",[{"k":1}]]}"#), 0);
    assert_eq!(
        hint(r#"{ "units" : [ {"a":[{},2]}, "x,]", null, { "k" : 1 } ] }"#),
        2
    );
    assert_eq!(hint(r#"{"units":["\"],[{", {"b":"\\"}]}"#), 1);
    assert_eq!(
        hint(r#"{"towerName":"units","units":[{"k":1},{"k":2}]}"#),
        2
    );
    assert_eq!(
        hint(r#"{"view":{"units":[{"k":1},{"k":1},{"k":1}]},"units":[{"k":1}]}"#),
        1
    );
    assert_eq!(hint(r#"{"view":{"units":[{"k":1},{"k":1}]}}"#), 0);
    assert_eq!(hint(r#"{"units":{"a":{"k":1}}}"#), 0);
    assert_eq!(hint(r#"{"units":[{"k":1},{""#), 2);
    assert_eq!(hint(r#"{"units"#), 0);
    assert_eq!(hint("[\"units\",[{\"k\":1}]]"), 0);
    let unit = r#"{"kind":"floor","x":12345},"#;
    let many = format!("{{\"units\":[{}{{}}]}}", unit.repeat(UNIT_CAP + 5));
    assert_eq!(units_hint(many.as_bytes()), UNIT_CAP);
    // Short objects cannot reserve more units than their text could hold.
    let short = format!("{{\"units\":[{}{{}}]}}", "{\"k\":1},".repeat(1000));
    assert_eq!(units_hint(short.as_bytes()), short.len() / MIN_UNIT_BYTES);
    // Empty objects reserve nothing, however much space is around them.
    let spaced = format!(
        "{{\"units\":[{}{{}}]}}{}",
        "{ },".repeat(30_000),
        " ".repeat(1 << 21)
    );
    assert_eq!(units_hint(spaced.as_bytes()), 0);
}
