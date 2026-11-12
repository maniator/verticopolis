//! Parking demand: hotel suites and offices in both modes, and in Modern the
//! homes too (#1973, owner decision 2026-11-12). From three stars a share of
//! each Modern home's households own a car, and a working Metro station
//! halves the parking Modern offices and homes need.
//!
//! Classic keeps the 1994 rule: condos never ask for a space, and a Metro
//! changes no parking demand. The shares are Modern tuning, not canon: one
//! space per 2 occupied condos, per 3 occupied apartments and per 6
//! occupied studios. They are counted in aggregate, with no per-household
//! stall and no random draw, the same way office parking is.

use crate::facilities::Kind;
use crate::rules::OfficeParking;
use crate::services::PARKING_WORKERS_PER_SPACE;
use crate::sim::Simulation;

/// Slack for comparing sums of household shares, which thirds and sixths
/// make inexact in floating point.
pub const SHARE_EPSILON: f64 = 1e-9;

/// Modern: occupied condos that share one parking space.
pub const CONDOS_PER_SPACE: f64 = 2.0;
/// Modern: occupied apartments that share one parking space.
pub const APARTMENTS_PER_SPACE: f64 = 3.0;
/// Modern: occupied studios that share one parking space.
pub const STUDIOS_PER_SPACE: f64 = 6.0;
/// Modern: the share of office and home parking demand left once a Metro
/// station works. Hotel suites still need a space each.
pub const METRO_PARKING_SHARE: f64 = 0.5;
/// Modern: the move-in and condo-sale chance a home keeps while parking
/// covers under half of what offices and homes need.
pub const HOME_MOVE_IN_SHORT_FACTOR: f64 = 0.5;
/// Modern: the coverage under which homes move in more slowly.
pub const HOME_SLOW_COVERAGE: f64 = 0.5;

/// The tower's parking demand, zero below the star rating parking unlocks at.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ParkingDemand {
    pub office_pop: f64,
    /// Whole spaces the offices need, after the Metro's share.
    pub offices: f64,
    /// Operational hotel suites, a space each.
    pub suites: f64,
    /// Modern: the whole spaces the homes add to the offices', after the
    /// Metro's share, so `offices + homes` is what the two need together
    /// (they share spaces, so their fractions are rounded once, together).
    /// Classic homes need none.
    pub homes: f64,
    pub total: f64,
    /// Modern: the spaces the homes need, unrounded, after the Metro's share.
    pub home_need: f64,
    /// The spaces offices and homes need together, unrounded: what the spaces
    /// the suites leave are measured against.
    pub shared_need: f64,
}

/// What the parking means for the daily move-in pass.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ParkingMoveIn {
    /// Offices are short of parking: their move-in chance halves.
    pub office_short: bool,
    /// The factor a home's move-in or condo-sale chance keeps.
    pub home_factor: f64,
}

/// Whether a hotel suite lacks its space: fewer working spaces than suites.
pub(crate) fn suite_short_of(d: &ParkingDemand, spots: f64) -> bool {
    d.suites > 0.0 && spots < d.suites
}

/// [`Simulation::parking_short`] from readings a caller already holds: the
/// demand, the working spaces and `ServiceShortfalls::parking_coverage()`,
/// which is `Some` exactly while offices (and Modern homes) are short by the
/// mode's rule, the same answer the move-in pass reads.
pub(crate) fn parking_short_of(d: &ParkingDemand, spots: f64, coverage: Option<f64>) -> bool {
    suite_short_of(d, spots) || coverage.is_some()
}

/// `need` as whole spaces, ignoring rounding noise in the shares.
fn whole_spaces(need: f64) -> f64 {
    (need - SHARE_EPSILON).ceil().max(0.0)
}

/// Whether `kind` is a home whose households need parking in Modern.
pub fn is_parked_home(kind: Kind) -> bool {
    kind == Kind::Condo || kind.is_rental()
}

/// The parking spaces one tenanted unit of `kind` needs in Modern before the
/// Metro's share: an office's workers at [`PARKING_WORKERS_PER_SPACE`], or a
/// home's household share. `None` for a kind that parks no one this way
/// (hotel suites reserve a whole space each, apart from this count).
pub fn modern_spaces_for(kind: Kind) -> Option<f64> {
    match kind {
        Kind::Office => Some(Kind::Office.facility().population as f64 / PARKING_WORKERS_PER_SPACE),
        Kind::Condo => Some(1.0 / CONDOS_PER_SPACE),
        Kind::RentalApartment => Some(1.0 / APARTMENTS_PER_SPACE),
        Kind::RentalStudio => Some(1.0 / STUDIOS_PER_SPACE),
        _ => None,
    }
}

