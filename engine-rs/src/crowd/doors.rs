//! Which way in or out of a floor someone takes when the trip names no
//! spot on it: the ground lobby a shopper comes in by, the lobby a
//! commuter heads home through, the platform a Metro rider leaves from.
//!
//! A floor can hold several runs that do not touch: three towers on one
//! lot, each with its own ground lobby and green space between them. Each
//! such trip uses the run nearest the other end of the trip that a route
//! reaches, so a shopper walks in and out through the lobby under their
//! shop instead of the lot's leftmost one (the r/tycoon report on 3.12.0,
//! where everyone rode down to B10 and across to the left tower to leave).
//! A floor with one run answers as before.

use super::routing::{parts_split, passenger_parts};
use super::spawn::{pick_x, pick_x_in_segment};
use super::{Crowd, Route};
use crate::tower::Tower;

/// How far `x` is from the run `start..=end`, 0 inside it.
fn distance_to_run(x: f64, (start, end): (i64, i64)) -> f64 {
    (start as f64 - x).max(x - end as f64).max(0.0)
}

/// The runs of `floor` that the passenger graph joins to `fixed` (a
/// segment), nearest `anchor_x` first; equally near runs keep their left
/// to right order. Empty when `floor` has one run or none, where the
/// caller's old pick stands.
fn candidate_runs(
    crowd: &mut Crowd,
    tower: &Tower,
    floor: i64,
    anchor_x: f64,
    fixed: i64,
) -> Vec<(i64, i64)> {
    let mut runs = tower.segments_of(floor);
    if runs.len() <= 1 {
        return Vec::new();
    }
    let parts = passenger_parts(crowd, tower);
    runs.retain(|&(start, _)| !parts_split(parts, fixed, crate::tower_query::seg_id(floor, start)));
    runs.sort_by(|&a, &b| distance_to_run(anchor_x, a).total_cmp(&distance_to_run(anchor_x, b)));
    runs
}

/// A route from (`from`, `from_x`) to `to`, ending in the run of `to`
/// nearest `from_x` that it reaches, and the tile it ends on there (the
/// seed's tile in that run). `None` when `to` has a single run (or none),
/// or no run of it is reachable: the caller then routes as it always has.
pub fn route_out_nearest(
    crowd: &mut Crowd,
    tower: &Tower,
    from: i64,
    from_x: f64,
    to: i64,
    seed: i32,
) -> Option<(Route, i64)> {
    let fixed = tower.seg_at(from, Some(from_x));
    for run in candidate_runs(crowd, tower, to, from_x, fixed) {
        let x = pick_x_in_segment(tower, to, seed, run.0);
        if let Some(r) = crowd.route(tower, from, to, Some(from_x), Some(x as f64)) {
            return Some((r, x));
        }
    }
    None
}

/// The tile of `floor` for the open end of a trip whose other end is
/// (`other`, `other_x`): in the run of `floor` nearest `other_x` that a
/// route joins to it. With one run, or none joined, the seed's tile
/// anywhere on the floor, as `pick_x` always chose.
pub fn door_x(
    crowd: &mut Crowd,
    tower: &Tower,
    floor: i64,
    other: i64,
    other_x: f64,
    seed: i32,
) -> i64 {
    let fixed = tower.seg_at(other, Some(other_x));
    match candidate_runs(crowd, tower, floor, other_x, fixed).first() {
        Some(run) => pick_x_in_segment(tower, floor, seed, run.0),
        None => pick_x(tower, floor, seed),
    }
}
