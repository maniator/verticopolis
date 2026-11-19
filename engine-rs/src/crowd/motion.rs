//! Port of the retired TypeScript `src/engine/crowd/motion.ts`: the per-slice person state machine.

use super::commuters;
use super::doors::route_out_nearest;
use super::landing::Landings;
use super::spawn::{inside_x, metro_station_for_platform, pick_x, pick_x_in_segment};
use super::staff_shift;
use super::visits::{begin_dwell, leave_venue};
use super::walk::{
    find_another_way, is_still_setting_out, reach_on_run, reroute, turn_back, walk_to, way_is_cut,
};
use super::workplace;
use super::{Crowd, PState, StaffResult, GIVE_UP, STAFF_GIVE_UP, STRESS_WAIT};
use crate::jsmath;
use crate::tower::Tower;

/// `advance(crowd, dtSec, tower)`.
pub fn advance(crowd: &mut Crowd, dt_sec: f64, tower: &mut Tower) {
    let mut frustrated = 0;
    let mut travelling = 0;
    let mut landings = Landings::refill(crowd, tower);
    let room = super::expected_time::spare_lines(crowd);
    let mut lines = super::line_count::LineCount::new(tower, room);
    for i in 0..crowd.people.len() {
        // A trip's patience counts only the time spent waiting for a car
        // (#2386): walking, climbing a flight and riding use none of it, so
        // nobody runs out of patience on the stairs or in a cab, and a long
        // route costs no more patience than a short one. `age` is that
        // waiting time, from the trip's start.
        if crowd.people[i].state == PState::Waiting {
            crowd.people[i].age += dt_sec;
        }
        let p = &crowd.people[i];
        let patience = if p.staff { STAFF_GIVE_UP } else { GIVE_UP };
        if p.age > patience && p.state == PState::Waiting {
            if p.staff {
                give_up(crowd, i, tower);
                continue;
            }
            // Nobody vanishes (owner, 2026-11-14): someone still on the
            // floor they set out from walks back and leaves the way they
            // came. Anyone past their first ride keeps going, since a floor
            // partway up has no way out.
            if is_still_setting_out(p) {
                frustrated += 1;
                travelling += 1;
                turn_back(crowd, i);
                crowd.people[i].gave_up = true;
                continue;
            }
        }
        let waited = crowd.people[i].wait;
        step(crowd, i, dt_sec, tower, &mut landings);
        super::line_count::rethink_long_wait(crowd, i, waited, tower);
        let p = &crowd.people[i];
        lines.see(p);
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
    super::line_count::waits_seen::keep_lines(crowd, lines.counted(), dt_sec);
    super::floor_index::settle(crowd);
    crowd.landings = landings;
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
            let mut target_x = if is_elevator {
                landings.back_of_line(tower, shaft, p.floor)
            } else {
                shaft.x as f64 + shaft.width as f64 / 2.0
            };
            if way_is_cut(p, target_x, tower) {
                // A shaft or flight wide enough to stand over the gap is
                // reached from this side of it, the way the route reached it.
                match reach_on_run(p, shaft.x, shaft.width, target_x, tower) {
                    Some(x) => target_x = x,
                    None => return find_another_way(crowd, i, tower),
                }
            }
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
            let speed = tower.mode.climb_speed(shaft.kind);
            p.fy += dir * speed * dt;
            p.x = shaft.x as f64 + shaft.width as f64 / 2.0;
            if (dir > 0.0 && p.fy >= dest as f64) || (dir < 0.0 && p.fy <= dest as f64) {
                p.fy = dest as f64;
                p.floor = dest;
                p.leg += 1;
                if super::walk::stepped_off_short(p, shaft) {
                    p.x = tower.alight_x(shaft, dest, p.dest_x);
                    return super::walk::find_way_on(crowd, i, tower);
                }
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
            let target = landings
                .slot(i)
                .unwrap_or(shaft.x as f64 + shaft.width as f64 / 2.0);
            walk_to(&mut crowd.people[i], target, dt, tower);
            let (floor, to) = (
                crowd.people[i].floor,
                crowd.people[i].floors.get(crowd.people[i].leg + 1).copied(),
            );
            let mut boarded = None;
            for ci in 0..shaft.cars as usize {
                // Only a car standing here with its doors open takes riders,
                // never one passing the floor, and only one leaving their way.
                // A car not on the floor is ruled out before the open list is
                // searched.
                if shaft.car_positions[ci] != floor as f64
                    || !crowd
                        .door_open(shaft.id, ci as i64, floor)
                        .is_some_and(|way| to.is_none_or(|to| way.takes(floor, to)))
                {
                    continue;
                }
                let key = (shaft.id, ci as i64);
                if crowd.closed_cars.binary_search(&key).is_ok() {
                    continue;
                }
                // A car holds as many as its kind does (21 standard, 17
                // service, 42 express), the original's cab sizes: the
                // customers from outside ride one to one beside the tenants.
                let n = crowd.car_riders.get(&key).copied().unwrap_or(0);
                if n >= shaft.kind.car_capacity() as i64 {
                    continue;
                }
                crowd.car_riders.insert(key, n + 1);
                if n + 1 == shaft.kind.car_capacity() as i64 {
                    mark_full(crowd, tower, key);
                }
                if let Some(to) = to {
                    crate::dispatch::first_aboard(&mut crowd.open_cars, key.0, key.1, floor, to);
                }
                boarded = Some((shaft.id, ci as i64, shaft.kind.is_elevator()));
                break;
            }
            // The ride is noted once the shaft's read above ends.
            if let Some((shaft_id, ci, elevator)) = boarded {
                tower.note_ride(shaft_id);
                if elevator {
                    *crowd
                        .elevator_boardings
                        .entry((shaft_id, floor))
                        .or_insert(0.0) += 1.0;
                }
                super::line_count::waits_seen::note_boarding(crowd, tower, elevator, i);
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
            let ridden = p.shaft_id.and_then(|id| tower.transport_index(id));
            // A rider whose car or shaft went steps out of the trip (3.7.3);
            // one whose floor stopped being a stop rides on to the nearest
            // stop, gets off there and finds a new way on (#2324).
            let (Some(si), Some(ci)) = (ridden, p.car_index) else {
                return give_up(crowd, i, tower);
            };
            let shaft = &tower.transports[si];
            let stops = tower.stop_bits();
            if ci as usize >= shaft.car_positions.len() || !tower.stops_at_index(&stops, si, dest) {
                return super::walk::ride_on_or_step_out(crowd, i, tower);
            }
            let pos = shaft.car_positions[ci as usize];
            // A rider steps off only once the car has stopped at their floor
            // with its doors open, never from a car passing it.
            let arrived = pos == dest as f64 && crowd.door_open(shaft.id, ci, dest).is_some();
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
                if super::walk::stepped_off_short(p, shaft) {
                    p.x = tower.alight_x(shaft, dest, p.dest_x);
                    return super::walk::find_way_on(crowd, i, tower);
                }
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
            if way_is_cut(&crowd.people[i], dest_x, tower) {
                return find_another_way(crowd, i, tower);
            }
            if walk_to(&mut crowd.people[i], dest_x, dt, tower) {
                // A housekeeper's working day decides what comes next.
                if let Some(trip) = crowd.people[i].staff_trip {
                    return staff_shift::at_destination(crowd, i, tower, dt, trip);
                }
                let p = &mut crowd.people[i];
                p.linger += dt;
                if p.linger > p.linger_for.unwrap_or(2.0) {
                    // Nobody leaves from an empty platform (`metro_train`).
                    if super::metro_train::waits_for_train(crowd, i, tower) {
                        return;
                    }
                    let p = &crowd.people[i];
                    // An office worker sits down at their desk, or leaves.
                    if let Some(c) = p.commute {
                        return commuters::at_destination(crowd, i, tower, c);
                    }
                    if (p.origin_unit_id.is_some() || p.meal_venue_id.is_some()) && !p.returning {
                        begin_dwell(crowd, tower, i);
                    } else {
                        finish(crowd, i, tower);
                    }
                }
            }
        }
        PState::Dwelling => {
            // A venue's visitors leave when it closes, the late show's
            // audience included, rather than wait inside a dark room.
            let closed = crowd.people[i]
                .meal_venue_id
                .and_then(|id| tower.get_unit(id))
                .is_some_and(|v| crowd.venue_closed(v.kind));
            let p = &mut crowd.people[i];
            let left = p.dwell_seconds_left.unwrap_or(0.0) - dt;
            p.dwell_seconds_left = Some(left);
            if left <= 0.0 || closed {
                transition_to_return(crowd, tower, i);
            }
        }
        PState::Done => {}
    }
}

fn transition_to_return(crowd: &mut Crowd, tower: &mut Tower, i: usize) {
    leave_venue(crowd, tower, i);
    let off_work = workplace::off_work_after_outing(crowd, tower, i);
    let origin = crowd.people[i]
        .origin_unit_id
        .filter(|_| !off_work)
        .and_then(|id| tower.get_unit(id))
        .map(|u| (u.floor, u.x));
    // Someone whose room was bulldozed while they were out, or an office
    // worker whose day is over, leaves by the ground lobby from the venue.
    let home_gone = origin.is_none() && crowd.people[i].origin_unit_id.is_some();
    if home_gone {
        crowd.people[i].origin_unit_id = None;
    }
    let venue_floor = crowd.people[i].floor;
    let from_x = crowd.people[i].x;
    let origin_floor = match origin {
        Some(o) => o.0,
        None if home_gone => 1,
        // A Metro visitor out after the last train leaves by the lobby.
        None => super::metro_train::way_out(crowd, tower, crowd.people[i].floors[0], from_x),
    };
    // With no room to go back to (a customer from outside, someone whose
    // room went), leave by the run of the floor nearest the venue that a
    // route reaches: the lobby under it, not the lot's leftmost (`doors`).
    let seed = crowd.people[i].seed;
    let exit = match origin {
        None => route_out_nearest(crowd, tower, venue_floor, from_x, origin_floor, seed),
        Some(_) => None,
    };
    let exit_x = exit.as_ref().map(|e| e.1);
    let r = match exit {
        Some((r, _)) => Some(r),
        None => crowd.route(
            tower,
            venue_floor,
            origin_floor,
            Some(from_x),
            origin.map(|o| o.1 as f64),
        ),
    };
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
    } else if let Some(x) = exit_x {
        crowd.people[i].dest_x = x as f64;
    } else {
        crowd.people[i].dest_x = pick_x(tower, origin_floor, seed) as f64;
    }
    crowd.people[i].returning = true;
}

