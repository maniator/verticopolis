use super::*;
use crate::clock::GameMode;
use crate::crowd::spawn::add;
use crate::crowd::trip::{Errand, ErrandPlace};
use crate::facilities::Kind;
use crate::rule_tests::{shaft, strip_tower};
use crate::tower::UnitState;

/// Slot `name` of a `personCard` record.
fn at(r: &[f64], name: &str) -> f64 {
    r[PERSON_CARD.iter().position(|n| *n == name).unwrap()]
}

/// A lobby, floors 2 and 3, a standard elevator at x 4 and an office at
/// x 10 on floor 2. Returns the engine and the office's id.
fn office_tower() -> (Engine, i64) {
    let mut sim = strip_tower(1, GameMode::Modern, 40, 3);
    shaft(&mut sim, Kind::ElevatorStandard, 4, 1, 3);
    let office = sim.tower.place(Kind::Office, 2, 10).unit_id.unwrap();
    sim.tower.get_unit_mut(office).unwrap().state = UnitState::Occupied;
    (Engine::of(sim), office)
}

#[test]
fn a_worker_card_names_why_where_from_and_where_to() {
    let (mut e, office) = office_tower();
    let i = add(&mut e.sim.crowd, &e.sim.tower, 1, 2, Some(30), Some(11)).unwrap();
    let p = &mut e.sim.crowd.people[i];
    p.errand = Some(Errand {
        place: ErrandPlace::Office,
        inbound: true,
    });
    p.wait = 12.0;
    let id = p.id;
    let r = e.port_person_card(id as f64);
    assert_eq!(r.len(), PERSON_CARD.len());
    assert_eq!(at(&r, "id"), id as f64);
    assert_eq!(
        at(&r, "purpose"),
        Purpose::ALL
            .iter()
            .position(|p| *p == Purpose::ToWork)
            .unwrap() as f64
    );
    assert_eq!(at(&r, "fromPlace"), 3.0, "lobby");
    assert_eq!(at(&r, "fromFloor"), 1.0);
    assert!(at(&r, "fromUnit").is_nan());
    assert_eq!(at(&r, "toPlace"), 1.0, "room");
    assert_eq!(at(&r, "toUnit"), office as f64);
    assert_eq!(at(&r, "toKind"), Kind::Office as usize as f64);
    assert_eq!(at(&r, "toFloor"), 2.0);
    assert_eq!(at(&r, "wait"), 12.0);
    assert_eq!(
        at(&r, "waitMinutes"),
        12.0 / crate::crowd::CROWD_SECONDS_PER_MINUTE
    );
    assert_eq!(at(&r, "staff"), 0.0);
    assert!(at(&r, "shiftStep").is_nan());
    assert_eq!(at(&r, "shaftId"), e.sim.tower.transports[0].id as f64);
}

#[test]
fn nobody_and_a_bad_id_answer_an_empty_card() {
    let (mut e, _) = office_tower();
    add(&mut e.sim.crowd, &e.sim.tower, 1, 2, Some(30), Some(11)).unwrap();
    add(&mut e.sim.crowd, &e.sim.tower, 1, 3, Some(31), Some(12)).unwrap();
    let ids: Vec<i64> = e.sim.crowd.people.iter().map(|p| p.id).collect();
    // The first walks out of the picture; the second is still found.
    e.sim.crowd.people.remove(0);
    assert!(e.port_person_card(ids[0] as f64).is_empty());
    assert_eq!(at(&e.port_person_card(ids[1] as f64), "id"), ids[1] as f64);
    for bad in [f64::NAN, 1.5, -1.0, 1e300] {
        assert!(e.port_person_card(bad).is_empty(), "{bad}");
    }
}

#[test]
fn the_layout_names_the_card_and_its_codes() {
    let mut layout = serde_json::json!({ "records": {} });
    add_person_records(&mut layout);
    assert_eq!(
        layout["records"]["personCard"],
        serde_json::json!(PERSON_CARD)
    );
    assert_eq!(layout["tripPlaces"][3], "lobby");
    assert_eq!(
        layout["personPurposes"].as_array().unwrap().len(),
        Purpose::ALL.len()
    );
    assert_eq!(
        layout["shiftSteps"].as_array().unwrap().len(),
        SHIFT_STEPS.len()
    );
    for (i, s) in SHIFT_STEPS.iter().enumerate() {
        // The names follow the steps' order.
        assert_eq!(format!("{s:?}").to_lowercase(), SHIFT_STEP_NAMES[i]);
    }
}
