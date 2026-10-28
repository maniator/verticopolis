use super::*;
use crate::clock::GameMode;
use crate::sim::Simulation;

fn code(kind: Kind) -> f64 {
    FACILITIES.iter().position(|f| f.kind == kind).unwrap() as f64
}

fn engine() -> Engine {
    let mut e = Engine::of(Simulation::new_game(7, GameMode::Modern));
    e.sim.money = 1e9;
    e
}

#[test]
fn a_command_answers_its_record_and_a_refusal_leaves_its_reason() {
    let mut e = engine();
    let done = e.port_build(code(Kind::Lobby), 1.0, 100.0);
    assert_eq!(done[STATUS], 1.0);
    assert!(done[DELTA] < 0.0, "the lobby was paid for: {done:?}");
    assert_eq!(e.last_reason_text(), None);
    let again = e.port_build(code(Kind::Lobby), 1.0, 100.0);
    assert_eq!((again[STATUS], again[DELTA]), (0.0, 0.0));
    assert!(e.last_reason_text().is_some());
    e.port_build(999.0, 1.0, 100.0);
    assert_eq!(e.last_reason_text().as_deref(), Some(UNKNOWN_FACILITY));
    for bad in [1.5, f64::NAN, f64::INFINITY, 1e300] {
        assert_eq!(
            e.port_build(code(Kind::Lobby), bad, 100.0)[STATUS],
            0.0,
            "{bad}"
        );
        assert_eq!(e.last_reason_text().as_deref(), Some(INVALID_REQUEST));
    }
    // Reads leave the text; the next status-producing call clears it.
    e.port_build(999.0, 1.0, 100.0);
    let _ = (
        e.port_hotspot(),
        e.port_onboarding(),
        e.sim.tower_stats_record(),
    );
    assert_eq!(e.last_reason_text().as_deref(), Some(UNKNOWN_FACILITY));
    let [ok, _] = e.port_quote_build(code(Kind::Lobby), 1.0, 300.0);
    assert_eq!(ok, 1.0);
    assert_eq!(e.last_reason_text(), None);
}

#[test]
fn the_brush_answers_the_tiles_laid() {
    let mut e = engine();
    assert_eq!(e.port_build(code(Kind::Lobby), 1.0, 100.0)[STATUS], 1.0);
    let tiles: Vec<f64> = (100..104).map(f64::from).collect();
    let r = e.port_paint(code(Kind::Floor), 2.0, &tiles);
    assert_eq!(r[STATUS], 1.0);
    assert!(r[2] > 0.0);
    let bad = e.port_paint(code(Kind::Floor), 2.0, &[0.5]);
    assert_eq!((bad[STATUS], bad[2]), (0.0, 0.0));
    assert_eq!(e.last_reason_text().as_deref(), Some(INVALID_REQUEST));
}

#[test]
fn the_layout_names_every_record() {
    let mut layout = crate::view::layout_json();
    add_records(&mut layout);
    assert_eq!(
        layout["records"]["extendShaft"],
        serde_json::json!(["status", "delta", "bottom", "top", "added"])
    );
    assert_eq!(
        layout["records"]["statsStrip"].as_array().unwrap().len(),
        crate::panels::stats::TOWER_STATS.len()
    );
    assert_eq!(layout["onboarding"][0], "lobby");
}

#[test]
fn the_strip_record_matches_the_json_readout() {
    let e = engine();
    let rec = e.sim.tower_stats_record();
    let json = e.sim.tower_stats();
    for (name, v) in crate::panels::stats::TOWER_STATS.iter().zip(rec) {
        assert_eq!(json[*name].as_f64(), Some(v), "{name}");
    }
}

#[test]
fn onboarding_packs_the_facts_in_order() {
    let mut e = engine();
    // No fact is +0, the number TypeScript's bits give, never -0.
    assert!(e.port_onboarding() == 0.0 && e.port_onboarding().is_sign_positive());
    assert_eq!(e.port_build(code(Kind::Lobby), 1.0, 100.0)[STATUS], 1.0);
    assert_eq!(e.port_onboarding(), 1.0);
}

