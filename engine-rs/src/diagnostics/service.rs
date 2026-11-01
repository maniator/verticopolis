//! Structured, engine-owned service diagnostics shared by native Rust and
//! the WASM inspector. The UI receives named, typed facts, not a slot array.
//! This is an inspector read, not the high-frequency frame data path.

use serde::Serialize;

use crate::clock::GameMode;
use crate::economy::{daily_traffic_income, retail_spend_per_customer};
use crate::facilities::Kind;
use crate::jsmath::round;
use crate::sim_loop::Weather;
use crate::housekeeping::{HK_MAIDS_PER_UNIT, INFEST_DAYS};
use crate::panels::coverage::HK_NOMINAL_ROOMS_PER_MAID;
use crate::sim::Simulation;
use crate::tower::UnitState;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum HotelRating {
    #[default]
    NotApplicable,
    Counts,
    Excluded,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum HotelCondition {
    #[default]
    Other,
    Dirty,
    Infested,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum ParkingStatus {
    #[default]
    NotApplicable,
    Ramp,
    Connected,
    Disconnected,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum HousekeepingStatus {
    #[default]
    NotApplicable,
    Adequate,
    NominalShortfall,
    ObservedShortfall,
}

/// A venue's business tier, based on yesterday (a completed day) only.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum RetailTier {
    #[default]
    NotApplicable,
    NoData,
    Low,
    Average,
    Booming,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum RetailAdvice {
    #[default]
    None,
    UnderServed,
    OverBuilt,
}

const TRAFFIC_FACTOR_MEAN: f64 = 0.8;
const LOW_PATRONAGE_RATIO: f64 = 0.5;
const BOOMING_PATRONAGE_RATIO: f64 = 0.85;
const OVER_BUILT_DEMAND_SHARE: f64 = 0.5;

fn retail_tier(yesterday: Option<f64>, baseline: f64) -> RetailTier {
    let Some(yesterday) = yesterday else {
        return RetailTier::NoData;
    };
    let ratio = if baseline > 0.0 { yesterday.max(0.0) / baseline } else { 0.0 };
    if ratio < LOW_PATRONAGE_RATIO {
        RetailTier::Low
    } else if ratio > BOOMING_PATRONAGE_RATIO {
        RetailTier::Booming
    } else {
        RetailTier::Average
    }
}

fn retail_advice(mode: GameMode, share: f64) -> RetailAdvice {
    if mode != GameMode::Modern {
        RetailAdvice::None
    } else if share >= 1.0 {
        RetailAdvice::UnderServed
    } else if share < OVER_BUILT_DEMAND_SHARE {
        RetailAdvice::OverBuilt
    } else {
        RetailAdvice::None
    }
}

/// A single Rust source of truth, serialized as nested properties in JS.
#[derive(Clone, Copy, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServiceDiagnosticFacts {
    hotel: HotelServiceFacts,
    parking: ParkingServiceFacts,
    housekeeping: HousekeepingServiceFacts,
    retail: RetailServiceFacts,
}

#[derive(Clone, Copy, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct HotelServiceFacts {
    rating: HotelRating,
    condition: HotelCondition,
    infest_days: Option<i64>,
    recovery: Option<bool>,
}

#[derive(Clone, Copy, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct ParkingServiceFacts {
    status: ParkingStatus,
    shortage: Option<bool>,
    have: Option<usize>,
    total: Option<f64>,
    offices: Option<f64>,
    suites: Option<f64>,
}

#[derive(Clone, Copy, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct HousekeepingServiceFacts {
    status: HousekeepingStatus,
    crews: Option<i64>,
    maids: Option<i64>,
    rooms: Option<i64>,
    maids_per_unit: Option<i64>,
    rooms_per_maid: Option<i64>,
    cleaned: Option<i64>,
    leftover: Option<i64>,
    infested: Option<i64>,
    out_of_reach: Option<i64>,
    has_infested: Option<bool>,
    has_out_of_reach: Option<bool>,
    recovery: Option<bool>,
}

#[derive(Clone, Copy, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct RetailServiceFacts {
    active: bool,
    today: Option<i64>,
    bar_width: Option<i64>,
    tier: RetailTier,
    local_demand_pct: Option<i64>,
    advice: RetailAdvice,
    profit_yest: Option<i64>,
    rainy: Option<bool>,
}

