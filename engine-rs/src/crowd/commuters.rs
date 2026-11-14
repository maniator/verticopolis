//! Office workers who really come to work (the real-tenant-arrivals plan,
//! step 5, which the owner approved). An office's head count is the
//! workers at their desks: each one comes in at the ground lobby or a
//! served Metro platform, rides to the office and only then counts, and
//! leaves the same way at the end of the day. Nobody appears or vanishes
//! on an office floor (owner, 2026-11-14).
//!
//! The times stay as they were (owner, 2026-11-13): on weekdays the
//! workers set out from 8 AM and leave from 6 PM. Each hour the
//! simulation books the arrivals an office is still missing and the
//! departures it still owes at random minutes of the hour
//! (`Crowd::book_commutes`), and every step starts the ones whose minute
//! has come (`start_commutes`). A slow tower fills late, and an office no
//! route reaches never fills. Workers who give up on the way in go back
//! out and are booked again the next hour; one who gives up on the way
//! out goes back to the desk and leaves later.
//!
//! The crowd keeps each office's workers in a [`Desk`]: who is inside, who
//! is on the way in and who is booked to leave. The office's `occupants`
//! mirrors `inside`. Workers on the way are crowd people and are never
//! saved: a load starts a fresh crowd, takes the saved head counts as the
//! workers inside, and the next hour books whoever is missing.

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

/// Whether office workers are at work at `hour`: weekdays, 8 AM to 6 PM.
pub fn office_hours(weekend: bool, hour: i64) -> bool {
    !weekend && (8..18).contains(&hour)
}

/// One office's workers, as the crowd keeps them.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Desk {
    pub floor: i64,
    pub x: i64,
    pub width: i64,
    /// At their desks: the office's head count.
    pub inside: i64,
    /// Booked to come in, or on the way.
    pub coming: i64,
    /// Inside, and booked to leave.
    pub going: i64,
}

/// An arrival (`inbound`) or a departure booked for `office_id` at clock
/// minute `at`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Shift {
    pub at: f64,
    pub office_id: i64,
    pub inbound: bool,
}

/// The office a commuting worker belongs to, and which way they are going.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Commute {
    pub office_id: i64,
    pub inbound: bool,
}

fn is_office(u: &Unit) -> bool {
    u.kind.commutes_in_person()
}

/// The office `id`, if it still stands and has a tenant whose workers come.
fn working_office(tower: &Tower, id: i64) -> Option<&Unit> {
    tower
        .get_unit(id)
        .filter(|u| is_office(u) && !u.is_dormant())
}

/// Sets the office's head count to the workers at their desks.
fn sync_head_count(tower: &mut Tower, id: i64, inside: i64) {
    if let Some((u, at)) = tower.marked_by_id(id) {
        if is_office(u) {
            u.set_occupants(at, inside);
        }
    }
}

impl Crowd {
    /// The hourly pass: books the arrivals each office still needs during
    /// office hours and the departures it still owes outside them, at
    /// random minutes from `clock.minutes` to the end of the hour. An
    /// office that lost its tenant (or burned) sends its workers out at
    /// once.
    pub fn book_commutes(&mut self, tower: &mut Tower, clock: &Clock) {
        reconcile(self, tower);
        let from = clock.minutes;
        let until = (from / 60.0).floor() * 60.0 + 60.0;
        let working = office_hours(clock.is_weekend(), clock.hour());
        for u in tower.room_units() {
            if !is_office(u) {
                continue;
            }
            let desk = self.desks.entry(u.id).or_default();
            (desk.floor, desk.x, desk.width) = (u.floor, u.x, u.width);
            let (dormant, out) = (u.is_dormant(), u.out_for_meal.unwrap_or(0));
            let mut desk = *desk;
            if working && !dormant {
                let missing = u.kind.facility().population - desk.inside - desk.coming;
                for _ in 0..missing.max(0) {
                    let at = from + self.rng.next() * (until - from);
                    self.shifts.push(Shift {
                        at,
                        office_id: u.id,
                        inbound: true,
                    });
                }
                desk.coming += missing.max(0);
            } else {
                let owed = desk.inside - out - desk.going;
                for _ in 0..owed.max(0) {
                    let at = if dormant {
                        from
                    } else {
                        from + self.rng.next() * (until - from)
                    };
                    self.shifts.push(Shift {
                        at,
                        office_id: u.id,
                        inbound: false,
                    });
                }
                desk.going += owed.max(0);
            }
            self.desks.insert(u.id, desk);
        }
        self.desks
            .retain(|_, d| d.inside > 0 || d.coming > 0 || d.going > 0);
        self.shifts.sort_by(|a, b| {
            b.at.total_cmp(&a.at)
                .then_with(|| b.office_id.cmp(&a.office_id))
                .then_with(|| b.inbound.cmp(&a.inbound))
        });
    }
}

