//! Native tests of the binding helpers.

use super::*;
use crate::canonical::canonical_json;
use crate::clock::GameMode;
use crate::load_stream::override_mode;

/// The binding stamps the save and hands back the crate encoder's text.
/// (A refusal is a JavaScript error, which cannot be built off the wasm
/// target; the crate's `stamp_save` tests and the Node suite cover those.)
#[test]
fn the_vctower_binding_stamps_and_writes_what_the_crate_writes() {
    let save =
        serde_json::json!({"version": 7, "units": [], "minutes": 0, "towerName": "Caf\u{e9}"});
    let Ok(text) = encode_vctower(&save.to_string(), "3.0.0", 1.5e12) else {
        panic!("the binding refused a tower save");
    };
    let mut stamped = save.clone();
    crate::load::stamp_save(&mut stamped, "3.0.0", 1.5e12).unwrap();
    assert_eq!(
        text.as_bytes(),
        crate::load::encode_vctower(&stamped).unwrap()
    );
    assert_eq!(
        canonical_json(&crate::load::decode_vctower(&text).unwrap()),
        canonical_json(&stamped)
    );
}

/// The two TDT free functions answer every lock case the way the referee
/// does: the JSON envelope carries the pinned save and warnings, each
/// refusal carries the pinned message, and each embedded export matches
/// its pinned bytes or refusal.
#[test]
fn the_tdt_binding_answers_from_the_lock() {
    use crate::canonical::digest;
    use crate::tdt::referee::{inflate, read_lock, sha256_hex};
    let suite = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../conformance");
    let lock = read_lock(&suite.join("tdt-cases.json")).expect("lock");
    let mut parsed = 0;
    for case in lock.import.iter().filter(|c| c.expected.is_some()) {
        let Ok(json) = import_tdt(&inflate(&case.bytes).expect("bytes"), &case.filename) else {
            panic!("the import refused {}, which the lock parses", case.id);
        };
        let v: serde_json::Value = serde_json::from_str(&json).expect("json envelope");
        let expected = case.expected.as_ref().unwrap();
        assert_eq!(digest(&v["save"]), expected.save, "{}", case.id);
        let mut warnings: Vec<String> =
            serde_json::from_value(v["warnings"].clone()).expect("a string array");
        // The lock stores warnings sorted (as the referee compares them);
        // their order is pinned by the TypeScript versus WASM
        // differential test.
        warnings.sort();
        assert_eq!(warnings, expected.warnings, "{}", case.id);
        parsed += 1;
    }
    assert!(parsed > 0, "the lock has import cases that parse");
    // A JavaScript error cannot be built off the wasm target, so each
    // refusal is asserted on the crate function the binding wraps, with
    // the lock's exact message.
    let mut refused = 0;
    for case in lock.import.iter().filter(|c| c.throws.is_some()) {
        let got = crate::tdt::import_tdt(&inflate(&case.bytes).expect("bytes"), &case.filename);
        assert_eq!(got.err().as_ref(), case.throws.as_ref(), "{}", case.id);
        refused += 1;
    }
    assert!(refused > 0, "the lock has import cases that refuse");
    let mut written = 0;
    for ex in lock
        .export
        .iter()
        .filter(|c| c.save.is_some() && c.expected.is_some())
    {
        let Ok(bytes) = export_tdt(&ex.save.as_ref().unwrap().to_string()) else {
            panic!("the export refused {}, which the lock writes", ex.id);
        };
        assert_eq!(
            sha256_hex(&bytes),
            *ex.expected.as_ref().unwrap(),
            "{}",
            ex.id
        );
        written += 1;
    }
    assert!(written > 0, "the lock has embedded export cases");
    for ex in lock
        .export
        .iter()
        .filter(|c| c.save.is_some() && c.throws.is_some())
    {
        let got = crate::tdt::export_tdt(&ex.save.as_ref().unwrap().to_string());
        assert_eq!(got.err().as_ref(), ex.throws.as_ref(), "{}", ex.id);
    }
}

