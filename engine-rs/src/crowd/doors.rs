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
    let shared = tower.segment_runs(floor);
    if shared.len() <= 1 {
        return Vec::new();
    }
    let mut runs = shared.to_vec();
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
    route_open_end(crowd, tower, to, (from, from_x), false, seed)
}

/// A route for a trip with one end fixed at (`fixed.0`, `fixed.1`) and the
/// other open on `open`: the open end tries each run of `open` the
/// passenger graph joins to the fixed end, nearest first, and takes the
/// first one a route reaches (Classic's walk budget can refuse a joined
/// run). Answers the route and the open end's tile. `None` when `open` has
/// one run (or none) or no run routes: the caller then routes as it always
/// has. `open_is_from` says which end of the trip is open.
pub fn route_open_end(
    crowd: &mut Crowd,
    tower: &Tower,
    open: i64,
    (fixed_floor, fixed_x): (i64, f64),
    open_is_from: bool,
    seed: i32,
) -> Option<(Route, i64)> {
    let fixed = tower.seg_at(fixed_floor, Some(fixed_x));
    for run in candidate_runs(crowd, tower, open, fixed_x, fixed) {
        let x = pick_x_in_segment(tower, open, seed, run.0);
        let r = if open_is_from {
            crowd.route(tower, open, fixed_floor, Some(x as f64), Some(fixed_x))
        } else {
            crowd.route(tower, fixed_floor, open, Some(fixed_x), Some(x as f64))
        };
        if let Some(r) = r {
            return Some((r, x));
        }
    }
    None
}

/// The tiles of `floor` to try, nearest `anchor_x` first, for a trip whose
/// end there is open but whose network the passenger graph does not
/// describe (a housekeeper's commute, which keeps to the staff network when
/// it can): one tile in each run, the seed's tile in it, worked out only
/// when the caller gets to that run. Each comes with its run's first tile,
/// for [`passenger_joins`]. A floor with one run (or none) yields only the
/// tile `pick_x` always picked, with no run, and copies nothing.
pub fn tiles_nearest(
    tower: &Tower,
    floor: i64,
    anchor_x: f64,
    seed: i32,
) -> impl Iterator<Item = (Option<i64>, i64)> + '_ {
    let shared = tower.segment_runs(floor);
    let (single, mut runs) = if shared.len() <= 1 {
        (Some(pick_x(tower, floor, seed)), Vec::new())
    } else {
        (None, shared.to_vec())
    };
    runs.sort_by(|&a, &b| distance_to_run(anchor_x, a).total_cmp(&distance_to_run(anchor_x, b)));
    single.map(|x| (None, x)).into_iter().chain(
        runs.into_iter()
            .map(move |(start, _)| (Some(start), pick_x_in_segment(tower, floor, seed, start))),
    )
}

/// Whether a passenger route may join the run of `floor` starting at
/// `run_start` to the segment `other`: false only when the passenger graph
/// puts them in different parts, so the search would fail. No run (a floor
/// with one) always may.
pub fn passenger_joins(
    crowd: &mut Crowd,
    tower: &Tower,
    floor: i64,
    run_start: Option<i64>,
    other: i64,
) -> bool {
    run_start.is_none_or(|start| {
        let parts = passenger_parts(crowd, tower);
        !parts_split(parts, other, crate::tower_query::seg_id(floor, start))
    })
}
