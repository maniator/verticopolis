use super::*;
use crate::facilities::{Kind, FACILITIES};

fn code(kind: Kind) -> f64 {
    FACILITIES.iter().position(|f| f.kind == kind).unwrap() as f64
}

fn engine() -> Engine {
    let mut e = Engine::of(Simulation::new_game(7, GameMode::Modern));
    e.sim.money = 1e9;
    e.port_drain_events();
    e
}

fn names(e: &Engine) -> Vec<String> {
    (0..e.drained.len())
        .map(|i| {
            let v: serde_json::Value =
                serde_json::from_str(&e.port_event_text(i as f64).unwrap()).unwrap();
            v["name"].as_str().unwrap().to_owned()
        })
        .collect()
}

#[test]
fn a_refused_load_changes_nothing() {
    let mut e = engine();
    e.port_build(code(Kind::Lobby), 1.0, 100.0);
    let before = e.sim.serialize();
    assert_eq!(e.port_load_save("not a save"), vec![0.0, 0.0]);
    assert!(e.last_reason_text().is_some());
    assert_eq!(e.sim.serialize(), before);
    assert_eq!(e.port_found(1.0, 9.0, 0.0, false), vec![0.0, 0.0]);
    assert_eq!(e.port_found(-1.0, 1.0, 0.0, false)[0], 0.0);
    assert_eq!(e.sim.gameplay.len(), 1, "the queue survives a refusal");
}

#[test]
fn a_done_load_moves_the_generation_and_keeps_the_owed_events() {
    let mut e = engine();
    let save = e.sim.serialize().to_string();
    e.port_build(code(Kind::Lobby), 1.0, 100.0);
    assert_eq!(e.port_load_save(&save), vec![1.0, 1.0]);
    assert_eq!(e.port_found(3.0, 1.0, 1.0, false), vec![1.0, 2.0]);
    let [dropped, count] = e.port_drain_events()[..] else {
        panic!()
    };
    assert_eq!(dropped, 0.0);
    assert!(count >= 1.0);
    let names = names(&e);
    assert_eq!(
        names[0], "facility_placed",
        "the owed event comes first: {names:?}"
    );
}

#[test]
fn the_backdrop_hands_on_nothing() {
    let mut e = engine();
    e.port_build(code(Kind::Lobby), 1.0, 100.0);
    e.port_set_backdrop(true);
    // A refused swap keeps the mark.
    e.port_load_save("{");
    assert!(e.backdrop);
    e.port_found(3.0, 1.0, 1.0, false);
    assert!(!e.backdrop);
    e.port_drain_events();
    assert!(!names(&e).contains(&"facility_placed".to_owned()));
}

#[test]
fn restore_keeps_the_live_auto_bridge() {
    let mut e = engine();
    let snapshot = e.sim.serialize().to_string();
    e.sim.auto_bridge = !e.sim.auto_bridge;
    let live = e.sim.auto_bridge;
    assert_eq!(e.port_restore(&snapshot)[0], 1.0);
    assert_eq!(e.sim.auto_bridge, live);
}

#[test]
fn restore_keeps_the_live_camera_and_a_load_takes_the_saved_one() {
    let mut e = engine();
    assert_eq!(e.port_set_camera(10.5, 3.25, 1.0)[0], 1.0);
    let snapshot = e.sim.serialize().to_string();
    assert_eq!(e.port_set_camera(80.0, 12.5, 2.0)[0], 1.0);
    let live = e.sim.view.clone();
    assert_eq!(e.port_restore(&snapshot)[0], 1.0);
    assert_eq!(
        e.sim.view, live,
        "undo and redo keep the camera under the player"
    );
    assert_eq!(e.port_load_save(&snapshot)[0], 1.0);
    assert_eq!(
        e.sim.view.as_ref().unwrap()["tile"],
        10.5,
        "a load takes the save's camera"
    );
}

