//! Customers who come in from outside the tower to a shop or restaurant (a
//! kind that [`Kind::takes_walk_ins`]): as many as its demand sends (owner,
//! 2026-11-14, "Full demand", picked over the 1994 daily visitor counts
//! after both were measured with the no-vanishing rule in place).
//!
//! Each hour the traffic pass works out how many customers each open venue
//! should see that hour and books that many arrivals at random minutes of
//! the hour (`Crowd::book_walk_ins`). Every step starts the arrivals whose
//! minute has come (`start_walk_ins`): each one enters at the ground lobby,
//! or at a Metro platform the tower's riders can reach, and walks and rides
//! to the venue like anyone else. They are not part of the 140-person
//! sample (`MAX_PEOPLE`); only `MAX_WALK_INS` bounds them, a ceiling a
//! working tower never reaches (owner, 2026-11-14: "Yes, both modes").
//! They split between the lobby and the stations by what each entrance's
//! transport can carry.
//!
//! The bookings live only in the crowd, like everyone in it: a load starts
//! a fresh crowd and the next hour books again.

use super::spawn::{add, inside_x, venue_has_room};
use super::Crowd;
use crate::clock::Clock;
use crate::tower::Tower;

/// The most walk-ins in the tower at once, on their way or inside. A
/// ceiling for a tower whose transport has seized up, far above what a
/// working tower holds: the crowd benchmark moves 5,000 people for about
/// 3 ms a step in the browser.
pub const MAX_WALK_INS: i64 = 4_000;

/// An arrival booked for `unit_id` at clock minute `at`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WalkIn {
    pub at: f64,
    pub unit_id: i64,
}

impl Crowd {
    /// Books `expected` customers (a mean, its fraction rounded up by a
    /// draw) for `unit_id` at random minutes from `from` to `until`.
    pub fn book_walk_ins(&mut self, unit_id: i64, expected: f64, from: f64, until: f64) {
        if !expected.is_finite() || expected <= 0.0 || until <= from {
            return;
        }
        let whole = expected.floor();
        let extra = self.rng.chance(expected - whole);
        let count = whole as i64 + i64::from(extra);
        for _ in 0..count {
            let at = from + self.rng.next() * (until - from);
            self.walk_ins.push(WalkIn { at, unit_id });
        }
    }

    /// Orders the bookings latest first, so the next one due is last and
    /// each start pops it off the end. Run once after an hour's bookings.
    pub fn sort_walk_ins(&mut self) {
        self.walk_ins.sort_by(|a, b| {
            b.at.total_cmp(&a.at)
                .then_with(|| b.unit_id.cmp(&a.unit_id))
        });
    }
}

/// Starts every booked walk-in whose minute has come. A booking more than
/// an hour late (a bomb search held everyone still) is dropped, so a long
/// freeze does not end in a flood.
pub fn start_walk_ins(crowd: &mut Crowd, tower: &Tower, clock: &Clock) {
    let now = clock.minutes;
    if crowd.walk_ins.last().is_none_or(|w| w.at > now) {
        return;
    }
    let hour = clock.hour();
    let doors = entrances(tower);
    while let Some(w) = crowd.walk_ins.last().copied() {
        if w.at > now {
            break;
        }
        crowd.walk_ins.pop();
        if now - w.at > 60.0 || crowd.walk_in_count >= MAX_WALK_INS {
            continue;
        }
        start_walk_in(crowd, tower, &doors, w.unit_id, hour);
    }
}

fn start_walk_in(crowd: &mut Crowd, tower: &Tower, doors: &Entrances, unit_id: i64, hour: i64) {
    let Some(venue) = tower.get_unit(unit_id) else {
        return;
    };
    if !venue.kind.takes_walk_ins()
        || !venue.is_tenanted()
        || !venue.kind.is_open_at(hour)
        || !venue_has_room(venue)
    {
        return;
    }
    let (vx, vw, vf) = (venue.x, venue.width, venue.floor);
    let station = doors.pick(crowd);
    let from = station.map_or(1, |sid| tower.get_unit(sid).unwrap().floor + 1);
    let Some(i) = add(crowd, tower, from, vf, None, Some(vx)) else {
        return;
    };
    crowd.people[i].dest_x = crowd.rng.int(vx, vx + vw - 1) as f64;
    crowd.people[i].meal_venue_id = Some(unit_id);
    crowd.people[i].walk_in = true;
    crowd.walk_in_count += 1;
    if let Some(sid) = station {
        let st = tower.get_unit(sid).unwrap().clone();
        crowd.people[i].x = inside_x(crowd, &st, 2) as f64;
        crowd.people[i].start_x = crowd.people[i].x;
        crowd.people[i].from_metro = true;
    }
}

/// The ways in from the street and how many people an hour each can take
/// up into the tower: the ground lobby, and each Metro station whose
/// platform the riders' transport serves. Walk-ins split between them by
/// that capacity, so a station with one small elevator gets a small share.
pub(super) struct Entrances {
    lobby: f64,
    stations: Vec<(i64, f64)>,
    total: f64,
}

impl Entrances {
    /// The station a walk-in comes in by, or `None` for the ground lobby.
    pub(super) fn pick(&self, crowd: &mut Crowd) -> Option<i64> {
        if self.stations.is_empty() || self.total <= 0.0 {
            return None;
        }
        let mut r = crowd.rng.next() * self.total - self.lobby;
        if r < 0.0 {
            return None;
        }
        for &(id, cap) in &self.stations {
            if r < cap {
                return Some(id);
            }
            r -= cap;
        }
        self.stations.last().map(|s| s.0)
    }
}

pub(super) fn entrances(tower: &Tower) -> Entrances {
    let lobby = boarding_capacity(tower, 1);
    let stations: Vec<(i64, f64)> = tower
        .metro_stations()
        .filter(|u| tower.is_metro_platform_served(u))
        .map(|u| (u.id, boarding_capacity(tower, u.floor + 1)))
        .filter(|s| s.1 > 0.0)
        .collect();
    let total = lobby + stations.iter().map(|s| s.1).sum::<f64>();
    Entrances {
        lobby,
        stations,
        total,
    }
}

/// The riders the passenger transport at `floor` holds in one load: every
/// car of each elevator that stops there, plus each flight of stairs and
/// escalator. Staff-only transport takes no customers.
fn boarding_capacity(tower: &Tower, floor: i64) -> f64 {
    tower
        .transports
        .iter()
        .filter(|t| !t.kind.facility().staff_only && t.stops_at(floor))
        .map(|t| {
            let cars = if t.kind.is_elevator() { t.cars } else { 1 };
            cars as f64 * t.kind.car_capacity()
        })
        .sum()
}
