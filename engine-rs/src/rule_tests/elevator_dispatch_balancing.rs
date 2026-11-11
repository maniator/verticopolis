//! Shaft fairness across a bank of equivalent elevators (#303): identical
//! trips spread over every shaft of the bank on the seeded crowd stream, the
//! spread is the same run to run, a lone shaft and the reachability probe
//! draw nothing, and the raw search without the balancing funnels every trip
//! onto one shaft. No other Rust test covered these rules.
use std::collections::BTreeMap;

use crate::crowd::routing::{adjacency, bfs_route};
use crate::crowd::Crowd;
use crate::facilities::Kind;
use crate::tower::Tower;

/// The trip every test routes: the lobby to floor 8.
const FROM: i64 = 1;
const TO: i64 = 8;
/// A draw range wide enough that two streams agreeing by chance is unlikely.
const DRAW_MAX: i64 = 1_000_000;

/// A lobby, floors 2 to 10, and `shafts` standard elevators with the same
/// span at distinct columns. Returns the tower and the shaft ids.
fn tower_with_bank(shafts: i64) -> (Tower, Vec<i64>) {
    let mut tower = Tower::new();
    for x in 0..40 {
        assert!(tower.place(Kind::Lobby, 1, x).ok);
    }
    for floor in 2..=10 {
        for x in 0..40 {
            assert!(tower.place(Kind::Floor, floor, x).ok);
        }
    }
    let ids = (0..shafts)
        .map(|s| {
            let r = tower.place_transport(Kind::ElevatorStandard, 4 + s * 4, 1, 10);
            assert!(r.ok, "bank shaft {s}: {:?}", r.reason);
            r.unit_id.unwrap()
        })
        .collect();
    (tower, ids)
}

/// The shaft each of `trips` identical trips is assigned to.
fn assignments(crowd: &mut Crowd, tower: &Tower, trips: usize) -> Vec<i64> {
    (0..trips)
        .map(|_| {
            let r = crowd.route(tower, FROM, TO, None, None).expect("a route");
            assert_eq!(r.shafts.len(), 1, "one ride");
            r.shafts[0]
        })
        .collect()
}

fn counts(picks: &[i64]) -> BTreeMap<i64, usize> {
    let mut out = BTreeMap::new();
    for id in picks {
        *out.entry(*id).or_insert(0) += 1;
    }
    out
}

#[test]
fn identical_trips_spread_across_both_shafts_of_a_two_shaft_bank() {
    let (tower, ids) = tower_with_bank(2);
    let trips = 200;
    let by_shaft = counts(&assignments(&mut Crowd::new(1234), &tower, trips));
    assert_eq!(by_shaft.len(), 2);
    for id in ids {
        let n = by_shaft.get(&id).copied().unwrap_or(0);
        assert!(n * 5 > trips, "shaft {id} took {n} of {trips}");
    }
}

#[test]
fn the_same_seed_gives_the_same_assignments() {
    let (a, _) = tower_with_bank(2);
    let (b, _) = tower_with_bank(2);
    let first = assignments(&mut Crowd::new(99), &a, 150);
    assert_eq!(first, assignments(&mut Crowd::new(99), &b, 150));
    assert!(counts(&first).len() == 2, "the stream did spread");
}

#[test]
fn every_shaft_of_a_three_shaft_bank_is_used() {
    let (tower, ids) = tower_with_bank(3);
    let by_shaft = counts(&assignments(&mut Crowd::new(7), &tower, 300));
    for id in ids {
        assert!(by_shaft.contains_key(&id), "shaft {id} never used");
    }
}

#[test]
fn a_lone_shaft_draws_nothing_from_the_crowd_stream() {
    let (tower, _) = tower_with_bank(1);
    let mut routed = Crowd::new(555);
    let mut untouched = Crowd::new(555);
    assert!(routed.route(&tower, FROM, TO, None, None).is_some());
    assert_eq!(routed.rng.int(0, DRAW_MAX), untouched.rng.int(0, DRAW_MAX));
}

#[test]
fn the_reachability_probe_draws_nothing_even_on_a_bank() {
    let (tower, _) = tower_with_bank(2);
    let mut probed = Crowd::new(2024);
    let mut untouched = Crowd::new(2024);
    assert!(probed.reachable(&tower, FROM, TO, None, None));
    assert_eq!(probed.rng.int(0, DRAW_MAX), untouched.rng.int(0, DRAW_MAX));
    // A route on the same bank does draw, so the probe's silence is its own.
    let mut routed = Crowd::new(2024);
    assert!(routed.route(&tower, FROM, TO, None, None).is_some());
    let mut fresh = Crowd::new(2024);
    assert_ne!(routed.rng.int(0, DRAW_MAX), fresh.rng.int(0, DRAW_MAX));
}

#[test]
fn without_the_balancing_the_raw_search_funnels_every_trip_onto_one_shaft() {
    let (tower, _) = tower_with_bank(2);
    let mut crowd = Crowd::new(1234);
    let (from, to) = (tower.seg_at(FROM, None), tower.seg_at(TO, None));
    let graph = adjacency(&mut crowd, &tower);
    let mut raw = std::collections::BTreeSet::new();
    for _ in 0..50 {
        raw.insert(bfs_route(graph, from, to).expect("a path").shafts[0]);
    }
    assert_eq!(raw.len(), 1);
}
