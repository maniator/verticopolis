//! The crowd through a save and a load (`crowd::save`).

use std::collections::BTreeMap;

use serde_json::{json, Value};

use crate::clock::GameMode;
use crate::crowd::PState;
use crate::load::inflate_vctower;
use crate::load_stream::load_save_text;
use crate::sim::Simulation;
use crate::snapshot::state_view;

/// The conformance fixture towers, as save text.
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
            let name = p.file_name().unwrap().to_string_lossy().into_owned();
            (name, text)
        })
        .collect()
}

/// A fixture played on until its crowd is busy: to the next weekday noon,
/// then a little past it, so people are out on every kind of trip.
fn busy(text: &str) -> Simulation {
    let mut sim = load_save_text(text.as_bytes()).unwrap();
    for _ in 0..(24 * 30) {
        if sim.clock.hour() == 12 && !sim.clock.is_weekend() {
            break;
        }
        sim.tick(2.0);
    }
    for _ in 0..10 {
        sim.tick(2.0);
    }
    sim
}

/// What the tower keeps about its people, per room: visitors inside, hotel
/// guests among them, tenants out for a meal, and the head count.
fn room_counts(sim: &Simulation) -> BTreeMap<i64, (i64, i64, i64, i64)> {
    sim.tower
        .units
        .iter()
        .map(|u| {
            let counts = (
                u.customers_in.unwrap_or(0),
                u.hotel_customers_in.unwrap_or(0),
                u.out_for_meal.unwrap_or(0),
                u.occupants,
            );
            (u.id, counts)
        })
        .filter(|(_, c)| *c != (0, 0, 0, 0))
        .collect()
}

/// What the crowd keeps about its people beside the list.
fn crowd_tallies(sim: &Simulation) -> Value {
    let mut riders: Vec<_> = sim
        .crowd
        .car_riders
        .sorted()
        .into_iter()
        .filter(|(_, &n)| n != 0)
        .map(|(k, n)| (*k, *n))
        .collect();
    riders.sort();
    let mut crews: Vec<_> = sim
        .crowd
        .crew_roster
        .iter()
        .map(|(k, n)| (*k, *n))
        .collect();
    crews.sort();
    json!({
        "riders": riders,
        "crews": crews,
        "staff": sim.crowd.staff_count,
        "walkIns": sim.crowd.walk_in_count,
        "booked": sim.crowd.walk_ins.len(),
        "held": sim
            .tower
            .units
            .iter()
            .filter_map(|u| sim.housekeeping.room_holder(u.id).map(|held| (u.id, held)))
            .collect::<Vec<_>>(),
        "commute": sim.crowd.commute_stress_json(),
        "frustration": sim.crowd.frustration,
        "spawnAcc": sim.crowd.spawn_acc,
    })
}

/// The first place two JSON trees differ, as a path and the two values.
fn first_difference(a: &Value, b: &Value, path: &str) -> Option<String> {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            for k in x.keys().chain(y.keys()) {
                let (va, vb) = (
                    x.get(k).unwrap_or(&Value::Null),
                    y.get(k).unwrap_or(&Value::Null),
                );
                if let Some(d) = first_difference(va, vb, &format!("{path}.{k}")) {
                    return Some(d);
                }
            }
            None
        }
        (Value::Array(x), Value::Array(y)) if x.len() == y.len() => x
            .iter()
            .zip(y)
            .enumerate()
            .find_map(|(i, (va, vb))| first_difference(va, vb, &format!("{path}[{i}]"))),
        _ if a == b => None,
        _ => Some(format!("{path}: {a} vs {b}")),
    }
}

/// Fails with the first place `got` and `want` differ.
fn assert_same(got: &Value, want: &Value, what: &str) {
    if let Some(d) = first_difference(got, want, "") {
        panic!("{what}: {d}");
    }
}

fn states(sim: &Simulation) -> BTreeMap<&'static str, usize> {
    let mut m = BTreeMap::new();
    for p in &sim.crowd.people {
        *m.entry(p.state.as_str()).or_insert(0) += 1;
    }
    m
}

