//! Venue staff who really come to work (the real-tenant-arrivals plan,
//! step 6, which the owner approved). Every shop, restaurant, fast food,
//! hall and cinema keeps a staff ([`Kind::staff_size`]): each worker comes
//! in at the ground lobby or a served Metro platform before the venue
//! opens, rides to it, and leaves the same way after it closes. A venue
//! opens for business only once one of its staff is in
//! ([`Unit::open_for_business`]), so a venue no route reaches never opens.
//! Nobody appears or vanishes at a venue (owner, 2026-11-14).
//!
//! Each hour the simulation books the arrivals a venue is still missing
//! while it is staffed ([`Kind::staffed_at`]: its open hours and the hour
//! before) and the departures it still owes outside them, at random minutes
//! of the hour (`Crowd::book_commutes`); every step starts the ones whose
//! minute has come (`start_commutes`), and an edit to the tower books a new
//! venue's staff at once. Staff who give up on the way in go back out and
//! are booked again the next hour; one who gives up on the way out goes
//! back in and leaves later.
//!
//! The crowd keeps each venue's staff in a [`Desk`]: who is inside, who is
//! on the way in and who is booked to leave, and writes the staff inside to
//! the venue's unsaved `staff_in`. Staff on the way are crowd people and
//! are never saved: a load starts a fresh crowd with every staffed venue's
//! staff at work, and the next hour books whoever is missing.
//!
//! [`Kind::staff_size`]: crate::facilities::Kind::staff_size
//! [`Kind::staffed_at`]: crate::facilities::Kind::staffed_at

use std::collections::BTreeMap;

use super::motion::finish;
use super::spawn::{add, inside_x};
use super::trip::{Errand, ErrandPlace};
use super::walk_ins::{entrances, Entrances};
use super::{Crowd, PState};
use crate::clock::Clock;
use crate::tower::{Tower, Unit};

/// The floor of the street doors.
const STREET_FLOOR: i64 = 1;

/// One venue's staff, as the crowd keeps them.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Desk {
    pub floor: i64,
    pub x: i64,
    pub width: i64,
    /// At work inside: the venue's `staff_in`.
    pub inside: i64,
    /// Booked to come in, or on the way.
    pub coming: i64,
    /// Inside, and booked to leave.
    pub going: i64,
}

/// An arrival (`inbound`) or a departure booked for `unit_id` at clock
/// minute `at`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Shift {
    pub at: f64,
    pub unit_id: i64,
    pub inbound: bool,
}

/// The venue a commuting worker belongs to, and which way they are going.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Commute {
    pub unit_id: i64,
    pub inbound: bool,
}

/// The venue `id`, if it still stands, keeps a staff and can work.
fn workplace(tower: &Tower, id: i64) -> Option<&Unit> {
    tower
        .get_unit(id)
        .filter(|u| u.kind.has_staff() && u.is_operational())
}

/// Writes the staff at work to the venue.
fn sync_staff(tower: &mut Tower, id: i64, inside: i64) {
    if let Some(u) = tower.get_unit_mut(id) {
        if u.kind.has_staff() {
            u.staff_in = inside.clamp(0, u8::MAX as i64) as u8;
        }
    }
}

impl Crowd {
    /// The hourly pass: books the arrivals each venue still needs while it
    /// is staffed and the departures it still owes outside those hours, at
    /// random minutes from `clock.minutes` to the end of the hour. A venue
    /// that burned or was gutted sends its staff out at once.
    pub fn book_commutes(&mut self, tower: &mut Tower, clock: &Clock) {
        reconcile(self, tower, clock.hour());
        self.book(tower, clock);
    }

    /// The booking half of [`Crowd::book_commutes`]. Idempotent within the
    /// hour: it books only what no booking already covers.
    fn book(&mut self, tower: &Tower, clock: &Clock) {
        let from = clock.minutes;
        let until = (from / 60.0).floor() * 60.0 + 60.0;
        let hour = clock.hour();
        for u in tower.room_units() {
            if !u.kind.has_staff() {
                continue;
            }
            let desk = self.desks.entry(u.id).or_default();
            (desk.floor, desk.x, desk.width) = (u.floor, u.x, u.width);
            let mut desk = *desk;
            let working = u.is_operational();
            if working && u.kind.staffed_at(hour) {
                let missing = (u.kind.staff_size() - desk.inside - desk.coming).max(0);
                for _ in 0..missing {
                    let at = from + self.rng.next() * (until - from);
                    self.shifts.push(Shift {
                        at,
                        unit_id: u.id,
                        inbound: true,
                    });
                }
                desk.coming += missing;
            } else {
                let owed = (desk.inside - desk.going).max(0);
                for _ in 0..owed {
                    let at = if working {
                        from + self.rng.next() * (until - from)
                    } else {
                        from
                    };
                    self.shifts.push(Shift {
                        at,
                        unit_id: u.id,
                        inbound: false,
                    });
                }
                desk.going += owed;
            }
            self.desks.insert(u.id, desk);
        }
        self.desks
            .retain(|_, d| d.inside > 0 || d.coming > 0 || d.going > 0);
        self.shifts.sort_by(|a, b| {
            b.at.total_cmp(&a.at)
                .then_with(|| b.unit_id.cmp(&a.unit_id))
                .then_with(|| b.inbound.cmp(&a.inbound))
        });
    }
}

