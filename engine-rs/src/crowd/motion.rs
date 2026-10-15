//! Port of `crowd/motion.ts`: the per-slice person state machine.

use std::collections::HashMap;

use super::landing::landing_slots;
use super::spawn::{inside_x, metro_station_for_platform, pick_x, pick_x_in_segment};
use super::visits::begin_dwell;
use super::walk::walk_to;
use super::{
    Crowd, PState, Person, StaffResult, CAR_CAPACITY, GIVE_UP, RIDE_SECONDS_PER_FLOOR,
    STAFF_GIVE_UP, STRESS_WAIT,
};
use crate::jsmath;
use crate::tower::Tower;

fn trip_floors(p: &Person) -> i64 {
    let mut n = 0;
    for i in 0..p.floors.len().saturating_sub(1) {
        n += (p.floors[i + 1] - p.floors[i]).abs();
    }
    n
}

/// `advance(crowd, dtSec, tower)`.
pub fn advance(crowd: &mut Crowd, dt_sec: f64, tower: &mut Tower) {
    let mut frustrated = 0;
    let mut travelling = 0;
    let slots = landing_slots(crowd, tower);
    for i in 0..crowd.people.len() {
        crowd.people[i].age += dt_sec;
        let p = &crowd.people[i];
        let patience = (if p.staff { STAFF_GIVE_UP } else { GIVE_UP })
            + trip_floors(p) as f64 * RIDE_SECONDS_PER_FLOOR;
        if p.age > patience
            && p.state != PState::ToDest
            && p.state != PState::Dwelling
            && p.state != PState::Done
        {
            if !p.staff {
                frustrated += 1;
                travelling += 1;
            }
            finish(crowd, i, tower);
            continue;
        }
        step(crowd, i, dt_sec, tower, &slots);
        let p = &crowd.people[i];
        if !p.staff
            && matches!(
                p.state,
                PState::Waiting | PState::Riding | PState::ToShaft | PState::Climbing
            )
        {
            travelling += 1;
            if p.wait > STRESS_WAIT {
                frustrated += 1;
            }
        }
    }
    let target = if travelling > 0 {
        frustrated as f64 / travelling as f64
    } else {
        0.0
    };
    crowd.frustration += (target - crowd.frustration) * (dt_sec * 0.5).min(1.0);
    crowd.people.retain(|p| p.state != PState::Done);
}