#[test]
fn the_charge_commands_cross_as_the_typescript_spells_them() {
    use crate::charges::{ChargeResult, ExtendEnd, ExtendResult};
    use crate::gameplay::RemovalMethod;
    let refused = ChargeResult {
        ok: false,
        reason: Some("Not enough money.".into()),
        delta: 0.0,
    };
    let v = charge_json(&refused);
    assert_eq!(v["ok"], false);
    assert_eq!(v["reason"], "Not enough money.");
    assert_eq!(v["delta"].as_f64(), Some(0.0));
    let paid = ExtendResult {
        charge: ChargeResult {
            ok: true,
            reason: None,
            delta: -10_000.0,
        },
        bottom: 1,
        top: 4,
        added: 2,
    };
    let v = extend_json(&paid);
    assert!(v.get("reason").is_none());
    assert_eq!(v["delta"].as_f64(), Some(-10_000.0));
    assert_eq!(
        (v["bottom"].as_i64(), v["top"].as_i64(), v["added"].as_i64()),
        (Some(1), Some(4), Some(2))
    );
    assert_eq!(ExtendEnd::parse("down"), Some(ExtendEnd::Down));
    assert_eq!(ExtendEnd::parse("sideways"), None);
    assert_eq!(
        RemovalMethod::parse("bulldoze"),
        Some(RemovalMethod::Bulldoze)
    );
    assert_eq!(RemovalMethod::parse("burn"), None);
}

/// A malformed charge command (#923) is refused with one reason and moves
/// nothing: a fractional or NaN id or floor that the old `i32` arguments
/// truncated to a real shaft, an unknown `end` or `method`, a bad mark.
#[test]
fn a_malformed_charge_command_is_refused_and_moves_nothing() {
    use crate::charges::INVALID_REQUEST;
    use crate::facilities::Kind;
    let mut sim = Simulation::new_game(1, crate::clock::GameMode::Classic);
    for x in 10..40 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    for x in 10..40 {
        assert!(sim.tower.place(Kind::Floor, 2, x).ok);
    }
    assert!(sim.build_transport(Kind::ElevatorStandard, 10, 1, 2).ok);
    let lift = sim.tower.transport_at(1, 10).unwrap().id;
    sim.money = 1_000_000.0;
    let mut e = Engine::of(sim);
    let before = e.serialize();
    e.sim.gameplay.drain();
    let refused = |text: String| -> Value {
        let v: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["ok"], false, "{text}");
        assert_eq!(v["reason"], INVALID_REQUEST, "{text}");
        assert_eq!(v["delta"].as_f64(), Some(0.0), "{text}");
        v
    };
    let id = Some(lift as f64);
    let near = Some(lift as f64 + 0.5);
    let up = || Some("up".to_string());
    // A non-number id (a numeric string, null, a boolean, a missing
    // argument) reaches the checked call as None and is refused.
    refused(e.add_car_checked(None));
    refused(e.add_car_checked(near));
    refused(e.add_car_checked(Some(f64::NAN)));
    refused(e.remove_car_checked(None));
    refused(e.remove_car_checked(Some(f64::INFINITY)));
    refused(e.remove_car_checked(Some(f64::NEG_INFINITY)));
    refused(e.add_car_checked(Some(9_007_199_254_740_992.0))); // 2^53: past Number.isSafeInteger
    refused(e.extend_checked(id, Some("UP".into()), Some(3.0))); // exact match
    refused(e.remove_facility_checked(id, Some("Sell".into())));
    let v = refused(e.extend_checked(id, Some("sideways".into()), Some(3.0)));
    assert_eq!(
        (v["bottom"].as_i64(), v["top"].as_i64()),
        (Some(1), Some(2))
    );
    let v = refused(e.extend_checked(id, None, Some(3.0))); // a non-string end
    assert_eq!(
        (v["bottom"].as_i64(), v["top"].as_i64()),
        (Some(1), Some(2))
    );
    refused(e.extend_checked(id, up(), Some(3.5)));
    refused(e.extend_checked(id, up(), Some(f64::NAN)));
    refused(e.extend_checked(id, up(), None));
    let v = refused(e.extend_checked(near, up(), Some(3.0)));
    assert_eq!(
        (v["bottom"].as_i64(), v["top"].as_i64()),
        (Some(0), Some(0))
    );
    // A malformed beginExtend opens no gesture and drops the open one.
    assert!(e.begin_extend_checked(id));
    assert!(!e.begin_extend_checked(None));
    assert_eq!(e.sim.extend_gesture, None);
    assert!(!e.begin_extend_checked(near));
    assert!(!e.begin_extend_checked(Some(f64::NAN)));
    refused(e.remove_facility_checked(id, Some("burn".into())));
    refused(e.remove_facility_checked(id, None));
    refused(e.remove_facility_checked(near, Some("sell".into())));
    refused(e.remove_facility_checked(None, Some("sell".into())));
    assert_eq!(
        e.serialize(),
        before,
        "a refusal moved the tower or the money"
    );
    assert!(
        e.sim.gameplay.drain().is_empty(),
        "a refusal emitted an event"
    );
    // A well-formed call still lands.
    let ok: Value = serde_json::from_str(&e.add_car_checked(id)).unwrap();
    assert_eq!(ok["ok"], true);
    // A gesture opened through the binding bills a wiggle once.
    assert!(e.begin_extend_checked(id));
    let at = |e: &mut Engine, floor: f64| -> Value {
        serde_json::from_str(&e.extend_checked(id, up(), Some(floor))).unwrap()
    };
    assert_eq!(at(&mut e, 3.0)["added"].as_i64(), Some(1));
    assert_eq!(at(&mut e, 2.0)["added"].as_i64(), Some(0));
    assert_eq!(at(&mut e, 3.0)["added"].as_i64(), Some(0));
}