#[test]
fn the_camera_takes_a_fractional_zoom_and_nan_for_none() {
    let mut e = engine();
    assert_eq!(e.port_set_camera(10.0, 3.0, 1.5)[STATUS], 1.0);
    assert_eq!(e.sim.view.as_ref().unwrap()["zoom"], 1.5);
    assert_eq!(e.port_set_camera(10.0, 3.0, f64::NAN)[STATUS], 1.0);
    assert!(e.sim.view.as_ref().unwrap().get("zoom").is_none());
    for bad in [0.0, -1.0, f64::INFINITY] {
        assert_eq!(e.port_set_camera(10.0, 3.0, bad)[STATUS], 0.0, "{bad}");
    }
}

#[test]
fn the_editing_commands_answer_records() {
    let mut e = engine();
    let bad_dir = e.port_step_rent(1.0, 2.0);
    assert_eq!(bad_dir[STATUS], 0.0);
    assert!(bad_dir[2].is_nan());
    assert_eq!(e.port_set_rent(1.0, -5.0)[STATUS], 0.0);
    assert_eq!(e.port_label_unit(12345.0, "x")[STATUS], 0.0);
    assert_eq!(e.port_mark_stop(0.5, 1.0, true)[STATUS], 0.0);
    // Nothing is pending on a new tower.
    assert_eq!(e.port_answer_choice(true)[STATUS], 0.0);
    let batch = e.port_rent_batch(code(Kind::Office), f64::NAN, false);
    assert_eq!(batch.len(), 2 + crate::wasm::port_edit::BATCH_SLOTS.len());
    assert_eq!(e.port_rent_batch(999.0, 1.0, false)[STATUS], 0.0);
    let before = e.sim.auto_bridge;
    let flipped = e.port_flip_auto_bridge();
    assert_eq!(flipped[2], f64::from(u8::from(!before)));
    let chosen = e.port_choose_auto_bridge(before);
    assert_eq!(
        (chosen[STATUS], chosen[2]),
        (1.0, f64::from(u8::from(before)))
    );
    assert_eq!(e.port_name_tower(Some("Spire".into()))[STATUS], 1.0);
    assert_eq!(e.sim.tower.tower_name.as_deref(), Some("Spire"));
}

/// A small tower: a lobby and two floors from 150 to 199, an office on 2.
fn built() -> Engine {
    let mut e = engine();
    for x in 150..200 {
        assert!(e.sim.tower.place(Kind::Lobby, 1, x).ok);
        assert!(e.sim.tower.place(Kind::Floor, 2, x).ok);
        assert!(e.sim.tower.place(Kind::Floor, 3, x).ok);
    }
    assert!(e.sim.tower.place(Kind::Office, 2, 160).ok);
    e
}

fn office(e: &Engine) -> f64 {
    e.sim
        .tower
        .units
        .iter()
        .find(|u| u.kind == Kind::Office)
        .unwrap()
        .id as f64
}

/// The exported layout's hash; raise `VIEW_LAYOUT_VERSION` (and append its
/// pin in `view/layout_tests.rs`) in the same commit as any change here.
const EXPORTED_LAYOUT_PIN: &str = "59aebd31288ac82c";

#[test]
fn the_exported_layout_is_pinned() {
    use sha2::{Digest, Sha256};
    let mut v = exported_layout();
    v.as_object_mut().unwrap().shift_remove("names");
    let text = v.to_string();
    let hex: String = Sha256::digest(text.as_bytes())[..8]
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    assert_eq!(v["version"], crate::view::VIEW_LAYOUT_VERSION);
    assert_eq!(
        hex, EXPORTED_LAYOUT_PIN,
        "the exported layout changed: raise VIEW_LAYOUT_VERSION\n{text}"
    );
}

#[test]
fn the_camera_keeps_a_fractional_center() {
    let mut e = engine();
    assert_eq!(e.port_set_camera(123.5, 42.25, 1.7)[STATUS], 1.0);
    let v = e.sim.view.clone().unwrap();
    assert_eq!(
        (v["tile"].as_f64(), v["floor"].as_f64()),
        (Some(123.5), Some(42.25))
    );
    e.port_set_camera(10.0, -2.0, f64::NAN);
    assert_eq!(
        e.sim.view.as_ref().unwrap().to_string(),
        r#"{"tile":10,"floor":-2}"#
    );
    assert_eq!(e.port_set_camera(f64::NAN, 1.0, 1.0)[STATUS], 0.0);
}