fn step(crowd: &mut Crowd, i: usize, dt: f64, tower: &mut Tower, slots: &HashMap<i64, f64>) {
    let state = crowd.people[i].state;
    match state {
        PState::ToShaft => {
            let p = &crowd.people[i];
            let Some(shaft) = p.shaft_id.and_then(|id| tower.get_transport(id)) else {
                return finish(crowd, i, tower);
            };
            let target_x = shaft.x as f64 + shaft.width as f64 / 2.0;
            let is_elevator = shaft.kind.is_elevator();
            let p = &mut crowd.people[i];
            if walk_to(p, target_x, dt, tower) {
                if is_elevator {
                    p.state = PState::Waiting;
                    p.wait = 0.0;
                } else {
                    p.state = PState::Climbing;
                    p.wait = 0.0;
                }
            }
        }
        PState::Climbing => {
            let p = &crowd.people[i];
            let Some(shaft) = p.shaft_id.and_then(|id| tower.get_transport(id)) else {
                return finish(crowd, i, tower);
            };
            let shaft = shaft.clone();
            let p = &mut crowd.people[i];
            let dest = p.floors[p.leg + 1];
            let mut dir = jsmath::sign(dest as f64 - p.fy);
            if dir == 0.0 {
                dir = 1.0;
            }
            let speed = if shaft.kind == crate::facilities::Kind::Escalator {
                1.3
            } else {
                0.85
            };
            p.fy += dir * speed * dt;
            p.x = shaft.x as f64 + shaft.width as f64 / 2.0;
            if (dir > 0.0 && p.fy >= dest as f64) || (dir < 0.0 && p.fy <= dest as f64) {
                p.fy = dest as f64;
                p.floor = dest;
                p.leg += 1;
                if p.leg >= p.shafts.len() {
                    p.state = PState::ToDest;
                    p.x = tower.alight_x(&shaft, dest, p.dest_x);
                } else {
                    p.shaft_id = Some(p.shafts[p.leg]);
                    let next = tower.get_transport(p.shafts[p.leg]);
                    let toward = next
                        .map(|n| n.x as f64 + n.width as f64 / 2.0)
                        .unwrap_or(p.dest_x);
                    p.x = tower.alight_x(&shaft, dest, toward);
                    p.state = PState::ToShaft;
                }
            }
        }
        PState::Waiting => {
            crowd.people[i].wait += dt;
            let p = &crowd.people[i];
            let Some(shaft) = p.shaft_id.and_then(|id| tower.get_transport(id)) else {
                return finish(crowd, i, tower);
            };
            let shaft = shaft.clone();
            let pid = crowd.people[i].id;
            let target = slots
                .get(&pid)
                .copied()
                .unwrap_or(shaft.x as f64 + shaft.width as f64 / 2.0);
            walk_to(&mut crowd.people[i], target, dt, tower);
            let floor = crowd.people[i].floor;
            for ci in 0..shaft.cars as usize {
                if (shaft.car_positions[ci] - floor as f64).abs() > 0.25 {
                    continue;
                }
                let key = (shaft.id, ci as i64);
                let n = crowd.car_riders.get(&key).copied().unwrap_or(0);
                if n >= CAR_CAPACITY {
                    continue;
                }
                crowd.car_riders.insert(key, n + 1);
                let p = &mut crowd.people[i];
                p.car_index = Some(ci as i64);
                p.state = PState::Riding;
                p.trip_wait += p.wait;
                p.wait = 0.0;
                break;
            }
        }
        PState::Riding => {
            let p = &crowd.people[i];
            let shaft = p.shaft_id.and_then(|id| tower.get_transport(id)).cloned();
            let (Some(shaft), Some(ci)) = (shaft, p.car_index) else {
                return finish(crowd, i, tower);
            };
            if ci as usize >= shaft.car_positions.len() {
                return finish(crowd, i, tower);
            }
            let pos = shaft.car_positions[ci as usize];
            let p = &mut crowd.people[i];
            let prev = p.fy;
            p.fy = pos;
            p.x = shaft.x as f64 + shaft.width as f64 / 2.0;
            let dest = p.floors[p.leg + 1];
            let d = dest as f64;
            let arrived = (pos - d).abs() < 0.2 || (prev - d) * (pos - d) <= 0.0;
            if arrived && shaft.stops_at(dest) {
                release_seat(crowd, i);
                let p = &mut crowd.people[i];
                p.floor = dest;
                p.fy = d;
                p.leg += 1;
                if p.leg >= p.shafts.len() {
                    p.state = PState::ToDest;
                    p.x = tower.alight_x(&shaft, dest, p.dest_x);
                } else {
                    p.shaft_id = Some(p.shafts[p.leg]);
                    let next = tower.get_transport(p.shafts[p.leg]);
                    let toward = next
                        .map(|n| n.x as f64 + n.width as f64 / 2.0)
                        .unwrap_or(p.dest_x);
                    p.x = tower.alight_x(&shaft, dest, toward);
                    p.state = PState::ToShaft;
                }
            }
        }
        PState::ToDest => {
            let dest_x = crowd.people[i].dest_x;
            if walk_to(&mut crowd.people[i], dest_x, dt, tower) {
                let p = &mut crowd.people[i];
                p.linger += dt;
                if p.linger > p.linger_for.unwrap_or(2.0) {
                    if (p.origin_unit_id.is_some() || p.meal_venue_id.is_some()) && !p.returning {
                        begin_dwell(crowd, tower, i);
                    } else {
                        finish(crowd, i, tower);
                    }
                }
            }
        }
        PState::Dwelling => {
            let p = &mut crowd.people[i];
            let left = p.dwell_seconds_left.unwrap_or(0.0) - dt;
            p.dwell_seconds_left = Some(left);
            if left <= 0.0 {
                transition_to_return(crowd, tower, i);
            }
        }
        PState::Done => {}
    }
}