#[test]
fn the_frame_view_carries_the_header_and_one_record_per_person_unit_and_car() {
    // A real tower, so the view carries people, every unit kind and cars.
    let text = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../conformance/fixtures/towerone-star4.vctower"
    ))
    .expect("fixture");
    let raw = crate::load::decode_vctower(&text).expect("decodes");
    let mut sim = crate::load::deserialize(&raw).expect("loads");
    sim.tick(600.0);
    let v = frame_view(&sim);
    let people = v[23] as usize;
    let units = v[24] as usize;
    let transports = v[25] as usize;
    assert_eq!(people, sim.crowd.people.len());
    assert_eq!(units, sim.tower.units.len());
    assert_eq!(transports, sim.tower.transports.len());
    assert!(people > 0 && transports > 0);
    let cars: usize = sim.tower.transports.iter().map(|t| t.cars as usize).sum();
    let person_slots: usize = sim
        .crowd
        .people
        .iter()
        .map(|p| PERSON_FIXED + p.floors.len() + p.shafts.len())
        .sum();
    assert_eq!(
        v.len(),
        FRAME_HEADER + person_slots + units * 6 + 2 * transports + 3 * cars
    );
    assert_eq!(v[0], sim.clock.minutes);
    assert_eq!(v[4], sim.money);
    assert_eq!(v[22], sim.on_hour_runs as f64);
    // The first unit record names the first unit and its occupants.
    let u0 = FRAME_HEADER + person_slots;
    assert_eq!(v[u0], sim.tower.units[0].id as f64);
    assert_eq!(v[u0 + 2], sim.tower.units[0].occupants as f64);
    // The transport record follows the units.
    let t0 = u0 + units * 6;
    assert_eq!(v[t0], sim.tower.transports[0].id as f64);
    assert_eq!(v[t0 + 1], sim.tower.transports[0].cars as f64);
    // The first person record names the first person, its position and
    // its route: the floors and shafts follow the fixed slots.
    let p0 = &sim.crowd.people[0];
    assert_eq!(v[FRAME_HEADER], p0.id as f64);
    assert_eq!(v[FRAME_HEADER + 5], p0.x);
    assert_eq!(v[FRAME_HEADER + 8], p0.origin_floor as f64);
    assert_eq!(v[FRAME_HEADER + 16], p0.floors.len() as f64);
    assert_eq!(v[FRAME_HEADER + 17], p0.shafts.len() as f64);
    let floors: Vec<i64> = v
        [FRAME_HEADER + PERSON_FIXED..FRAME_HEADER + PERSON_FIXED + p0.floors.len()]
        .iter()
        .map(|f| *f as i64)
        .collect();
    assert_eq!(floors, p0.floors);
    // A round-tripper in the crowd carries its origin unit and venue; the
    // record agrees with the person's own fields.
    let (mut at, mut seen) = (FRAME_HEADER, false);
    for p in &sim.crowd.people {
        assert_eq!(v[at], p.id as f64);
        assert_eq!(v[at + 9], p.origin_unit_id.map_or(-1.0, |n| n as f64));
        assert_eq!(v[at + 11], p.meal_venue_id.map_or(-1.0, |n| n as f64));
        assert_eq!(v[at + 14], if p.returning { 1.0 } else { 0.0 });
        match p.dwell_seconds_left {
            Some(left) => assert_eq!(v[at + 15], left),
            None => assert!(v[at + 15].is_nan()),
        }
        seen |= p.origin_unit_id.is_some();
        at += PERSON_FIXED + p.floors.len() + p.shafts.len();
    }
    assert!(seen, "the fixture's noon crowd has a round-tripper");
}

