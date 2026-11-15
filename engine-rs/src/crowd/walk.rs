//! Port of `crowd/walk.ts`.

use super::motion::give_up;
use super::street::walks_off_run;
use super::{Crowd, PState, Person, Route, WALK_SPEED};
use crate::jsmath;
use crate::tower::Tower;

/// Walk toward a tile x on the current floor; true once arrived. A walker
/// whose target lies past the end of their run walks to that end and
/// stops there, at walking speed like any other step (nobody jumps along
/// the floor), except on the street floor in a mode that walks the street,
/// where they carry on along the sidewalk (`crowd::street`).
pub fn walk_to(p: &mut Person, target_x: f64, dt: f64, tower: &Tower) -> bool {
    let mut target_x = target_x;
    let dir = jsmath::sign(target_x - p.x);
    if dir != 0.0 && !walks_off_run(tower, p.floor) {
        if let Some((start, end)) = tower.run_at(p.floor, jsmath::round(p.x) as i64) {
            if dir > 0.0 && target_x > end as f64 {
                target_x = end as f64;
            } else if dir < 0.0 && target_x < start as f64 {
                target_x = start as f64;
            }
        }
    }
    let dir = jsmath::sign(target_x - p.x);
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
    take_route(crowd, i, r);
    true
}

/// Sets someone standing at `p.floor` on route `r` from there.
pub(super) fn take_route(crowd: &mut Crowd, i: usize, r: Route) {
    let from = crowd.people[i].floor;
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
}

/// A rider whose car stopped going their way: the car or shaft went, or the
/// floor they ride to stopped being a stop. Nobody vanishes from the cab
/// (#2324): a rider whose floor stopped being a stop rides on to the stop
/// nearest it and goes on from there by a new route. A rider whose car went,
/// or with no way on from any stop, steps out of the trip as before (3.7.3).
pub(super) fn ride_on_or_step_out(crowd: &mut Crowd, i: usize, tower: &mut Tower) {
    if !ride_to_nearest_stop(crowd, i, tower) {
        give_up(crowd, i, tower);
    }
}

/// Points a rider whose floor stopped being a stop at the car's stop nearest
/// that floor (of two as near, the one nearer the car), with a new route on
/// from there to the trip's last floor. `false` when the car is gone, the
/// shaft stops nowhere, or no route leads on.
fn ride_to_nearest_stop(crowd: &mut Crowd, i: usize, tower: &Tower) -> bool {
    let p = &crowd.people[i];
    let Some(shaft) = p.shaft_id.and_then(|id| tower.get_transport(id)) else {
        return false;
    };
    let Some(&car) = p
        .car_index
        .and_then(|ci| shaft.car_positions.get(ci as usize))
    else {
        return false;
    };
    let (leg, dest_x) = (p.leg, p.dest_x);
    let (Some(&dest), Some(&to)) = (p.floors.get(leg + 1), p.floors.last()) else {
        return false;
    };
    let nearness = |s: i64| ((s - dest).abs(), (s as f64 - car).abs());
    let Some(stop) = tower.stops_of(shaft).into_iter().min_by(|&a, &b| {
        let (da, ca) = nearness(a);
        let (db, cb) = nearness(b);
        da.cmp(&db).then(ca.total_cmp(&cb)).then(a.cmp(&b))
    }) else {
        return false;
    };
    let on = if stop == to {
        Route {
            floors: vec![stop],
            shafts: Vec::new(),
        }
    } else {
        let x = shaft.x as f64 + shaft.width as f64 / 2.0;
        match crowd.route(tower, stop, to, Some(x), Some(dest_x)) {
            Some(r) => r,
            None => return false,
        }
    };
    let p = &mut crowd.people[i];
    p.floors.truncate(leg + 1);
    p.floors.extend(on.floors);
    p.shafts.truncate(leg + 1);
    p.shafts.extend(on.shafts);
    true
}