/// Squares the desks with the tower: on the first call (a fresh crowd,
/// after a load) the saved head counts become the workers inside; an
/// office bulldozed with workers inside, or one whose head count something
/// else cleared (a fire), sends them out from where it stood; and a head
/// count raised from outside (an undo) drops back to the workers really
/// there. Runs each hour and whenever the tower is edited.
pub fn reconcile(crowd: &mut Crowd, tower: &mut Tower) {
    if crowd.desk_revision.is_none() {
        for u in tower.room_units() {
            if is_office(u) && u.occupants > 0 {
                let desk = crowd.desks.entry(u.id).or_default();
                (desk.floor, desk.x, desk.width) = (u.floor, u.x, u.width);
                desk.inside = u.occupants;
            }
        }
    }
    crowd.desk_revision = Some(tower.revision);
    let mut doors: Option<Entrances> = None;
    let ids: Vec<i64> = crowd.desks.keys().copied().collect();
    for id in ids {
        let desk = crowd.desks[&id];
        let counted = tower
            .get_unit(id)
            .filter(|u| is_office(u))
            .map(|u| u.occupants);
        let stranded = match counted {
            None => desk.inside,
            Some(n) if n < desk.inside => desk.inside - n,
            Some(n) => {
                if n > desk.inside {
                    sync_head_count(tower, id, desk.inside);
                }
                0
            }
        };
        if stranded <= 0 {
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
    if crowd.desk_revision != Some(tower.revision) {
        reconcile(crowd, tower);
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
        let Some(desk) = crowd.desks.get(&s.office_id).copied() else {
            continue;
        };
        let late = now - s.at > 60.0;
        if s.inbound {
            if late || !arrive(crowd, tower, &doors, s.office_id) {
                crowd.desks.get_mut(&s.office_id).unwrap().coming -= 1;
            }
            continue;
        }
        let d = crowd.desks.get_mut(&s.office_id).unwrap();
        d.going = (d.going - 1).max(0);
        if late || desk.inside <= 0 {
            continue;
        }
        if leave(crowd, tower, &doors, s.office_id, &desk) {
            let d = crowd.desks.get_mut(&s.office_id).unwrap();
            d.inside -= 1;
            let inside = d.inside;
            sync_head_count(tower, s.office_id, inside);
        }
    }
}

/// Marks person `i` as a commuting worker of `office_id`.
fn stamp(crowd: &mut Crowd, i: usize, office_id: i64, inbound: bool) {
    let p = &mut crowd.people[i];
    p.commute = Some(Commute { office_id, inbound });
    p.errand = Some(Errand {
        place: ErrandPlace::Office,
        inbound,
    });
    if !p.commuter {
        p.commuter = true;
        crowd.commuter_count += 1;
    }
}

/// One worker sets out from an entrance for `office_id`. False when the
/// office is gone or no route reaches it.
fn arrive(crowd: &mut Crowd, tower: &Tower, doors: &Entrances, office_id: i64) -> bool {
    let Some(office) = working_office(tower, office_id) else {
        return false;
    };
    let (ox, ow, of) = (office.x, office.width, office.floor);
    let station = doors.pick(crowd);
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
    stamp(crowd, i, office_id, true);
    true
}

/// One worker walks out of the office at `desk` for an exit. False when no
/// route leads out, and the worker stays at their desk.
fn leave(
    crowd: &mut Crowd,
    tower: &Tower,
    doors: &Entrances,
    office_id: i64,
    desk: &Desk,
) -> bool {
    let x = crowd.rng.int(desk.x, desk.x + desk.width - 1);
    let (to, to_x) = exit(crowd, tower, doors);
    let Some(i) = add(crowd, tower, desk.floor, to, Some(x), to_x) else {
        return false;
    };
    crowd.people[i].x = x as f64;
    crowd.people[i].start_x = x as f64;
    stamp(crowd, i, office_id, false);
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

/// A commuting worker at the end of a walk. On the way in, they sit down
/// at their desk (or, with the office gone, head back out); on the way
/// out, they leave the tower; one who turned back on the way out goes back
/// to their desk.
pub fn at_destination(crowd: &mut Crowd, i: usize, tower: &mut Tower, c: Commute) {
    let returning = crowd.people[i].returning;
    let usable = working_office(tower, c.office_id).is_some();
    match (c.inbound, returning) {
        (true, false) if usable => {
            let d = crowd.desks.entry(c.office_id).or_default();
            d.coming = (d.coming - 1).max(0);
            d.inside += 1;
            let inside = d.inside;
            sync_head_count(tower, c.office_id, inside);
            crowd.people[i].commute = None;
            finish(crowd, i, tower);
        }
        (true, false) => {
            if let Some(d) = crowd.desks.get_mut(&c.office_id) {
                d.coming = (d.coming - 1).max(0);
            }
            stamp(crowd, i, c.office_id, false);
            send_out(crowd, i, tower);
        }
        (false, true) if usable => {
            let d = crowd.desks.entry(c.office_id).or_default();
            d.inside += 1;
            let inside = d.inside;
            sync_head_count(tower, c.office_id, inside);
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
        if let Some(d) = crowd.desks.get_mut(&c.office_id) {
            d.coming = (d.coming - 1).max(0);
        }
    }
}

/// The workers on the way to `office_id`, booked or walking, for the room
/// card.
pub fn coming_to(crowd: &Crowd, office_id: i64) -> i64 {
    crowd.desks.get(&office_id).map_or(0, |d| d.coming)
}

/// The desks in id order, for tests and the hot-path record.
pub fn desks(crowd: &Crowd) -> &BTreeMap<i64, Desk> {
    &crowd.desks
}
