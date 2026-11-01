//! Structured, engine-owned service diagnostics shared by native Rust and
//! the WASM inspector. The UI receives named, typed facts, not a slot array.
//! This is an inspector read, not the high-frequency frame data path.

use serde::Serialize;

use crate::facilities::Kind;
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

/// A single Rust source of truth, serialized as nested properties in JS.
#[derive(Clone, Copy, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServiceDiagnosticFacts {
    hotel: HotelServiceFacts,
    parking: ParkingServiceFacts,
    housekeeping: HousekeepingServiceFacts,
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

impl Simulation {
    /// Read-only, keyed service diagnostics. No TypeScript gameplay policy.
    pub(crate) fn service_diagnostic_facts(&self, id: i64) -> Option<ServiceDiagnosticFacts> {
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
    }
}