fn transition_to_return(crowd: &mut Crowd, tower: &mut Tower, i: usize) {
    let origin = crowd.people[i]
        .origin_unit_id
        .and_then(|id| tower.get_unit(id))
        .map(|u| (u.floor, u.x));
    if origin.is_none() && crowd.people[i].origin_unit_id.is_some() {
        crowd.people[i].origin_unit_id = None;
        finish(crowd, i, tower);
        return;
    }
    let venue_floor = crowd.people[i].floor;
    let origin_floor = origin.map(|o| o.0).unwrap_or(crowd.people[i].floors[0]);
    let from_x = crowd.people[i].x;
    let r = crowd.route(
        tower,
        venue_floor,
        origin_floor,
        Some(from_x),
        origin.map(|o| o.1 as f64),
    );
    let Some(r) = r else {
        crowd.people[i].returning = true;
        finish(crowd, i, tower);
        return;
    };
    let p = &mut crowd.people[i];
    p.floors = r.floors;
    p.shafts = r.shafts;
    p.leg = 0;
    p.shaft_id = p.shafts.first().copied();
    p.car_index = None;
    p.state = if p.shafts.is_empty() {
        PState::ToDest
    } else {
        PState::ToShaft
    };
    p.wait = 0.0;
    p.age = 0.0;
    p.linger = 0.0;
    let seed = p.seed;
    let station = if origin.is_none() {
        metro_station_for_platform(tower, origin_floor)
    } else {
        None
    };
    if let Some(sid) = station {
        let st = tower.get_unit(sid).unwrap().clone();
        crowd.people[i].dest_x = inside_x(crowd, &st, 2) as f64;
    } else if let Some((_, ox)) = origin {
        crowd.people[i].dest_x = pick_x_in_segment(tower, origin_floor, seed, ox) as f64;
    } else {
        crowd.people[i].dest_x = pick_x(tower, origin_floor, seed) as f64;
    }
    crowd.people[i].returning = true;
}

fn release_seat(crowd: &mut Crowd, i: usize) {
    let p = &mut crowd.people[i];
    let (Some(ci), Some(sid)) = (p.car_index, p.shaft_id) else {
        return;
    };
    let key = (sid, ci);
    let n = crowd.car_riders.get(&key).copied().unwrap_or(1);
    crowd.car_riders.insert(key, (n - 1).max(0));
    crowd.people[i].car_index = None;
}

pub fn finish(crowd: &mut Crowd, i: usize, tower: &mut Tower) {
    release_seat(crowd, i);
    let p = &crowd.people[i];
    if p.staff {
        crowd.staff_count = (crowd.staff_count - 1).max(0);
        if let Some(uid) = p.clean_unit_id {
            let ok = p.state == PState::ToDest;
            crowd.staff_done.push(StaffResult { unit_id: uid, ok });
        }
    } else {
        let (of, w) = (p.origin_floor, p.trip_wait + p.wait);
        crowd.record_commute(of, w);
    }
    let p = &crowd.people[i];
    if let Some(oid) = p.origin_unit_id {
        if let Some(origin) = tower.get_unit_mut(oid) {
            if origin.out_for_meal.unwrap_or(0) > 0 {
                origin.out_for_meal = Some(origin.out_for_meal.unwrap_or(0) - 1);
                tower.bump_meal_overlay_revision();
            }
        }
    }
    let p = &crowd.people[i];
    if let Some(vid) = p.venue_unit_id {
        let counted_hotel = p.counted_hotel_guest;
        if let Some(venue) = tower.get_unit_mut(vid) {
            if venue.customers_in.unwrap_or(0) > 0 {
                venue.customers_in = Some(venue.customers_in.unwrap_or(0) - 1);
                venue.sync_attendance_occupants();
                if counted_hotel && venue.hotel_customers_in.unwrap_or(0) > 0 {
                    venue.hotel_customers_in = Some(venue.hotel_customers_in.unwrap_or(0) - 1);
                }
                tower.bump_meal_overlay_revision();
            }
        }
        let p = &mut crowd.people[i];
        p.venue_unit_id = None;
        p.counted_hotel_guest = false;
    }
    crowd.people[i].state = PState::Done;
}
