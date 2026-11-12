//! Service shortfalls that lower tenant evaluations: too little recycling for
//! the tower's trash, and too little parking for its office workers.
//!
//! The original lowers evaluations when either runs short from three stars
//! (the Classic reference: trash is an evaluation factor once recycling is
//! needed, and offices want parking from three stars). It publishes no
//! formula, so the shape here is ours, by mode (owner ruling, 2026-11-12):
//!
//! - **Classic** is the strict game. Any recycling shortfall sinks every
//!   rated tenant to red, and tenants give notice as they do for any other
//!   red rating, until the service is fixed. Offices sink the same way when
//!   no parking is available to them: no working space is left once the
//!   occupied hotel suites take theirs. The references name no
//!   workers-per-space ratio (the wiki's Office article says offices lose
//!   evaluation "if no parking is available"), and real five-star towers
//!   saved by the original (TOWER6 and TOWER7 in
//!   `conformance/fixtures/tdt-reddit`) park far fewer workers than our
//!   ratio asks for, so Classic counts none. Distance to parking, which the
//!   wiki's Evaluation article also names, waits on a PC check (#1524).
//! - **Modern** is graduated. A small shortfall holds the affected rooms at
//!   Good (they cannot read Excellent, and nobody leaves); a large one sinks
//!   them: recycling more than one center short, or parking covering under
//!   [`SHORTFALL_SINK_COVERAGE`] of what offices and homes need. Every
//!   operational suite reserves its space first, and the rest go to the
//!   tenanted offices and homes nearest the basement (lowest floor, then
//!   leftmost): an office's six workers at
//!   [`crate::services::PARKING_WORKERS_PER_SPACE`] workers a space, a home
//!   its household share (#1973, `services::parking`), both halved while a
//!   Metro station works. Only the rooms left without parking feel the
//!   shortfall. A home short of parking is held at Good and never sinks, so
//!   parking alone never empties one. The one-center allowance gives a tower
//!   that just reached three stars room to afford its first center before
//!   anyone leaves.
//!
//! Each mode's choices are named rules on `GameMode` in `rules/`.
//!
//! Recycling is tower-wide: every rated tenant shares the trash. An empty
//! office the move-in gate weighs gets parking only if it would be parked.

use crate::clock::GameMode;
use crate::demand::RECYCLING_POP_PER_CENTER;
use crate::facilities::{Kind, MAX_FLOOR, MIN_FLOOR};
use crate::rules::{Drain, OfficeParking};
use crate::satisfaction::GRIPE_WARN;
use crate::services::{is_parked_home, modern_spaces_for, recycling_capacity_of, SHARE_EPSILON};
use crate::sim::Simulation;
use crate::tower::Unit;

/// The star rating from which both services are demanded.
pub const SHORTFALL_MIN_STAR: i64 = 3;
/// Modern: parking coverage under which office ratings sink instead of
/// holding.
pub const SHORTFALL_SINK_COVERAGE: f64 = 0.5;
/// Modern: recycling short by more than this much capacity (one center's
/// worth) sinks ratings instead of holding them.
pub const TRASH_SINK_MISSING_CAPACITY: f64 = RECYCLING_POP_PER_CENTER;
/// The highest satisfaction a short-served room keeps: the Good line.
pub const SHORTFALL_CAP: f64 = GRIPE_WARN;
/// Hourly erosion of a sinking shortfall, the same pull unmet shop demand
/// has. It outpaces a served room's hourly recovery even at the
/// lowest rent, so a discount cannot hold a room at Good through it.
pub const SHORTFALL_EROSION: f64 = 0.12;

/// The gripe and vacate cause for too little recycling.
pub const TRASH_CAUSE: &str = "trash";
/// The gripe and vacate cause for too little office parking.
pub const PARKING_CAUSE: &str = "parking";
/// The gripe cause for a Modern home without parking. It holds the home at
/// Good and never empties it.
pub const HOME_PARKING_CAUSE: &str = "homeParking";

/// The tower's service need and capacity this hour, read once per pass.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ServiceShortfalls {
    /// The tower's mode once both services are demanded (from
    /// [`SHORTFALL_MIN_STAR`]); `None` below it, when nothing falls short.
    demanded_in: Option<GameMode>,
    population: f64,
    recycling_capacity: f64,
    /// What the parking left after the hotel suites must serve. Classic:
    /// the office workers. Modern: the spaces offices and homes need together.
    parking_need: f64,
    /// What that parking serves, in the same unit. Classic counts no ratio:
    /// any free space serves every office (infinite capacity), and none
    /// serves none. Modern: the spare spaces.
    parking_capacity: f64,
    /// Modern: the share of office and home demand the tower carries
    /// (`Simulation::parking_demand_share`), for a newcomer's need.
    parking_share: f64,
    /// The first tenanted office (or, in Modern, home), in parking order
    /// (floor, then x, then id), the spaces ran out before: it and every
    /// room after it go unparked. `None` while every tenanted room parks.
    first_unparked: Option<RoomOrder>,
    /// A newcomer the move-in gate is weighing: its kind and population,
    /// counted in the need while it is set.
    candidate: Option<(Kind, f64)>,
}

