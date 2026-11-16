//! Office workers who really come to work (the real-tenant-arrivals plan,
//! step 5). An office's head count is the workers at their desks: each
//! comes in at the ground lobby or a served Metro platform, rides to the
//! office and only then counts, and leaves the same way. Nobody appears or
//! vanishes on an office floor (owner, 2026-11-14). Only Modern offices
//! commute this way; Classic keeps the hourly head count of 8 AM to 6 PM.
//!
//! The rush is spread (owner, 2026-11-14): on weekdays the workers arrive
//! over 7 to 10 AM, a third of those missing at 7, half at 8 and the rest
//! at 9, and leave over 4 to 7 PM the same way. Each hour the simulation
//! books that hour's share of the arrivals an office still misses and the
//! departures it owes at random minutes (`Crowd::book_commutes`), and each
//! step starts the ones due (`start_commutes`). Anyone still missing after
//! 10 AM is booked in full each hour; an office no route reaches never
//! fills. Workers who give up on the way in go back out and are booked
//! again; one who gives up on the way out goes back to the desk and leaves
//! later, unless the desk was taken meanwhile. An office never holds more
//! workers than its population, nor a venue more staff than its crew.
//!
//! A Modern venue's staff commute the same way (`workplace.rs`), booked in
//! full in the hour they are called in (`Kind::staffed_at`: four hours
//! before it opens, or at once for a venue built while open), leave over the hour after it closes, and it opens
//! once one of them is in.
//!
//! The crowd keeps each office's workers in a [`Desk`]: who is inside, who
//! is on the way in and who is booked to leave. The office's `occupants`
//! mirrors `inside`. The save keeps the workers on the way with the rest of
//! the crowd, and the desks and the hour's bookings beside them
//! (`commuters_save.rs`). A save without them (an older one, or the boot
//! after an engine crash) starts with nobody on the way: the load takes the
//! saved head counts as the workers inside, and the next hour books whoever
//! is missing.

use super::commuters_save::adopt_head_counts;
use super::metro_train;
use super::motion::finish;
use super::spawn::{add, inside_x};
use super::trip::{Errand, ErrandPlace};
use super::walk_ins::{entrances, Entrances};
use super::workplace::{due, head_count_of, held, stranded};
use super::workplace::{sync_head_count, working, Workplace, LEAVE_BY, LEAVE_FROM};
use super::{Crowd, PState};
use crate::clock::Clock;
use crate::tower::Tower;
use std::collections::BTreeMap;

/// The floor of the street doors.
const STREET_FLOOR: i64 = 1;

/// One workplace's workers, as the crowd keeps them.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Desk {
    pub floor: i64,
    pub x: i64,
    pub width: i64,
    /// At work: the office's head count, or the venue's staff in.
    pub inside: i64,
    /// Booked to come in, or on the way.
    pub coming: i64,
    /// Inside, and booked to leave.
    pub going: i64,
}

/// An arrival (`inbound`) or a departure booked for `workplace_id` at
/// clock minute `at`. An arrival held for the Metro's train names the
/// `station` it comes in by (`metro_train::hold_for_train`), saved with the
/// booking.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Shift {
    pub at: f64,
    pub workplace_id: i64,
    pub inbound: bool,
    pub station: Option<i64>,
}

/// The workplace a commuting worker belongs to, and which way they are
/// going.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Commute {
    pub workplace_id: i64,
    pub inbound: bool,
}

impl Crowd {
    /// The hourly pass: books this hour's share of the arrivals each office
    /// still needs during office hours and of the departures it still owes
    /// outside them, at random minutes from `clock.minutes` to the end of
    /// the hour. An office that lost its tenant (or burned) sends its
    /// workers out at once.
    pub fn book_commutes(&mut self, tower: &mut Tower, clock: &Clock) {
        // Nothing to book where workplaces count by the clock.
        if !tower.mode.office_workers_commute_in_person() {
            return;
        }
        reconcile(self, tower, clock.hour(), true);
        self.book(tower, clock, false);
    }

    /// Calls the crews of venues that just opened mid-hour (construction
    /// done) at once, as an edit does, instead of at the next hour's pass.
    pub(crate) fn book_venue_crews(&mut self, tower: &Tower, clock: &Clock) {
        if tower.mode.venue_staff_commute_in_person() {
            self.book(tower, clock, true);
        }
    }

