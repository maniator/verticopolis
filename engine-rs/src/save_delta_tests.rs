//! Tests for `save_delta.rs`: a delta carries exactly the units whose save
//! form moved, and patching it onto the last full save gives the new one.
use super::*;
use crate::canonical::digest;
use crate::snapshot::state_view;

/// A scenario of the lock run up to one of its checkpoints.
fn at(id: &str, label: &str) -> Simulation {
    let suite = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../conformance");
    let text = std::fs::read_to_string(suite.join(format!("scenarios/{id}.json"))).unwrap();
    let s = crate::scenario::Scenario::parse(&text).unwrap();
    crate::scenario::run_scenario_until(&s, &suite, label).unwrap()
}

fn busy() -> Simulation {
    at("hotel-exterminator-modern", "booked")
}

/// The last full save with a delta written over it, as a host applies it.
fn patch(base: &Value, delta: &Value) -> Value {
    let mut out = delta["rest"].as_object().unwrap().clone();
    let mut units = base["units"].as_array().unwrap().clone();
    for changed in delta["units"].as_array().unwrap() {
        let slot = units.iter_mut().find(|u| u["id"] == changed["id"]).unwrap();
        *slot = changed.clone();
    }
    out.insert("units".into(), Value::Array(units));
    Value::Object(out)
}

#[test]
fn an_unprimed_mirror_asks_for_a_full_save() {
    let mut sim = busy();
    let mut m = SaveMirror::default();
    assert!(m.delta(&mut sim).is_none());
}

#[test]
fn the_full_save_is_serialize_byte_for_byte() {
    let sim = busy();
    let mut m = SaveMirror::default();
    assert_eq!(m.full(&sim), sim.serialize().to_string());
}

#[test]
fn a_delta_patched_onto_the_last_save_gives_the_new_one() {
    // Both rule sets: the modern hotel tower and two classic ones.
    for (id, label, hours) in [
        ("hotel-exterminator-modern", "booked", 12),
        ("star-climb-classic", "three-stars", 4),
        ("events-classic", "built", 4),
    ] {
        patched_deltas_give_the_new_save(at(id, label), id, hours);
    }
}

fn patched_deltas_give_the_new_save(mut sim: Simulation, id: &str, hours: usize) {
    let mut m = SaveMirror::default();
    let mut base: Value = serde_json::from_str(&m.full(&sim)).unwrap();
    let mut moved = 0;
    for _ in 0..hours {
        for _ in 0..30 {
            sim.tick(2.0);
        }
        let delta: Value = serde_json::from_str(&m.delta(&mut sim).unwrap()).unwrap();
        let want = sim.serialize();
        let got = patch(&base, &delta);
        assert_eq!(got, want, "{id}");
        let units = want["units"].as_array().unwrap();
        let changed = delta["units"].as_array().unwrap();
        assert!(changed.len() < units.len() || units.is_empty());
        moved += changed.len();
        base = want;
    }
    assert!(
        moved > 0,
        "{id}: {hours} hours of steps moved no unit record"
    );
}

#[test]
fn an_unchanged_tower_sends_no_units() {
    let mut sim = busy();
    let mut m = SaveMirror::default();
    m.full(&sim);
    let delta: Value = serde_json::from_str(&m.delta(&mut sim).unwrap()).unwrap();
    assert_eq!(delta["units"], Value::Array(vec![]));
    assert!(delta["rest"].get("units").is_none());
    assert_eq!(delta["rest"]["transports"], sim.serialize()["transports"]);
}

#[test]
fn a_field_the_save_leaves_out_moves_no_record() {
    let mut sim = busy();
    let mut m = SaveMirror::default();
    m.full(&sim);
    let before = sim.serialize();
    for u in sim.tower.units.iter_mut() {
        u.customers_in = Some(u.customers_in.unwrap_or(0) + 7);
    }
    assert_eq!(sim.serialize(), before, "customersIn is not saved");
    let delta: Value = serde_json::from_str(&m.delta(&mut sim).unwrap()).unwrap();
    assert_eq!(delta["units"], Value::Array(vec![]));
}

#[test]
fn a_delta_leaves_the_simulation_as_it_was() {
    let mut sim = busy();
    let mut m = SaveMirror::default();
    m.full(&sim);
    sim.tick(60.0);
    let before = sim.serialize();
    let hash = digest(&state_view(&sim));
    m.delta(&mut sim).unwrap();
    assert_eq!(sim.serialize(), before);
    assert_eq!(digest(&state_view(&sim)), hash, "the conformance hash");
}

#[test]
fn a_unit_added_or_removed_asks_for_a_full_save_and_clears_the_mirror() {
    let mut sim = busy();
    let mut m = SaveMirror::default();
    m.full(&sim);
    sim.tower.units.pop();
    assert!(m.delta(&mut sim).is_none());
    // Cleared: the next one needs a full save too, even with nothing moved.
    assert!(m.delta(&mut sim).is_none());
    m.full(&sim);
    assert!(m.delta(&mut sim).is_some());
}

#[test]
fn units_in_a_new_order_ask_for_a_full_save() {
    let mut sim = busy();
    let mut m = SaveMirror::default();
    m.full(&sim);
    assert!(sim.tower.units.len() > 1);
    sim.tower.units.swap(0, 1);
    assert!(m.delta(&mut sim).is_none());
}

#[test]
fn clear_forgets_the_mirror() {
    let mut sim = busy();
    let mut m = SaveMirror::default();
    m.full(&sim);
    m.clear();
    assert!(m.delta(&mut sim).is_none());
}
