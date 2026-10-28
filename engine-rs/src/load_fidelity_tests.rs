//! A save at random state 0 reloads at state 0 (#856), and hand-edited saves
//! load as the TypeScript loader loads them (#858). Mirrors
//! `src/engine/rng.test.ts` and `src/engine/sim/loaderFidelity.test.ts`; the
//! cross-engine half is the loader table (`conformance/loader-cases.json`).
//! Each current save also goes through the streamed reader (#1225), which
//! `Engine.fromSave` loads through, so every narrowing holds there too.
use crate::clock::{CalendarKind, GameMode};
use crate::facilities::Kind;
use crate::load::{
    deserialize, floating_structure_count, migration_looks_valid, parse_save_json, reflow_v1_to_v2,
};
use crate::load_stream::{load_save_text, read_save};
use crate::rng::Rng;
use crate::sim::{Simulation, SAVE_VERSION};
use serde_json::{json, Value};

/// A seed one draw before state 0: Mulberry32 adds 0x6d2b79f5 per draw.
const ONE_BEFORE_ZERO: u32 = 0u32.wrapping_sub(0x6d2b_79f5);
const MAX_SAFE: f64 = 9_007_199_254_740_991.0;

fn draws(rng: &mut Rng, n: usize) -> Vec<f64> {
    (0..n).map(|_| rng.next()).collect()
}

/// A small Modern tower: two offices, a condo, one elevator.
fn tower() -> Simulation {
    let mut sim = Simulation::new(7, GameMode::Modern, CalendarKind::RealWorld, false);
    sim.money = 1e8;
    for x in 170..192 {
        assert!(sim.build(Kind::Lobby, 1, x).ok);
    }
    for fl in 2..=3 {
        for x in 171..191 {
            assert!(sim.build(Kind::Floor, fl, x).ok);
        }
    }
    assert!(sim.build(Kind::Office, 2, 172).ok);
    assert!(sim.build(Kind::Office, 2, 181).ok);
    assert!(sim.build(Kind::Condo, 3, 172).ok);
    assert!(sim.build_transport(Kind::ElevatorStandard, 171, 1, 3).ok);
    sim
}

/// The streamed reader's game for a save it must take.
fn streamed(save: &Value) -> Simulation {
    let (sim, took) = read_save(save.to_string().as_bytes()).expect("the save streams");
    assert!(took, "the streamed reader declined a current save");
    sim
}

/// Whether the streamed reader takes the save: the current version and a
/// game mode, both written before `units` (every save edited here but the
/// pre-mode condo's). `is_current` in `load_stream_tests.rs` (private to the
/// reader) also checks the unit cap, which no save here comes near.
fn is_current(save: &Value) -> bool {
    let Some(top) = save.as_object() else {
        return false;
    };
    let at = |key: &str| top.keys().position(|k| k == key);
    let units = at("units").unwrap_or(usize::MAX);
    let before_units = |key: &str| at(key).is_some_and(|i| i < units);
    save["version"].as_f64() == Some(SAVE_VERSION as f64)
        && matches!(save["mode"].as_str(), Some("classic" | "modern"))
        && before_units("version")
        && before_units("mode")
}

/// `deserialize`, checked against the streamed reader, which must take the
/// save exactly when it is current.
fn load(save: &Value) -> Simulation {
    let sim = deserialize(save).expect("the save loads");
    let current = is_current(save);
    let (fast, took) = read_save(save.to_string().as_bytes()).expect("the save streams");
    assert_eq!(took, current, "the streamed reader's choice");
    assert_eq!(fast.serialize(), sim.serialize(), "the two readers differ");
    sim
}

fn edited(edit: impl FnOnce(&mut Value)) -> Simulation {
    let mut save = tower().serialize();
    edit(&mut save);
    load(&save)
}

fn office(save: &mut Value) -> &mut Value {
    save["units"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|u| u["kind"] == "office")
        .unwrap()
}

#[test]
fn a_save_at_state_zero_continues_the_uninterrupted_main_stream() {
    let mut sim = tower();
    sim.rng.restore(ONE_BEFORE_ZERO);
    sim.rng.next();
    let save = sim.serialize();
    assert_eq!(save["seed"], json!(0));
    let want = draws(&mut sim.rng.clone(), 4);
    for mut loaded in [deserialize(&save).unwrap(), streamed(&save)] {
        assert_eq!(loaded.rng.seed(), 0);
        assert_eq!(loaded.rng.initial_seed, sim.rng.initial_seed);
        assert_eq!(draws(&mut loaded.rng, 4), want);
    }
}

