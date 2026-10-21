//! Tests for a pending exterminator booking across a save (#902), mirroring
//! `src/engine/sim/exterminationPersistence.test.ts`.
use super::*;
use crate::clock::{CalendarKind, GameMode};
use crate::load::{deserialize, UNIT_CAP};
use serde_json::{json, Value};

/// A Modern tower with two hotel rooms on floor 2: the first infested and
/// booked, the second infested after the booking. Returns their ids.
fn booked() -> (Simulation, i64, i64) {
    let mut sim = Simulation::new(1, GameMode::Modern, CalendarKind::RealWorld, false);
    for x in 0..40 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        assert!(sim.tower.place(Kind::Floor, 2, x).ok);
    }
    let width = Kind::HotelSingle.facility().width;
    let paid = sim.tower.place(Kind::HotelSingle, 2, 0).unit_id.unwrap();
    let later = sim
        .tower
        .place(Kind::HotelSingle, 2, width)
        .unit_id
        .unwrap();
    sim.money = 1e6;
    sim.tower.get_unit_mut(paid).unwrap().state = UnitState::Infested;
    assert_eq!(sim.call_exterminator(), Ok((7000.0, 1)));
    sim.tower.get_unit_mut(later).unwrap().state = UnitState::Infested;
    (sim, paid, later)
}

/// Load `raw`, move to the due day and land the treatment.
fn treated(raw: &Value) -> Simulation {
    let mut sim = deserialize(raw).unwrap();
    sim.clock.minutes += 1440.0;
    sim.resolve_extermination();
    sim
}

fn state(sim: &Simulation, id: i64) -> UnitState {
    sim.tower.get_unit(id).unwrap().state
}

#[test]
fn pending_booking_survives_reload_without_treating_unpaid_rooms() {
    let (sim, paid, later) = booked();
    let mut loaded = deserialize(&sim.serialize()).unwrap();
    assert_eq!(loaded.extermination_room_ids, Some(vec![paid]));
    assert_eq!(
        loaded.call_exterminator(),
        Err(ExterminatorRefusal::Pending)
    );
    loaded.clock.minutes += 1440.0;
    loaded.resolve_extermination();
    assert_eq!(state(&loaded, paid), UnitState::Empty);
    assert_eq!(state(&loaded, later), UnitState::Infested);
    assert_eq!(loaded.extermination_room_ids, None);
    assert!(loaded.serialize().get("exterminationRoomIds").is_none());
    loaded.tower.get_unit_mut(paid).unwrap().state = UnitState::Infested;
    assert_eq!(loaded.call_exterminator(), Ok((9000.0, 2)));
}

#[test]
fn a_legacy_save_without_the_list_treats_every_infested_room() {
    let (sim, paid, later) = booked();
    let mut raw = sim.serialize();
    raw.as_object_mut().unwrap().remove("exterminationRoomIds");
    let loaded = treated(&raw);
    assert_eq!(state(&loaded, paid), UnitState::Empty);
    assert_eq!(state(&loaded, later), UnitState::Empty);
}

#[test]
fn a_list_that_is_not_an_array_bills_no_rooms() {
    for bad in [json!("bad"), json!(null), json!({ "0": 1 })] {
        let (sim, paid, _) = booked();
        let mut raw = sim.serialize();
        raw["exterminationRoomIds"] = bad.clone();
        assert_eq!(
            deserialize(&raw).unwrap().extermination_room_ids,
            Some(vec![]),
            "{bad}"
        );
        let loaded = treated(&raw);
        assert_eq!(state(&loaded, paid), UnitState::Infested, "{bad}");
        assert_eq!(loaded.extermination_due_day, None, "{bad}");
    }
}

#[test]
fn a_list_without_a_due_day_or_in_classic_is_ignored() {
    let (sim, paid, _) = booked();
    let mut raw = sim.serialize();
    raw.as_object_mut().unwrap().remove("exterminationDueDay");
    assert_eq!(raw["exterminationRoomIds"], json!([paid]));
    assert_eq!(deserialize(&raw).unwrap().extermination_room_ids, None);
    raw["mode"] = json!("classic");
    raw["exterminationDueDay"] = json!(1);
    assert_eq!(deserialize(&raw).unwrap().extermination_room_ids, None);
}

#[test]
fn ids_keep_the_first_unit_cap_valid_unique_values() {
    // The same list as the TypeScript test: invalid entries and a repeat
    // just short of the cap count for nothing, and the cap keeps the first.
    let mut list = vec![
        json!(2147483647),
        json!(0),
        json!(-1),
        json!(2.5),
        json!("2"),
        json!(null),
        json!(true),
        json!(2147483648u64),
    ];
    // The literal cap, the same tripwire `storage.integration.test.ts` pins
    // on the TypeScript side, so the two loaders keep one cap.
    assert_eq!(UNIT_CAP, 82_500);
    let cap = UNIT_CAP as i64;
    list.extend((1..=cap - 2).map(|i| json!(i)));
    list.extend([json!(1), json!(cap - 1), json!(cap), json!(cap + 1)]);
    let (sim, _, _) = booked();
    let mut raw = sim.serialize();
    raw["exterminationRoomIds"] = Value::Array(list);
    let ids = deserialize(&raw).unwrap().extermination_room_ids.unwrap();
    let mut want = vec![2147483647];
    want.extend(1..=cap - 1);
    assert_eq!(ids.len(), UNIT_CAP);
    assert_eq!(ids, want);
}

#[test]
fn an_integral_float_id_is_kept() {
    // A writer that keeps ids as doubles saves a room as `5.0`, which the
    // loader keeps as the integer. A loader that read ids with `as_i64()`
    // (None for a float) would drop them, and this fails.
    let (sim, paid, _) = booked();
    let other = paid + 1000; // never `paid`, so the dedupe keeps both
    let mut raw = sim.serialize();
    raw["exterminationRoomIds"] = json!([paid as f64, other as f64]);
    assert!(raw["exterminationRoomIds"][0].is_f64() && raw["exterminationRoomIds"][1].is_f64());
    let ids = deserialize(&raw).unwrap().extermination_room_ids.unwrap();
    assert_eq!(ids, vec![paid, other]);
}

#[test]
fn a_billed_room_demolished_before_the_treatment_is_skipped() {
    let (sim, paid, later) = booked();
    let mut loaded = deserialize(&sim.serialize()).unwrap();
    let x = loaded.tower.get_unit(paid).unwrap().x;
    assert!(loaded.tower.remove_unit(paid).is_some());
    let rebuilt = loaded.tower.place(Kind::HotelSingle, 2, x).unit_id.unwrap();
    assert_ne!(rebuilt, paid);
    loaded.tower.get_unit_mut(rebuilt).unwrap().state = UnitState::Infested;
    loaded.clock.minutes += 1440.0;
    loaded.resolve_extermination();
    assert_eq!(state(&loaded, rebuilt), UnitState::Infested);
    assert_eq!(state(&loaded, later), UnitState::Infested);
    assert_eq!(loaded.extermination_due_day, None);
    assert_eq!(loaded.extermination_room_ids, None);
}