#[test]
fn every_fixture_keeps_its_people_through_a_reload() {
    let mut modes = Vec::new();
    for (name, text) in fixtures() {
        let sim = busy(&text);
        let saved = sim.save_text();
        let loaded = load_save_text(saved.as_bytes()).unwrap();
        assert!(!sim.crowd.people.is_empty(), "{name}: nobody out at noon");
        assert_eq!(
            loaded.crowd.view(),
            sim.crowd.view(),
            "{name}: the people come back as they stood"
        );
        assert_same(
            &loaded.serialize(),
            &sim.serialize(),
            &format!("{name}: a reloaded save writes the same save"),
        );
        // The ledger's day totals may come back in another key order, so
        // only the crowd's text is held to the byte.
        let crowd_text = |t: &str| serde_json::from_str::<Value>(t).unwrap()["crowd"].to_string();
        assert_eq!(
            crowd_text(&loaded.save_text()),
            crowd_text(&saved),
            "{name}: the crowd writes the same text"
        );
        assert_eq!(
            room_counts(&loaded),
            room_counts(&sim),
            "{name}: the rooms count the same people"
        );
        assert_eq!(
            crowd_tallies(&loaded),
            crowd_tallies(&sim),
            "{name}: the crowd's tallies come back"
        );
        modes.push((sim.mode, states(&sim)));
    }
    // Both modes are covered, and between them people stand in every state
    // a save can hold.
    assert!(modes.iter().any(|(m, _)| *m == GameMode::Classic));
    assert!(modes.iter().any(|(m, _)| *m == GameMode::Modern));
    for state in ["toShaft", "waiting", "riding", "toDest", "dwelling"] {
        assert!(
            modes.iter().any(|(_, s)| s.contains_key(state)),
            "no fixture has anyone {state}: {modes:?}"
        );
    }
}

#[test]
fn a_reloaded_tower_plays_on_as_it_would_have() {
    for (name, text) in fixtures() {
        let mut sim = busy(&text);
        let mut loaded = load_save_text(sim.save_text().as_bytes()).unwrap();
        for _ in 0..60 {
            sim.tick(2.0);
            loaded.tick(2.0);
        }
        assert_same(
            &loaded.crowd.view(),
            &sim.crowd.view(),
            &format!("{name}: the crowd moves on as it would have"),
        );
        // The save keeps only the newest messages (`LOG_SAVE_CAP`), so the
        // two logs part once the live one passes that many; everything else
        // stays the same.
        let without_log = |s: &Simulation| {
            let mut v = state_view(s);
            v.as_object_mut().unwrap().remove("log");
            v
        };
        assert_same(
            &without_log(&loaded),
            &without_log(&sim),
            &format!("{name}: the tower moves on as it would have"),
        );
    }
}

#[test]
fn a_save_without_a_crowd_loads_an_empty_one() {
    let (_, text) = fixtures().remove(0);
    let sim = busy(&text);
    let mut save: Value = serde_json::from_str(&sim.save_text()).unwrap();
    save.as_object_mut().unwrap().remove("crowd");
    let loaded = load_save_text(save.to_string().as_bytes()).unwrap();
    assert!(loaded.crowd.people.is_empty());
    assert_eq!(loaded.crowd.staff_count, 0);
    assert!(loaded.crowd.walk_ins.is_empty());
    assert!(room_counts(&loaded)
        .values()
        .all(|&(inside, guests, out, _)| (inside, guests, out) == (0, 0, 0)));
}

/// One valid saved person, as the save writes them, to forge from.
fn walker() -> Value {
    json!({
        "id": 7, "state": "toShaft", "floor": 1, "fy": 1.0, "x": 10.0,
        "startX": 10.0, "floors": [1, 5], "originFloor": 1, "shafts": [99],
        "leg": 0, "shaftId": 99, "destX": 20.0, "wait": 0.0, "tripWait": 0.0,
        "age": 3.0, "linger": 0.0,
    })
}

fn load_with_crowd(crowd: Value) -> Simulation {
    let mut save = Simulation::new_game(5, GameMode::Classic).serialize();
    save["crowd"] = crowd;
    load_save_text(save.to_string().as_bytes()).unwrap()
}