    /// Books the hour's arrivals and departures from `clock.minutes` to the
    /// end of the hour: for every workplace, or only the venues when the
    /// tower was edited mid-hour, so a venue built while it should be open
    /// calls its staff in at once. It books only what no booking already
    /// covers.
    fn book(&mut self, tower: &Tower, clock: &Clock, venues_only: bool) {
        let from = clock.minutes;
        let until = (from / 60.0).floor() * 60.0 + 60.0;
        let (weekend, hour) = (clock.is_weekend(), clock.hour());
        // Weekday evenings spread the office departures; any other hour
        // sends whoever still owes one.
        let leave_by = if !weekend && (LEAVE_FROM..LEAVE_BY).contains(&hour) {
            LEAVE_BY
        } else {
            hour
        };
        for u in tower.room_units() {
            let Some(place) = Workplace::of(u, tower.mode) else {
                continue;
            };
            if venues_only && place != Workplace::Venue {
                continue;
            }
            // Read and written back only when it holds someone: an idle desk
            // is never inserted to be dropped again below.
            let mut desk = self.desks.get(&u.id).copied().unwrap_or_default();
            (desk.floor, desk.x, desk.width) = (u.floor, u.x, u.width);
            let dormant = place.sends_out_at_once(u);
            let (at_work, count) = due(place, u, &desk, (weekend, hour), leave_by);
            if at_work {
                let missing = count;
                for _ in 0..missing {
                    let at = from + self.rng.next() * (until - from);
                    self.shifts.push(Shift {
                        at,
                        workplace_id: u.id,
                        inbound: true,
                        station: None,
                    });
                }
                desk.coming += missing;
            } else {
                let owed = count;
                for _ in 0..owed {
                    let at = if dormant {
                        from
                    } else {
                        from + self.rng.next() * (until - from)
                    };
                    self.shifts.push(Shift {
                        at,
                        workplace_id: u.id,
                        inbound: false,
                        station: None,
                    });
                }
                desk.going += owed;
            }
            match held(&desk) {
                true => self.desks.insert(u.id, desk),
                false => self.desks.remove(&u.id),
            };
        }
        self.desks.retain(|_, d| held(d));
        self.sort_shifts();
    }

    /// Orders the booked arrivals and departures latest first, so the next
    /// one due is last (`start_commutes` pops it).
    pub(crate) fn sort_shifts(&mut self) {
        self.shifts.sort_by(later_first);
    }
}

/// The order the shifts are kept in: latest first.
pub(super) fn later_first(a: &Shift, b: &Shift) -> std::cmp::Ordering {
    b.at.total_cmp(&a.at)
        .then_with(|| b.workplace_id.cmp(&a.workplace_id))
        .then_with(|| b.inbound.cmp(&a.inbound))
}

/// The desk revision a load leaves when the save's desks were not squared
/// with its last edit: no tower revision matches it, so the first step
/// squares them without taking the head counts again.
pub(super) const UNSQUARED: i64 = i64::MIN;

/// Squares the desks with the tower: on the first call (a fresh crowd) the
/// head counts become the workers inside (`adopt_head_counts`); a workplace
/// bulldozed with workers inside, one whose head count something else
/// cleared (a fire), or a venue gone dormant sends them out from where it
/// stood; and a head count raised from outside (an undo) drops back to the
/// workers really there. A venue's `staff_in` is not saved, so it is
/// written from the desk. Runs each hour and whenever the tower is edited.
/// A load squares through `restore_desks` instead.
pub fn reconcile(crowd: &mut Crowd, tower: &mut Tower, hour: i64, send_out: bool) {
    if !tower.mode.office_workers_commute_in_person() {
        return;
    }
    if crowd.desk_revision.is_none() {
        adopt_head_counts(crowd, tower, Some(hour));
    }
    square(crowd, tower, send_out);
}

/// [`reconcile`] past the first call: squares the desks with the tower as it
/// stands, and sends stranded workers out when `send_out` is set.
pub(super) fn square(crowd: &mut Crowd, tower: &mut Tower, send_out: bool) {
    crowd.desk_revision = Some(tower.revision);
    let mut doors: Option<Entrances> = None;
    let ids: Vec<i64> = crowd.desks.keys().copied().collect();
    for id in ids {
        let desk = crowd.desks[&id];
        let (counted, stranded) = stranded(tower, id, &desk);
        let standing = counted.is_some() && head_count_of(tower, id) != Some(desk.inside);
        if stranded == 0 && standing {
            sync_head_count(tower, id, desk.inside);
        }
        if stranded <= 0 || !send_out {
            continue;
        }
        let doors = doors.get_or_insert_with(|| entrances(tower));
        let mut left = 0;
        for _ in 0..stranded {
            if leave(crowd, tower, doors, id, &desk) {
                left += 1;
            }
        }
        let d = crowd.desks.get_mut(&id).unwrap();
        d.inside -= left;
        d.going = d.going.min(d.inside);
        if counted.is_some() {
            sync_head_count(tower, id, d.inside);
        }
    }
}