/// `capacity` over `need` while it falls short; `None` once it covers the
/// need (or nothing is needed).
fn short_coverage(capacity: f64, need: f64) -> Option<f64> {
    (need > 0.0 && need > capacity).then(|| capacity / need)
}

/// One service falling short for a room: its cause key, the share of the
/// need the service meets tower-wide, and whether the shortfall sinks the
/// room's rating.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ServiceShort {
    pub cause: &'static str,
    pub coverage: f64,
    pub sinks: bool,
}

impl ServiceShort {
    /// Whether this shortfall may send a tenant packing. A Modern home short
    /// of parking never leaves for it (#1973).
    pub fn can_empty_a_room(self) -> bool {
        self.cause != HOME_PARKING_CAUSE
    }
}

/// The drain a shortfall puts on a room: held at Good, eroding when it sinks.
pub fn shortfall_drain(short: ServiceShort) -> Drain {
    Drain {
        cap: SHORTFALL_CAP,
        erosion: if short.sinks { SHORTFALL_EROSION } else { 0.0 },
    }
}

/// Whether a kind's evaluation suffers from a trash shortfall: the rated
/// tenants (offices, condos, hotel rooms and rentals).
fn feels_trash(kind: Kind) -> bool {
    kind == Kind::Office || kind == Kind::Condo || kind.is_hotel() || kind.is_rental()
}

/// A room's place in the parking order: floor, then x, then id.
type RoomOrder = (i64, i64, i64);

fn room_order(u: &Unit) -> RoomOrder {
    (u.floor, u.x, u.id)
}

/// The workers one office brings, and so the parking it takes.
fn office_workers_each() -> f64 {
    Kind::Office.facility().population as f64
}

impl ServiceShortfalls {
    fn candidate_population(&self) -> f64 {
        self.candidate.map_or(0.0, |(_, pop)| pop)
    }

    /// The parking a newcomer adds to the need, in [`Self::parking_need`]'s
    /// unit: an office's workers in Classic; in Modern its spaces, an
    /// office's or one household's share.
    fn candidate_parking_need(&self) -> f64 {
        let Some((kind, pop)) = self.candidate else {
            return 0.0;
        };
        match self.demanded_in.map(GameMode::office_parking) {
            Some(OfficeParking::AnyFreeSpace) if kind == Kind::Office => pop,
            Some(OfficeParking::WorkersPerSpace(_)) => {
                modern_spaces_for(kind).unwrap_or(0.0) * self.parking_share
            }
            _ => 0.0,
        }
    }

    /// The recycling shortfall, while there is one: every rated tenant
    /// shares it.
    pub fn trash(&self) -> Option<ServiceShort> {
        let mode = self.demanded_in?;
        let population = self.population + self.candidate_population();
        let coverage = short_coverage(self.recycling_capacity, population)?;
        let missing = population - self.recycling_capacity;
        Some(ServiceShort {
            cause: TRASH_CAUSE,
            coverage,
            sinks: mode.trash_shortfall_sinks(missing),
        })
    }

    /// The share of the parking need the spaces left after the suites serve
    /// tower-wide, while it falls short: the office workers in Classic, and
    /// what offices and homes need together in Modern.
    pub fn parking_coverage(&self) -> Option<f64> {
        self.demanded_in?;
        let need = self.parking_need + self.candidate_parking_need();
        short_coverage(self.parking_capacity + SHARE_EPSILON, need)
            .map(|_| (self.parking_capacity / need).min(1.0))
    }

    /// The parking shortfall room `u` feels: none when it holds a space (a
    /// tenanted room the allocation reached), or, for a room the gate is
    /// weighing, when the spaces cover the need with it counted. Offices feel
    /// it in both modes; homes only in Modern, where it holds them at Good and
    /// never sinks them.
    pub fn parking_for(&self, u: &Unit) -> Option<ServiceShort> {
        let mode = self.demanded_in?;
        let cause = match u.kind {
            Kind::Office => PARKING_CAUSE,
            kind if mode.homes_need_parking() && is_parked_home(kind) => HOME_PARKING_CAUSE,
            _ => return None,
        };
        let coverage = self.parking_coverage()?;
        let unparked = if u.is_tenanted() {
            self.first_unparked
                .is_some_and(|first| room_order(u) >= first)
        } else {
            true
        };
        unparked.then_some(ServiceShort {
            cause,
            coverage,
            sinks: cause == PARKING_CAUSE && mode.office_parking_shortfall_sinks(coverage),
        })
    }

    /// Counts a newcomer of `kind` and `population` in the need (the move-in
    /// gate's probe), or stops counting one with `None`.
    pub fn set_candidate(&mut self, candidate: Option<(Kind, f64)>) {
        self.candidate = candidate;
    }

