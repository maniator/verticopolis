//! Port of `crowd/walk.ts`.

use super::motion::give_up;
use super::street::walks_off_run;
use super::{Crowd, PState, Person, WALK_SPEED};
use crate::jsmath;
use crate::tower::Tower;

/// Walk toward a tile x on the current floor; true once arrived. A walker
/// stops at the end of their run, except on the street floor in a mode
/// that walks the street, where they carry on along the sidewalk
/// (`crowd::street`).
pub fn walk_to(p: &mut Person, target_x: f64, dt: f64, tower: &Tower) -> bool {
    let dir = jsmath::sign(target_x - p.x);
    if dir != 0.0 && !walks_off_run(tower, p.floor) {
        if let Some((start, end)) = tower.run_at(p.floor, jsmath::round(p.x) as i64) {
            if dir > 0.0 && target_x > end as f64 {
                p.x = end as f64;
                return true;
            }
            if dir < 0.0 && target_x < start as f64 {
                p.x = start as f64;
                return true;
            }
        }
    }
    let dx = target_x - p.x;
    let step = WALK_SPEED * dt;
    if dx.abs() <= step {
        p.x = target_x;
        return true;
    }
    p.x += dir * step;
    false
}

/// Whether the place `p` walks toward at `target_x` stands on another run of
/// their floor than the one under them, so no walk along the floor reaches
/// it: a sky bridge or the floor between was bulldozed while they were on
/// their way. The ground floor is left to the street (`crowd::street`).
pub fn way_is_cut(p: &Person, target_x: f64, tower: &Tower) -> bool {
    if p.floor == 1 {
        return false;
    }
    let here = tower.run_at(p.floor, jsmath::round(p.x) as i64);
    let there = tower.run_at(p.floor, jsmath::round(target_x) as i64);
    here.is_some() && there.is_some() && here != there
}

/// Where a walker on their own run of the floor reaches a shaft or flight
/// whose columns `x .. x + width` stand over a gap: the column nearest
/// `target_x` on the walker's side. `None` when no column of it stands on
/// the walker's run, so the gap really cuts them off from it.
pub fn reach_on_run(p: &Person, x: i64, width: i64, target_x: f64, tower: &Tower) -> Option<f64> {
    let (start, end) = tower.run_at(p.floor, jsmath::round(p.x) as i64)?;
    let first = x.max(start);
    let last = (x + width - 1).min(end);
    (first <= last).then(|| target_x.clamp(first as f64, last as f64))
}

/// Someone whose way along the floor was cut finds another way from where
/// they stand, and never steps over the gap. A housekeeper, or anyone with
/// no other way, gives up as a stuck walker does.
pub fn find_another_way(crowd: &mut Crowd, i: usize, tower: &mut Tower) {
    if crowd.people[i].staff_trip.is_some() || !reroute(crowd, i, tower) {
        give_up(crowd, i, tower);
    }
}

/// Sends someone on foot partway through a trip on to the trip's last floor
/// by a new route from where they stand. `false` when there is none.
pub(super) fn reroute(crowd: &mut Crowd, i: usize, tower: &Tower) -> bool {
    let p = &crowd.people[i];
    let (from, from_x, dest_x) = (p.floor, p.x, p.dest_x);
    let Some(&to) = p.floors.last() else {
        return false;
    };
    let Some(r) = crowd.route(tower, from, to, Some(from_x), Some(dest_x)) else {
        return false;
    };
    let p = &mut crowd.people[i];
    p.state = if r.shafts.is_empty() {
        PState::ToDest
    } else {
        PState::ToShaft
    };
    p.shaft_id = r.shafts.first().copied();
    p.floors = r.floors;
    p.shafts = r.shafts;
    p.leg = 0;
    p.car_index = None;
    p.fy = from as f64;
    p.wait = 0.0;
    true
}
