//! The person's save entry walk (`SaveEntries for Person`) against
//! `Person::save_form` as it was when each entry was built as a `Value`,
//! kept verbatim below (but for `self`, and the `gaveUp` flag of #2019): the tree and the written text read
//! the same entry, for everyone in every committed tower each hour of
//! twelve played hours, and for a person carrying every optional key with values a
//! JSON writer can spell differently.

use serde_json::{json, Map, Value};

use crate::crowd::commuters::Commute;
use crate::crowd::staff_shift::StaffTrip;
use crate::crowd::trip::{Errand, ErrandPlace};
use crate::crowd::Person;
use crate::load::{decode_vctower, deserialize};
use crate::save_entry::{Written, WrittenAll};

/// `Person::save_form` before the walk, verbatim but for `self`.
fn reference(p: &Person) -> Value {
    let mut m = Map::new();
    m.insert("id".into(), json!(p.id));
    m.insert("state".into(), json!(p.state.as_str()));
    m.insert("floor".into(), json!(p.floor));
    m.insert("fy".into(), json!(p.fy));
    m.insert("x".into(), json!(p.x));
    m.insert("startX".into(), json!(p.start_x));
    m.insert("floors".into(), json!(p.floors));
    m.insert("originFloor".into(), json!(p.origin_floor));
    m.insert("shafts".into(), json!(p.shafts));
    m.insert("leg".into(), json!(p.leg));
    if let Some(v) = p.shaft_id {
        m.insert("shaftId".into(), json!(v));
    }
    if let Some(v) = p.car_index {
        m.insert("carIndex".into(), json!(v));
    }
    m.insert("destX".into(), json!(p.dest_x));
    m.insert("wait".into(), json!(p.wait));
    m.insert("tripWait".into(), json!(p.trip_wait));
    m.insert("age".into(), json!(p.age));
    m.insert("linger".into(), json!(p.linger));
    let flags = [
        ("staff", p.staff),
        ("countedHotelGuest", p.counted_hotel_guest),
        ("returning", p.returning),
        ("fromMetro", p.from_metro),
        ("gaveUp", p.gave_up),
        ("walkIn", p.walk_in),
    ];
    for (key, set) in flags {
        if set {
            m.insert(key.into(), json!(true));
        }
    }
    let ids = [
        ("cleanUnitId", p.clean_unit_id),
        ("mealVenueId", p.meal_venue_id),
        ("venueUnitId", p.venue_unit_id),
        ("originUnitId", p.origin_unit_id),
        ("crewId", p.crew_id),
    ];
    for (key, id) in ids {
        if let Some(id) = id {
            m.insert(key.into(), json!(id));
        }
    }
    if let Some(v) = p.dwell_seconds_left {
        m.insert("dwellSecondsLeft".into(), json!(v));
    }
    if let Some(v) = p.linger_for {
        m.insert("lingerFor".into(), json!(v));
    }
    if let Some(v) = p.routine {
        m.insert("routine".into(), json!(v));
    }
    if let Some(t) = p.staff_trip {
        m.insert("staffTrip".into(), json!(t.as_str()));
    }
    if let Some(e) = p.errand {
        m.insert(
            "errand".into(),
            json!({ "place": e.place.as_str(), "inbound": e.inbound }),
        );
    }
    if let Some(c) = p.commute {
        m.insert(
            "commute".into(),
            json!({ "officeId": c.workplace_id, "inbound": c.inbound }),
        );
    }
    Value::Object(m)
}

fn same(p: &Person, what: &str) {
    let want = reference(p);
    assert_eq!(p.save_form(), want, "{what}: the tree");
    assert_eq!(
        serde_json::to_string(&Written(p)).unwrap(),
        want.to_string(),
        "{what}: the text"
    );
}

#[test]
fn everyone_in_the_committed_towers_writes_as_before() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../conformance/fixtures");
    let mut paths: Vec<_> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|x| x == "vctower"))
        .collect();
    paths.sort();
    let mut seen = 0;
    for path in paths {
        let save = decode_vctower(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let mut sim = deserialize(&save).unwrap();
        for hour in 0..12 {
            for p in &sim.crowd.people {
                same(p, &format!("{} hour {hour}", path.display()));
            }
            let list: Vec<Value> = sim.crowd.people.iter().map(reference).collect();
            assert_eq!(
                serde_json::to_string(&WrittenAll(&sim.crowd.people)).unwrap(),
                Value::Array(list).to_string(),
                "{}: the list",
                path.display()
            );
            seen += sim.crowd.people.len();
            for _ in 0..60 {
                sim.tick(1.0);
            }
        }
    }
    assert!(seen > 1000, "only {seen} people seen");
}

#[test]
fn a_person_with_every_key_writes_as_before() {
    let save = decode_vctower(include_str!(
        "../../../conformance/fixtures/split-tower-4.vctower"
    ))
    .unwrap();
    let mut sim = deserialize(&save).unwrap();
    for _ in 0..9 * 60 {
        sim.tick(1.0);
    }
    let base = sim
        .crowd
        .people
        .first()
        .cloned()
        .expect("people out by 9 AM");
    let odd = [f64::NAN, f64::INFINITY, -0.0, 0.1 + 0.2, 1e21, 5e-324, 2.0];
    for (i, n) in odd.into_iter().enumerate() {
        let mut p = base.clone();
        p.fy = n;
        p.x = n;
        p.start_x = -n;
        p.floors = vec![1, -3, i as i64];
        p.shafts = Vec::new();
        p.leg = i;
        p.shaft_id = Some(-4);
        p.car_index = Some(7);
        p.dest_x = n;
        p.wait = n;
        p.trip_wait = n;
        p.age = n;
        p.linger = n;
        p.staff = true;
        p.counted_hotel_guest = true;
        p.returning = true;
        p.from_metro = true;
        p.gave_up = true;
        p.walk_in = true;
        p.clean_unit_id = Some(1);
        p.meal_venue_id = Some(2);
        p.venue_unit_id = Some(3);
        p.origin_unit_id = Some(4);
        p.crew_id = Some(5);
        p.dwell_seconds_left = Some(n);
        p.linger_for = Some(n);
        p.routine = Some("lunch");
        p.staff_trip = Some(StaffTrip::Job);
        p.errand = Some(Errand {
            place: ErrandPlace::Home,
            inbound: i % 2 == 0,
        });
        p.commute = Some(Commute {
            workplace_id: 99,
            inbound: i % 2 == 1,
        });
        same(&p, &format!("every key, {n}"));
    }
    same(&base, "the first person out");
}