#[test]
fn a_person_the_loader_cannot_place_is_left_out() {
    let forged = |edit: &dyn Fn(&mut Value)| {
        let mut p = walker();
        edit(&mut p);
        load_with_crowd(json!({ "people": [p] })).crowd.people.len()
    };
    assert_eq!(forged(&|_| {}), 1, "the valid walker loads");
    let bad: Vec<(&str, Box<dyn Fn(&mut Value)>)> = vec![
        ("unknown state", Box::new(|p| p["state"] = json!("flying"))),
        ("a finished trip", Box::new(|p| p["state"] = json!("done"))),
        ("leg past the route", Box::new(|p| p["leg"] = json!(1))),
        ("route legs mismatch", Box::new(|p| p["shafts"] = json!([]))),
        (
            "floor off the lot",
            Box::new(|p| p["floors"] = json!([1, 500])),
        ),
        ("fraction floor", Box::new(|p| p["floor"] = json!(1.5))),
        ("no position", Box::new(|p| p["x"] = Value::Null)),
        ("far off the lot", Box::new(|p| p["x"] = json!(1e300))),
        ("headed off the lot", Box::new(|p| p["destX"] = json!(-1e9))),
        ("above the top floor", Box::new(|p| p["fy"] = json!(500.0))),
        ("negative id", Box::new(|p| p["id"] = json!(-3))),
        (
            "rider with no car",
            Box::new(|p| p["state"] = json!("riding")),
        ),
        ("seat while walking", Box::new(|p| p["carIndex"] = json!(0))),
        (
            "bad errand",
            Box::new(|p| p["errand"] = json!({"place": "moon"})),
        ),
        (
            "bad staff trip",
            Box::new(|p| p["staffTrip"] = json!("nap")),
        ),
    ];
    for (why, edit) in bad {
        assert_eq!(forged(&*edit), 0, "{why}");
    }
}

#[test]
fn people_come_back_in_id_order_and_new_ones_get_fresh_ids() {
    let with = |id: i64, x: f64| {
        let mut p = walker();
        p["id"] = json!(id);
        p["x"] = json!(x);
        p
    };
    let sim = load_with_crowd(json!({
        "nextId": 3,
        "people": [with(7, 10.0), with(7, 30.0), with(5, 1.0), with(40, 2.0)],
    }));
    let kept: Vec<(i64, f64)> = sim.crowd.people.iter().map(|p| (p.id, p.x)).collect();
    assert_eq!(
        kept,
        vec![(7, 10.0), (40, 2.0)],
        "a repeated or out-of-order id is left out, so the crowd stays in id order"
    );
    assert_eq!(sim.crowd.next_id, 41, "past every id held");
    assert_eq!(sim.crowd.people[1].seed, crate::crowd::spawn::seed_for(40));
}

#[test]
fn only_a_housekeeper_carries_a_crew_and_a_room() {
    let staffer = |edit: &dyn Fn(&mut Value)| {
        let mut p = walker();
        p["staff"] = json!(true);
        p["crewId"] = json!(3);
        p["staffTrip"] = json!("in");
        edit(&mut p);
        load_with_crowd(json!({ "people": [p] })).crowd.people.len()
    };
    assert_eq!(staffer(&|_| {}), 1, "a housekeeper on the way in loads");
    let bad: Vec<(&str, Box<dyn Fn(&mut Value)>)> = vec![
        ("no crew", Box::new(|p| p["crewId"] = Value::Null)),
        ("no working day", Box::new(|p| p["staffTrip"] = Value::Null)),
        ("not staff", Box::new(|p| p["staff"] = json!(false))),
        (
            "a room to clean, not staff",
            Box::new(|p| {
                p["staff"] = json!(false);
                p["crewId"] = Value::Null;
                p["staffTrip"] = Value::Null;
                p["cleanUnitId"] = json!(9);
            }),
        ),
    ];
    for (why, edit) in bad {
        assert_eq!(staffer(&*edit), 0, "{why}");
    }
}

#[test]
fn a_hand_edit_cannot_seat_a_visitor_or_a_housekeeper_in_the_wrong_room() {
    let (_, text) = &fixtures()[0];
    let tower = load_save_text(text.as_bytes()).unwrap();
    // A room that takes no visitors and is no hotel room.
    let lobby = tower
        .tower
        .units
        .iter()
        .find(|u| !u.kind.counts_visitors() && !u.kind.is_hotel())
        .unwrap()
        .id;
    let mut save = tower.serialize();
    let mut visitor = walker();
    visitor["venueUnitId"] = json!(lobby);
    visitor["countedHotelGuest"] = json!(true);
    let mut maid = walker();
    maid["id"] = json!(8);
    maid["staff"] = json!(true);
    maid["crewId"] = json!(3);
    maid["staffTrip"] = json!("job");
    maid["cleanUnitId"] = json!(lobby);
    save["crowd"] = json!({ "people": [visitor, maid] });
    let sim = load_save_text(save.to_string().as_bytes()).unwrap();
    assert_eq!(sim.crowd.people.len(), 2, "both people load");
    let unit = sim.tower.get_unit(lobby).unwrap();
    assert_eq!(unit.customers_in.unwrap_or(0), 0, "the lobby counts nobody");
    assert_eq!(unit.hotel_customers_in.unwrap_or(0), 0);
    let visitor = &sim.crowd.people[0];
    assert_eq!(visitor.venue_unit_id, None, "the visitor counts nowhere");
    assert!(!visitor.counted_hotel_guest);
    assert_eq!(
        sim.housekeeping.room_holder(lobby),
        None,
        "no crew holds it"
    );
    // Her finish cannot release a claim another crew holds on it.
    assert_eq!(sim.crowd.people[1].clean_unit_id, None);
}

