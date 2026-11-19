//! The shaft floor refusal (#1261) answers what the floors-by-shafts walk it
//! replaced answered, on every probe of a tower with gaps and stacked flights.

use super::*;

/// The walk `validate_transport` ran before #1261: every floor of the new
/// shaft, then every built shaft on that floor.
fn floors_by_shafts(
    t: &Tower,
    kind: Kind,
    x: i64,
    width: i64,
    bottom: i64,
    top: i64,
) -> Option<&'static str> {
    for fl in bottom..=top {
        if !t.shaft_has_structure_at(fl, x, width) {
            return Some(NEEDS_FLOORS);
        }
        for s in &t.transports {
            let overlaps = fl >= s.bottom && fl <= s.top && x < s.x + s.width && x + width > s.x;
            let stacked = kind.is_fixed_span()
                && s.kind.is_fixed_span()
                && s.x == x
                && s.width == width
                && (bottom == s.top || top == s.bottom);
            if overlaps && !stacked {
                return Some(SHAFT_OVERLAP);
            }
        }
    }
    None
}

/// A lobby across 0..40, full floors 2 to 12 but for a gap in floor 9 at x
/// 36, and floors 13 to 16 over the left half only, with elevators (two of
/// them in the gap's column, either side of it), a stacked pair of stairs
/// and an escalator.
fn tower_with_gaps() -> Tower {
    let mut t = Tower::new();
    let w = Kind::ElevatorStandard.facility().width;
    for x in 0..40 {
        assert!(t.place(Kind::Lobby, 1, x).ok);
    }
    for fl in 2..=16 {
        let right = if fl <= 12 { 40 } else { 20 };
        for x in 0..right {
            assert!(t.place(Kind::Floor, fl, x).ok, "floor {fl} at {x}");
        }
    }
    for (kind, x, bottom, top) in [
        (Kind::ElevatorStandard, 2, 1, 8),
        (Kind::ElevatorStandard, 10, 3, 14),
        (Kind::Stairs, 20, 1, 2),
        (Kind::Stairs, 20, 2, 3),
        (Kind::Escalator, 28, 4, 5),
        (Kind::ElevatorStandard, 36, 10, 12),
        (Kind::ElevatorStandard, 36, 3, 7),
    ] {
        let r = t.place_transport(kind, x, bottom, top);
        assert!(r.ok, "{kind:?} at {x}: {:?}", r.reason);
    }
    for x in 36..36 + w {
        let id = t.structure[&(9, x)];
        assert!(t.remove_unit(id).is_some(), "floor 9 at {x}");
    }
    t
}

#[test]
fn one_pass_answers_what_the_floor_walk_answered() {
    let t = tower_with_gaps();
    let kinds = [
        Kind::ElevatorStandard,
        Kind::ElevatorExpress,
        Kind::ElevatorService,
        Kind::Stairs,
        Kind::Escalator,
    ];
    let mut seed: u64 = 0x2545_f491_4f6c_dd1d;
    let mut next = |n: u64| {
        seed = seed
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        (seed >> 33) % n
    };
    let (mut needs, mut overlap, mut clear) = (0, 0, 0);
    for _ in 0..20_000 {
        let kind = kinds[next(kinds.len() as u64) as usize];
        let width = kind.facility().width;
        let x = next(46) as i64 - 3;
        let bottom = next(18) as i64;
        let top = bottom + 1 + next(8) as i64;
        let want = floors_by_shafts(&t, kind, x, width, bottom, top);
        assert_eq!(
            t.shaft_floor_refusal(kind, x, width, bottom, top),
            want,
            "{kind:?} at {x}, floors {bottom}..={top}"
        );
        match want {
            Some(NEEDS_FLOORS) => needs += 1,
            Some(_) => overlap += 1,
            None => clear += 1,
        }
    }
    // The probes reach every answer, so the comparison means something.
    assert!(
        needs > 100 && overlap > 100 && clear > 100,
        "{needs} {overlap} {clear}"
    );
}