/// Starts every booked arrival and departure whose minute has come, and
/// squares the desks with the tower when it was edited. A booking more
/// than an hour late (a bomb search held everyone still) is dropped and
/// booked again by the next hour's pass.
pub fn start_commutes(crowd: &mut Crowd, tower: &mut Tower, clock: &Clock) {
    if !tower.mode.office_workers_commute_in_person() {
        return;
    }
    if crowd.desk_revision != Some(tower.revision) {
        reconcile(crowd, tower, clock.hour(), true);
        crowd.book(tower, clock, true);
    }
    let now = clock.minutes;
    if crowd.shifts.last().is_none_or(|s| s.at > now) {
        return;
    }
    let doors = entrances(tower);
    while let Some(s) = crowd.shifts.last().copied() {
        if s.at > now {
            break;
        }
        crowd.shifts.pop();
        let Some(desk) = crowd.desks.get(&s.workplace_id).copied() else {
            continue;
        };
        let late = now - s.at > 60.0;
        if s.inbound {
            if late || !arrive(crowd, tower, &doors, s.workplace_id, (now, s.station)) {
                crowd.desks.get_mut(&s.workplace_id).unwrap().coming -= 1;
            }
            continue;
        }
        let d = crowd.desks.get_mut(&s.workplace_id).unwrap();
        d.going = (d.going - 1).max(0);
        if late || desk.inside <= 0 {
            continue;
        }
        if leave(crowd, tower, &doors, s.workplace_id, &desk) {
            let d = crowd.desks.get_mut(&s.workplace_id).unwrap();
            d.inside -= 1;
            let inside = d.inside;
            sync_head_count(tower, s.workplace_id, inside);
        }
    }
}

/// Marks person `i` as a commuting worker of `workplace_id`, a workplace
/// of kind `place` (unknown once bulldozed: still to or from work).
fn stamp(crowd: &mut Crowd, i: usize, workplace_id: i64, place: Option<Workplace>, inbound: bool) {
    let p = &mut crowd.people[i];
    p.commute = Some(Commute {
        workplace_id,
        inbound,
    });
    p.errand = Some(Errand {
        place: place.map_or(ErrandPlace::Work, Workplace::errand),
        inbound,
    });
    if !p.commuter {
        p.commuter = true;
        crowd.commuter_count += 1;
    }
}

/// One worker sets out for `workplace_id` at clock minute `now`, by the
/// station `held` for them if any; at a station with no train in they wait
/// for it (`metro_train::hold_for_train`). False when the workplace is gone
/// or no route reaches it.
fn arrive(
    crowd: &mut Crowd,
    tower: &Tower,
    doors: &Entrances,
    workplace_id: i64,
    (now, held): (f64, Option<i64>),
) -> bool {
    let Some((office, place)) = working(tower, workplace_id) else {
        return false;
    };
    let (ox, ow, of) = (office.x, office.width, office.floor);
    let mut station = match held {
        Some(sid) if tower.get_unit(sid).is_some() => Some(sid),
        _ => doors.pick(crowd),
    };
    let minute = now.rem_euclid(1440.0);
    if let Some(sid) = station.filter(|&s| !metro_train::train_in_at(tower, minute, s)) {
        if metro_train::hold_for_train(crowd, tower, now, workplace_id, sid) {
            return true;
        }
        station = None;
    }
    let from = station.map_or(STREET_FLOOR, |sid| tower.get_unit(sid).unwrap().floor + 1);
    let Some(i) = add(crowd, tower, from, of, None, Some(ox)) else {
        return false;
    };
    crowd.people[i].dest_x = crowd.rng.int(ox, ox + ow - 1) as f64;
    if let Some(sid) = station {
        let st = tower.get_unit(sid).unwrap().clone();
        crowd.people[i].x = inside_x(crowd, &st, 2) as f64;
        crowd.people[i].start_x = crowd.people[i].x;
        crowd.people[i].from_metro = true;
    }
    stamp(crowd, i, workplace_id, Some(place), true);
    true
}

/// One worker walks out of the office at `desk` for an exit. False when no
/// route leads out, and the worker stays at their desk.
fn leave(
    crowd: &mut Crowd,
    tower: &Tower,
    doors: &Entrances,
    workplace_id: i64,
    desk: &Desk,
) -> bool {
    let x = crowd.rng.int(desk.x, desk.x + desk.width - 1);
    let (to, to_x) = exit(crowd, tower, doors);
    let Some(i) = add(crowd, tower, desk.floor, to, Some(x), to_x) else {
        return false;
    };
    crowd.people[i].x = x as f64;
    crowd.people[i].start_x = x as f64;
    let place = tower
        .get_unit(workplace_id)
        .and_then(|u| Workplace::of(u, tower.mode));
    stamp(crowd, i, workplace_id, place, false);
    true
}

