//! Who lives in a condo and how often a household moves on.

use crate::clock::GameMode;

pub const CLASSIC_HOUSEHOLD: f64 = 3.0;
/// The 2-5 person family sizes a Modern condo can sell to. Both the gameplay
/// churn roll and the catalog's exposed `maxHousehold` read from this single
/// array so the rule cannot drift.
pub const HOUSEHOLD_SIZES: [i64; 4] = [2, 3, 4, 5];
pub const MAX_HOUSEHOLD: i64 = *HOUSEHOLD_SIZES.last().unwrap();
pub const HOUSEHOLD_CHURN_PER_PERSON: f64 = 0.06;
pub const CONDO_RELOCATION_CHANCE_MONTHLY: f64 = 0.015;

#[doc(hidden)]
impl GameMode {
    /// `hasVariantHouseholds`: Modern sells a condo to a household of 2 to 5
    /// and prices it by that size; Classic sells every condo to the flat
    /// family at the asking price and stores no household. The condo sale
    /// reads it; the save loader still keeps a saved household by the save's
    /// mode name (#1621).
    pub fn variant_households(self) -> bool {
        self == GameMode::Modern
    }

    pub fn churn_multiplier(self, residents: Option<i64>) -> f64 {
        match (self, residents) {
            (GameMode::Modern, Some(r)) => {
                (1.0 + HOUSEHOLD_CHURN_PER_PERSON * (r as f64 - CLASSIC_HOUSEHOLD)).max(0.5)
            }
            _ => 1.0,
        }
    }

    pub fn condo_relocation_chance(self, residents: Option<i64>) -> f64 {
        match self {
            GameMode::Classic => 0.0,
            GameMode::Modern => {
                let size = residents.map(|r| r as f64).unwrap_or(CLASSIC_HOUSEHOLD);
                CONDO_RELOCATION_CHANCE_MONTHLY * (size / CLASSIC_HOUSEHOLD)
            }
        }
    }
}