impl Simulation {
    /// Read-only, keyed service diagnostics. Only the inspector demand memo
    /// can change, not simulation/gameplay state.
    pub(crate) fn service_diagnostic_facts(&mut self, id: i64) -> Option<ServiceDiagnosticFacts> {
        let unit = self.tower.get_unit(id)?;
        let mut facts = ServiceDiagnosticFacts::default();

        if unit.kind.is_hotel() {
            facts.hotel.rating = if self.star < 4 {
                HotelRating::Counts
            } else {
                HotelRating::Excluded
            };
            facts.hotel.condition = match unit.state {
                UnitState::Dirty => HotelCondition::Dirty,
                UnitState::Infested => HotelCondition::Infested,
                _ => HotelCondition::Other,
            };
            if unit.state == UnitState::Dirty {
                facts.hotel.infest_days = Some(INFEST_DAYS);
            }
            if unit.state == UnitState::Infested {
                facts.hotel.recovery = Some(self.mode.infestation_recovery().is_some());
            }
        }

        if unit.is_operational() && matches!(unit.kind, Kind::Parking | Kind::ParkingRamp) {
            let spaces = self.tower.functional_parking_set();
            facts.parking.status = if unit.kind == Kind::ParkingRamp {
                ParkingStatus::Ramp
            } else if spaces.contains(&id) {
                ParkingStatus::Connected
            } else {
                ParkingStatus::Disconnected
            };
            if facts.parking.status != ParkingStatus::Disconnected {
                let demand = self.parking_demand();
                facts.parking.shortage = Some((spaces.len() as f64) < demand.total);
                facts.parking.have = Some(spaces.len());
                facts.parking.total = Some(demand.total);
                facts.parking.offices = Some(demand.offices);
                facts.parking.suites = Some(demand.suites);
            }
        }

        if unit.kind == Kind::Housekeeping && unit.is_operational() {
            let coverage = self.housekeeping_coverage();
            facts.housekeeping.status = if self
                .housekeeping
                .yesterday
                .is_some_and(|(_, leftover)| leftover > 0)
                && coverage.rooms > 0
            {
                HousekeepingStatus::ObservedShortfall
            } else if coverage.daily_capacity < coverage.rooms {
                HousekeepingStatus::NominalShortfall
            } else {
                HousekeepingStatus::Adequate
            };
            facts.housekeeping.crews = Some(coverage.crews);
            facts.housekeeping.maids = Some(coverage.maids);
            facts.housekeeping.rooms = Some(coverage.rooms);
            facts.housekeeping.maids_per_unit = Some(HK_MAIDS_PER_UNIT);
            facts.housekeeping.rooms_per_maid = Some(HK_NOMINAL_ROOMS_PER_MAID);
            if let Some((cleaned, leftover)) = self.housekeeping.yesterday {
                facts.housekeeping.cleaned = Some(cleaned);
                facts.housekeeping.leftover = Some(leftover);
            }
            facts.housekeeping.infested = Some(coverage.infested);
            facts.housekeeping.out_of_reach = Some(coverage.out_of_reach);
            facts.housekeeping.has_infested = Some(coverage.infested > 0);
            facts.housekeeping.has_out_of_reach = Some(coverage.out_of_reach > 0);
            facts.housekeeping.recovery = Some(self.mode.infestation_recovery().is_some());
        }
        // Retail policy stays in Rust. Score the Modern catalog's average
        // good day even in Classic, never Classic's higher sellout ceiling.
        let unit = self.tower.get_unit(id)?;
        let retail = (
            unit.kind,
            unit.is_operational(),
            unit.patronage_today,
            unit.patronage_yest,
            unit.profit_yest,
        );
        if retail.1 {
            if let (Some(spend), Some(daily)) = (
                retail_spend_per_customer(retail.0),
                daily_traffic_income(retail.0),
            ) {
                if spend > 0.0 {
                    let baseline = daily / spend * TRAFFIC_FACTOR_MEAN;
                    let today = retail.2.unwrap_or(0.0).max(0.0);
                    facts.retail.active = true;
                    facts.retail.today = Some(round(today) as i64);
                    facts.retail.bar_width = Some(
                        round((if baseline > 0.0 { today / baseline } else { 0.0 }) * 100.0)
                            .clamp(0.0, 100.0) as i64,
                    );
                    facts.retail.tier = retail_tier(retail.3, baseline);
                    if let Some((fraction, share)) = self.inspector_retail_pressure(id) {
                        facts.retail.local_demand_pct =
                            Some(round(fraction.clamp(0.0, 1.0) * 100.0) as i64);
                        facts.retail.advice = retail_advice(self.mode, share);
                    }
                    if retail.3.is_some() || retail.4.is_some() {
                        facts.retail.profit_yest =
                            Some(round(retail.4.unwrap_or(0.0).max(0.0)) as i64);
                    }
                    facts.retail.rainy = Some(self.weather == Weather::Rain);
                }
            }
        }

        Some(facts)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn serializes_named_nested_facts_and_enum_strings_without_numeric_slots() {
        let mut facts = ServiceDiagnosticFacts::default();
        facts.parking.status = ParkingStatus::Disconnected;
        facts.housekeeping.status = HousekeepingStatus::ObservedShortfall;
        facts.housekeeping.leftover = Some(5);
        let value = serde_json::to_value(facts).unwrap();
        assert_eq!(value["parking"]["status"], "disconnected");
        assert!(value["parking"]["have"].is_null());
        assert_eq!(value["housekeeping"]["status"], "observedShortfall");
        assert_eq!(value["housekeeping"]["leftover"], 5);
        assert_eq!(value["hotel"]["rating"], "notApplicable");
        assert_eq!(value["retail"]["tier"], "notApplicable");
    }

    #[test]
    fn yesterday_is_the_only_basis_for_the_business_verdict() {
        assert_eq!(retail_tier(None, 100.0), RetailTier::NoData);
        assert_eq!(retail_tier(Some(0.0), 100.0), RetailTier::Low);
        assert_eq!(retail_tier(Some(49.9), 100.0), RetailTier::Low);
        assert_eq!(retail_tier(Some(50.0), 100.0), RetailTier::Average);
        assert_eq!(retail_tier(Some(85.0), 100.0), RetailTier::Average);
        assert_eq!(retail_tier(Some(85.1), 100.0), RetailTier::Booming);
    }

    #[test]
    fn demand_advice_is_modern_only_and_uses_raw_tower_pressure() {
        assert_eq!(retail_advice(GameMode::Modern, 0.499), RetailAdvice::OverBuilt);
        assert_eq!(retail_advice(GameMode::Modern, 0.5), RetailAdvice::None);
        assert_eq!(retail_advice(GameMode::Modern, 0.99), RetailAdvice::None);
        assert_eq!(retail_advice(GameMode::Modern, 1.0), RetailAdvice::UnderServed);
        assert_eq!(retail_advice(GameMode::Modern, 1.5), RetailAdvice::UnderServed);
        assert_eq!(retail_advice(GameMode::Classic, 0.1), RetailAdvice::None);
        assert_eq!(retail_advice(GameMode::Classic, 2.0), RetailAdvice::None);
    }
}
