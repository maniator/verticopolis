//! The places whose people come in and go out as people (`crowd::commuters`),
//! and what each asks of the commute. A Modern office
//! counts the workers at their desks in `occupants` and keeps office hours,
//! its rush spread over 7 to 10 AM and 4 to 7 PM. A Modern venue with staff
//! of its own (`Kind::staff_size`: a shop, restaurant, hall, cinema and the
//! like) counts the staff in `staff_in`, opens only once one of them is in
//! (`Unit::open_for_business`), and has them in from the hour they are
//! called in (`Kind::staffed_at`) until it closes, every day of the week. A
//! Modern home (a condo, apartment or studio) counts the residents at home in
//! `occupants`: on weekdays all but the one who stays in
//! (`Kind::residents_home_by_day`) leave over 7 to 10 AM and come home over 4
//! to 7 PM, and on weekends and at night everyone is home. A home works the
//! other way round from an office, so its "workers inside" are the
//! residents at home. A Modern hotel room counts the guests in it in
//! `occupants`: they ride in at once in the hour after the room is let and
//! ride out over the hour of their checkout.

use super::trip::ErrandPlace;
use crate::clock::GameMode;
use crate::tower::{Tower, Unit, UnitState};

/// The hour the first workers set out, and the hour by which all are booked.
pub(super) const ARRIVE_FROM: i64 = 7;
pub(super) const ARRIVE_BY: i64 = 10;
/// The hour the first workers leave, and the hour by which all are booked.
pub(super) const LEAVE_FROM: i64 = 16;
pub(super) const LEAVE_BY: i64 = 19;

/// Whether office workers come in at `hour` (weekdays, 7 AM to 4 PM)
/// instead of going home.
pub fn office_hours(weekend: bool, hour: i64) -> bool {
    !weekend && (ARRIVE_FROM..LEAVE_FROM).contains(&hour)
}

/// The share of `n` workers to book at `hour` when the rest of them are
/// spread over the hours left until `by`: all of them once `by` has come.
pub(super) fn hour_share(n: i64, hour: i64, by: i64) -> i64 {
    if n <= 0 {
        return 0;
    }
    let hours_left = by - hour;
    if hours_left <= 1 {
        return n;
    }
    (n + hours_left - 1) / hours_left
}

/// Which kind of workplace a room is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Workplace {
    /// An office: its workers are its head count.
    Office,
    /// A venue: its staff serve the visitors.
    Venue,
    /// A home: its residents at home are its head count.
    Home,
    /// A hotel room: its guests in the room are its head count, from the
    /// hour after it is let until checkout.
    Hotel,
}

impl Workplace {
    /// The workplace `u` is in a `mode` tower, if its workers commute.
    pub(super) fn of(u: &Unit, mode: GameMode) -> Option<Workplace> {
        if u.kind.commutes_in_person(mode) {
            Some(Workplace::Office)
        } else if u.kind.waits_for_staff(mode) {
            Some(Workplace::Venue)
        } else if u.kind.lives_in_person(mode) {
            Some(Workplace::Home)
        } else if u.kind.stays_in_person(mode) {
            Some(Workplace::Hotel)
        } else {
            None
        }
    }

    /// The errand a person card names for its workers.
    pub(super) fn errand(self) -> ErrandPlace {
        match self {
            Workplace::Office => ErrandPlace::Office,
            Workplace::Venue => ErrandPlace::Work,
            Workplace::Home | Workplace::Hotel => ErrandPlace::Home,
        }
    }

    /// Whether `u` can have its workers in: an office or home with a
    /// tenant, a venue that stands (a venue has no tenant: it opens and
    /// closes by its hours, `Empty` while closed), or a hotel room let for
    /// the night (`Asleep`, until checkout).
    pub(super) fn can_work(self, u: &Unit) -> bool {
        match self {
            Workplace::Office | Workplace::Home => !u.is_dormant(),
            Workplace::Venue => u.is_operational(),
            Workplace::Hotel => u.state == UnitState::Asleep,
        }
    }

