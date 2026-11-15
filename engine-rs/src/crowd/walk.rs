//! Port of `crowd/walk.ts`.

use super::motion::{give_up, reroute};
use super::street::walks_off_run;
use super::{Crowd, Person, WALK_SPEED};
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

/// Someone whose way along the floor was cut finds another way from where
/// they stand, and never steps over the gap. A housekeeper, or anyone with
/// no other way, gives up as a stuck walker does.
pub fn find_another_way(crowd: &mut Crowd, i: usize, tower: &mut Tower) {
    if crowd.people[i].staff_trip.is_some() || !reroute(crowd, i, tower) {
        give_up(crowd, i, tower);
    }
}
