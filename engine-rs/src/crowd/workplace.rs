//! The two kinds of workplace whose workers come in and go home as people
//! (`crowd::commuters`), and what each asks of the commute. A Modern office
//! counts the workers at their desks in `occupants` and keeps office hours,
//! its rush spread over 7 to 10 AM and 4 to 7 PM. A Modern venue with staff
//! of its own (`Kind::staff_size`: a shop, restaurant, hall, cinema and the
//! like) counts the staff in `staff_in`, opens only once one of them is in
//! (`Unit::open_for_business`), and has them in from the hour they are
//! called in (`Kind::staffed_at`) until it closes, every day of the week.

use super::trip::ErrandPlace;
use crate::clock::GameMode;
use crate::tower::{Tower, Unit};

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
}

impl Workplace {
    /// The workplace `u` is in a `mode` tower, if its workers commute.
    pub(super) fn of(u: &Unit, mode: GameMode) -> Option<Workplace> {
        if u.kind.commutes_in_person(mode) {
            Some(Workplace::Office)
        } else if u.kind.waits_for_staff(mode) {
            Some(Workplace::Venue)
        } else {
            None
        }
    }

    /// The errand a person card names for its workers.
    pub(super) fn errand(self) -> ErrandPlace {
        match self {
            Workplace::Office => ErrandPlace::Office,
            Workplace::Venue => ErrandPlace::Work,
        }
    }

    /// Whether `u` can have its workers in: an office with a tenant, or a
    /// venue that stands (a venue has no tenant: it opens and closes by its
    /// hours, `Empty` while closed).
    pub(super) fn can_work(self, u: &Unit) -> bool {
        match self {
            Workplace::Office => !u.is_dormant(),
            Workplace::Venue => u.is_operational(),
        }
    }

    /// The workers `u` keeps at work.
    pub(super) fn crew(self, u: &Unit) -> i64 {
        match self {
            Workplace::Office => u.kind.facility().population,
            Workplace::Venue => u.kind.staff_size(),
        }
    }

    /// The workers `u` counts as at work today.
    pub(super) fn head_count(self, u: &Unit) -> i64 {
        match self {
            Workplace::Office => u.occupants,
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
            Workplace::Office => Some(u.occupants),
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
            Some(Workplace::Office) => u.set_occupants(at, inside),
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
    let at_work = !dormant
        && match place {
            Workplace::Office => office_hours(weekend, hour),
            Workplace::Venue => u.kind.staffed_at(hour),
        };
    if at_work {
        let missing = place.crew(u) - desk.inside - desk.coming;
        return match place {
            Workplace::Office => (true, hour_share(missing, hour, ARRIVE_BY)),
            Workplace::Venue => (true, missing.max(0)),
        };
    }
    let owed = desk.inside - out - desk.going;
    match place {
        Workplace::Office if !dormant => (false, hour_share(owed, hour, leave_by)),
        _ => (false, owed.max(0)),
    }
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