    /// Whether everyone inside `u` leaves the minute it is booked, rather
    /// than over the hour: a workplace that cannot have them in, except a
    /// hotel room after checkout, whose guests leave over the hour unless
    /// the room is gone or burned.
    pub(super) fn sends_out_at_once(self, u: &Unit) -> bool {
        match self {
            Workplace::Hotel => u.is_dormant(),
            _ => !self.can_work(u),
        }
    }

    /// The workers `u` keeps at work.
    pub(super) fn crew(self, u: &Unit) -> i64 {
        match self {
            Workplace::Office => u.kind.facility().population,
            Workplace::Venue => u.kind.staff_size(),
            Workplace::Home => u.resident_count(),
            Workplace::Hotel => u.kind.facility().population,
        }
    }

    /// The workers `u` counts as at work today.
    pub(super) fn head_count(self, u: &Unit) -> i64 {
        match self {
            Workplace::Office | Workplace::Home | Workplace::Hotel => u.occupants,
            Workplace::Venue => i64::from(u.staff_in),
        }
    }
}

/// The workplace `id` in its tower, if its workers commute and it can have
/// them in ([`Workplace::can_work`]).
pub(super) fn working(tower: &Tower, id: i64) -> Option<(&Unit, Workplace)> {
    let u = tower.get_unit(id)?;
    let place = Workplace::of(u, tower.mode).filter(|w| w.can_work(u))?;
    Some((u, place))
}

/// Workplace `id`'s head count as its unit stands (`None` once it is gone
/// or its workers no longer commute) and the workers at `desk` it leaves
/// without a place.
pub(super) fn stranded(
    tower: &Tower,
    id: i64,
    desk: &super::commuters::Desk,
) -> (Option<i64>, i64) {
    let counted = tower
        .get_unit(id)
        .and_then(|u| match Workplace::of(u, tower.mode)? {
            Workplace::Office | Workplace::Home | Workplace::Hotel => Some(u.occupants),
            Workplace::Venue if !u.is_operational() => Some(0),
            Workplace::Venue => Some(desk.inside),
        });
    (counted, (desk.inside - counted.unwrap_or(0)).max(0))
}

/// The head count of workplace `id`, if it stands and its workers commute.
pub(super) fn head_count_of(tower: &Tower, id: i64) -> Option<i64> {
    let u = tower.get_unit(id)?;
    Some(Workplace::of(u, tower.mode)?.head_count(u))
}

/// Whether a desk has anyone inside, coming or going.
pub(super) fn held(d: &super::commuters::Desk) -> bool {
    d.inside > 0 || d.coming > 0 || d.going > 0
}

/// Sets the workplace's head count to the workers at work.
pub(super) fn sync_head_count(tower: &mut Tower, id: i64, inside: i64) {
    let mode = tower.mode;
    if let Some((u, at)) = tower.marked_by_id(id) {
        match Workplace::of(u, mode) {
            Some(Workplace::Office | Workplace::Home | Workplace::Hotel) => {
                u.set_occupants(at, inside)
            }
            Some(Workplace::Venue) => u.staff_in = inside.clamp(0, i64::from(u8::MAX)) as u8,
            None => {}
        }
    }
}

/// Puts every venue staffed at `hour` to work at once, as a load of a save
/// from before venue staff commuted does, for a test that sets the clock
/// without the hours that would bring the staff in.
#[cfg(test)]
pub fn staff_at_work(crowd: &mut super::Crowd, tower: &mut Tower, hour: i64) {
    let staffed: Vec<(i64, i64, i64, i64, i64)> = tower
        .room_units()
        .filter(|u| Workplace::of(u, tower.mode) == Some(Workplace::Venue))
        .filter(|u| u.is_operational() && u.kind.staffed_at(hour))
        .map(|u| (u.id, u.floor, u.x, u.width, u.kind.staff_size()))
        .collect();
    for (id, floor, x, width, staff) in staffed {
        let desk = crowd.desks.entry(id).or_default();
        (desk.floor, desk.x, desk.width) = (floor, x, width);
        desk.inside = staff;
        sync_head_count(tower, id, staff);
    }
}

