//! Port of `src/engine/EconomySystem.ts` and `economy/rentalIncome.ts`.

use indexmap::IndexMap;

use crate::clock::GameMode;
use crate::econ::{rent_config, rent_of};
use crate::facilities::Kind;
use crate::jsmath;
use crate::services::with_thousands;
use crate::sim::{LogKind, Simulation};

mod traffic;
mod upkeep;

pub const COMMERCIAL_LOBBY_FLOORS: i64 = 2;
const COMMERCIAL_LOBBY_FAR_MULT: f64 = 0.5;
pub const TRAFFIC_FACTOR_MIN: f64 = 0.6;
pub const TRAFFIC_FACTOR_SPAN: f64 = 0.4;
pub const MAINTENANCE_PER_CAR_MONTHLY: f64 = 600.0;
pub const CINEMA_BOOKING_MONTHLY: f64 = 150_000.0;
pub const CINEMA_BOOKING_BLOCKBUSTER: f64 = 300_000.0;
pub const NIGHTCLUB_DJ_MONTHLY: f64 = 40_000.0;
pub const CONDO_MONTHLY_TAX_RATE: f64 = 0.015;
pub const OVERHEAD_PER_LEASABLE_UNIT_MONTHLY: f64 = 700.0;
pub const REAL_WORLD_MAINT_PERIOD_DAYS: f64 = 30.0;
pub const REAL_WORLD_QUARTER_DAYS: f64 = 90.0;

/// `ledgerCatFor`.
pub fn ledger_cat_for(kind: Kind) -> Option<&'static str> {
    Some(match kind {
        Kind::Office => "offices",
        Kind::Condo | Kind::RentalStudio | Kind::RentalApartment => "condos",
        Kind::HotelSingle | Kind::HotelDouble | Kind::HotelSuite => "hotels",
        Kind::Shop | Kind::BoutiqueBay | Kind::Clinic | Kind::Daycare => "retail",
        Kind::FastFood | Kind::Restaurant | Kind::FoodHall => "food",
        Kind::Cinema
        | Kind::PartyHall
        | Kind::AquaticCenter
        | Kind::Amusements
        | Kind::FitnessClub
        | Kind::Nightclub
        | Kind::Spa
        | Kind::SkyBar => "entertainment",
        _ => return None,
    })
}

/// `ECON.dailyTrafficIncome` (Modern).
pub fn daily_traffic_income(kind: Kind) -> Option<f64> {
    Some(match kind {
        Kind::FastFood => 2_000.0,
        Kind::Restaurant => 4_000.0,
        Kind::FoodHall => 6_500.0,
        Kind::Amusements => 4_500.0,
        Kind::BoutiqueBay => 3_500.0,
        Kind::Nightclub => 10_000.0,
        Kind::Spa => 5_000.0,
        Kind::SkyBar => 4_000.0,
        Kind::AquaticCenter => 7_000.0,
        Kind::Daycare => 3_500.0,
        Kind::Shop => 2_500.0,
        Kind::Cinema => 8_000.0,
        Kind::PartyHall => 3_000.0,
        _ => return None,
    })
}

/// `ECON.classicDailyTrafficIncome`.
pub fn classic_daily_traffic_income(kind: Kind) -> Option<f64> {
    Some(match kind {
        Kind::FastFood => 5_000.0,
        Kind::Restaurant => 10_000.0,
        Kind::Shop => 20_000.0,
        Kind::Cinema => 10_000.0,
        Kind::PartyHall => 20_000.0,
        _ => return None,
    })
}

/// `GameRules.commercialDailyIncome`.
pub fn commercial_daily_income(mode: GameMode, kind: Kind) -> Option<f64> {
    match mode {
        GameMode::Classic => classic_daily_traffic_income(kind),
        GameMode::Modern => daily_traffic_income(kind),
    }
}

/// `ECON.retailSpendPerCustomer`.
pub fn retail_spend_per_customer(kind: Kind) -> Option<f64> {
    Some(match kind {
        Kind::FastFood => 10.0,
        Kind::Restaurant => 30.0,
        Kind::FoodHall => 25.0,
        Kind::Amusements => 15.0,
        Kind::BoutiqueBay => 20.0,
        Kind::Nightclub => 30.0,
        Kind::Spa => 40.0,
        Kind::SkyBar => 35.0,
        Kind::Daycare => 25.0,
        Kind::Shop => 20.0,
        _ => return None,
    })
}

/// `GameRules.weekendMultiplier`.
pub fn weekend_multiplier(mode: GameMode, kind: Kind, is_weekend: bool) -> f64 {
    if !is_weekend {
        return 1.0;
    }
    match mode {
        GameMode::Classic => match kind {
            Kind::FastFood | Kind::Restaurant => 48.0 / 35.0,
            Kind::Shop => 30.0 / 25.0,
            _ => 1.0,
        },
        GameMode::Modern => match kind {
            Kind::FastFood => 0.7,
            Kind::Restaurant => 1.35,
            Kind::FoodHall => 1.25,
            Kind::Amusements => 1.4,
            Kind::BoutiqueBay => 1.3,
            Kind::Nightclub => 1.5,
            Kind::Spa => 1.4,
            Kind::SkyBar => 1.45,
            Kind::Daycare => 0.6,
            Kind::Shop => 1.2,
            _ => 1.0,
        },
    }
}

