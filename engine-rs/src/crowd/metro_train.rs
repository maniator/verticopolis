//! The Metro's train and the riders who leave the tower on it.
//!
//! One train runs each line (every station on the first station's row, left
//! to right). It calls each daytime game hour from 6:00 to 20:59 and none
//! runs overnight: it comes out of the left tunnel, waits at each station in
//! turn, and leaves by the right tunnel. A rider leaving by the Metro waits
//! on the platform until the train stands at their station and boards it;
//! nobody leaves the tower from an empty platform. One who reaches the
//! platform after the day's last train goes out by the nearest lobby
//! instead. A rider arriving by Metro steps off the train while it stands
//! at their station (`spawn`'s Metro arrivals ask [`train_in_at`]), so
//! nobody appears on an empty platform either. The renderer draws the same
//! timetable from the catalog's `metroTrain`.

use super::commuters::{later_first, Shift};
use super::doors::route_out_nearest;
use super::spawn::{metro_station_for_platform, pick_x};
use super::{Crowd, PState};
use crate::tower::{Tower, Unit};

/// The first hour a train runs.
pub const FIRST_HOUR: i64 = 6;
/// The last hour a train runs: its run ends before 21:00, when night falls.
pub const LAST_HOUR: i64 = 20;
/// Minutes the train takes from a tunnel mouth, or the station before, to a
/// station.
pub const LEG_MINUTES: f64 = 6.0;
/// The longest the train waits at a station: the whole call on a line of
/// one station.
pub const DWELL_MINUTES: f64 = 14.0;
/// Minutes of each hour the train's run along a line may take.
pub const RUN_MINUTES: f64 = 54.0;

/// How long the train takes between two calls and how long it waits at each
/// on a line of `stops` stations, as `(leg, dwell)` in game minutes. More
/// stations share the hour, so the train waits less at each and is gone
/// before the next hour's run.
pub fn line_times(stops: usize) -> (f64, f64) {
    let n = stops.max(1) as f64;
    let dwell = DWELL_MINUTES.min(((RUN_MINUTES - LEG_MINUTES * (n + 1.0)) / n).floor());
    if dwell >= 1.0 {
        (LEG_MINUTES, dwell)
    } else {
        let even = RUN_MINUTES / (2.0 * n + 1.0);
        (even, even)
    }
}

/// The minutes past the hour the train stands at the `stop`th station (from
/// the left, 0 first) of a line of `stops`, as `[from, to)`.
fn call(stop: usize, stops: usize) -> (f64, f64) {
    let (leg, dwell) = line_times(stops);
    let from = leg + stop as f64 * (dwell + leg);
    (from, from + dwell)
}

fn hour_of(minute_of_day: f64) -> i64 {
    (minute_of_day.rem_euclid(1440.0) / 60.0).floor() as i64
}

/// Whether the train stands at the `stop`th station of a line of `stops` at
/// `minute_of_day`.
pub fn train_in(minute_of_day: f64, stop: usize, stops: usize) -> bool {
    let hour = hour_of(minute_of_day);
    let (from, to) = call(stop, stops);
    let t = minute_of_day.rem_euclid(60.0);
    (FIRST_HOUR..=LAST_HOUR).contains(&hour) && t >= from && t < to
}

/// Whether the train still calls at the `stop`th station of a line of
/// `stops` before night, at `minute_of_day` or later: trains are running and
/// the day's last call there has not ended.
pub fn train_due(minute_of_day: f64, stop: usize, stops: usize) -> bool {
    let hour = hour_of(minute_of_day);
    let (_, to) = call(stop, stops);
    (FIRST_HOUR..LAST_HOUR).contains(&hour)
        || (hour == LAST_HOUR && minute_of_day.rem_euclid(60.0) < to)
}

/// `station`'s place on its line, left to right, and the line's length.
fn place_on_line(tower: &Tower, station: &Unit) -> (usize, usize) {
    let mut stop = 0;
    let mut stops = 0;
    for u in tower.metro_stations().filter(|u| u.floor == station.floor) {
        stops += 1;
        if u.x < station.x {
            stop += 1;
        }
    }
    (stop, stops.max(1))
}

/// Whether the line's train still calls at station `id` today, at the
/// crowd's minute. A crowd stepped on its own (no minute) has a train due.
pub fn due_at(crowd: &Crowd, tower: &Tower, id: i64) -> bool {
    let (Some(minute), Some(station)) = (crowd.minute, tower.get_unit(id)) else {
        return true;
    };
    let (stop, stops) = place_on_line(tower, station);
    train_due(minute, stop, stops)
}

/// Whether the line's train stands at station `id` at `minute_of_day`, so a
/// rider can step off it there.
pub fn train_in_at(tower: &Tower, minute_of_day: f64, id: i64) -> bool {
    tower.get_unit(id).is_some_and(|station| {
        let (stop, stops) = place_on_line(tower, station);
        train_in(minute_of_day, stop, stops)
    })
}