#[test]
fn a_save_at_state_zero_continues_the_uninterrupted_event_stream() {
    let mut sim = tower();
    sim.events.extra.restore(ONE_BEFORE_ZERO);
    sim.events.extra.next();
    let save = sim.serialize();
    assert_eq!(save["events"]["rngState"], json!(0));
    let want = draws(&mut sim.events.extra, 4);
    for mut loaded in [deserialize(&save).unwrap(), streamed(&save)] {
        assert_eq!(loaded.events.extra.seed(), 0);
        assert_eq!(draws(&mut loaded.events.extra, 4), want);
    }
}

#[test]
fn a_new_game_seeded_zero_still_starts_at_state_one() {
    let sim = Simulation::new(0, GameMode::Modern, CalendarKind::RealWorld, false);
    assert_eq!(sim.rng.seed(), 1);
    assert_eq!(sim.serialize()["seed"], json!(1));
}

#[test]
fn a_missing_or_non_number_seed_loads_as_before_and_a_number_is_restored() {
    let seed_of = |seed: Option<Value>| {
        edited(|s| match seed {
            Some(v) => s["seed"] = v,
            None => {
                s.as_object_mut().unwrap().remove("seed");
            }
        })
        .rng
        .seed()
    };
    assert_eq!(seed_of(None), 12345);
    assert_eq!(seed_of(Some(Value::Null)), 1);
    assert_eq!(seed_of(Some(json!("0x10"))), 16);
    assert_eq!(seed_of(Some(json!("abc"))), 1);
    // A string is no saved state, so "0" goes through the constructor's guard.
    assert_eq!(seed_of(Some(json!("0"))), 1);
    assert_eq!(seed_of(Some(json!(0))), 0);
    assert_eq!(seed_of(Some(json!(4294967296.0))), 0);
    assert_eq!(seed_of(Some(json!(12345.75))), 12345);
}

#[test]
fn saved_whole_numbers_clamp_to_the_safe_integers() {
    let sim = edited(|s| office(s)["occupants"] = json!(1e300));
    let o = sim
        .tower
        .units
        .iter()
        .find(|u| u.kind == Kind::Office)
        .unwrap();
    assert_eq!(o.occupants, MAX_SAFE as i64);
    let load_of = |v: Value| edited(|s| s["transports"][0]["load"] = v).tower.transports[0].load;
    assert_eq!(load_of(json!(1e300)), MAX_SAFE as i64);
    assert_eq!(load_of(json!(-1e300)), -(MAX_SAFE as i64));
    assert_eq!(load_of(json!(2.5)), 2);
    assert_eq!(load_of(json!("x")), 0);
    assert_eq!(load_of(Value::Null), 0);
    let absent = edited(|s| {
        s["transports"][0].as_object_mut().unwrap().remove("load");
    });
    assert_eq!(absent.tower.transports[0].load, 0);
    let nag = edited(|s| s["lastVipNagDay"] = json!(-1e300));
    assert_eq!(nag.last_vip_nag_day, -(MAX_SAFE as i64));
    // Floored, as the TypeScript reads it; truncation would give -3.
    let nag = edited(|s| s["lastVipNagDay"] = json!(-3.5));
    assert_eq!(nag.last_vip_nag_day, -4);
    let late = edited(|s| s["minutes"] = json!(1e23));
    assert_eq!(late.clock.minutes, MAX_SAFE);
}

#[test]
fn flags_and_the_name_read_only_their_own_type() {
    let sim = edited(|s| {
        s["builtWeddingHall"] = json!("yes");
        s["evaluatedTower"] = json!(0);
        s["vipFavorable"] = json!("yes");
        s["towerName"] = json!({});
    });
    assert_eq!(sim.tower.built_wedding_hall, Some(false));
    assert_eq!(sim.evaluated_tower, Some(false));
    assert!(!sim.vip_favorable);
    assert_eq!(sim.tower.tower_name.as_deref(), Some(""));
    let sim = edited(|s| {
        s["builtWeddingHall"] = json!(0);
        s["evaluatedTower"] = json!("yes");
        s["vipFavorable"] = json!(0);
    });
    assert_eq!(sim.tower.built_wedding_hall, Some(false));
    assert_eq!(sim.evaluated_tower, Some(false));
    assert!(!sim.vip_favorable);
    assert!(edited(|s| s["vipFavorable"] = json!(true)).vip_favorable);
}

#[test]
fn a_negative_fraction_of_occupants_reads_as_zero() {
    let sim = edited(|s| office(s)["occupants"] = json!(-0.5));
    let o = sim.tower.units.iter().find(|u| u.kind == Kind::Office);
    assert_eq!(o.unwrap().occupants, 0);
}