/// `ECON.serviceMaintenanceMonthly`.
pub fn service_maintenance_monthly(kind: Kind) -> Option<f64> {
    Some(match kind {
        Kind::Security => 2_000.0,
        Kind::Medical => 5_000.0,
        Kind::Housekeeping => 1_000.0,
        Kind::Recycling => 4_000.0,
        Kind::Metro => 8_000.0,
        _ => return None,
    })
}

/// `isOverheadKind`.
fn is_overhead_kind(kind: Kind) -> bool {
    rent_config(kind).is_some() || daily_traffic_income(kind).is_some()
}

impl Simulation {
    pub fn has_operational(&self, kind: Kind) -> bool {
        self.tower.units_of_kind(kind).any(|u| u.is_operational())
    }

    pub fn count_operational(&self, kind: Kind) -> i64 {
        self.tower
            .units_of_kind(kind)
            .filter(|u| u.is_operational())
            .count() as i64
    }

    pub fn has_any(&self, kind: Kind) -> bool {
        self.tower.units_of_kind(kind).next().is_some()
    }

    /// `collectRent`: quarterly lease income.
    pub fn collect_rent(&mut self) {
        let mut sums: IndexMap<Kind, (f64, i64)> = IndexMap::new();
        for u in &self.tower.units {
            if !matches!(u.kind, Kind::Office | Kind::FitnessClub | Kind::Clinic) {
                continue;
            }
            if !u.is_tenanted() || !self.tower.is_floor_served(u.floor) {
                continue;
            }
            let b = sums.entry(u.kind).or_insert((0.0, 0));
            b.0 += rent_of(u.kind, u.rent, u.no_rate);
            b.1 += 1;
        }
        let scale = self
            .mode
            .quarterly_rent_scale(self.clock.calendar.quarter_days);
        for (kind, (sum, n)) in sums {
            let amt = jsmath::round(sum * scale);
            if amt <= 0.0 {
                continue;
            }
            self.money += amt;
            self.record_money(ledger_cat_for(kind).unwrap_or("upkeep"), amt);
            let msg = lease_message(kind, amt, n);
            self.emit(&msg, LogKind::Money);
        }
    }
}

/// The quarterly lease line (`LEASE_MESSAGE` in `EconomySystem.ts`).
pub(crate) fn lease_message(kind: Kind, amt: f64, n: i64) -> String {
    let plural = if n > 1 { "s" } else { "" };
    match kind {
        Kind::Office => format!(
            "Quarterly office rent collected: ${} ({n} offices).",
            with_thousands(amt)
        ),
        Kind::FitnessClub => format!(
            "Fitness Club membership dues collected: ${} ({n} club{plural}).",
            with_thousands(amt)
        ),
        _ => format!(
            "Clinic lease collected: ${} ({n} clinic{plural}).",
            with_thousands(amt)
        ),
    }
}

/// The monthly rental line (`collectRentalIncome` in `rentalIncome.ts`).
pub(crate) fn rental_message(amt: f64, n: i64) -> String {
    format!(
        "Monthly rent collected: ${} ({n} rental{}).",
        with_thousands(amt),
        if n > 1 { "s" } else { "" }
    )
}

#[cfg(test)]
mod message_tests {
    use super::*;

    #[test]
    fn rent_lines_word_their_counts_as_typescript_does() {
        // The TypeScript templates (EconomySystem.ts LEASE_MESSAGE, rentalIncome.ts).
        assert_eq!(
            lease_message(Kind::Office, 1520000.0, 152),
            "Quarterly office rent collected: $1,520,000 (152 offices)."
        );
        // The TypeScript office line never drops its plural.
        assert_eq!(
            lease_message(Kind::Office, 10000.0, 1),
            "Quarterly office rent collected: $10,000 (1 offices)."
        );
        assert_eq!(
            crate::build::treasure_message(452311.0),
            "💰 Excavation crews unearthed buried treasure worth $452,311!"
        );
        assert_eq!(
            lease_message(Kind::FitnessClub, 30000.0, 1),
            "Fitness Club membership dues collected: $30,000 (1 club)."
        );
        assert_eq!(
            lease_message(Kind::FitnessClub, 60000.0, 2),
            "Fitness Club membership dues collected: $60,000 (2 clubs)."
        );
        assert_eq!(
            lease_message(Kind::Clinic, 1500.0, 1),
            "Clinic lease collected: $1,500 (1 clinic)."
        );
        assert_eq!(
            lease_message(Kind::Clinic, 3000.0, 2),
            "Clinic lease collected: $3,000 (2 clinics)."
        );
        assert_eq!(
            rental_message(950.0, 1),
            "Monthly rent collected: $950 (1 rental)."
        );
        assert_eq!(
            rental_message(12500.0, 3),
            "Monthly rent collected: $12,500 (3 rentals)."
        );
    }
}
