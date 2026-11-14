//! The person card's facts (#2092): why a person is out, where the leg they
//! are on began and where it ends. Read on demand when a player opens a
//! person's card; nothing here runs in the step, and nothing here draws a
//! random number.
//!
//! What a person knows depends on who sent them. A meal trip, a venue
//! visit, a school run, a sales call and a housekeeper know their rooms. A
//! plain commute (the floor-list trips of `spawn_trips`) knows a floor and a
//! tile, so the card names the room on that tile only when it is the kind
//! the trip is for, and the floor otherwise.

use super::staff_shift::StaffTrip;
use super::Person;
use crate::facilities::Kind;
use crate::tower::Tower;

/// The kind of room a plain commute heads for or leaves.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ErrandPlace {
    Office,
    Home,
    Venue,
}

impl ErrandPlace {
    /// Whether a room of `kind` is one this errand is for: the same kinds
    /// that put a floor on its list in `spawn_floors`.
    pub fn fits(self, kind: Kind) -> bool {
        match self {
            ErrandPlace::Office => kind == Kind::Office,
            ErrandPlace::Home => kind == Kind::Condo || kind.is_rental() || kind.is_hotel(),
            ErrandPlace::Venue => kind.is_ambient_venue(),
        }
    }
}

/// Why a plain commute set out: the room kind, and whether the person is
/// coming in to it (`inbound`) or leaving it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Errand {
    pub place: ErrandPlace,
    pub inbound: bool,
}

/// Why a person is out, as the card says it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Purpose {
    ToWork,
    FromWork,
    LeaveHome,
    ReturnHome,
    ToVenue,
    FromVenue,
    Meal,
    Visit,
    SchoolRun,
    SalesCall,
    Housekeeping,
    Unknown,
}

impl Purpose {
    pub const ALL: [Purpose; 12] = [
        Purpose::ToWork,
        Purpose::FromWork,
        Purpose::LeaveHome,
        Purpose::ReturnHome,
        Purpose::ToVenue,
        Purpose::FromVenue,
        Purpose::Meal,
        Purpose::Visit,
        Purpose::SchoolRun,
        Purpose::SalesCall,
        Purpose::Housekeeping,
        Purpose::Unknown,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Purpose::ToWork => "toWork",
            Purpose::FromWork => "fromWork",
            Purpose::LeaveHome => "leaveHome",
            Purpose::ReturnHome => "returnHome",
            Purpose::ToVenue => "toVenue",
            Purpose::FromVenue => "fromVenue",
            Purpose::Meal => "meal",
            Purpose::Visit => "visit",
            Purpose::SchoolRun => "schoolRun",
            Purpose::SalesCall => "salesCall",
            Purpose::Housekeeping => "housekeeping",
            Purpose::Unknown => "unknown",
        }
    }

    fn of_errand(e: Errand) -> Purpose {
        match (e.place, e.inbound) {
            (ErrandPlace::Office, true) => Purpose::ToWork,
            (ErrandPlace::Office, false) => Purpose::FromWork,
            (ErrandPlace::Home, true) => Purpose::ReturnHome,
            (ErrandPlace::Home, false) => Purpose::LeaveHome,
            (ErrandPlace::Venue, true) => Purpose::ToVenue,
            (ErrandPlace::Venue, false) => Purpose::FromVenue,
        }
    }
}

/// One end of a leg.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Place {
    /// Nothing to name (a housekeeper waiting for work, or a room since
    /// bulldozed).
    None,
    /// A room or venue, by unit id.
    Room(i64),
    /// A floor, where the trip names no room.
    Floor(i64),
    /// A lobby floor: the street door on the ground, or a sky lobby.
    Lobby(i64),
    /// A Metro platform floor.
    Metro(i64),
}

impl Place {
    pub const NAMES: [&'static str; 5] = ["none", "room", "floor", "lobby", "metro"];

    pub fn name(self) -> &'static str {
        match self {
            Place::None => "none",
            Place::Room(_) => "room",
            Place::Floor(_) => "floor",
            Place::Lobby(_) => "lobby",
            Place::Metro(_) => "metro",
        }
    }
}

/// What the card says about a person's trip.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TripFacts {
    pub purpose: Purpose,
    /// For a housekeeper, the housekeeping room they work from; for anyone
    /// else, where this leg began.
    pub from: Place,
    pub to: Place,
    /// On the way back from a meal or a visit.
    pub returning: bool,
    /// A housekeeper's step in their working day.
    pub shift: Option<StaffTrip>,
}

