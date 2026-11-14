//! What a load does with a tampered or foreign save, from the engine half of
//! the retired `storage.integration.test.ts` (its storage half, the slots,
//! compression and files, stays there on the Rust engine). The table in
//! `conformance/loader-cases.json` (replayed by `load::loader_cases`) pins
//! the exact loaded state of many single-field forgeries (`unit-width-*`,
//! `unit-floor-out-of-range`, `unit-duplicate-ids`, `unit-overlap`,
//! `unit-unknown-kind`, `unit-bad-state`, `next-id-zero`, `units-not-array`,
//! `transport-*`); the tests here hold the rules those cases add up to, on a
//! played tower. The unit cap's refusal and its junk filter are
//! `load_stream_tests::the_unit_cap`.
use super::{seeded_game, MID};
use crate::clock::GameMode;
use crate::facilities::{Kind, LOT_WIDTH, MAX_FLOOR, MIN_FLOOR};
use crate::load::deserialize;
use crate::sim::Simulation;
use crate::tower::UnitState;
use serde_json::{json, Value};

/// 2^53: past it a JavaScript number no longer holds every whole number.
const JS_SAFE_INTEGER_LIMIT: i64 = 9_007_199_254_740_992;

pub const X0: i64 = MID - 20;
/// The units the whole lot can hold: two index layers (structure and rooms)
/// over the 375 by 110 lot.
const UNIT_CAP: usize = 82_500;

/// A played tower: floor 2 over part of the lobby, an elevator, an office and
/// five hours of play.
pub fn sample_game() -> Simulation {
    let mut sim = seeded_game(42, GameMode::Classic);
    for x in X0..X0 + 12 {
        sim.tower.place(Kind::Floor, 2, x);
    }
    assert!(sim.build_transport(Kind::ElevatorStandard, X0, 1, 2).ok);
    assert!(sim.build(Kind::Office, 2, X0).ok);
    sim.money = 1_234_567.0;
    sim.tick(60.0 * 5.0);
    sim
}

fn load(save: &Value) -> Simulation {
    deserialize(save).expect("loads")
}

fn ids(sim: &Simulation) -> Vec<i64> {
    let units = sim.tower.units.iter().map(|u| u.id);
    units
        .chain(sim.tower.transports.iter().map(|t| t.id))
        .collect()
}

#[test]
fn non_finite_unit_fields_load_as_safe_values() {
    let mut save = sample_game().serialize();
    save["units"][0]["satisfaction"] = Value::Null;
    save["units"][0]["occupants"] = json!("NaN");
    let u = &load(&save).tower.units[0];
    assert!((0.0..=1.0).contains(&u.satisfaction));
    assert!(u.occupants >= 0, "a count, never NaN");
}

#[test]
fn malformed_entries_drop_and_every_valid_one_survives() {
    let mut save = sample_game().serialize();
    let units = save["units"].as_array().unwrap().len();
    let transports = save["transports"].as_array().unwrap().len();
    let list = save["units"].as_array_mut().unwrap();
    list.insert(0, Value::Null);
    for junk in [json!("junk"), json!(42), json!({})] {
        list.insert(2, junk);
    }
    let shafts = save["transports"].as_array_mut().unwrap();
    shafts.insert(0, Value::Null);
    shafts.push(json!({}));
    let loaded = load(&save);
    assert_eq!(loaded.tower.units.len(), units);
    assert_eq!(loaded.tower.transports.len(), transports);
    // A shaft list that is not a list at all loads as an empty one.
    save["transports"] = json!({ "nope": true });
    let loaded = load(&save);
    assert!(loaded.tower.transports.is_empty());
    // A unit list that is not a list is no tower at all (#1418).
    save["units"] = json!(5);
    assert_eq!(
        deserialize(&save).err().as_deref(),
        Some(crate::load::NOT_A_SAVE_REFUSAL)
    );
}

#[test]
fn forged_geometry_is_clamped_to_the_lot() {
    let mut save = sample_game().serialize();
    save["units"][0]["x"] = json!(-5.5);
    save["units"][0]["floor"] = json!("NaN");
    save["units"][0]["width"] = json!(1e9);
    // A near-edge origin with a wide footprint must not overhang the lot.
    save["units"][1]["x"] = json!(LOT_WIDTH - 1);
    save["units"][1]["width"] = json!(50);
    save["transports"][0]["x"] = json!(1e308);
    save["transports"][0]["top"] = json!(1e9);
    // A bottom at or above the roof must not push the top past it.
    save["transports"][0]["bottom"] = json!(1e9);
    let loaded = load(&save);
    for u in &loaded.tower.units[..2] {
        assert!((0..LOT_WIDTH).contains(&u.x), "x {}", u.x);
        assert!(
            (MIN_FLOOR..=MAX_FLOOR).contains(&u.floor),
            "floor {}",
            u.floor
        );
        assert!(
            u.width >= 1 && u.x + u.width <= LOT_WIDTH,
            "{} wide at {}",
            u.width,
            u.x
        );
    }
    let t = &loaded.tower.transports[0];
    assert!(t.x >= 0 && t.x + t.kind.facility().width <= LOT_WIDTH);
    assert!(t.bottom >= MIN_FLOOR && t.top <= MAX_FLOOR && t.top > t.bottom);
}