/// How many times as often a Metro arrival is drawn while a train stands
/// at one of the stations `ids`: the hour over the minutes of it a train
/// stands at one of them. Riders come only then, so the day brings as many
/// as when they came at any minute.
pub fn arrival_weight(tower: &Tower, ids: &[i64]) -> f64 {
    let stands: f64 = ids
        .iter()
        .filter_map(|&id| tower.get_unit(id))
        .map(|station| line_times(place_on_line(tower, station).1).1)
        .sum();
    if stands > 0.0 {
        60.0 / stands
    } else {
        1.0
    }
}

/// When the line's train next pulls in at station `id`, from clock minute
/// `minutes` on (counted as `Clock::minutes` counts), and how long it stands
/// there: `None` once the day's last call there has begun, or with no such
/// station.
pub fn next_call_at(tower: &Tower, minutes: f64, id: i64) -> Option<(f64, f64)> {
    let station = tower.get_unit(id)?;
    let (stop, stops) = place_on_line(tower, station);
    let (from, to) = call(stop, stops);
    let now = minutes.rem_euclid(1440.0);
    (FIRST_HOUR..=LAST_HOUR)
        .map(|hour| (hour * 60) as f64 + from)
        .find(|&start| start >= now)
        .map(|start| (minutes - now + start, to - from))
}

/// The floor someone leaving from `from_x` heads for when their trip began
/// on `floor`: that floor, unless it is a Metro platform no train calls at
/// again today, when they leave by the ground lobby (floor 1) instead.
pub fn way_out(crowd: &Crowd, tower: &Tower, floor: i64, from_x: f64) -> i64 {
    match metro_station_for_platform(tower, floor, from_x) {
        Some(sid) if !due_at(crowd, tower, sid) => 1,
        _ => floor,
    }
}

/// The station whose platform person `i` stands on, if any.
fn station_underfoot(crowd: &Crowd, i: usize, tower: &Tower) -> Option<(usize, usize)> {
    let p = &crowd.people[i];
    if p.floor >= 1 || p.state != PState::ToDest {
        return None;
    }
    // One pass over the line: stations on a floor never overlap, so the
    // ones starting at or left of the rider are the one underfoot and every
    // stop before it.
    let (mut underfoot, mut left, mut stops) = (false, 0, 0);
    for u in tower.metro_stations().filter(|u| u.floor + 1 == p.floor) {
        stops += 1;
        left += usize::from(u.x as f64 <= p.x);
        underfoot |= p.x >= u.x as f64 && p.x < (u.x + u.width) as f64;
    }
    underfoot.then(|| (left - 1, stops))
}

/// Person `i` has ended a walk and is about to leave the picture. Answers
/// `true` when they stay instead: they stand on a Metro platform and wait
/// for the train, or the day's last train has gone and they set off for the
/// nearest lobby. `false` lets the caller end the trip: they stand anywhere
/// else, or the train is in and they board it.
pub fn waits_for_train(crowd: &mut Crowd, i: usize, tower: &Tower) -> bool {
    let Some(minute) = crowd.minute else {
        return false;
    };
    let Some((stop, stops)) = station_underfoot(crowd, i, tower) else {
        return false;
    };
    if train_in(minute, stop, stops) {
        return false;
    }
    if !train_due(minute, stop, stops) {
        leave_by_lobby(crowd, i, tower);
    }
    true
}

/// Sends person `i` from the platform to the ground floor run nearest
/// them, keeping the rest of their trip as it is, so they leave by the
/// lobby. With no way up they wait for the morning's first train.
fn leave_by_lobby(crowd: &mut Crowd, i: usize, tower: &Tower) {
    let (floor, x, seed) = {
        let p = &crowd.people[i];
        (p.floor, p.x, p.seed)
    };
    let (r, exit_x) = match route_out_nearest(crowd, tower, floor, x, 1, seed) {
        Some(found) => found,
        None => match crowd.route(tower, floor, 1, Some(x), None) {
            Some(r) => (r, pick_x(tower, 1, seed)),
            None => return,
        },
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
    p.leg = 0;
    p.car_index = None;
    p.dest_x = exit_x as f64;
    p.wait = 0.0;
    p.age = 0.0;
    p.linger = 0.0;
}

/// Puts off a worker's arrival by the Metro until the line's train next
/// stands at station `sid`, so they step off it rather than appear on an
/// empty platform. False when no train calls there again today: they come
/// in by the street instead.
pub(super) fn hold_for_train(
    crowd: &mut Crowd,
    tower: &Tower,
    now: f64,
    workplace_id: i64,
    sid: i64,
) -> bool {
    let Some((pulls_in, stands)) = next_call_at(tower, now, sid) else {
        return false;
    };
    // They step off over the first half of the train's stop.
    let held = Shift {
        at: pulls_in + crowd.rng.next() * stands / 2.0,
        workplace_id,
        inbound: true,
        station: Some(sid),
    };
    let at = crowd
        .shifts
        .partition_point(|s| later_first(s, &held).is_lt());
    crowd.shifts.insert(at, held);
    true
}

#[cfg(test)]
#[path = "metro_train_tests.rs"]
mod tests;
