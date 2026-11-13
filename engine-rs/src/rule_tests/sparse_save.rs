//! The sparse unit save: a unit writes only the fields that differ from what
//! the loader restores, rooms always keep their width, a sparse save loads to
//! the same state as its full-shape twin, the No Rate flag and the quarter's
//! money snapshot cross the save (Classic only for No Rate, forged values
//! hardened), a forged wide floor tile clamps while a room keeps its width,
//! and the real towerone_6 tower saves in under half its full-shape size.
//!
//! The save text against the TypeScript writer is pinned by
//! `sim_save_tests::{engine_games_write_the_trees_text, fixture_towers_write_the_trees_text}`;
//! non-numeric widths by `load_fidelity_tests::{a_room_width_that_is_not_a_number_takes_the_catalog_width,
//! a_structure_width_that_is_not_a_number_counts_as_one}`.
use serde_json::{json, Map, Value};

use crate::clock::GameMode;
use crate::facilities::{Kind, LOT_WIDTH};
use crate::load::deserialize;
use crate::sim::{Simulation, PLAIN_SAVE_VERSION};
use crate::tower::UnitState;

use super::fixture_save;

fn place(sim: &mut Simulation, kind: Kind, floor: i64, x: i64) -> i64 {
    let r = sim.tower.place(kind, floor, x);
    assert!(r.ok, "{kind:?} at {floor}/{x}: {:?}", r.reason);
    r.unit_id.unwrap()
}

/// A Modern tower with a unit on every omit branch: a plain tile, a leased
/// office with every field set, a sold condo with a household, and a fast
/// food site under construction.
fn sample() -> Simulation {
    let mut sim = Simulation::new_game(7, GameMode::Modern);
    sim.money = 1e9;
    for i in 0..56 {
        place(&mut sim, Kind::Lobby, 1, 167 + i);
    }
    for i in 0..56 {
        place(&mut sim, Kind::Floor, 2, 167 + i);
    }
    let office = place(&mut sim, Kind::Office, 2, 168);
    let u = sim.tower.get_unit_mut(office).unwrap();
    (u.state, u.label, u.satisfaction, u.occupants) =
        (UnitState::Occupied, "Acme Corp".into(), 0.62, 6);
    (u.ever_occupied, u.pending_income, u.rent) = (true, 1234.0, Some(9000.0));
    u.extras_mut().vacate_reason = Some("rent");
    u.extras_mut().vacate_at = Some(4321.0);
    let condo = place(&mut sim, Kind::Condo, 2, 177);
    let u = sim.tower.get_unit_mut(condo).unwrap();
    (u.state, u.ever_occupied, u.rent, u.residents) =
        (UnitState::Occupied, true, Some(150_000.0), Some(4));
    let site = place(&mut sim, Kind::FastFood, 2, 194);
    let u = sim.tower.get_unit_mut(site).unwrap();
    u.state = UnitState::Construction;
    u.extras_mut().complete_at = Some(999.0);
    sim
}

fn unit_of<'a>(save: &'a Value, kind: &str) -> &'a Map<String, Value> {
    let units = save["units"].as_array().unwrap();
    units
        .iter()
        .find(|u| u["kind"] == kind)
        .unwrap()
        .as_object()
        .unwrap()
}

/// The full unit shape: the loader's fallbacks under the saved fields.
fn materialize(u: &Value) -> Value {
    let kind = Kind::parse(u["kind"].as_str().unwrap()).unwrap();
    let f = kind.facility();
    let mut full = json!({
        "width": f.width, "state": "empty", "satisfaction": 1, "occupants": 0,
        "everOccupied": false, "pendingIncome": 0, "label": f.name,
    });
    for (k, v) in u.as_object().unwrap() {
        full[k] = v.clone();
    }
    full
}

fn reload(save: &Value) -> Simulation {
    deserialize(save).expect("the save loads")
}

#[test]
fn a_plain_floor_tile_writes_only_its_place() {
    let save = sample().serialize();
    let mut keys: Vec<&String> = unit_of(&save, "floor").keys().collect();
    keys.sort();
    assert_eq!(keys, ["floor", "id", "kind", "x"]);
    // The omitted width rests on these catalog widths.
    assert_eq!(Kind::Floor.facility().width, 1);
    assert_eq!(Kind::Lobby.facility().width, 1);
}

#[test]
fn a_room_keeps_its_width_and_every_field_it_sets() {
    let save = sample().serialize();
    let office = unit_of(&save, "office");
    assert_eq!(office["width"], Kind::Office.facility().width);
    for (k, v) in [
        ("state", json!("occupied")),
        ("label", json!("Acme Corp")),
        ("satisfaction", json!(0.62)),
        ("occupants", json!(6)),
        ("everOccupied", json!(true)),
        ("pendingIncome", json!(1234.0)),
        ("rent", json!(9000.0)),
        ("vacateReason", json!("rent")),
        ("vacateAt", json!(4321.0)),
    ] {
        assert_eq!(office.get(k), Some(&v), "{k}");
    }
    let condo = unit_of(&save, "condo");
    assert_eq!(
        (&condo["rent"], &condo["residents"]),
        (&json!(150_000.0), &json!(4))
    );
    let site = unit_of(&save, "fastFood");
    assert_eq!(
        (&site["state"], &site["completeAt"]),
        (&json!("construction"), &json!(999.0))
    );
}

#[test]
fn a_sparse_save_loads_as_its_full_shape_twin_and_round_trips() {
    let sparse = sample().serialize();
    let mut full = sparse.clone();
    full["units"] = Value::Array(
        sparse["units"]
            .as_array()
            .unwrap()
            .iter()
            .map(materialize)
            .collect(),
    );
    let (a, b) = (reload(&sparse), reload(&full));
    assert_eq!(a.serialize(), b.serialize());
    assert_eq!(
        format!("{:?}", a.tower.units),
        format!("{:?}", b.tower.units)
    );
    assert_eq!(a.serialize(), sparse, "save, load, save is stable");
}

