//! The stop sets answer what `Transport::stops_at` answers, for every floor
//! of every shaft, and follow a stop toggle and a resize (#1984).

use super::*;
use crate::facilities::{Kind, MAX_FLOOR, MIN_FLOOR};

/// A tower with floors 1 to 20 over tiles 0 to 39 and a standard elevator
/// from 1 to 20 at tile 5; its id.
fn tower() -> (Tower, i64) {
    let mut t = Tower::new();
    for x in 0..40 {
        assert!(t.place(Kind::Lobby, 1, x).ok);
    }
    for fl in 2..=20 {
        for x in 0..40 {
            assert!(t.place(Kind::Floor, fl, x).ok);
        }
    }
    let r = t.place_transport(Kind::ElevatorStandard, 5, 1, 20);
    assert!(r.ok, "{:?}", r.reason);
    (t, r.unit_id.unwrap())
}

fn agrees(t: &Tower, id: i64) {
    let shaft = t.get_transport(id).unwrap();
    for fl in MIN_FLOOR - 2..=MAX_FLOOR + 6 {
        assert_eq!(t.stops_at_id(id, fl), shaft.stops_at(fl), "floor {fl}");
    }
}

#[test]
fn the_sets_follow_stop_toggles_and_a_resize() {
    let (mut t, id) = tower();
    agrees(&t, id);
    for fl in [3, 7, 8, 15] {
        assert!(t.set_stop(id, fl, false));
    }
    assert!(!t.stops_at_id(id, 7), "a skipped floor");
    assert!(t.stops_at_id(id, 6));
    agrees(&t, id);
    assert!(t.set_stop(id, 7, true));
    assert!(t.stops_at_id(id, 7), "the stop came back");
    agrees(&t, id);
    assert!(t.resize_transport(id, 1, 12).ok);
    assert!(!t.stops_at_id(id, 13), "past the new top");
    agrees(&t, id);
}

#[test]
fn a_skip_list_a_save_carries_reads_the_same() {
    let (mut t, id) = tower();
    let i = t.transport_index(id).unwrap();
    // Fractions, floors outside the span, a negative zero, NaN and an
    // infinity skip nothing; the whole floors inside the span do.
    t.transports[i].skip_floors = Some(vec![4.0, 4.5, -0.0, 25.0, f64::NAN, f64::INFINITY, 9.0]);
    t.revision += 1;
    agrees(&t, id);
    assert!(!t.stops_at_id(id, 9) && t.stops_at_id(id, 10));
}

#[test]
fn an_unknown_shaft_stops_nowhere() {
    let (t, id) = tower();
    assert!(!t.stops_at_id(id + 1000, 5));
}

/// Every floor's serving classes read from the sets match the walk.
fn classes_agree(t: &Tower) {
    for fl in MIN_FLOOR - 2..=MAX_FLOOR + 6 {
        assert_eq!(
            t.serving_transport_kinds_at(fl),
            t.serving_kinds_by_walk(fl),
            "floor {fl}"
        );
    }
}

#[test]
fn the_class_sets_name_the_passenger_classes_serving_each_floor() {
    let (mut t, id) = tower();
    classes_agree(&t);
    assert_eq!(t.serving_transport_kinds_at(9), (true, false, false));
    // A staff-only shaft counts as no class.
    let service = t.place_transport(Kind::ElevatorService, 12, 1, 20);
    assert!(service.ok, "{:?}", service.reason);
    assert!(t.set_stop(id, 9, false));
    assert_eq!(t.serving_transport_kinds_at(9), (false, false, false));
    let stairs = t.place_transport(Kind::Stairs, 20, 8, 9);
    assert!(stairs.ok, "{:?}", stairs.reason);
    let escalator = t.place_transport(Kind::Escalator, 30, 9, 10);
    assert!(escalator.ok, "{:?}", escalator.reason);
    assert_eq!(t.serving_transport_kinds_at(9), (false, true, true));
    assert_eq!(t.serving_transport_kinds_at(8), (true, true, false));
    assert_eq!(t.serving_transport_kinds_at(21), (false, false, false));
    classes_agree(&t);
}
