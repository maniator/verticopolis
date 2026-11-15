//! The street: in Modern, ground lobbies that do not touch (towers on one
//! lot with open ground between them) are joined by the sidewalk out front.
//! A trip from one tower to another may step out of one lobby, walk along
//! the street and come in by the other, as a person would, instead of
//! having no way across (owner, 2026-11-14). The router prices the walk
//! across the open ground (`expected_time`), and a walker on the street
//! floor walks past the end of a lobby onto the sidewalk (`walk::walk_to`).
//! Classic keeps to the 1994 game, where a trip goes only through the tower
//! ([`GameMode::walks_the_street`](crate::clock::GameMode::walks_the_street)).

use super::staff_shift::STREET_FLOOR;
use super::WALK_SPEED;
use crate::tower::Tower;
use crate::tower_query::seg_id;

/// What a tile of sidewalk costs, in crowd seconds: the time to walk it.
pub const STREET_SECONDS_PER_TILE: f64 = 1.0 / WALK_SPEED;

/// The street's links, for the router: each ground lobby run to its
/// neighbor on either side, as (from segment, to segment, crowd seconds to
/// walk the open ground between them). Empty in a mode that keeps to the
/// tower, or with one ground lobby run.
pub fn links(tower: &Tower) -> Vec<(i64, i64, f64)> {
    if !tower.mode.walks_the_street() {
        return Vec::new();
    }
    let runs = tower.segment_runs(STREET_FLOOR);
    let mut out = Vec::with_capacity(2 * runs.len().saturating_sub(1));
    for pair in runs.windows(2) {
        let (left, right) = (pair[0], pair[1]);
        let (a, b) = (seg_id(STREET_FLOOR, left.0), seg_id(STREET_FLOOR, right.0));
        let seconds = (right.0 - left.1) as f64 * STREET_SECONDS_PER_TILE;
        out.push((a, b, seconds));
        out.push((b, a, seconds));
    }
    out
}

/// Whether someone walking on `floor` may walk past the end of the run
/// they stand on: on the street floor, in a mode that walks the street.
pub fn walks_off_run(tower: &Tower, floor: i64) -> bool {
    floor == STREET_FLOOR && tower.mode.walks_the_street()
}

/// The segment a route from (`floor`, `x`) starts on when `x` is out on the
/// street, off every lobby run: the nearest run, nearer left on a tie, so
/// someone caught on the sidewalk by a tower edit finds a new way instead
/// of dropping out of the trip. `None` anywhere else.
pub fn street_start(tower: &Tower, floor: i64, x: Option<f64>) -> Option<i64> {
    let x = x?;
    if !walks_off_run(tower, floor) {
        return None;
    }
    let runs = tower.segment_runs(floor);
    if runs
        .iter()
        .any(|&(start, end)| x >= start as f64 && x <= end as f64)
    {
        return None;
    }
    let away = |&(start, end): &(i64, i64)| (start as f64 - x).max(x - end as f64);
    let nearest = runs.iter().min_by(|a, b| away(a).total_cmp(&away(b)))?;
    Some(seg_id(floor, nearest.0))
}