#[test]
fn an_all_default_room_writes_only_its_place_and_width() {
    let mut sim = sample();
    let id = sim
        .tower
        .units
        .iter()
        .find(|u| u.kind == Kind::Office)
        .unwrap()
        .id;
    let u = sim.tower.get_unit_mut(id).unwrap();
    (u.state, u.satisfaction, u.occupants, u.ever_occupied) = (UnitState::Empty, 1.0, 0, false);
    (u.pending_income, u.rent, u.label) = (0.0, None, Kind::Office.facility().name.into());
    u.extras = None;
    let written = sim.tower.get_unit(id).unwrap().serialize();
    let width = Kind::Office.facility().width;
    assert_eq!(
        written,
        json!({ "id": id, "kind": "office", "floor": 2, "x": 168, "width": width })
    );
    let restored = reload(&sim.serialize());
    assert_eq!(restored.tower.get_unit(id).unwrap().serialize(), written);
}

#[test]
fn a_save_without_no_rate_or_the_quarter_snapshot_loads_on_market_at_zero() {
    let save = sample().serialize();
    let mut legacy = save.clone();
    legacy.as_object_mut().unwrap().remove("lastQuarterMoney");
    for u in legacy["units"].as_array_mut().unwrap() {
        u.as_object_mut().unwrap().remove("noRate");
    }
    let sim = reload(&legacy);
    assert!(sim.tower.units.iter().all(|u| !u.no_rate));
    let round = sim.serialize();
    assert_eq!(round["lastQuarterMoney"], 0.0);
    assert_eq!(round, reload(&save).serialize());
}

/// A served Classic office on floor 2.
fn classic_office() -> (Simulation, i64) {
    let mut sim = Simulation::new_game(1, GameMode::Classic);
    sim.money = 1e9;
    let (w, x0) = (Kind::Office.facility().width, 200);
    for x in 0..LOT_WIDTH {
        sim.tower.place(Kind::Lobby, 1, x);
    }
    for i in 0..w + 2 {
        place(&mut sim, Kind::Floor, 2, x0 + i);
    }
    assert!(sim.build_transport(Kind::ElevatorStandard, x0, 1, 2).ok);
    let id = place(&mut sim, Kind::Office, 2, x0);
    (sim, id)
}

fn office_entry(save: &mut Value, id: i64) -> &mut Value {
    let units = save["units"].as_array_mut().unwrap();
    units.iter_mut().find(|u| u["id"] == id).unwrap()
}

#[test]
fn classic_no_rate_and_the_quarter_snapshot_cross_the_save() {
    let (mut sim, id) = classic_office();
    sim.tower.get_unit_mut(id).unwrap().no_rate = true;
    let mut save = sim.serialize();
    save["lastQuarterMoney"] = json!(1_750_000);
    let round = reload(&save).serialize();
    assert_eq!(round["lastQuarterMoney"], 1_750_000.0);
    assert_eq!(unit_of(&round, "office")["noRate"], true);
}

#[test]
fn forged_no_rate_and_quarter_snapshot_values_are_hardened() {
    let (sim, id) = classic_office();
    let mut save = sim.serialize();
    save["lastQuarterMoney"] = json!("not a number");
    office_entry(&mut save, id)["noRate"] = json!("no");
    let round = reload(&save).serialize();
    assert_eq!(round["lastQuarterMoney"], 0.0);
    assert!(
        unit_of(&round, "office").get("noRate").is_none(),
        "only true counts"
    );
    // Modern never holds the state.
    let mut modern = sample().serialize();
    let office = modern["units"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|u| u["kind"] == "office")
        .unwrap();
    office["noRate"] = json!(true);
    assert!(unit_of(&reload(&modern).serialize(), "office")
        .get("noRate")
        .is_none());
}

#[test]
fn a_forged_wide_floor_tile_clamps_and_a_room_keeps_its_width() {
    let (sim, id) = classic_office();
    let mut save = sim.serialize();
    let tile = save["units"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|u| u["kind"] == "floor")
        .unwrap();
    tile["width"] = json!(4);
    let (floor, x) = (tile["floor"].as_i64().unwrap(), tile["x"].as_i64().unwrap());
    let wide = Kind::Office.facility().width + 2;
    office_entry(&mut save, id)["width"] = json!(wide);
    let loaded = reload(&save);
    let tile = loaded
        .tower
        .units
        .iter()
        .find(|u| u.kind == Kind::Floor && u.floor == floor && u.x == x);
    assert_eq!(tile.unwrap().width, 1);
    assert_eq!(loaded.tower.get_unit(id).unwrap().width, wide);
}

#[test]
fn the_real_towerone_6_tower_saves_under_half_its_full_shape() {
    let sim = reload(&fixture_save("towerone_6"));
    let sparse = sim.serialize();
    assert_eq!(sparse["version"], PLAIN_SAVE_VERSION);
    let mut full = sparse.clone();
    full["units"] = Value::Array(
        sparse["units"]
            .as_array()
            .unwrap()
            .iter()
            .map(materialize)
            .collect(),
    );
    let (sparse_len, full_len) = (sparse.to_string().len(), full.to_string().len());
    assert!(sparse_len * 2 < full_len, "{sparse_len} against {full_len}");
    let reloaded = reload(&sparse);
    assert_eq!(reloaded.serialize(), sparse);
    assert_eq!(reloaded.population(), sim.population());
    assert_eq!(reloaded.money, sim.money);
    assert_eq!(
        reloaded.tower.functional_parking_spots(),
        sim.tower.functional_parking_spots()
    );
}