    /// The shortfall that binds room `u`: a sinking one before one that only
    /// holds the rating, then the worse-covered of the two. A room off the
    /// network already has the worse problem, so `served` must be true.
    pub fn binding_for(&self, u: &Unit, served: bool) -> Option<ServiceShort> {
        if !served {
            return None;
        }
        let trash = self.trash().filter(|_| feels_trash(u.kind));
        let parking = self.parking_for(u);
        match (trash, parking) {
            (Some(t), Some(p)) => {
                let parking_binds = (p.sinks, -p.coverage) > (t.sinks, -t.coverage);
                Some(if parking_binds { p } else { t })
            }
            (t, p) => t.or(p),
        }
    }

    /// The tower-wide coverage behind `cause`, for the inspector's line.
    pub fn coverage_of(&self, cause: &str) -> Option<f64> {
        match cause {
            TRASH_CAUSE => self.trash().map(|t| t.coverage),
            PARKING_CAUSE | HOME_PARKING_CAUSE => self.parking_coverage(),
            _ => None,
        }
    }
}

#[doc(hidden)]
impl Simulation {
    /// This hour's service shortfalls. Below [`SHORTFALL_MIN_STAR`] neither
    /// service is demanded, so the scans are skipped.
    pub fn service_shortfalls(&self) -> ServiceShortfalls {
        if self.star < SHORTFALL_MIN_STAR {
            return ServiceShortfalls::default();
        }
        let d = self.parking_demand();
        let spots = self.tower.functional_parking_spots() as f64;
        let share = self.parking_demand_share();
        let (parking_need, parking_capacity) = match self.mode.office_parking() {
            OfficeParking::AnyFreeSpace => {
                let guests_parked = self
                    .tower
                    .units_of_kind(Kind::HotelSuite)
                    .filter(|u| u.is_present())
                    .count() as f64;
                let capacity = if spots > guests_parked {
                    f64::INFINITY
                } else {
                    0.0
                };
                (d.office_pop, capacity)
            }
            OfficeParking::WorkersPerSpace(_) => {
                (d.shared_need, self.parking_spare_after_suites(&d))
            }
        };
        let first_unparked = if parking_need > parking_capacity + SHARE_EPSILON {
            match self.mode.office_parking() {
                OfficeParking::AnyFreeSpace => self.first_unparked_office(parking_capacity),
                // Offices alone all take the same share: select the boundary.
                OfficeParking::WorkersPerSpace(workers) if d.home_need == 0.0 => {
                    self.first_unparked_office(parking_capacity * workers / share)
                }
                OfficeParking::WorkersPerSpace(_) => {
                    self.first_unparked_room(parking_capacity, share)
                }
            }
        } else {
            None
        };
        ServiceShortfalls {
            demanded_in: Some(self.mode),
            population: self.tower.total_population() as f64,
            recycling_capacity: recycling_capacity_of(self.recycling_centers()),
            parking_need,
            parking_capacity,
            parking_share: share,
            first_unparked,
            candidate: None,
        }
    }

    /// The first tenanted office the spaces run out before, with `capacity`
    /// office workers served. Only the boundary matters, so a linear
    /// selection does.
    fn first_unparked_office(&self, capacity: f64) -> Option<RoomOrder> {
        let mut offices: Vec<RoomOrder> = self
            .tower
            .units_of_kind(Kind::Office)
            .filter(|u| u.is_tenanted())
            .map(room_order)
            .collect();
        let parked = (capacity / office_workers_each()).floor() as usize;
        (parked < offices.len()).then(|| *offices.select_nth_unstable(parked).1)
    }

    /// Modern: the first tenanted office or home, in parking order, whose
    /// share would overrun the `spare` spaces. Shares differ by kind, so the
    /// boundary is found in two linear passes instead of a sort of every
    /// room: one sums each floor's shares and finds the floor the spaces run
    /// out on, and only that floor's rooms are put in order and walked.
    fn first_unparked_room(&self, spare: f64, share: f64) -> Option<RoomOrder> {
        let shares = || {
            self.tower
                .room_units()
                .filter(|u| u.is_tenanted())
                .filter_map(move |u| Some((u, modern_spaces_for(u.kind)? * share)))
        };
        let mut per_floor = [0.0_f64; (MAX_FLOOR - MIN_FLOOR + 1) as usize];
        for (u, spaces) in shares() {
            per_floor[(u.floor - MIN_FLOOR) as usize] += spaces;
        }
        let limit = spare + SHARE_EPSILON;
        let mut used = 0.0;
        let mut boundary = None;
        for (i, &spaces) in per_floor.iter().enumerate() {
            if used + spaces > limit {
                boundary = Some(i as i64 + MIN_FLOOR);
                break;
            }
            used += spaces;
        }
        let floor = boundary?;
        let mut rooms: Vec<(RoomOrder, f64)> = shares()
            .filter(|(u, _)| u.floor == floor)
            .map(|(u, spaces)| (room_order(u), spaces))
            .collect();
        rooms.sort_unstable_by_key(|&(order, _)| order);
        let last = rooms.last().map(|&(order, _)| order);
        // The floor's sum overran the spaces, so one of its rooms does; the
        // last stands in should rounding in a different order say otherwise.
        rooms
            .into_iter()
            .find_map(|(order, spaces)| {
                used += spaces;
                (used > limit).then_some(order)
            })
            .or(last)
    }
}