/// The room `id` while it stands.
fn room(tower: &Tower, id: Option<i64>) -> Place {
    match id.and_then(|id| tower.get_unit(id)) {
        Some(u) => Place::Room(u.id),
        None => Place::None,
    }
}

/// A floor a trip starts or ends on with no room of its own: a Metro
/// platform, a lobby, or a plain floor.
fn end_place(tower: &Tower, floor: i64) -> Place {
    if floor < 1 && tower.metro_stations().any(|u| u.floor + 1 == floor) {
        Place::Metro(floor)
    } else if tower.lobby_tiles.contains_key(&floor) {
        Place::Lobby(floor)
    } else {
        Place::Floor(floor)
    }
}

/// The room on tile `x` of `floor` when it is the kind `place` is for, else
/// the floor.
fn room_at(tower: &Tower, floor: i64, x: f64, place: ErrandPlace) -> Place {
    match tower.unit_at(floor, x.floor() as i64) {
        Some(u) if place.fits(u.kind) => Place::Room(u.id),
        _ => Place::Floor(floor),
    }
}

fn is_food(kind: Kind) -> bool {
    matches!(kind, Kind::FastFood | Kind::Restaurant | Kind::FoodHall)
}

/// The card's facts for person `p`.
pub fn trip_facts(p: &Person, tower: &Tower) -> TripFacts {
    let first = p.floors.first().copied().unwrap_or(p.floor);
    let last = p.floors.last().copied().unwrap_or(p.floor);
    let facts = |purpose, from, to| TripFacts {
        purpose,
        from,
        to,
        returning: false,
        shift: None,
    };
    if p.staff {
        let base = room(tower, p.crew_id);
        let to = match p.staff_trip {
            Some(StaffTrip::In | StaffTrip::Home) => base,
            Some(StaffTrip::Job) => room(tower, p.clean_unit_id),
            Some(StaffTrip::Out) => end_place(tower, last),
            Some(StaffTrip::Base | StaffTrip::Free) | None => Place::None,
        };
        return TripFacts {
            shift: p.staff_trip,
            ..facts(Purpose::Housekeeping, base, to)
        };
    }
    if let Some(venue_id) = p.meal_venue_id {
        let venue_unit = tower.get_unit(venue_id);
        let purpose = match venue_unit {
            Some(v) if is_food(v.kind) => Purpose::Meal,
            _ => Purpose::Visit,
        };
        let (home_floor, venue_floor) = if p.returning {
            (last, first)
        } else {
            (first, last)
        };
        let home = match p.origin_unit_id {
            Some(id) => room(tower, Some(id)),
            None => end_place(tower, home_floor),
        };
        let venue = match venue_unit {
            Some(v) => Place::Room(v.id),
            None => Place::Floor(venue_floor),
        };
        let (from, to) = if p.returning {
            (venue, home)
        } else {
            (home, venue)
        };
        return TripFacts {
            returning: p.returning,
            ..facts(purpose, from, to)
        };
    }
    match p.routine {
        Some("schoolRun") => {
            return match p.origin_unit_id {
                Some(id) => facts(
                    Purpose::SchoolRun,
                    room(tower, Some(id)),
                    end_place(tower, last),
                ),
                None => facts(
                    Purpose::SchoolRun,
                    end_place(tower, first),
                    room_at(tower, last, p.dest_x, ErrandPlace::Home),
                ),
            };
        }
        Some("salesCall") => {
            return facts(
                Purpose::SalesCall,
                room(tower, p.origin_unit_id),
                end_place(tower, last),
            );
        }
        _ => {}
    }
    match p.errand {
        Some(e) if e.inbound => facts(
            Purpose::of_errand(e),
            end_place(tower, first),
            room_at(tower, last, p.dest_x, e.place),
        ),
        Some(e) => facts(
            Purpose::of_errand(e),
            room_at(tower, first, p.start_x, e.place),
            end_place(tower, last),
        ),
        None => facts(
            Purpose::Unknown,
            end_place(tower, first),
            end_place(tower, last),
        ),
    }
}

#[cfg(test)]
#[path = "trip_tests.rs"]
mod tests;