#[test]
fn unknown_kinds_are_unknown_facility_everywhere() {
    let mut e = engine();
    assert_eq!(e.port_paint(999.0, 2.0, &[100.0])[STATUS], 0.0);
    assert_eq!(e.last_reason_text().as_deref(), Some(UNKNOWN_FACILITY));
    assert_eq!(e.port_rent_batch(999.0, 1.0, false)[STATUS], 0.0);
    assert_eq!(e.last_reason_text().as_deref(), Some(UNKNOWN_FACILITY));
    let bad = e.port_rent_batch(code(Kind::Office), f64::INFINITY, false);
    assert_eq!(bad[STATUS], 0.0);
    assert_eq!(e.last_reason_text().as_deref(), Some(INVALID_REQUEST));
}

#[test]
fn auto_bridge_follows_the_mode() {
    let mut classic = Engine::of(Simulation::new_game(7, GameMode::Classic));
    let before = classic.sim.auto_bridge;
    let flip = classic.port_flip_auto_bridge();
    assert_eq!((flip[STATUS], flip[2]), (0.0, f64::from(u8::from(before))));
    assert_eq!(classic.port_choose_auto_bridge(!before)[STATUS], 0.0);
    assert_eq!(classic.port_choose_auto_bridge(before)[STATUS], 1.0);
    let mut modern = engine();
    let before = modern.sim.auto_bridge;
    assert_eq!(modern.port_flip_auto_bridge()[STATUS], 1.0);
    assert_eq!(modern.sim.auto_bridge, !before);
}

#[test]
fn rent_commands_answer_the_rent_and_refuse_without_writing() {
    let mut e = built();
    let id = office(&e);
    let up = e.port_step_rent(id, 1.0);
    assert_eq!(up[STATUS], 1.0);
    assert!(up[2].is_finite());
    let set = e.port_set_rent(id, 0.0);
    assert_eq!(set[STATUS], 1.0);
    let before = e.sim.serialize();
    for (dir, target) in [(0.0, -1.0), (f64::NAN, f64::NAN)] {
        assert_eq!(e.port_step_rent(id, dir)[STATUS], 0.0);
        assert_eq!(e.port_set_rent(id, target)[STATUS], 0.0);
    }
    assert_eq!(e.sim.serialize(), before, "a refusal writes nothing");
    let batch = e.port_rent_batch(code(Kind::Office), f64::NAN, false);
    assert_eq!(batch[STATUS], 1.0);
    assert_eq!(batch[2], 1.0, "one office matched: {batch:?}");
    assert_eq!(e.port_no_rate(id + 1000.0)[STATUS], 0.0);
    assert_eq!(e.port_label_unit(id, "HQ")[STATUS], 1.0);
}

#[test]
fn a_shaft_takes_stops_and_the_extend_gesture() {
    let mut e = built();
    let shaft = e.port_build_shaft(code(Kind::ElevatorStandard), 155.0, 1.0, 3.0);
    assert_eq!(shaft[STATUS], 1.0, "{:?}", e.last_reason_text());
    assert!(shaft[DELTA] < 0.0);
    let id = e.sim.tower.transports[0].id as f64;
    assert_eq!(e.port_mark_stop(id, 2.0, false)[STATUS], 1.0);
    assert_eq!(e.port_express_stops(id)[STATUS], 1.0);
    assert_eq!(e.port_drop_stops(id)[STATUS], 1.0);
    assert_eq!(e.port_mark_stop(id + 1000.0, 2.0, true)[STATUS], 0.0);
    let cars = e.port_cars(id, true);
    assert_eq!((cars[STATUS], cars[2]), (1.0, 2.0));
    assert_eq!(e.port_start_extend(id)[STATUS], 1.0);
    assert_eq!(e.port_stop_extend()[STATUS], 1.0);
    assert_eq!(e.port_start_extend(0.5)[STATUS], 0.0);
}
