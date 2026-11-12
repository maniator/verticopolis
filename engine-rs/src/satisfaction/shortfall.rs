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
//!   [`SHORTFALL_SINK_COVERAGE`] of the office workers. Every operational
//!   suite reserves its space first, and the rest go to the tenanted offices
//!   nearest the basement (lowest floor, then leftmost), six workers each
//!   at [`crate::services::PARKING_WORKERS_PER_SPACE`] workers a space;
//!   only the offices left without one feel the shortfall. The one-center
//!   allowance gives a tower that just reached three stars room to afford
//!   its first center before anyone leaves.
//!
//! Each mode's choices are named rules on `GameMode` in `rules.rs`.
//!
//! Recycling is tower-wide: every rated tenant shares the trash. An empty
//! office the move-in gate weighs gets parking only if it would be parked.

use crate::clock::GameMode;
use crate::demand::RECYCLING_POP_PER_CENTER;
use crate::facilities::Kind;
use crate::rules::{Drain, OfficeParking};
use crate::satisfaction::GRIPE_WARN;
use crate::services::recycling_capacity_of;
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

/// The tower's service need and capacity this hour, read once per pass.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ServiceShortfalls {
    /// The tower's mode once both services are demanded (from
    /// [`SHORTFALL_MIN_STAR`]); `None` below it, when nothing falls short.
    demanded_in: Option<GameMode>,
    population: f64,
    recycling_capacity: f64,
    office_workers: f64,
    /// The office workers the parking left after the hotel suites can serve.
    /// Classic counts no ratio: any free space serves every office (infinite
    /// capacity), and none serves none.
    office_parking_capacity: f64,
    /// The first tenanted office, in parking order (floor, then x, then
    /// id), the spaces ran out before: it and every office after it go
    /// unparked. `None` while every tenanted office parks.
    first_unparked: Option<OfficeOrder>,
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

/// An office's place in the parking order: floor, then x, then id.
type OfficeOrder = (i64, i64, i64);

fn office_order(u: &Unit) -> OfficeOrder {
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

    fn candidate_office_workers(&self) -> f64 {
        match self.candidate {
            Some((Kind::Office, pop)) => pop,
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

    /// The share of office workers the parking serves tower-wide, while it
    /// falls short.
    pub fn office_parking_coverage(&self) -> Option<f64> {
        self.demanded_in?;
        let workers = self.office_workers + self.candidate_office_workers();
        short_coverage(self.office_parking_capacity, workers)
    }

    /// The parking shortfall office `u` feels: none when it holds a space (a
    /// tenanted office the allocation reached), or, for an office the gate
    /// is weighing, when the spaces cover every worker with it counted.
    pub fn office_parking_for(&self, u: &Unit) -> Option<ServiceShort> {
        if u.kind != Kind::Office {
            return None;
        }
        let mode = self.demanded_in?;
        let coverage = self.office_parking_coverage()?;
        let unparked = if u.is_tenanted() {
            self.first_unparked
                .is_some_and(|first| office_order(u) >= first)
        } else {
            true
        };
        unparked.then_some(ServiceShort {
            cause: PARKING_CAUSE,
            coverage,
            sinks: mode.office_parking_shortfall_sinks(coverage),
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
        let parking = self.office_parking_for(u);
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
            PARKING_CAUSE => self.office_parking_coverage(),
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
        let office_parking_capacity = match self.mode.office_parking() {
            OfficeParking::AnyFreeSpace => {
                let guests_parked = self
                    .tower
                    .units_of_kind(Kind::HotelSuite)
                    .filter(|u| u.is_present())
                    .count() as f64;
                if spots > guests_parked {
                    f64::INFINITY
                } else {
                    0.0
                }
            }
            OfficeParking::WorkersPerSpace(workers) => (spots - d.suites).max(0.0) * workers,
        };
        let mut first_unparked = None;
        if d.office_pop > office_parking_capacity {
            let mut offices: Vec<OfficeOrder> = self
                .tower
                .units_of_kind(Kind::Office)
                .filter(|u| u.is_tenanted())
                .map(office_order)
                .collect();
            let parked = (office_parking_capacity / office_workers_each()).floor() as usize;
            if parked < offices.len() {
                // Only the boundary matters, so a linear selection does.
                first_unparked = Some(*offices.select_nth_unstable(parked).1);
            }
        }
        ServiceShortfalls {
            demanded_in: Some(self.mode),
            population: self.tower.total_population() as f64,
            recycling_capacity: recycling_capacity_of(self.recycling_centers()),
            office_workers: d.office_pop,
            office_parking_capacity,
            first_unparked,
            candidate: None,
        }
    }
}