#[test]
fn a_narrower_legacy_shaft_keeps_its_width_and_a_forged_one_clamps() {
    // Stored widths below the catalog's are legacy (stairs were 4 wide, the
    // catalog says 8) and survive; a walkway is used because the v5 pass
    // re-widens narrow elevators.
    let mut save = sample_game().serialize();
    let mut stairs = save["transports"][0].clone();
    for (key, value) in [
        ("id", json!(9_001)),
        ("kind", json!("stairs")),
        ("x", json!(5)),
        ("width", json!(4)),
        ("bottom", json!(1)),
        ("top", json!(2)),
        ("cars", json!(0)),
        ("carPositions", json!([])),
        ("carDir", json!([])),
    ] {
        stairs[key] = value;
    }
    save["transports"].as_array_mut().unwrap().push(stairs);
    let loaded = load(&save);
    let kept = loaded
        .tower
        .transports
        .iter()
        .find(|t| t.kind == Kind::Stairs);
    assert_eq!(kept.map(|t| t.width), Some(4));
    // Wider than the catalog is forged, and a width that is not a positive
    // number falls back to the catalog's.
    let catalog = Kind::ElevatorStandard.facility().width;
    for bad in [
        json!(catalog + 3),
        json!("NaN"),
        json!(-4),
        json!(0),
        json!("8"),
    ] {
        let mut save = sample_game().serialize();
        save["transports"][0]["width"] = bad.clone();
        assert_eq!(load(&save).tower.transports[0].width, catalog, "{bad}");
    }
}

#[test]
fn a_forged_state_or_label_loads_as_the_default() {
    let mut save = sample_game().serialize();
    save["units"][0]["state"] = json!("<img src=x onerror=\"x\">");
    save["units"][0]["label"] = json!(42);
    let loaded = load(&save);
    let u = &loaded.tower.units[0];
    assert_eq!(u.state, UnitState::Empty);
    assert_eq!(u.label, u.kind.facility().name);
}

/// A floor tile placed next to the sample's strip, which the rules allow.
fn place_next(sim: &mut Simulation, offset: i64) -> i64 {
    let r = sim.tower.place(Kind::Floor, 2, X0 + 12 + offset);
    assert!(r.ok, "{:?}", r.reason);
    r.unit_id.unwrap()
}

#[test]
fn a_new_placement_never_reuses_a_live_id_after_a_forged_counter() {
    for forged in [json!(1), Value::Null] {
        let mut save = sample_game().serialize();
        save["nextId"] = forged;
        let mut loaded = load(&save);
        let before = ids(&loaded);
        assert!(!before.contains(&place_next(&mut loaded, 0)));
    }
}

#[test]
fn corrupt_ids_are_repaired_to_unique_safe_ones() {
    let mut save = sample_game().serialize();
    save["units"][0]["id"] = json!("NaN");
    save["units"][1]["id"] = save["units"][2]["id"].clone();
    save["units"][3]["id"] = json!(2f64.powi(60));
    save["units"][4]["id"] = json!(-7);
    save["nextId"] = json!(1e308);
    let mut loaded = load(&save);
    let ids = ids(&loaded);
    assert!(
        ids.iter().all(|&id| id > 0 && id < JS_SAFE_INTEGER_LIMIT),
        "{ids:?}"
    );
    let mut unique = ids.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), ids.len());
    let first = place_next(&mut loaded, 0);
    assert!(first < JS_SAFE_INTEGER_LIMIT && !ids.contains(&first));
    assert_ne!(place_next(&mut loaded, 1), first, "the counter still moves");
}

#[test]
fn the_weather_is_recomputed_on_load() {
    let mut sim = sample_game();
    sim.tick(60.0 * 24.0 * 5.0);
    let loaded = load(&sim.serialize());
    assert_eq!(
        loaded.weather,
        crate::sim_loop::weather_for(loaded.clock.day())
    );
    assert_eq!(loaded.weather, sim.weather);
}

#[test]
fn a_later_overlapping_unit_drops_per_layer() {
    let sim = sample_game();
    let mut save = sim.serialize();
    let units = save["units"].as_array().unwrap().clone();
    let office = units
        .iter()
        .find(|u| u["kind"] == "office")
        .unwrap()
        .clone();
    let tile = units.iter().find(|u| u["kind"] == "floor").unwrap().clone();
    let (floor, x) = (
        office["floor"].as_i64().unwrap(),
        office["x"].as_i64().unwrap(),
    );
    let mut twin = office.clone();
    twin["id"] = json!(999_001);
    let mut shifted = office.clone();
    shifted["id"] = json!(999_002);
    shifted["x"] = json!(x + 1);
    let mut tile_twin = tile;
    tile_twin["id"] = json!(999_003);
    save["units"]
        .as_array_mut()
        .unwrap()
        .extend([twin, shifted, tile_twin]);
    let loaded = load(&save);
    assert_eq!(loaded.tower.units.len(), sim.tower.units.len());
    assert_eq!(
        loaded.tower.room_at(floor, x).map(|u| u.id),
        office["id"].as_i64()
    );
    assert!(
        loaded.tower.has_structure(floor, x),
        "the office sits on its floor"
    );
    let again = load(&loaded.serialize());
    assert_eq!(again.tower.units.len(), loaded.tower.units.len());
}

#[test]
fn a_save_at_the_unit_cap_loads_to_a_consistent_tower() {
    let mut save = sample_game().serialize();
    let first = save["units"][0].clone();
    // Over the cap is refused before any unit is built.
    save["units"] = Value::Array(vec![json!({ "kind": "office" }); UNIT_CAP + 1]);
    let refused = deserialize(&save).err().expect("refused");
    assert!(format!("{refused:?}").contains("cannot be a real tower"));
    // Junk does not count: three real entries padded with nulls still load.
    let mut padded = vec![first.clone(); 3];
    padded.extend(std::iter::repeat_n(Value::Null, UNIT_CAP));
    save["units"] = Value::Array(padded);
    assert!(!load(&save).tower.units.is_empty());
    // At the cap the overlap pass keeps the first of identical entries.
    save["units"] = Value::Array(vec![first; UNIT_CAP]);
    assert_eq!(load(&save).tower.units.len(), 1);
}