#[doc(hidden)]
impl Simulation {
    pub fn parking_demand(&self) -> ParkingDemand {
        if self.star < Kind::Parking.facility().min_star {
            return ParkingDemand::default();
        }
        let homes_park = self.mode.homes_need_parking();
        let mut office_pop = 0.0;
        let mut suites = 0.0;
        let mut home_need = 0.0;
        for u in self.tower.room_units() {
            if u.kind == Kind::Office && u.is_tenanted() {
                office_pop += Kind::Office.facility().population as f64;
            } else if u.kind == Kind::HotelSuite && u.is_operational() {
                suites += 1.0;
            } else if homes_park && is_parked_home(u.kind) && u.is_tenanted() {
                home_need += modern_spaces_for(u.kind).unwrap_or(0.0);
            }
        }
        let share = self.parking_demand_share();
        // The spaces the office workers' cars fill, what the garage draws and
        // the statistics count, after a Modern Metro's share. Whether the
        // offices are short is the mode's rule (#1970).
        let office_need = office_pop / PARKING_WORKERS_PER_SPACE * share;
        let home_need = home_need * share;
        let shared_need = office_need + home_need;
        let offices = whole_spaces(office_need);
        let shared = whole_spaces(shared_need);
        ParkingDemand {
            office_pop,
            offices,
            suites,
            homes: (shared - offices).max(0.0),
            total: shared + suites,
            home_need,
            shared_need,
        }
    }

    /// The working spaces left once every operational hotel suite has its own.
    pub fn parking_spare_after_suites(&self, d: &ParkingDemand) -> f64 {
        (self.tower.functional_parking_spots() as f64 - d.suites).max(0.0)
    }

    /// Whether offices are short of parking, which halves office move-ins.
    /// Classic asks its mode rule (one free space serves every office,
    /// #1970); Modern measures what offices and homes need together, since
    /// they share the spaces.
    pub fn office_parking_short(&self) -> bool {
        self.parking_move_in_reading().office_short
    }

    /// Whether the tower is short of parking by the mode's rule: a hotel suite
    /// lacks its space, or offices are short (#1970). This is the answer the
    /// stats screen's parking line and the parking inspector color by, so a
    /// Classic garage with fewer spaces than cars, but one free for the
    /// offices, does not read as short.
    pub fn parking_short(&self) -> bool {
        let d = self.parking_demand();
        let spots = self.tower.functional_parking_spots() as f64;
        parking_short_of(&d, spots, self.service_shortfalls().parking_coverage())
    }

    /// One reading of the parking for the daily move-in pass: whether offices
    /// are short, and the factor a Modern home's move-in and condo-sale chance
    /// keeps (lower while the parking covers under [`HOME_SLOW_COVERAGE`] of
    /// what offices and homes need). Floods the garage once.
    pub fn parking_move_in_reading(&self) -> ParkingMoveIn {
        if self.star < Kind::Parking.facility().min_star {
            return ParkingMoveIn {
                office_short: false,
                home_factor: 1.0,
            };
        }
        let d = self.parking_demand();
        let spare = self.parking_spare_after_suites(&d);
        match self.mode.office_parking() {
            // Classic: the same answer the satisfaction drain reads (#1970).
            OfficeParking::AnyFreeSpace => ParkingMoveIn {
                office_short: self.service_shortfalls().parking_coverage().is_some(),
                home_factor: 1.0,
            },
            OfficeParking::WorkersPerSpace(_) => {
                let short = spare + SHARE_EPSILON < d.shared_need;
                let slow_homes = short && spare < HOME_SLOW_COVERAGE * d.shared_need;
                ParkingMoveIn {
                    office_short: short,
                    home_factor: if slow_homes {
                        HOME_MOVE_IN_SHORT_FACTOR
                    } else {
                        1.0
                    },
                }
            }
        }
    }

    /// The share of office and home parking demand the tower carries: half
    /// in Modern while a Metro station works, and all of it otherwise.
    pub fn parking_demand_share(&self) -> f64 {
        let metro_works = self.mode.metro_eases_parking()
            && self
                .tower
                .units_of_kind(Kind::Metro)
                .any(|u| u.is_operational());
        if metro_works {
            METRO_PARKING_SHARE
        } else {
            1.0
        }
    }
}