#[test]
fn a_pre_mode_condo_with_a_non_string_state_gets_no_legacy_sold_price() {
    let condo_rent = |state: Value| {
        let sim = edited(|s| {
            s.as_object_mut().unwrap().remove("mode");
            let units = s["units"].as_array_mut().unwrap();
            let condo = units.iter_mut().find(|u| u["kind"] == "condo").unwrap();
            condo["everOccupied"] = json!(true);
            condo["state"] = state;
            condo.as_object_mut().unwrap().remove("rent");
        });
        sim.tower
            .units
            .iter()
            .find(|u| u.kind == Kind::Condo)
            .unwrap()
            .rent
    };
    // A non-string state loads like "empty"; a sold condo is the control.
    let unsold = condo_rent(json!("empty"));
    assert_ne!(condo_rent(json!("occupied")), unsold);
    assert_eq!(condo_rent(json!(5)), unsold);
    assert_eq!(condo_rent(json!({})), unsold);
}

#[test]
fn a_car_direction_reads_as_minus_one_zero_or_one() {
    let dir_of = |v: Value| {
        edited(|s| s["transports"][0]["carDir"] = json!([v]))
            .tower
            .transports[0]
            .car_dir
            .clone()
    };
    assert_eq!(dir_of(json!(0.5)), vec![0]);
    assert_eq!(dir_of(json!(-0.5)), vec![0]);
    assert_eq!(dir_of(json!(2.5)), vec![1]);
    assert_eq!(dir_of(json!(-1e300)), vec![-1]);
    assert_eq!(dir_of(json!(1e300)), vec![1]);
}

/// The tower's save at version 1, edited, for the v1 to v5 checks.
fn v1(edit: impl FnOnce(&mut Value)) -> Value {
    let mut save = tower().serialize();
    edit(&mut save);
    save["version"] = json!(1);
    save
}

fn office_indexes(save: &Value) -> Vec<usize> {
    let units = save["units"].as_array().unwrap();
    (0..units.len())
        .filter(|&i| units[i]["kind"] == "office")
        .collect()
}

/// The second office moved one column into the first.
fn overlap(save: &mut Value) {
    let o = office_indexes(save);
    let x = save["units"][o[0]]["x"].as_f64().unwrap();
    save["units"][o[1]]["x"] = json!(x + 1.0);
}

#[test]
fn a_room_width_that_is_not_a_number_takes_the_catalog_width() {
    // The second office moved 3 columns left of the first: 1 wide it ends
    // before the first, 9 wide (the catalog's) it overlaps it.
    let left = |width: Value| {
        v1(|s| {
            let o = office_indexes(s);
            let x = s["units"][o[0]]["x"].as_f64().unwrap();
            s["units"][o[1]]["x"] = json!(x - 3.0);
            s["units"][o[1]]["width"] = width;
        })
    };
    assert!(migration_looks_valid(&left(json!(1))));
    assert!(!migration_looks_valid(&left(json!(9))));
    assert!(!migration_looks_valid(&left(json!("abc"))));
}

#[test]
fn the_v1_checks_skip_a_nan_column_and_a_far_floor() {
    assert!(!migration_looks_valid(&v1(overlap)));
    // Sorted between the two, the NaN room would hide their overlap.
    let between = v1(|s| {
        overlap(s);
        let first = office_indexes(s)[0];
        let mut nan = s["units"][first].clone();
        nan["id"] = json!(9003);
        nan["x"] = json!("abc");
        s["units"].as_array_mut().unwrap().insert(first + 1, nan);
    });
    assert!(!migration_looks_valid(&between));
    // Found below FAR_COORD (2^52), skipped at it.
    let overlap_at = |floor: f64| {
        v1(|s| {
            overlap(s);
            for i in office_indexes(s) {
                s["units"][i]["floor"] = json!(floor);
            }
        })
    };
    assert!(!migration_looks_valid(&overlap_at(4_503_599_627_370_495.0)));
    assert!(migration_looks_valid(&overlap_at(4_503_599_627_370_496.0)));
}

#[test]
fn the_reflow_pads_from_a_floored_next_id_only_on_the_lot() {
    let floor4_ids = |out: &Value| -> Vec<Value> {
        out["units"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|u| u["kind"] == "floor" && u["floor"] == 4)
            .map(|u| u["id"].clone())
            .collect()
    };
    let moved = |s: &mut Value| {
        let second = office_indexes(s)[1];
        s["units"][second]["floor"] = json!(4);
    };
    let whole = reflow_v1_to_v2(&v1(moved));
    let fractional = reflow_v1_to_v2(&v1(|s| {
        moved(s);
        s["nextId"] = json!(s["nextId"].as_f64().unwrap() + 100.5);
    }));
    let shifted: Vec<Value> = floor4_ids(&whole)
        .iter()
        .map(|id| json!(id.as_i64().unwrap() + 100))
        .collect();
    assert!(!shifted.is_empty());
    assert_eq!(floor4_ids(&fractional), shifted);
    assert_eq!(fractional["nextId"].as_f64().unwrap().fract(), 0.0);
    // A footprint kept far off the lot paves nothing, so the reflow ends.
    let plain = v1(|_| {});
    let off_lot = reflow_v1_to_v2(&v1(|s| {
        let first = office_indexes(s)[0];
        s["units"][first]["x"] = json!(400);
        s["units"][first]["width"] = json!(1e9);
    }));
    assert_eq!(
        off_lot["units"].as_array().unwrap().len(),
        plain["units"].as_array().unwrap().len()
    );
    // A room column at -FAR_COORD is left out of the reflow, as it was saved
    // (a far column on the other side would pave nothing either way).
    let far = reflow_v1_to_v2(&v1(|s| {
        let first = office_indexes(s)[0];
        s["units"][first]["x"] = json!(-4_503_599_627_370_496.0);
    }));
    assert!(far["units"]
        .as_array()
        .unwrap()
        .iter()
        .any(|u| u["kind"] == "office" && u["x"].as_f64() == Some(-4_503_599_627_370_496.0)));
}