/// Squares the desks with the tower. On the first call (a fresh crowd,
/// after a load) every venue staffed at `hour` starts with its staff at
/// work. A venue bulldozed, burned or gutted with staff inside sends them
/// out from where it stood, and a venue whose `staff_in` something else
/// reset (an undo) gets the count back from its desk. Runs each hour and
/// whenever the tower is edited.
pub fn reconcile(crowd: &mut Crowd, tower: &mut Tower, hour: i64) {
    if crowd.desk_revision.is_none() {
        for u in tower.room_units() {
            if u.kind.staffed_at(hour) && u.is_operational() {
                let desk = crowd.desks.entry(u.id).or_default();
                (desk.floor, desk.x, desk.width) = (u.floor, u.x, u.width);
                desk.inside = u.kind.staff_size();
            }
        }
    }
    crowd.desk_revision = Some(tower.revision);
    let mut doors: Option<Entrances> = None;
    let ids: Vec<i64> = crowd.desks.keys().copied().collect();
    for id in ids {
        let desk = crowd.desks[&id];
        if workplace(tower, id).is_some() {
            if tower.get_unit(id).map(|u| i64::from(u.staff_in)) != Some(desk.inside) {
                sync_staff(tower, id, desk.inside);
            }
            continue;
        }
        if desk.inside <= 0 {
            continue;
        }
        let doors = doors.get_or_insert_with(|| entrances(tower));
        let mut left = 0;
        for _ in 0..desk.inside {
            if leave(crowd, tower, doors, id, &desk) {
                left += 1;
            }
        }
        let d = crowd.desks.get_mut(&id).unwrap();
        d.inside -= left;
        d.going = d.going.min(d.inside);
        let inside = d.inside;
        sync_staff(tower, id, inside);
    }
}

/// Starts every booked arrival and departure whose minute has come. When
/// the tower was edited it squares the desks and books a new venue's staff
/// at once. A booking more than an hour late (a bomb search held everyone
/// still) is dropped and booked again by the next hour's pass.
pub fn start_commutes(crowd: &mut Crowd, tower: &mut Tower, clock: &Clock) {
    if crowd.desk_revision != Some(tower.revision) {
        reconcile(crowd, tower, clock.hour());
        crowd.book(tower, clock);
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
        let Some(desk) = crowd.desks.get(&s.unit_id).copied() else {
            continue;
        };
        let late = now - s.at > 60.0;
        if s.inbound {
            if late || !arrive(crowd, tower, &doors, s.unit_id) {
                crowd.desks.get_mut(&s.unit_id).unwrap().coming -= 1;
            }
            continue;
        }
        let d = crowd.desks.get_mut(&s.unit_id).unwrap();
        d.going = (d.going - 1).max(0);
        if late || desk.inside <= 0 {
            continue;
        }
        if leave(crowd, tower, &doors, s.unit_id, &desk) {
            let d = crowd.desks.get_mut(&s.unit_id).unwrap();
            d.inside -= 1;
            let inside = d.inside;
            sync_staff(tower, s.unit_id, inside);
        }
    }
}

/// Marks person `i` as a commuting worker of `unit_id`.
fn stamp(crowd: &mut Crowd, i: usize, unit_id: i64, inbound: bool) {
    let p = &mut crowd.people[i];
    p.commute = Some(Commute { unit_id, inbound });
    p.errand = Some(Errand {
        place: ErrandPlace::Work,
        inbound,
    });
    if !p.commuter {
        p.commuter = true;
        crowd.commuter_count += 1;
    }
}