/// Notes that car `key` (shaft, car) is full where full cars pass hall calls
/// (`full_cars`), until a seat is left (`release_seat`). Rare, so cold.
#[cold]
#[inline(never)]
pub(super) fn mark_full(crowd: &mut Crowd, tower: &Tower, key: (i64, i64)) {
    if !tower.mode.full_cars_pass_hall_calls() {
        return;
    }
    if let Err(at) = crowd.full_cars.binary_search(&key) {
        crowd.full_cars.insert(at, key);
    }
}

pub(super) fn release_seat(crowd: &mut Crowd, i: usize) {
    let p = &mut crowd.people[i];
    let (Some(ci), Some(sid)) = (p.car_index, p.shaft_id) else {
        return;
    };
    let key = (sid, ci);
    let n = crowd.car_riders.get(&key).copied().unwrap_or(1);
    crowd.car_riders.insert(key, (n - 1).max(0));
    if !crowd.full_cars.is_empty() {
        if let Ok(at) = crowd.full_cars.binary_search(&key) {
            crowd.full_cars.remove(at);
        }
    }
    crowd.people[i].car_index = None;
}

/// Someone whose trip cannot go on: a housekeeper out of patience, or
/// anyone whose shaft or car went. A housekeeper stops where they stand for
/// their next errand. Anyone else never vanishes on foot: one still setting
/// out turns back, and one partway up finds another way to where they were
/// going. Only a rider whose car went from under them, or one left with no
/// way on at all, leaves the picture.
pub(super) fn give_up(crowd: &mut Crowd, i: usize, tower: &mut Tower) {
    if crowd.people[i].staff_trip.is_some() {
        staff_shift::stuck(crowd, i, tower);
    } else if is_still_setting_out(&crowd.people[i]) {
        turn_back(crowd, i);
    } else if crowd.people[i].state == PState::Riding || !reroute(crowd, i, tower) {
        finish(crowd, i, tower);
    }
}

pub fn finish(crowd: &mut Crowd, i: usize, tower: &mut Tower) {
    release_seat(crowd, i);
    commuters::on_finish(crowd, i);
    let p = &crowd.people[i];
    if p.walk_in {
        crowd.walk_in_count = (crowd.walk_in_count - 1).max(0);
    }
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
    } else if !p.walk_in && !super::trip::Errand::on_the_job(p.errand) {
        // A trip from a lobby or a Metro platform belongs to the tenant at
        // its other end (#1971): the morning commuter's wait lands on the
        // office floor, not the lobby or the platform. A customer from
        // outside is no tenant, so their wait stresses no floor; nor do staff.
        let tenant_floor = match p.floors.last() {
            Some(&dest) if p.from_metro || tower.floor_has_lobby(p.origin_floor) => dest,
            _ => p.origin_floor,
        };
        let wait = super::commute_stress::finished_trip_wait(p, tower.mode);
        crowd.record_commute(tenant_floor, wait);
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
    leave_venue(crowd, tower, i);
    crowd.people[i].state = PState::Done;
}