/// The floor and tile a worker leaving the tower heads for: the ground
/// lobby, or a Metro station, shared as the arrivals share them.
fn exit(crowd: &mut Crowd, tower: &Tower, doors: &Entrances) -> (i64, Option<i64>) {
    match doors.pick(crowd) {
        None => (STREET_FLOOR, None),
        Some(sid) => {
            let st = tower.get_unit(sid).unwrap().clone();
            (st.floor + 1, Some(inside_x(crowd, &st, 2)))
        }
    }
}

/// A commuting worker at the end of a walk. On the way in, they start work
/// (or, with the workplace gone or full, head back out); on the way out,
/// they leave the tower; one who turned back on the way out goes back to
/// work, unless one booked while they were gone took their place, when they
/// head out again. A workplace never holds more than its crew, so a save's
/// head counts are always ones a load keeps.
pub fn at_destination(crowd: &mut Crowd, i: usize, tower: &mut Tower, c: Commute) {
    let returning = crowd.people[i].returning;
    let inside = crowd.desks.get(&c.workplace_id).map_or(0, |d| d.inside);
    // A place to work: the workplace stands, can have its workers in, and
    // is not full.
    let free_desk = working(tower, c.workplace_id).is_some_and(|(u, w)| inside < w.crew(u));
    match (c.inbound, returning) {
        (true, false) if free_desk => {
            let d = crowd.desks.entry(c.workplace_id).or_default();
            d.coming = (d.coming - 1).max(0);
            d.inside += 1;
            let inside = d.inside;
            sync_head_count(tower, c.workplace_id, inside);
            crowd.people[i].commute = None;
            finish(crowd, i, tower);
        }
        (true, false) => {
            if let Some(d) = crowd.desks.get_mut(&c.workplace_id) {
                d.coming = (d.coming - 1).max(0);
            }
            let place = tower
                .get_unit(c.workplace_id)
                .and_then(|u| Workplace::of(u, tower.mode));
            stamp(crowd, i, c.workplace_id, place, false);
            send_out(crowd, i, tower);
        }
        (false, true) if free_desk => {
            let d = crowd.desks.entry(c.workplace_id).or_default();
            d.inside += 1;
            let inside = d.inside;
            sync_head_count(tower, c.workplace_id, inside);
            crowd.people[i].commute = None;
            finish(crowd, i, tower);
        }
        (false, true) => send_out(crowd, i, tower),
        _ => finish(crowd, i, tower),
    }
}

/// Sends person `i` from where they stand to an exit, or ends their trip
/// there when no route leads out.
fn send_out(crowd: &mut Crowd, i: usize, tower: &mut Tower) {
    let doors = entrances(tower);
    let (to, to_x) = exit(crowd, tower, &doors);
    let p = &crowd.people[i];
    let (from, from_x, seed) = (p.floor, p.x, p.seed);
    let to_x = to_x.unwrap_or_else(|| super::spawn::pick_x(tower, to, seed));
    let Some(r) = crowd.route(tower, from, to, Some(from_x), Some(to_x as f64)) else {
        return finish(crowd, i, tower);
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
    p.origin_floor = from;
    p.leg = 0;
    p.car_index = None;
    p.dest_x = to_x as f64;
    p.start_x = from_x;
    p.wait = 0.0;
    p.age = 0.0;
    p.linger = 0.0;
    p.returning = false;
}

/// What `finish` owes the desks for a commuting worker: one who never got
/// to the office is no longer on the way.
pub(super) fn on_finish(crowd: &mut Crowd, i: usize) {
    let p = &mut crowd.people[i];
    if !p.commuter {
        return;
    }
    p.commuter = false;
    crowd.commuter_count = (crowd.commuter_count - 1).max(0);
    if let Some(c) = p.commute.take().filter(|c| c.inbound) {
        if let Some(d) = crowd.desks.get_mut(&c.workplace_id) {
            d.coming = (d.coming - 1).max(0);
        }
    }
}

/// The workers on the way to `workplace_id`, booked or walking, for the room
/// card.
pub fn coming_to(crowd: &Crowd, workplace_id: i64) -> i64 {
    crowd.desks.get(&workplace_id).map_or(0, |d| d.coming)
}

/// The desks in id order, for tests and the hot-path record.
pub fn desks(crowd: &Crowd) -> &BTreeMap<i64, Desk> {
    &crowd.desks
}