/// One worker sets out from an entrance for `unit_id`. False when the venue
/// is gone or no route reaches it.
fn arrive(crowd: &mut Crowd, tower: &Tower, doors: &Entrances, unit_id: i64) -> bool {
    let Some(venue) = workplace(tower, unit_id) else {
        return false;
    };
    let (vx, vw, vf) = (venue.x, venue.width, venue.floor);
    let station = doors.pick(crowd);
    let from = station.map_or(STREET_FLOOR, |sid| tower.get_unit(sid).unwrap().floor + 1);
    let Some(i) = add(crowd, tower, from, vf, None, Some(vx)) else {
        return false;
    };
    crowd.people[i].dest_x = crowd.rng.int(vx, vx + vw - 1) as f64;
    if let Some(sid) = station {
        let st = tower.get_unit(sid).unwrap().clone();
        crowd.people[i].x = inside_x(crowd, &st, 2) as f64;
        crowd.people[i].start_x = crowd.people[i].x;
        crowd.people[i].from_metro = true;
    }
    stamp(crowd, i, unit_id, true);
    true
}

/// One worker walks out of the venue at `desk` for an exit. False when no
/// route leads out, and the worker stays at work.
fn leave(crowd: &mut Crowd, tower: &Tower, doors: &Entrances, unit_id: i64, desk: &Desk) -> bool {
    let x = crowd.rng.int(desk.x, desk.x + desk.width - 1);
    let (to, to_x) = exit(crowd, tower, doors);
    let Some(i) = add(crowd, tower, desk.floor, to, Some(x), to_x) else {
        return false;
    };
    crowd.people[i].x = x as f64;
    crowd.people[i].start_x = x as f64;
    stamp(crowd, i, unit_id, false);
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
/// (or, with the venue gone, head back out); on the way out, they leave the
/// tower; one who turned back on the way out goes back to work.
pub fn at_destination(crowd: &mut Crowd, i: usize, tower: &mut Tower, c: Commute) {
    let returning = crowd.people[i].returning;
    let usable = workplace(tower, c.unit_id).is_some();
    match (c.inbound, returning) {
        (true, false) if usable => {
            let d = crowd.desks.entry(c.unit_id).or_default();
            d.coming = (d.coming - 1).max(0);
            d.inside += 1;
            let inside = d.inside;
            sync_staff(tower, c.unit_id, inside);
            crowd.people[i].commute = None;
            finish(crowd, i, tower);
        }
        (true, false) => {
            if let Some(d) = crowd.desks.get_mut(&c.unit_id) {
                d.coming = (d.coming - 1).max(0);
            }
            stamp(crowd, i, c.unit_id, false);
            send_out(crowd, i, tower);
        }
        (false, true) if usable => {
            let d = crowd.desks.entry(c.unit_id).or_default();
            d.inside += 1;
            let inside = d.inside;
            sync_staff(tower, c.unit_id, inside);
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
/// to work is no longer on the way.
pub(super) fn on_finish(crowd: &mut Crowd, i: usize) {
    let p = &mut crowd.people[i];
    if !p.commuter {
        return;
    }
    p.commuter = false;
    crowd.commuter_count = (crowd.commuter_count - 1).max(0);
    if let Some(c) = p.commute.take().filter(|c| c.inbound) {
        if let Some(d) = crowd.desks.get_mut(&c.unit_id) {
            d.coming = (d.coming - 1).max(0);
        }
    }
}

/// The staff on the way to `unit_id`, booked or walking, for the room
/// card.
pub fn coming_to(crowd: &Crowd, unit_id: i64) -> i64 {
    crowd.desks.get(&unit_id).map_or(0, |d| d.coming)
}

/// The desks in id order, for tests and the hot-path record.
pub fn desks(crowd: &Crowd) -> &BTreeMap<i64, Desk> {
    &crowd.desks
}

/// Puts every venue staffed at `hour` to work at once, as a load does, for
/// a test that builds a tower and reads it at a time of day without playing
/// the morning.
#[cfg(test)]
pub fn staff_at_work(crowd: &mut Crowd, tower: &mut Tower, hour: i64) {
    let ids: Vec<i64> = tower
        .room_units()
        .filter(|u| u.kind.staffed_at(hour) && u.is_operational())
        .map(|u| u.id)
        .collect();
    for id in ids {
        let u = tower.get_unit(id).unwrap();
        let desk = crowd.desks.entry(id).or_default();
        (desk.floor, desk.x, desk.width) = (u.floor, u.x, u.width);
        desk.inside = u.kind.staff_size();
        let inside = desk.inside;
        sync_staff(tower, id, inside);
    }
}