/// Puts every home's residents where they are at `(weekend, hour)` at once:
/// all home outside weekday office hours, else the one who stays in
/// (`Kind::residents_home_by_day`), for a test that sets the clock without
/// the hours that would bring them home or send them out.
#[cfg(test)]
pub fn residents_at_home(crowd: &mut super::Crowd, tower: &mut Tower, weekend: bool, hour: i64) {
    let homes: Vec<(i64, i64, i64, i64, i64)> = tower
        .room_units()
        .filter(|u| Workplace::of(u, tower.mode) == Some(Workplace::Home))
        .filter(|u| !u.is_dormant())
        .map(|u| {
            let all = Workplace::Home.crew(u);
            let home = if office_hours(weekend, hour) {
                u.kind.residents_home_by_day().min(all)
            } else {
                all
            };
            (u.id, u.floor, u.x, u.width, home)
        })
        .collect();
    for (id, floor, x, width, home) in homes {
        let desk = crowd.desks.entry(id).or_default();
        (desk.floor, desk.x, desk.width) = (floor, x, width);
        desk.inside = home;
        sync_head_count(tower, id, home);
    }
}

/// Puts every let hotel room's guests in it at once, as a night after
/// check-in leaves them, for a test that lets rooms without the hours that
/// would bring the guests in.
#[cfg(test)]
pub fn guests_in_rooms(crowd: &mut super::Crowd, tower: &mut Tower) {
    let rooms: Vec<(i64, i64, i64, i64, i64)> = tower
        .room_units()
        .filter(|u| Workplace::of(u, tower.mode) == Some(Workplace::Hotel))
        .filter(|u| Workplace::Hotel.can_work(u))
        .map(|u| (u.id, u.floor, u.x, u.width, Workplace::Hotel.crew(u)))
        .collect();
    for (id, floor, x, width, guests) in rooms {
        let desk = crowd.desks.entry(id).or_default();
        (desk.floor, desk.x, desk.width) = (floor, x, width);
        desk.inside = guests;
        sync_head_count(tower, id, guests);
    }
}

/// Whether `place` `u` has its workers in at `(weekend, hour)`, and the
/// arrivals it still needs booked then, or else the departures it still
/// owes, with office departures spread until `leave_by`.
pub(super) fn due(
    place: Workplace,
    u: &Unit,
    desk: &super::commuters::Desk,
    (weekend, hour): (bool, i64),
    leave_by: i64,
) -> (bool, i64) {
    let (dormant, out) = (!place.can_work(u), u.out_for_meal.unwrap_or(0));
    if place == Workplace::Home {
        return home_due(u, desk, dormant, (weekend, hour));
    }
    if place == Workplace::Hotel {
        return hotel_due(u, desk, dormant);
    }
    let at_work = !dormant
        && match place {
            Workplace::Office => office_hours(weekend, hour),
            Workplace::Venue => u.kind.staffed_at(hour),
            Workplace::Home => unreachable!("homes are booked by `home_due`"),
            Workplace::Hotel => unreachable!("hotels are booked by `hotel_due`"),
        };
    if at_work {
        let missing = place.crew(u) - desk.inside - desk.coming;
        return match place {
            Workplace::Office => (true, hour_share(missing, hour, ARRIVE_BY)),
            Workplace::Venue | Workplace::Home | Workplace::Hotel => (true, missing.max(0)),
        };
    }
    let owed = desk.inside - out - desk.going;
    match place {
        Workplace::Office if !dormant => (false, hour_share(owed, hour, leave_by)),
        _ => (false, owed.max(0)),
    }
}