#[test]
fn log_since_numbers_the_ring_from_the_sequence_counter() {
    let mut sim = Simulation::new_game(7, GameMode::Classic);
    let founded = sim.log_seq;
    sim.emit("one", crate::sim::LogKind::Info);
    sim.emit("two", crate::sim::LogKind::Good);
    sim.emit("three", crate::sim::LogKind::Money);
    let all = log_since(&sim, 0);
    assert_eq!(all.as_array().map(Vec::len), Some(sim.log.len()));
    assert_eq!(log_since(&sim, founded).as_array().map(Vec::len), Some(3));
    let later = log_since(&sim, sim.log_seq - 1);
    let later = later.as_array().expect("array");
    assert_eq!(later.len(), 1);
    assert_eq!(later[0]["text"], "three");
    assert_eq!(later[0]["kind"], "money");
    assert_eq!(later[0]["seq"], sim.log_seq);
    assert_eq!(
        log_since(&sim, sim.log_seq).as_array().map(Vec::len),
        Some(0)
    );
}

#[test]
fn the_catalog_crosses_as_canonical_json_for_a_named_mode() {
    let text = catalog_text("modern").unwrap();
    assert_eq!(text, crate::catalog::catalog_json(GameMode::Modern));
    let v: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(v["mode"], "modern");
    assert!(catalog_text("arcade")
        .unwrap_err()
        .contains("classic or modern"));
}

#[test]
fn modes_and_kinds_parse_by_their_saved_spelling() {
    assert_eq!(parse_mode("classic"), Ok(GameMode::Classic));
    assert_eq!(parse_mode("modern"), Ok(GameMode::Modern));
    assert!(parse_mode("Classic")
        .unwrap_err()
        .contains("classic or modern"));
    assert_eq!(parse_kind("lobby"), Ok(Kind::Lobby));
    assert!(parse_kind("penthouse").unwrap_err().contains("penthouse"));
}