#[test]
fn a_malformed_crowd_loads_as_none() {
    for crowd in [
        json!(5),
        json!("people"),
        json!([]),
        json!({ "people": "x", "walkIns": 3, "commuteStress": {}, "rng": -1 }),
        json!({ "people": [1, null, {}], "walkIns": [{"at": "noon"}, null] }),
    ] {
        let sim = load_with_crowd(crowd.clone());
        assert!(sim.crowd.people.is_empty(), "{crowd}");
        assert!(sim.crowd.walk_ins.is_empty(), "{crowd}");
    }
}

#[test]
fn walk_ins_come_back_due_next_last() {
    let sim = load_with_crowd(json!({ "walkIns": [
        { "at": 600.0, "unitId": 4 },
        { "at": 640.0, "unitId": 2 },
        { "at": 610.0, "unitId": 9 },
    ] }));
    let order: Vec<(f64, i64)> = sim
        .crowd
        .walk_ins
        .iter()
        .map(|w| (w.at, w.unit_id))
        .collect();
    assert_eq!(order, vec![(640.0, 2), (610.0, 9), (600.0, 4)]);
}

#[test]
fn the_state_hash_leaves_the_crowd_to_its_own_channel() {
    let (_, text) = fixtures().remove(0);
    let sim = busy(&text);
    assert!(state_view(&sim).get("crowd").is_none());
    assert!(sim.serialize().get("crowd").is_some());
    // The busy tower's crowd is all live people: nobody finished is saved.
    assert!(sim.crowd.people.iter().all(|p| p.state != PState::Done));
}

#[test]
fn the_cars_timers_load_only_for_shafts_the_tower_holds() {
    let (_, text) = fixtures().remove(0);
    let sim = busy(&text);
    let shaft = sim.tower.transports[0].id;
    let mut save = sim.serialize();
    let cars = sim.tower.transports[0].cars as usize;
    save["dispatch"] = json!({
        "cars": [
            { "shaftId": shaft, "dwell": vec![0.5; cars], "seen": vec![1.0; cars], "held": vec![0.25; cars] },
            { "shaftId": shaft, "dwell": vec![9.0; cars], "seen": vec![9.0; cars], "held": vec![9.0; cars] },
            { "shaftId": 999_999, "dwell": [1.0], "seen": [1.0], "held": [1.0] },
            { "shaftId": 1.5, "dwell": [1.0], "seen": [1.0], "held": [1.0] },
            { "shaftId": shaft, "dwell": ["x"], "seen": [], "held": [] },
        ],
        "waiting": [
            { "floor": 3, "estimate": 2.5 },
            { "floor": 500, "estimate": 1.0 },
            { "floor": 4, "estimate": -1.0 },
            { "floor": 5, "estimate": "many" },
        ],
    });
    let loaded = load_save_text(save.to_string().as_bytes()).unwrap();
    assert_eq!(
        loaded.elevators.save_json(),
        json!({
            "cars": [{ "shaftId": shaft, "dwell": vec![0.5; cars], "seen": vec![1.0; cars], "held": vec![0.25; cars] }],
            "waiting": [{ "floor": 3, "estimate": 2.5 }],
        }),
        "the first entry for a shaft the tower holds, and estimates on the lot"
    );
    for junk in [json!(7), json!({ "cars": "x", "waiting": {} })] {
        save["dispatch"] = junk;
        let loaded = load_save_text(save.to_string().as_bytes()).unwrap();
        assert_eq!(
            loaded.elevators.save_json(),
            json!({ "cars": [], "waiting": [] })
        );
    }
}
