//! Port of the retired TypeScript `src/engine/crowd/walk.ts`.

use super::doors::route_out_nearest;
use super::motion::give_up;
use super::street::walks_off_run;
use super::{staff_shift, Crowd, PState, Person, Route, WALK_SPEED};
use crate::jsmath;
use crate::tower::{Tower, Transport};

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
    let (here, there) = (jsmath::round(p.x) as i64, jsmath::round(target_x) as i64);
    if here == there {
        return false;
    }
    // `run_at` for both ends from one read of the floor's runs.
    let runs = tower.segment_runs(p.floor);
    let run_at = |x: i64| runs.iter().take_while(|r| x >= r.0).find(|r| x <= r.1);
    matches!((run_at(here), run_at(there)), (Some(a), Some(b)) if a != b)
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

/// Whether `p` has not yet left the floor their trip began on, outbound:
/// waiting for or walking to their first car or flight of stairs.
pub(super) fn is_still_setting_out(p: &Person) -> bool {
    !p.returning
        && p.leg == 0
        && p.floor == p.origin_floor
        && matches!(p.state, PState::Waiting | PState::ToShaft)
        && p.floors.first() == Some(&p.floor)
}

/// Someone who has waited too long to set out walks back to where they
/// started and leaves from there (`PState::ToDest` with `returning`, which
/// ends the trip on arrival), so they go out the way they came in.
pub(super) fn turn_back(crowd: &mut Crowd, i: usize) {
    let p = &mut crowd.people[i];
    p.state = PState::ToDest;
    p.returning = true;
    p.dest_x = p.start_x;
    p.wait = 0.0;
    p.linger = 0.0;
}

/// A rider whose car stopped going their way: the car or shaft went, or the
/// floor they ride to stopped being a stop. Nobody vanishes from the cab
/// (#2324): a rider whose floor stopped being a stop rides on to the stop
/// nearest it, gets off there and finds a new way on (`find_way_on`). Only
/// a rider whose car went, or on a shaft that stops nowhere, steps out of
/// the trip as before (3.7.3).
pub(super) fn ride_on_or_step_out(crowd: &mut Crowd, i: usize, tower: &mut Tower) {
    if !ride_to_nearest_stop(crowd, i, tower) {
        give_up(crowd, i, tower);
    }
}

/// Sends a rider whose floor stopped being a stop to the car's stop nearest
/// that floor (of two as near, the one nearer the car). The trip on from
/// there is left as the same shaft to the trip's last floor, which it does
/// not stop at, so the rider finds a new way on once off
/// (`stepped_off_short`). `false` when the car is gone or the shaft stops
/// nowhere.
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
    let leg = p.leg;
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
    let shaft_id = shaft.id;
    let p = &mut crowd.people[i];
    p.floors.truncate(leg + 1);
    p.floors.push(stop);
    p.shafts.truncate(leg + 1);
    if stop != to {
        p.floors.push(to);
        p.shafts.push(shaft_id);
    }
    true
}

/// Whether a rider who just stepped off `shaft` got off short of where they
/// were going: the trip on from here rides the same shaft to a floor it no
/// longer stops at (`ride_to_nearest_stop`).
pub(super) fn stepped_off_short(p: &Person, shaft: &Transport) -> bool {
    p.shafts.get(p.leg) == Some(&shaft.id)
        && p.floors.get(p.leg + 1).is_some_and(|&f| !shaft.stops_at(f))
}

/// A rider off at a stop short of their floor finds a new way on to the
/// trip's last floor from where they stand: a housekeeper over the network
/// their errand uses (`staff_shift::way_on`), anyone else over the
/// passenger network. Someone with no way on leaves through the ground
/// lobby, as one who turns back does; a housekeeper with none stops there
/// for their next errand (`give_up`).
pub(super) fn find_way_on(crowd: &mut Crowd, i: usize, tower: &mut Tower) {
    let p = &mut crowd.people[i];
    p.state = PState::ToDest;
    p.shaft_id = None;
    p.car_index = None;
    let to = *p.floors.last().unwrap_or(&p.floor);
    let (from, to, seed) = ((p.floor, p.x), (to, p.dest_x), p.seed);
    let way = match p.staff_trip {
        Some(trip) => staff_shift::way_on(crowd, tower, trip, from, to),
        None => crowd.route(tower, from.0, to.0, Some(from.1), Some(to.1)),
    };
    if let Some(r) = way {
        return take_route(crowd, i, r);
    }
    if crowd.people[i].staff_trip.is_some() {
        return give_up(crowd, i, tower);
    }
    let out = route_out_nearest(crowd, tower, from.0, from.1, LOBBY_FLOOR, seed)
        .map(|(r, tile)| (r, tile as f64))
        .or_else(|| {
            let r = crowd.route(tower, from.0, LOBBY_FLOOR, Some(from.1), None)?;
            Some((r, from.1))
        });
    match out {
        Some((r, exit_x)) => {
            take_route(crowd, i, r);
            let p = &mut crowd.people[i];
            p.returning = true;
            p.dest_x = exit_x;
        }
        None => give_up(crowd, i, tower),
    }
}

/// The ground lobby, where someone with no way on leaves the tower.
const LOBBY_FLOOR: i64 = 1;
