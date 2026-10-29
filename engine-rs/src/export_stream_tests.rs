//! The streamed `.vctower` writer writes the bytes, or the message, of the
//! tree path it replaces (#1338): `parse_save_json`, `stamp_save` and
//! `encode_vctower` in turn.
use super::*;
use crate::clock::{CalendarKind, GameMode};
use crate::facilities::Kind;
use crate::load::{decode_vctower, deserialize, inflate_vctower};
use crate::sim::Simulation;

const NOW: f64 = 1_750_000_000_123.0;

/// The tree path, as it was before the streamed writer.
fn tree(text: &[u8], app_version: &str, saved_at_ms: f64) -> Result<Vec<u8>, String> {
    let mut save = parse_save_json(text).map_err(|e| format!("save: {e}"))?;
    stamp_save(&mut save, app_version, saved_at_ms)?;
    encode_vctower(&save)
}

/// The streamed writer matches the tree path, and says whether it took the
/// text itself.
fn same(what: &str, text: &str, app_version: &str, saved_at_ms: f64) -> bool {
    let want = tree(text.as_bytes(), app_version, saved_at_ms);
    let got = encode_vctower_text(text.as_bytes(), app_version, saved_at_ms);
    assert_eq!(got, want, "{what}");
    assert_eq!(
        encode_vctower_string(text.to_string(), app_version, saved_at_ms),
        want,
        "{what}: the owned text"
    );
    read_top(text.as_bytes()).is_some()
}

fn played(mode: GameMode) -> Simulation {
    let mut sim = Simulation::new_game_with(7, mode, CalendarKind::RealWorld, false);
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
    for (kind, floor, x) in [(Kind::Office, 2, 110), (Kind::Condo, 4, 110)] {
        assert!(sim.tower.place(kind, floor, x).ok, "{kind:?}");
    }
    for _ in 0..30 {
        sim.tick(2.0);
    }
    sim
}

fn fixtures() -> Vec<(String, String)> {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../conformance/fixtures");
    let mut paths: Vec<_> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|x| x == "vctower"))
        .collect();
    paths.sort();
    assert!(!paths.is_empty());
    paths
        .into_iter()
        .map(|p| {
            let file = std::fs::read_to_string(&p).unwrap();
            let text = String::from_utf8(inflate_vctower(&file).unwrap()).unwrap();
            (p.display().to_string(), text)
        })
        .collect()
}

#[test]
fn engine_games_write_the_trees_bytes() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let games = [
            (
                "a new game",
                Simulation::new(1, mode, CalendarKind::RealWorld, true),
            ),
            ("a played game", played(mode)),
        ];
        for (what, sim) in games {
            let text = sim.serialize().to_string();
            assert!(same(what, &text, "3.0.0", NOW), "{what}: today's path");
            let bytes = crate::load::encode_simulation_vctower(&sim, "3.0.0", NOW).unwrap();
            assert_eq!(Ok(bytes), tree(text.as_bytes(), "3.0.0", NOW), "{what}");
            let loaded = deserialize(&sim.serialize()).unwrap();
            assert!(same(what, &loaded.serialize().to_string(), "3.0.0", NOW));
        }
        // A founder's tower keeps its status as `founder: true`.
        let mut sim = played(mode);
        sim.founder = true;
        assert!(same(
            "a founder",
            &sim.serialize().to_string(),
            "3.0.0",
            NOW
        ));
    }
}

#[test]
fn fixture_towers_write_the_trees_bytes() {
    for (name, text) in fixtures() {
        same(&name, &text, "3.0.0", NOW);
        // As a file decodes (stamps and all) and as the game would re-stamp.
        let save = decode_vctower(&std::fs::read_to_string(&name).unwrap()).unwrap();
        same(&name, &save.to_string(), "2.0.1", 0.0);
    }
}

#[test]
fn every_loader_case_writes_the_trees_bytes_or_message() {
    let table: Value = serde_json::from_str(include_str!("../../conformance/loader-cases.json"))
        .expect("loader-cases.json parses");
    let cases = table["cases"].as_array().unwrap();
    assert!(!cases.is_empty());
    for case in cases {
        let text = case["input"].to_string();
        same(case["id"].as_str().unwrap(), &text, "3.0.0", NOW);
    }
}