#[test]
fn the_lowest_failing_floor_wins_and_a_missing_floor_beats_an_overlap() {
    let t = tower_with_gaps();
    let w = Kind::ElevatorStandard.facility().width;
    // The shaft at x 10 starts on floor 3; floor 13 is missing at x 30.
    assert_eq!(
        t.shaft_floor_refusal(Kind::ElevatorStandard, 10, w, 1, 4),
        Some(SHAFT_OVERLAP)
    );
    assert_eq!(
        t.shaft_floor_refusal(Kind::ElevatorStandard, 30, w, 10, 14),
        Some(NEEDS_FLOORS)
    );
    // At x 36 the lower shaft's overlap on floor 3 comes before the floor 9
    // gap, which comes before the upper shaft's overlap on floor 10.
    assert_eq!(
        t.shaft_floor_refusal(Kind::ElevatorStandard, 36, w, 2, 12),
        Some(SHAFT_OVERLAP)
    );
    assert_eq!(
        t.shaft_floor_refusal(Kind::ElevatorStandard, 36, w, 8, 12),
        Some(NEEDS_FLOORS)
    );
    // Floor 0 has no structure and the shaft at x 2 is in the way above it.
    assert_eq!(
        t.shaft_floor_refusal(Kind::ElevatorStandard, 2, w, 0, 3),
        Some(NEEDS_FLOORS)
    );
    // Over the left half the overlap on floor 3 comes before the gap.
    assert_eq!(
        t.shaft_floor_refusal(Kind::ElevatorStandard, 10, w, 3, 18),
        Some(SHAFT_OVERLAP)
    );
}

#[test]
fn a_flight_on_top_of_a_flight_is_a_stack() {
    let t = tower_with_gaps();
    let w = Kind::Stairs.facility().width;
    assert_eq!(t.shaft_floor_refusal(Kind::Stairs, 20, w, 3, 4), None);
    assert_eq!(
        t.shaft_floor_refusal(Kind::Stairs, 20, w, 1, 2),
        Some(SHAFT_OVERLAP)
    );
    assert_eq!(t.shaft_floor_refusal(Kind::Escalator, 20, w, 3, 4), None);
}

/// Each probe twice, so the second reads the column index built for the
/// revision, against the walk.
fn probe_twice(t: &Tower, kind: Kind, x: i64, bottom: i64, top: i64) -> Option<&'static str> {
    let width = kind.facility().width;
    let want = floors_by_shafts(t, kind, x, width, bottom, top);
    for _ in 0..2 {
        assert_eq!(t.shaft_floor_refusal(kind, x, width, bottom, top), want);
    }
    want
}

#[test]
fn the_column_index_follows_every_shaft_edit() {
    let mut t = tower_with_gaps();
    let e = Kind::ElevatorStandard;
    assert_eq!(probe_twice(&t, e, 15, 2, 6), None);
    let r = t.place_transport(e, 15, 2, 6);
    assert!(r.ok, "{:?}", r.reason);
    assert_eq!(probe_twice(&t, e, 15, 2, 6), Some(SHAFT_OVERLAP));
    let id = t.transports.last().unwrap().id;
    assert!(t.resize_transport(id, 2, 4).ok);
    assert_eq!(probe_twice(&t, e, 15, 5, 8), None);
    assert!(t.resize_transport(id, 2, 8).ok);
    assert_eq!(probe_twice(&t, e, 15, 5, 8), Some(SHAFT_OVERLAP));
    assert!(t.remove_transport(id).is_some());
    assert_eq!(probe_twice(&t, e, 15, 2, 6), None);
    // An undo step takes a shaft out and puts one back without a probe in
    // between, so the count matches while the columns do not.
    let mut moved = t.remove_transport(t.transports[0].id).unwrap();
    moved.x = 15;
    t.insert_transport_at(0, moved);
    assert_eq!(probe_twice(&t, e, 15, 2, 6), Some(SHAFT_OVERLAP));
    assert_eq!(probe_twice(&t, e, 2, 2, 6), None);
}