#[test]
fn a_refused_restore_or_founding_changes_nothing() {
    let mut e = engine();
    e.port_build(code(Kind::Lobby), 1.0, 100.0);
    let save = e.sim.serialize().to_string();
    assert_eq!(e.port_load_save(&save), vec![1.0, 1.0]);
    e.port_build(code(Kind::Floor), 2.0, 100.0);
    let before = e.sim.serialize();
    let queued = e.sim.gameplay.len();
    assert!(queued >= 1);
    let refusals: [fn(&mut Engine) -> Vec<f64>; 6] = [
        |e| e.port_restore("not a save"),
        |e| e.port_restore(r#"{"version":7,"units":["#),
        |e| e.port_found(1.5, 1.0, 0.0, false),
        |e| e.port_found(f64::from(u32::MAX) + 1.0, 1.0, 0.0, false),
        |e| e.port_found(1.0, 1.0, 9.0, false),
        |e| e.port_found(f64::NAN, 1.0, 0.0, false),
    ];
    for (i, refuse) in refusals.iter().enumerate() {
        let refused = refuse(&mut e);
        assert_eq!(refused, vec![0.0, 1.0], "refusal {i}: generation unmoved");
        assert!(e.last_reason_text().is_some());
        assert_eq!(e.sim.serialize(), before, "the tower stays");
        assert_eq!(e.sim.gameplay.len(), queued, "the queue stays");
    }
}

/// A standard elevator over floors 1 to 3 on a lobby and two floors.
fn shaft(e: &mut Engine) -> f64 {
    for x in 150..200 {
        assert!(e.sim.tower.place(Kind::Lobby, 1, x).ok);
        assert!(e.sim.tower.place(Kind::Floor, 2, x).ok);
        assert!(e.sim.tower.place(Kind::Floor, 3, x).ok);
    }
    let r = e.port_build_shaft(code(Kind::ElevatorStandard), 155.0, 1.0, 3.0);
    assert_eq!(r[0], 1.0, "{:?}", e.last_reason_text());
    e.port_cars(e.sim.tower.transports[0].id as f64, true);
    e.sim.tower.transports[0].id as f64
}

#[test]
fn a_schedule_reaches_the_shaft_and_reads_back() {
    let mut e = engine();
    let id = shaft(&mut e);
    let mut slots = vec![0.0; SCHEDULE_LEN];
    slots[0] = 1.0;
    slots[1..=SCHEDULE_HOURS].fill(2.0);
    let timing = 2 * (1 + SCHEDULE_HOURS);
    slots[timing] = 15.0;
    slots[timing + 1] = f64::NAN;
    slots[timing + 2] = 1.0;
    slots[timing + 3] = 3.0;
    assert_eq!(e.port_schedule_shaft(id, &slots), vec![1.0, 0.0]);
    let sch = e.sim.tower.transports[0].schedule.clone().unwrap();
    assert_eq!(sch.weekday, Some(vec![2; SCHEDULE_HOURS]));
    assert_eq!(sch.weekend, None);
    assert_eq!(sch.waiting_car_response, Some(15.0));
    assert_eq!(sch.standard_floor_departure, None);
    assert_eq!(sch.home_floors, Some(vec![3]));
    // The legacy JSON setter, given the same schedule, stores the same one.
    let mut legacy = engine();
    let lid = shaft(&mut legacy) as i64;
    assert!(legacy
        .sim
        .tower
        .set_schedule(lid, &schedule_json(&slots).unwrap()));
    assert_eq!(legacy.sim.tower.transports[0].schedule, Some(sch));
}

#[test]
fn a_malformed_schedule_is_refused_and_changes_nothing() {
    let mut e = engine();
    let id = shaft(&mut e);
    let timing = 2 * (1 + SCHEDULE_HOURS);
    let mut good = vec![0.0; SCHEDULE_LEN];
    good[0] = 1.0;
    good[1..=SCHEDULE_HOURS].fill(1.0);
    good[timing] = f64::NAN;
    good[timing + 1] = f64::NAN;
    good[timing + 2] = 1.0;
    good[timing + 3] = 2.0;
    assert_eq!(e.port_schedule_shaft(id, &good)[0], 1.0);
    let before = e.sim.tower.transports[0].schedule.clone();
    assert!(before.is_some());
    let breaks: [(&str, usize, f64); 8] = [
        ("a fractional car count", 5, 1.5),
        ("a non-finite car count", 5, f64::NAN),
        ("a row flag that is neither 0 nor 1", 0, 2.0),
        ("an infinite timing", timing, f64::INFINITY),
        ("more home floors than the record holds", timing + 2, 9.0),
        ("a fractional home-floor count", timing + 2, 0.5),
        ("a fractional home floor", timing + 3, 2.5),
        ("a non-finite home floor", timing + 3, f64::NAN),
    ];
    for (what, at, x) in breaks {
        let mut slots = good.clone();
        slots[at] = x;
        assert_eq!(e.port_schedule_shaft(id, &slots)[0], 0.0, "{what}");
        assert_eq!(e.sim.tower.transports[0].schedule, before, "{what}");
    }
    assert_eq!(e.port_schedule_shaft(id, &good[..SCHEDULE_LEN - 1])[0], 0.0);
    assert_eq!(e.port_schedule_shaft(0.5, &good)[0], 0.0);
    // An unset row's hours are not read.
    let mut unset = good.clone();
    unset[1 + SCHEDULE_HOURS + 3] = 0.5;
    assert_eq!(e.port_schedule_shaft(id, &unset)[0], 1.0);
}

#[test]
fn the_log_and_the_text_getters() {
    let mut e = engine();
    let last = e.sim.log_seq as f64;
    assert_eq!(e.port_log_line("Hello", 1.0)[0], 1.0);
    assert_eq!(e.port_log_line("x", 7.0)[0], 0.0);
    let after = e.port_log_after(last);
    assert_eq!(after.len(), 3);
    assert_eq!(after[1], 1.0);
    assert_eq!(e.port_log_text(after[0]).as_deref(), Some("Hello"));
    assert_eq!(e.port_log_text(-5.0), None);
    let meta = e.port_unit_meta_changed(0.0);
    assert_eq!(meta[1], 1.0, "a since of 0 is a full listing");
    assert_eq!(e.port_unit_label(99_999.0), None);
    assert_eq!(e.port_schedule_shaft(1.0, &[0.0; 3])[0], 0.0);
}

#[test]
fn the_unit_text_and_the_undo_signature() {
    let mut e = engine();
    e.port_build(code(Kind::Lobby), 1.0, 100.0);
    let id = e.sim.tower.units[0].id;
    assert_eq!(e.port_label_unit(id as f64, "Front desk")[0], 1.0);
    assert!(e.sim.tower.set_unit_subtype(id, Some("marble")));
    assert_eq!(e.port_unit_label(id as f64).as_deref(), Some("Front desk"));
    assert_eq!(e.port_unit_subtype(id as f64).as_deref(), Some("marble"));
    assert_eq!(e.port_unit_subtype(0.5), None);
    assert_eq!(
        e.port_undo_signature(),
        format!("{}:{}", e.sim.tower_signature(), e.sim.money)
    );
    let before = e.port_undo_signature();
    e.port_build(code(Kind::Floor), 2.0, 100.0);
    assert_ne!(e.port_undo_signature(), before, "a build moves it");
}

#[test]
fn a_schedule_crosses_as_slots() {
    let mut slots = vec![0.0; SCHEDULE_LEN];
    slots[0] = 1.0;
    slots[1..=SCHEDULE_HOURS].fill(2.0);
    slots[2 * (1 + SCHEDULE_HOURS)] = 15.0;
    slots[2 * (1 + SCHEDULE_HOURS) + 1] = f64::NAN;
    let v = schedule_json(&slots).unwrap();
    assert_eq!(v["activeCars"]["weekday"][0], 2.0);
    assert!(v["activeCars"].get("weekend").is_none());
    assert_eq!(v["waitingCarResponse"], 15.0);
    assert!(v.get("standardFloorDeparture").is_none());
    assert!(v.get("homeFloors").is_none());
}