const UNIT: &str = r#"{"id":1,"kind":"floor","floor":1,"x":0}"#;

fn tower(extra: &str) -> String {
    format!(r#"{{"version":7,"minutes":5,"units":[{UNIT}]{extra}}}"#)
}

#[test]
fn the_stamp_goes_where_stamp_save_puts_it() {
    let cases = [
        ("no stamp", tower("")),
        (
            "stamp keys before units",
            format!(r#"{{"savedAt":1,"appVersion":"2.5.0","minutes":5,"units":[{UNIT}]}}"#),
        ),
        (
            "stamp keys after units",
            tower(r#","savedAt":1,"appVersion":"2.5.0""#),
        ),
        (
            "stamp keys between",
            format!(r#"{{"appVersion":"2.5.0","minutes":5,"units":[{UNIT}],"savedAt":1}}"#),
        ),
        ("a founder", tower(r#","founder":true"#)),
        (
            "a founder before units",
            format!(r#"{{"founder":true,"minutes":5,"units":[{UNIT}]}}"#),
        ),
        ("not a founder", tower(r#","founder":false"#)),
        ("a founder by build", tower(r#","appVersion":"1.9.0""#)),
        (
            "a founder by build, after units",
            format!(r#"{{"appVersion":"1.5","minutes":5,"units":[{UNIT}]}}"#),
        ),
        ("a number build", tower(r#","appVersion":1"#)),
        ("a named build", tower(r#","appVersion":"dev""#)),
        ("a null founder", tower(r#","founder":null"#)),
        ("a string founder", tower(r#","founder":"true""#)),
    ];
    for (what, text) in &cases {
        for version in ["3.0.0", "dev", "2.0.0"] {
            assert!(same(what, text, version, NOW), "{what}: today's path");
        }
    }
}

#[test]
fn keys_are_ordered_as_javascript_orders_them() {
    let cases = [
        tower(r#","10":1,"9":2,"a":3,"01":4,"-1":5,"4294967295":6,"4294967294":7"#),
        format!(r#"{{"b":1,"7":{{"z":1,"2":3,"1":2}},"minutes":5,"units":[{UNIT}]}}"#),
        format!(r#"{{"units":[{UNIT}],"minutes":5}}"#),
        format!(r#"{{ "minutes" : 5 , "units" : [ {UNIT} , {UNIT} ] }}"#),
        format!("{{\n  \"minutes\": 5,\n  \"units\": [\n    {UNIT}\n  ]\n}}\n"),
        r#"{"minutes":5,"units":[]}"#.to_string(),
        r#"{"minutes":5,"units":[{},{"a":[]},{"b":{}}]}"#.to_string(),
        tower(r#","é":"ü","ü":1"#),
    ];
    for (i, text) in cases.iter().enumerate() {
        assert!(same(&format!("case {i}"), text, "3.0.0", NOW), "case {i}");
    }
}

#[test]
fn numbers_and_strings_are_spelled_as_javascript_spells_them() {
    let numbers = "[1e21,1e-7,-0,-0.0,123456789.125,0.1,100,1E5,1.5e300,5e-324,\
                   12345678901234567890,-9223372036854775808,18446744073709551615,0.30000000000000004]";
    let units = format!(
        r#"[{{"id":1,"kind":"office","floor":2,"x":3,"rent":1e21,"satisfaction":0.1,"n":{numbers}}}]"#
    );
    let strings = r#""towerName":"quote \" slash \\ \/ tab \t nl \n \u0001 \u001f \u007f   😀 é""#;
    let text = format!(r#"{{"version":7,"minutes":5.5,"units":{units},{strings}}}"#);
    assert!(same("numbers and strings", &text, "3.0.0", NOW));
}

#[test]
fn a_lone_surrogate_escape_reads_as_the_replacement_character() {
    for name in [
        r"\ud800",
        r"\udc00",
        r"a\ud800b",
        r"😀",
        r"\ud83dx",
        r"\\ud800",
    ] {
        let text = tower(&format!(r#","towerName":"{name}""#));
        assert!(same(name, &text, "3.0.0", NOW), "{name}");
        let units = format!(r#"{{"minutes":5,"units":[{{"label":"{name}"}}]}}"#);
        assert!(same(name, &units, "3.0.0", NOW), "{name}");
    }
}

#[test]
fn a_repeated_key_goes_to_the_tree_path_which_keeps_its_place_and_last_value() {
    let cases = [
        format!(r#"{{"minutes":1,"units":[{UNIT}],"minutes":2}}"#),
        format!(r#"{{"units":[],"minutes":1,"units":[{UNIT}]}}"#),
        tower(r#","savedAt":1,"savedAt":2"#),
        tower(r#","founder":true,"founder":false"#),
        tower(r#","a":1,"a":2,"a":3"#),
    ];
    for (i, text) in cases.iter().enumerate() {
        assert!(!same(&format!("case {i}"), text, "3.0.0", NOW), "case {i}");
    }
}

#[test]
fn text_that_is_not_a_tower_gives_the_trees_message() {
    let texts = [
        "",
        " ",
        "null",
        "[]",
        "[1,2",
        "{}",
        "7",
        "\"x\"",
        "{\"minutes\":1}",
        "{\"units\":[]}",
        r#"{"minutes":"1","units":[]}"#,
        r#"{"minutes":1,"units":{}}"#,
        r#"{"minutes":1,"units":null}"#,
        r#"{"minutes":null,"units":[]}"#,
        r#"{"minutes":1,"units":[]} x"#,
        r#"{"minutes":1,"units":[]}{"minutes":1,"units":[]}"#,
        r#"{"minutes":1,"units":[1,]}"#,
        r#"{"minutes":1e400,"units":[]}"#,
        r#"{"minutes":1,"units":[{"a":1e400}]}"#,
        "\u{feff}{\"minutes\":1,\"units\":[]}",
        r#"{"minutes":1,"units":[],"$serde_json::private::Number":"1"}"#,
        r#"{"$serde_json::private::RawValue":"1"}"#,
    ];
    for text in texts {
        same(text, text, "3.0.0", NOW);
    }
    // Nesting past serde_json's depth limit, in a unit and out of one.
    let deep = format!("{}{}", "[".repeat(200), "]".repeat(200));
    same(
        "deep unit",
        &format!(r#"{{"minutes":1,"units":[{deep}]}}"#),
        "3.0.0",
        NOW,
    );
    same(
        "deep key",
        &format!(r#"{{"minutes":1,"units":[],"k":{deep}}}"#),
        "3.0.0",
        NOW,
    );
    let ok = "[".repeat(100) + &"]".repeat(100);
    assert!(same(
        "deep but fine",
        &format!(r#"{{"minutes":1,"units":[{ok}]}}"#),
        "3.0.0",
        NOW
    ));
}

#[test]
fn a_bad_stamp_gives_the_trees_message_after_the_towers_checks() {
    let good = tower("");
    for (version, at) in [
        ("3.0.0", f64::NAN),
        ("3.0.0", f64::INFINITY),
        ("3.0.0", 8.65e15),
        ("3.0.0", -8.65e15),
        ("3.0.0", 8.64e15),
        ("3.0.0", -0.0),
        ("1.9.0", NOW),
        ("0", NOW),
        ("-3", NOW),
        (" 1.5", NOW),
        ("\u{feff}1.5", NOW),
        ("", NOW),
        ("dev", NOW),
    ] {
        same(&format!("{version:?} at {at}"), &good, version, at);
    }
    // The tower's checks come first, as `stamp_save` runs them.
    same("both", r#"{"minutes":"x","units":[]}"#, "1.0.0", f64::NAN);
    same("both", r#"{"units":[]}"#, "3.0.0", f64::NAN);
}

#[test]
fn a_save_past_the_reader_cap_is_refused_in_the_trees_words() {
    let name = "x".repeat(33 << 20);
    let text = tower(&format!(r#","towerName":"{name}""#));
    let got = encode_vctower_text(text.as_bytes(), "3.0.0", NOW);
    assert!(
        got.as_ref().is_err_and(|e| e.contains("more than the")),
        "{got:?}"
    );
    assert_eq!(got, tree(text.as_bytes(), "3.0.0", NOW));
}