#[test]
fn outcomes_and_choices_take_the_typescript_shape() {
    assert_eq!(outcome(true, None), r#"{"ok":true}"#);
    assert_eq!(
        outcome(false, Some("no money")),
        r#"{"ok":false,"reason":"no money"}"#
    );
    let v: Value = serde_json::from_str(&pending_json("bombThreat", 20000.0, "pay"))
        .expect("pending choice is JSON");
    assert_eq!(v["kind"], "bombThreat");
    assert_eq!(v["cost"], 20000.0);
    assert_eq!(v["message"], "pay");
}

#[test]
fn batch_targets_parse_and_results_take_the_typescript_keys() {
    use crate::rent::{BatchRentResult, BatchTarget};
    assert_eq!(parse_batch_target("\"default\""), Ok(BatchTarget::Default));
    assert_eq!(parse_batch_target("\"noRate\""), Ok(BatchTarget::NoRate));
    assert_eq!(parse_batch_target("1500"), Ok(BatchTarget::Price(1500.0)));
    assert!(parse_batch_target("\"cheap\"").is_err());
    assert!(parse_batch_target("[1]").is_err());
    let r = BatchRentResult {
        matched: 3,
        eligible: 2,
        changed: 1,
        skipped_sold: 1,
        ..BatchRentResult::default()
    };
    let v: Value = serde_json::from_str(&batch_result_json(&r)).unwrap();
    assert_eq!(v["matched"], 3);
    assert_eq!(v["skippedSold"], 1);
    assert_eq!(v["clampedHigh"], 0);
    assert_eq!(v.as_object().unwrap().len(), 8);
}

#[test]
fn markers_land_on_the_engine_and_refuse_a_bad_shape() {
    let mut sim = Simulation::new_game(1, GameMode::Classic);
    apply_markers(
        &mut sim,
        r#"{"lastHour":7,"lastDay":0,"lastQuarter":-1,"lastMonth":-1}"#,
    )
    .expect("whole numbers land");
    assert_eq!(
        (
            sim.last_hour,
            sim.last_day,
            sim.last_quarter,
            sim.last_month
        ),
        (7, 0, -1, -1)
    );
    assert!(apply_markers(&mut sim, r#"{"lastHour":7}"#)
        .unwrap_err()
        .contains("lastDay"));
    assert!(apply_markers(
        &mut sim,
        r#"{"lastHour":1.5,"lastDay":0,"lastQuarter":0,"lastMonth":0}"#
    )
    .unwrap_err()
    .contains("lastHour"));
    assert!(apply_markers(&mut sim, "[]")
        .unwrap_err()
        .contains("lastHour"));
}

/// The live engine's open extend gesture rides with the markers (#990):
/// restored as given on an elevator, dropped on anything else, refused
/// when malformed.
#[test]
fn markers_carry_the_open_extend_gesture() {
    use crate::facilities::Kind;
    let mut sim = Simulation::new_game(1, GameMode::Classic);
    for x in 10..40 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        assert!(sim.tower.place(Kind::Floor, 2, x).ok);
    }
    sim.money = 1_000_000.0;
    assert!(sim.build_transport(Kind::ElevatorStandard, 10, 1, 2).ok);
    let lift = sim.tower.transport_at(1, 10).unwrap().id;
    let base = r#""lastHour":7,"lastDay":0,"lastQuarter":-1,"lastMonth":-1"#;
    let with = |g: &str| format!("{{{base},\"extendGesture\":{g}}}");
    apply_markers(
        &mut sim,
        &with(&format!(r#"{{"id":{lift},"bottom":1,"top":5}}"#)),
    )
    .expect("a gesture lands");
    assert_eq!(sim.extend_gesture, Some((lift, 1, 5)));
    apply_markers(&mut sim, &with("null")).expect("no gesture lands");
    assert_eq!(sim.extend_gesture, None, "null is no gesture");
    apply_markers(
        &mut sim,
        &with(&format!(r#"{{"id":{lift},"bottom":1,"top":5}}"#)),
    )
    .expect("a gesture lands again");
    apply_markers(&mut sim, &format!("{{{base}}}")).expect("an absent gesture lands");
    assert_eq!(sim.extend_gesture, None, "absent is no gesture");
    apply_markers(&mut sim, &with(r#"{"id":99999,"bottom":1,"top":5}"#))
        .expect("a gone shaft is no gesture");
    assert_eq!(sim.extend_gesture, None);
    assert!(
        apply_markers(&mut sim, &with(r#"{"id":1.5,"bottom":1,"top":5}"#))
            .unwrap_err()
            .contains("extendGesture.id")
    );
}

#[test]
fn mode_override_edits_an_object_and_refuses_anything_else() {
    let mut raw = serde_json::json!({ "mode": "classic", "seed": 1 });
    override_mode(&mut raw, "modern").expect("object takes the mode");
    assert_eq!(raw["mode"], "modern");
    assert_eq!(raw["seed"], 1);
    assert!(override_mode(&mut raw, "arcade")
        .unwrap_err()
        .contains("classic or modern"));
    for mut not_a_save in [Value::Null, serde_json::json!([1]), serde_json::json!(3)] {
        assert!(override_mode(&mut not_a_save, "modern")
            .unwrap_err()
            .contains("saved game"));
    }
}
