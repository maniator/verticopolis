//! Parking: how offices count their spaces (#1970), and what Modern adds for
//! homes and the Metro (#1973).

use crate::clock::GameMode;
use crate::satisfaction::shortfall::SHORTFALL_SINK_COVERAGE;
use crate::services::PARKING_WORKERS_PER_SPACE;

/// How a mode counts the parking its offices have (#1970).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum OfficeParking {
    /// Classic: any space left once the occupied hotel suites park serves
    /// every office, and none serves none.
    AnyFreeSpace,
    /// Modern: each space left after every operational suite serves this
    /// many workers, lowest offices first.
    WorkersPerSpace(f64),
}

#[doc(hidden)]
impl GameMode {
    /// Whether homes (condos and rentals) need parking for a share of their
    /// households (#1973): Modern only, since Classic condos never asked for
    /// a space in the original game.
    pub fn homes_need_parking(self) -> bool {
        match self {
            GameMode::Classic => false,
            GameMode::Modern => true,
        }
    }

    /// Whether a working Metro station halves what offices and homes need in
    /// parking (#1973): Modern only. Hotel suites still need a space each.
    pub fn metro_eases_parking(self) -> bool {
        match self {
            GameMode::Classic => false,
            GameMode::Modern => true,
        }
    }

    /// Whether an unparked office's shortfall sinks its rating at
    /// `coverage`: always in Classic (where it means no parking at all),
    /// and in Modern under [`SHORTFALL_SINK_COVERAGE`].
    pub fn office_parking_shortfall_sinks(self, coverage: f64) -> bool {
        match self {
            GameMode::Classic => true,
            GameMode::Modern => coverage < SHORTFALL_SINK_COVERAGE,
        }
    }

    /// How the mode counts its offices' parking.
    pub fn office_parking(self) -> OfficeParking {
        match self {
            GameMode::Classic => OfficeParking::AnyFreeSpace,
            GameMode::Modern => OfficeParking::WorkersPerSpace(PARKING_WORKERS_PER_SPACE),
        }
    }
}