/// The tower at version 1 with its last floor-2 tile (x = 190, over the
/// lobby's last two columns) set to `width`.
fn edge_width(width: Value) -> Value {
    v1(|s| {
        let tile = s["units"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|u| u["kind"] == "floor" && u["floor"] == 2 && u["x"] == 190)
            .unwrap();
        tile["width"] = width;
    })
}

#[test]
fn a_structure_tile_far_wider_than_the_lot_counts_as_the_lot() {
    let plain = floating_structure_count(&v1(|_| {}));
    // Capped at the lot's 375 columns, two of them over the lobby; uncapped,
    // the count would be 1e8 - 2.
    assert_eq!(
        floating_structure_count(&edge_width(json!(1e8))),
        plain + 373
    );
    // The ground floor is never counted, so the lobby only has to end.
    let wide = v1(|s| {
        let lobby = s["units"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|u| u["kind"] == "lobby")
            .unwrap();
        lobby["width"] = json!(1e8);
    });
    assert_eq!(floating_structure_count(&wide), plain);
    assert!(deserialize(&wide).is_ok());
}

#[test]
fn a_structure_width_that_is_not_a_number_counts_as_one() {
    let plain = floating_structure_count(&v1(|_| {}));
    // Read as 4 wide, the last floor-2 tile would hang two columns past the
    // lobby.
    assert_eq!(floating_structure_count(&edge_width(json!(4))), plain + 2);
    assert_eq!(floating_structure_count(&edge_width(json!("4"))), plain);
}

#[test]
fn string_tile_floors_read_as_numbers() {
    let plain = floating_structure_count(&v1(|_| {}));
    // As `Number(" 2 ")` reads them; left as text, the floor-3 tiles would
    // float over " 2 ", and tiles at "1" would not be on the ground.
    let all_at = |floor: i64, text: &str| {
        v1(|s| {
            for u in s["units"].as_array_mut().unwrap() {
                if (u["kind"] == "floor" || u["kind"] == "lobby") && u["floor"] == floor {
                    u["floor"] = json!(text);
                }
            }
        })
    };
    assert_eq!(floating_structure_count(&all_at(2, " 2 ")), plain);
    assert_eq!(floating_structure_count(&all_at(1, "1")), plain);
}

#[test]
fn a_null_save_is_refused_as_the_typescript_refuses_it() {
    let refused = deserialize(&Value::Null).err().expect("null is refused");
    assert!(refused.contains("null"), "{refused}");
    // The binding's reader gives the same refusal.
    assert_eq!(load_save_text(b"null").err(), Some(refused));
    // Every other top-level value still loads, as it does in TypeScript.
    for other in [json!(5), json!([]), json!("abc")] {
        assert!(deserialize(&other).is_ok());
        assert!(load_save_text(other.to_string().as_bytes()).is_ok());
    }
}

#[test]
fn a_pending_message_that_is_not_a_string_reads_as_none() {
    let message_of = |m: Value| {
        let sim = edited(|s| {
            s["events"]["pending"] = json!({"kind": "bombThreat", "cost": 300000, "message": m});
        });
        sim.serialize()["events"]["pending"]["message"].clone()
    };
    assert_eq!(
        message_of(json!("Call the police?")),
        json!("Call the police?")
    );
    for m in [json!([1, 2]), json!(1e21), json!(5), Value::Null] {
        assert_eq!(message_of(m), json!(""));
    }
}

/// EX-3 (proposed): a number literal past the double range fails the JSON
/// parse here, where `JSON.parse` reads it as Infinity. A change in either
/// direction flips this test and the register entry has to be rewritten.
#[test]
fn a_number_past_the_double_range_is_refused_ex3() {
    assert!(parse_save_json(br#"{"money":1e400}"#).is_err());
    assert!(parse_save_json(br#"{"money":-1e400}"#).is_err());
    assert!(parse_save_json(br#"{"money":1e308}"#).is_ok());
}
