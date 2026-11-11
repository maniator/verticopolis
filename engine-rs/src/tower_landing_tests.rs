//! Tests for `landing_segs`: the run a flight lands on is the run of the
//! leftmost built column under its footprint, which is the column the
//! renderer's walkers stand at (`landingTile`, `towerWalkerBuild.ts`). Two
//! runs under one footprint are both linked (#662), leftmost first.
use crate::facilities::{Kind, NEEDS_FLOORS};
use crate::tower::{Tower, Transport};

/// A lobby across floor 1 at x 6..30 and floor tiles on floor 2 over each
/// `(from, to)` run of `floor2`, `to` excluded.
fn site(floor2: &[(i64, i64)]) -> Tower {
    let mut tower = Tower::new();
    for x in 6..30 {
        assert!(tower.place(Kind::Lobby, 1, x).ok, "lobby at {x}");
    }
    for &(from, to) in floor2 {
        for x in from..to {
            assert!(tower.place(Kind::Floor, 2, x).ok, "floor at {x}");
        }
    }
    tower
}

/// A stair at x 10 from floor 1 to 2, which must place.
fn stair(tower: &mut Tower) -> Transport {
    let res = tower.place_transport(Kind::Stairs, 10, 1, 2);
    assert!(res.ok, "{:?}", res.reason);
    tower.transports[0].clone()
}

/// The leftmost built column under the footprint, as `landingTile` picks it.
fn landing_tile(tower: &Tower, t: &Transport, floor: i64) -> i64 {
    (0..t.width)
        .map(|i| t.x + i)
        .find(|&x| tower.has_structure(floor, x))
        .unwrap_or(t.x)
}

/// `landing_segs`' first run is the run of the renderer's landing column, on both floors.
fn assert_parity(tower: &Tower, t: &Transport) {
    for floor in [t.bottom, t.top] {
        let tile = landing_tile(tower, t, floor);
        assert_eq!(
            tower.seg_at(floor, Some(tile as f64)),
            tower.landing_segs(t, floor)[0],
            "floor {floor}"
        );
    }
}

#[test]
fn a_flight_over_a_gap_lands_on_the_first_built_column() {
    let mut tower = site(&[(15, 26)]);
    let t = stair(&mut tower);
    assert!(!tower.has_structure(2, 10));
    assert_parity(&tower, &t);
    assert_eq!(landing_tile(&tower, &t, 2), 15);
    // The footprint's own column would have named a different run.
    assert_ne!(
        tower.seg_at(2, Some(t.x as f64)),
        tower.landing_segs(&t, 2)[0]
    );
}

#[test]
fn a_flight_over_built_floor_lands_at_its_own_column() {
    let mut tower = site(&[(10, 26)]);
    let t = stair(&mut tower);
    assert_parity(&tower, &t);
    assert_eq!(landing_tile(&tower, &t, 2), 10);
}

#[test]
fn a_flight_straddling_two_runs_links_both_leftmost_first() {
    let mut tower = site(&[(10, 12), (15, 26)]);
    let t = stair(&mut tower);
    assert_eq!(tower.segments_of(2), vec![(10, 11), (15, 25)]);
    assert_eq!(
        tower.landing_segs(&t, 2).len(),
        2,
        "the footprint must straddle two runs"
    );
    assert_parity(&tower, &t);
    assert_eq!(landing_tile(&tower, &t, 2), 10);
}

#[test]
fn a_flight_with_no_built_column_is_refused() {
    let mut tower = site(&[(20, 26)]);
    assert!(tower.has_structure(2, 20) && !tower.has_structure(2, 17));
    let res = tower.place_transport(Kind::Stairs, 10, 1, 2);
    assert!(!res.ok);
    assert_eq!(res.reason.as_deref(), Some(NEEDS_FLOORS));
    assert!(tower.transports.is_empty());
}
