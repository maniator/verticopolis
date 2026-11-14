//! Port of `crowd/motion.ts`: the per-slice person state machine.

use super::landing::{landing_slots, Landings};
use super::spawn::{inside_x, metro_station_for_platform, pick_x, pick_x_in_segment};
use super::staff_shift;
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
    let mut landings = landing_slots(crowd, tower);
    for i in 0..crowd.people.len() {
        crowd.people[i].age += dt_sec;
        let p = &crowd.people[i];
        let patience = (if p.staff { STAFF_GIVE_UP } else { GIVE_UP })
            + trip_floors(p) as f64 * RIDE_SECONDS_PER_FLOOR;
        // Someone aboard a car rides it to their floor: giving up there would
        // make them vanish from the cab (3.7.3). Only a wait or a walk can
        // run out of patience.
        if p.age > patience
            && p.state != PState::ToDest
            && p.state != PState::Dwelling
            && p.state != PState::Riding
            && p.state != PState::Done
        {
            if !p.staff {
                frustrated += 1;
                travelling += 1;
            }
            give_up(crowd, i, tower);
            continue;
        }
        step(crowd, i, dt_sec, tower, &mut landings);
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

fn step(crowd: &mut Crowd, i: usize, dt: f64, tower: &mut Tower, landings: &mut Landings) {
    let state = crowd.people[i].state;
    match state {
        PState::ToShaft => {
            let p = &crowd.people[i];
            let Some(shaft) = p.shaft_id.and_then(|id| tower.get_transport(id)) else {
                return give_up(crowd, i, tower);
            };
            let (shaft_id, is_elevator) = (shaft.id, shaft.kind.is_elevator());
            // An elevator rider walks straight to the back of the line, and a
            // climber to the middle of the stairs or the escalator (#2116).
            let target_x = if is_elevator {
                landings.back_of_line(tower, shaft, p.floor)
            } else {
                shaft.x as f64 + shaft.width as f64 / 2.0
            };
            let p = &mut crowd.people[i];
            if walk_to(p, target_x, dt, tower) {
                if is_elevator {
                    p.state = PState::Waiting;
                    p.wait = 0.0;
                    landings.join(shaft_id, p.floor);
                } else {
                    p.state = PState::Climbing;
                    p.wait = 0.0;
                    tower.note_ride(shaft_id);
                }
            }
        }
        PState::Climbing => {
            let p = &crowd.people[i];
            let Some(shaft) = p.shaft_id.and_then(|id| tower.get_transport(id)) else {
                return give_up(crowd, i, tower);
            };
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
                    p.x = tower.alight_x(shaft, dest, p.dest_x);
                } else {
                    p.shaft_id = Some(p.shafts[p.leg]);
                    let next = tower.get_transport(p.shafts[p.leg]);
                    let toward = next
                        .map(|n| n.x as f64 + n.width as f64 / 2.0)
                        .unwrap_or(p.dest_x);
                    p.x = tower.alight_x(shaft, dest, toward);
                    p.state = PState::ToShaft;
                }
            }
        }
        PState::Waiting => {
            crowd.people[i].wait += dt;
            let p = &crowd.people[i];
            let Some(shaft) = p.shaft_id.and_then(|id| tower.get_transport(id)) else {
                return give_up(crowd, i, tower);
            };
            let pid = crowd.people[i].id;
            let target = landings
                .slots
                .get(&pid)
                .copied()
                .unwrap_or(shaft.x as f64 + shaft.width as f64 / 2.0);
            walk_to(&mut crowd.people[i], target, dt, tower);
            let floor = crowd.people[i].floor;
            let mut boarded = None;
            for ci in 0..shaft.cars as usize {
                // Only a car standing here with its doors open takes riders,
                // never one passing the floor. A car not on the floor is
                // ruled out before the open list is searched.
                if shaft.car_positions[ci] != floor as f64
                    || !crowd.door_open(shaft.id, ci as i64, floor)
                {
                    continue;
                }
                let key = (shaft.id, ci as i64);
                if crowd.closed_cars.binary_search(&key).is_ok() {
                    continue;
                }
                let n = crowd.car_riders.get(&key).copied().unwrap_or(0);
                if n >= CAR_CAPACITY {
                    continue;
                }
                crowd.car_riders.insert(key, n + 1);
                boarded = Some((shaft.id, ci as i64));
                break;
            }
            // The shaft is read in place above, and the ride is noted once
            // the read ends.
            if let Some((shaft_id, ci)) = boarded {
                tower.note_ride(shaft_id);
                let p = &mut crowd.people[i];
                p.car_index = Some(ci);
                p.state = PState::Riding;
                p.trip_wait += p.wait;
                p.wait = 0.0;
            }
        }
        PState::Riding => {
            let p = &crowd.people[i];
            let dest = p.floors[p.leg + 1];
            let ridden = p.shaft_id.and_then(|id| tower.get_transport(id));
            // A rider whose car or shaft went, or whose floor the shaft no
            // longer stops at, steps out of the trip: no car would ever let
            // them off, and nothing else ends a ride (3.7.3).
            let (Some(shaft), Some(ci)) = (ridden, p.car_index) else {
                return give_up(crowd, i, tower);
            };
            if ci as usize >= shaft.car_positions.len() || !shaft.stops_at(dest) {
                return give_up(crowd, i, tower);
            }
            let pos = shaft.car_positions[ci as usize];
            // A rider steps off only once the car has stopped at their floor
            // with its doors open, never from a car passing it.
            let arrived = pos == dest as f64 && crowd.door_open(shaft.id, ci, dest);
            let p = &mut crowd.people[i];
            p.fy = pos;
            p.x = shaft.x as f64 + shaft.width as f64 / 2.0;
            let d = dest as f64;
            if arrived {
                release_seat(crowd, i);
                let p = &mut crowd.people[i];
                p.floor = dest;
                p.fy = d;
                p.leg += 1;
                if p.leg >= p.shafts.len() {
                    p.state = PState::ToDest;
                    p.x = tower.alight_x(shaft, dest, p.dest_x);
                } else {
                    p.shaft_id = Some(p.shafts[p.leg]);
                    let next = tower.get_transport(p.shafts[p.leg]);
                    let toward = next
                        .map(|n| n.x as f64 + n.width as f64 / 2.0)
                        .unwrap_or(p.dest_x);
                    p.x = tower.alight_x(shaft, dest, toward);
                    p.state = PState::ToShaft;
                }
            }
        }
        PState::ToDest => {
            let dest_x = crowd.people[i].dest_x;
            if walk_to(&mut crowd.people[i], dest_x, dt, tower) {
                // A housekeeper's working day decides what comes next.
                if let Some(trip) = crowd.people[i].staff_trip {
                    return staff_shift::at_destination(crowd, i, tower, dt, trip);
                }
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
    // The rider steps onto the platform where the last shaft lets them off,
    // or walks there from the venue, and heads for the nearest station.
    let platform_x = p
        .shafts
        .last()
        .and_then(|&sid| tower.get_transport(sid))
        .map_or(from_x, |t| t.x as f64);
    let station = if origin.is_none() {
        metro_station_for_platform(tower, origin_floor, platform_x)
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

pub(super) fn release_seat(crowd: &mut Crowd, i: usize) {
    let p = &mut crowd.people[i];
    let (Some(ci), Some(sid)) = (p.car_index, p.shaft_id) else {
        return;
    };
    let key = (sid, ci);
    let n = crowd.car_riders.get(&key).copied().unwrap_or(1);
    crowd.car_riders.insert(key, (n - 1).max(0));
    crowd.people[i].car_index = None;
}

/// Someone whose trip cannot go on: out of patience, or their shaft or car
/// gone. A visitor or tenant leaves the picture; a housekeeper never
/// vanishes mid-tower and stops where they stand for their next errand.
fn give_up(crowd: &mut Crowd, i: usize, tower: &mut Tower) {
    if crowd.people[i].staff_trip.is_some() {
        staff_shift::stuck(crowd, i, tower);
    } else {
        finish(crowd, i, tower);
    }
}

pub fn finish(crowd: &mut Crowd, i: usize, tower: &mut Tower) {
    release_seat(crowd, i);
    let p = &crowd.people[i];
    if p.staff {
        crowd.staff_count = (crowd.staff_count - 1).max(0);
        if let Some(crew) = p.crew_id {
            let left = crowd.crew_roster.get(&crew).map_or(0, |n| n - 1);
            if left > 0 {
                crowd.crew_roster.insert(crew, left);
            } else {
                crowd.crew_roster.remove(&crew);
            }
        }
        if let Some(uid) = p.clean_unit_id {
            let ok = p.state == PState::ToDest;
            crowd.staff_done.push(StaffResult { unit_id: uid, ok });
        }
    } else {
        // A trip from a lobby or a Metro platform belongs to the tenant at
        // its other end (#1971): the morning commuter's wait lands on the
        // office floor, not the lobby or the platform.
        let tenant_floor = match p.floors.last() {
            Some(&dest) if p.from_metro || tower.floor_has_lobby(p.origin_floor) => dest,
            _ => p.origin_floor,
        };
        crowd.record_commute(tenant_floor, p.trip_wait + p.wait);
    }
    let p = &crowd.people[i];
    if let Some(oid) = p.origin_unit_id {
        if let Some((origin, at)) = tower.marked_by_id(oid) {
            if origin.out_for_meal.unwrap_or(0) > 0 {
                origin.set_out_for_meal(at, Some(origin.out_for_meal.unwrap_or(0) - 1));
                tower.bump_meal_overlay_revision();
            }
        }
    }
    let p = &crowd.people[i];
    if let Some(vid) = p.venue_unit_id {
        let counted_hotel = p.counted_hotel_guest;
        if let Some((venue, at)) = tower.marked_by_id(vid) {
            if venue.customers_in.unwrap_or(0) > 0 {
                venue.set_customers_in(at, Some(venue.customers_in.unwrap_or(0) - 1));
                venue.sync_visitor_occupants(at);
                if counted_hotel && venue.hotel_customers_in.unwrap_or(0) > 0 {
                    let n = venue.hotel_customers_in.unwrap_or(0) - 1;
                    venue.set_hotel_customers_in(at, Some(n));
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