/// [`due`] for a home: whether its residents come home at `(weekend, hour)`
/// and how many to book now, or else how many leave. On weekday office
/// hours (7 AM to 4 PM) all but `Kind::residents_home_by_day` go out, spread
/// until 10 AM, and a home short of the one who stays in (one just bought or
/// let) has them come home at once; any other hour everyone comes home,
/// spread from 4 to 7 PM on weekdays and at once otherwise (a home just
/// bought, a weekend). A home with no tenant sends everyone out at once.
fn home_due(
    u: &Unit,
    desk: &super::commuters::Desk,
    dormant: bool,
    (weekend, hour): (bool, i64),
) -> (bool, i64) {
    let out = u.out_for_meal.unwrap_or(0);
    if dormant {
        return (false, (desk.inside - out - desk.going).max(0));
    }
    let residents = Workplace::Home.crew(u);
    if !office_hours(weekend, hour) {
        let missing = residents - desk.inside - desk.coming;
        let by = if !weekend && (LEAVE_FROM..LEAVE_BY).contains(&hour) {
            LEAVE_BY
        } else {
            hour
        };
        return (true, hour_share(missing, hour, by));
    }
    let stays = u.kind.residents_home_by_day().min(residents);
    // A home bought or let mid-morning still has its one who stays in come
    // home at once.
    let short = stays - desk.inside - desk.coming;
    if short > 0 {
        return (true, short);
    }
    let owed = desk.inside - out - desk.going - stays;
    (false, hour_share(owed, hour, ARRIVE_BY))
}

/// [`due`] for a hotel room: while it is let for the night (`Asleep`) its
/// guests not yet in or on the way all come at once; from checkout (or
/// once the room is gone) every guest still inside leaves, less any out
/// for a meal, who leave from the restaurant.
fn hotel_due(u: &Unit, desk: &super::commuters::Desk, checked_out: bool) -> (bool, i64) {
    if !checked_out {
        let missing = Workplace::Hotel.crew(u) - desk.inside - desk.coming;
        return (true, missing.max(0));
    }
    let out = u.out_for_meal.unwrap_or(0);
    (false, (desk.inside - out - desk.going).max(0))
}

/// Whether the venue pass after an edit (`Crowd::book` for venues) books
/// anyone at `hour`: a venue built while it should be open calls its crew.
pub(super) fn venue_bookings_due(crowd: &super::Crowd, tower: &Tower, hour: i64) -> bool {
    tower.room_units().any(|u| {
        Workplace::of(u, tower.mode) == Some(Workplace::Venue) && {
            let desk = crowd.desks.get(&u.id).copied().unwrap_or_default();
            due(Workplace::Venue, u, &desk, (false, hour), hour).1 > 0
        }
    })
}

/// Whether person `i`, out for dinner or a movie from a Modern office, is
/// done with work when the outing ends: office hours are over, so they go
/// home from the venue instead of back to the desk (#2481). Only an outing
/// to a venue counts: a sales call ends back at the desk, and the evening
/// rush takes that worker home. An office that
/// took them back after hours kept them until its next hourly pass, and an
/// evening movie could take them out again, so a few left after midnight.
/// When it answers true the worker no longer counts at the office or as out
/// from it, and the caller sends them out of the tower.
pub(super) fn off_work_after_outing(crowd: &mut super::Crowd, tower: &mut Tower, i: usize) -> bool {
    let p = &crowd.people[i];
    let Some(id) = p.origin_unit_id.filter(|_| p.meal_venue_id.is_some()) else {
        return false;
    };
    let after_hours = crowd.hour.is_some_and(|h| !office_hours(crowd.weekend, h));
    let office = tower
        .get_unit(id)
        .is_some_and(|u| Workplace::of(u, tower.mode) == Some(Workplace::Office));
    if !after_hours || !office {
        return false;
    }
    let was_out = tower.marked_by_id(id).is_some_and(|(u, at)| {
        let out = u.out_for_meal.unwrap_or(0);
        if out > 0 {
            u.set_out_for_meal(at, Some(out - 1));
        }
        out > 0
    });
    if was_out {
        tower.bump_meal_overlay_revision();
    }
    if let Some(d) = crowd.desks.get_mut(&id).filter(|d| d.inside > 0) {
        d.inside -= 1;
        d.going = d.going.min(d.inside);
        let inside = d.inside;
        sync_head_count(tower, id, inside);
    }
    true
}
