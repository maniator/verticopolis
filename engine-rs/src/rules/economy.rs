//! What the tower pays and earns: overhead, taxes, rent cadence, films, the
//! metro's draw, retail demand and the view premium.

use crate::clock::GameMode;
use crate::economy::films::{FilmRules, CLASSIC_FILMS, MODERN_FILMS};
use crate::economy::{
    CONDO_MONTHLY_TAX_RATE, OVERHEAD_PER_LEASABLE_UNIT_MONTHLY, REAL_WORLD_QUARTER_DAYS,
};

pub const DEMAND_PER_CAPITA: f64 = 30.0;
pub const DEMAND_FLOOR_MODERN: f64 = 0.25;
pub const SKY_BAR_VIEW_BASE_FLOOR: f64 = 10.0;
pub const SKY_BAR_VIEW_PER_FLOOR: f64 = 0.02;
pub const SKY_BAR_VIEW_MAX: f64 = 1.0;

#[doc(hidden)]
impl GameMode {
    /// `operatingOverheadPerUnit()`: Classic charges none.
    pub fn operating_overhead_per_unit(self) -> f64 {
        match self {
            GameMode::Classic => 0.0,
            GameMode::Modern => OVERHEAD_PER_LEASABLE_UNIT_MONTHLY,
        }
    }

    /// `condoHoldTaxRate()`: Classic charges none.
    pub fn condo_hold_tax_rate(self) -> f64 {
        match self {
            GameMode::Classic => 0.0,
            GameMode::Modern => CONDO_MONTHLY_TAX_RATE,
        }
    }

    /// `quarterlyRentScale(quarterDays)`: Classic lands the full canon lump
    /// every quarter; Modern rescales it to the quarter's length.
    pub fn quarterly_rent_scale(self, quarter_days: i64) -> f64 {
        match self {
            GameMode::Classic => 1.0,
            GameMode::Modern => quarter_days as f64 / REAL_WORLD_QUARTER_DAYS,
        }
    }

    /// Whether a new game lets the player pick its calendar: Modern offers
    /// the real-world calendar and the canon one; Classic always runs canon
    /// (see `clock::resolve_calendar`).
    pub fn lets_player_choose_calendar(self) -> bool {
        self == GameMode::Modern
    }

    /// The films a theater can show, their prices and run, and how they earn
    /// (#1932, #1950). Neither mode charges a theater each period: Classic
    /// shows a new film or a classic when ticket sales fall, as SimTower
    /// does, and Modern books a revival, a feature or a blockbuster and books
    /// it again when it is spent.
    pub fn films(self) -> &'static FilmRules {
        match self {
            GameMode::Classic => &CLASSIC_FILMS,
            GameMode::Modern => &MODERN_FILMS,
        }
    }

    /// Whether the metro's help to business needs its platform floor served:
    /// SimTower's station only draws visitors once the station's floors have
    /// transport connected. Modern keeps the older any-operational-station rule.
    pub fn metro_help_needs_service(self) -> bool {
        self == GameMode::Classic
    }

    /// `demandModel()`: `(perCapita, floor)`.
    pub fn demand_model(self) -> (f64, f64) {
        match self {
            GameMode::Classic => (DEMAND_PER_CAPITA, 0.0),
            GameMode::Modern => (DEMAND_PER_CAPITA, DEMAND_FLOOR_MODERN),
        }
    }

    pub fn view_premium(self, floor: i64) -> f64 {
        match self {
            GameMode::Classic => 1.0,
            GameMode::Modern => {
                let above = (floor as f64 - SKY_BAR_VIEW_BASE_FLOOR).max(0.0);
                1.0 + (above * SKY_BAR_VIEW_PER_FLOOR).min(SKY_BAR_VIEW_MAX)
            }
        }
    }
}
