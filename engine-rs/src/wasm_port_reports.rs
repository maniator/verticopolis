//! The port's report queries (facade slice 7, PR 1d; the contract is
//! `architecture-rust-facade-2026-10-20/engine-port-contract.md`): the stats
//! screen and one unit's diagnostics as numeric records. They are named
//! apart from the legacy JSON getters (`statsReport`, `diagnosticFacts`),
//! which stay for the conformance suites, and each reads the typed core its
//! JSON getter wraps, so the port computes nothing the game does not
//! already. The wording stays in TypeScript, as it does today.
use crate::diagnostics::GripeFacts;
use crate::ledger::LEDGER_CATS;
use crate::panels::progress::MILESTONE_IDS;
use crate::view::layout::MODES;

use super::port_panels::{code_of, flag, VACATE_REASONS};
use super::Engine;

/// `statsSheet`'s header. NaN marks an absent value (no shift yet, no next
/// threshold, no exterminator booked). The last six slots count what
/// follows the header, in this order: the `statsStrip` slots, the
/// `crewCoverage` slots, the daily income averages in `ledgerCats` order,
/// the next rung ([`NEXT_STAR`], when `nextStar` is 1) and its `gates` gate
/// rows ([`GATE_ROW`]), the `stranded` floors, one done flag per milestone in
/// `milestones` order, the `elevators` rows ([`ELEVATOR_ROW`]) and the `mix`
/// rows ([`MIX_ROW`]).
pub(crate) const STATS_SHEET: [&str; 25] = [
    "ratingPopulation",
    "hotelsCountTowardRating",
    "functionalParking",
    "parkingOfficePop",
    "parkingOffices",
    "parkingSuites",
    "parkingTotal",
    "cleaned",
    "leftover",
    "recyclingCapacity",
    "recyclingDemandMet",
    "nextStarThreshold",
    "vipVisits",
    "vipFavorable",
    "exterminationDueDay",
    "incomeHasData",
    "households",
    "residents",
    "milestonesAchieved",
    "nextStar",
    "gates",
    "stranded",
    "milestones",
    "elevators",
    "mix",
];

/// The next rung's slots in `statsSheet`.
pub(crate) const NEXT_STAR: [&str; 6] =
    ["star", "isTower", "popHave", "popNeed", "popMet", "allMet"];

/// One star gate row: its code in [`STAR_GATES`] and whether it is met.
pub(crate) const GATE_ROW: [&str; 2] = ["gateCode", "met"];

/// The star gates by code (`StarGateId`).
pub(crate) const STAR_GATES: [&str; 7] = [
    "security",
    "medical",
    "recycling",
    "suites",
    "vip",
    "metro",
    "weddingHall",
];

/// One passenger shaft's row on the stats screen (`ElevatorStatsRow`).
pub(crate) const ELEVATOR_ROW: [&str; 7] = [
    "id",
    "kindCode",
    "bottom",
    "top",
    "cars",
    "capacity",
    "utilization",
];

/// One household size row: the size and the homes that hold it.
pub(crate) const MIX_ROW: [&str; 2] = ["size", "count"];

/// `unitFacts`'s slots. Each section has a present flag; when it is 0 its
/// slots are NaN. A flag a section carries only sometimes (`elevatorHere`,
/// `adjacent`, `club`, `floorReachable`) is NaN when absent, else 0 or 1.
/// The gripe slots repeat for the gripe a held-vacant spot was held for.
pub(crate) const UNIT_FACTS: [&str; 37] = [
    "id",
    "kindCode",
    "modeCode",
    "access",
    "noRate",
    "farWalk",
    "lobby",
    "lobbyDistance",
    "sinking",
    "slot",
    "slotFloor",
    "onSlot",
    "needsSupport",
    "clearFirst",
    "gripe",
    "gripeCause",
    "gripeBinding",
    "gripeElevatorHere",
    "gripeAdjacent",
    "gripeClub",
    "gripeCoverage",
    "gripeFloorReachable",
    "wontLease",
    "carry",
    "leaseGripe",
    "leaseGripeCause",
    "leaseGripeBinding",
    "leaseGripeElevatorHere",
    "leaseGripeAdjacent",
    "leaseGripeClub",
    "leaseGripeCoverage",
    "leaseGripeFloorReachable",
    "notice",
    "noticeReason",
    "minutesLeft",
    "noticeSatisfaction",
    "keepAt",
];

/// The access line by code.
pub(crate) const ACCESS_LINES: [&str; 4] = ["notConnected", "cutOff", "reachable", "noRoute"];

/// The No Rate line by code.
pub(crate) const NO_RATE_LINES: [&str; 2] = ["occupied", "offMarket"];

/// The class that binds a floor's congestion reading, by code.
pub(crate) const BINDINGS: [&str; 5] = ["elevator", "stairs", "escalator", "walkways", "none"];

/// The report records and codes, beside the port's others in the layout.
pub(crate) fn add_report_records(layout: &mut serde_json::Value) {
    let records = &mut layout["records"];
    records["statsSheet"] = serde_json::json!(STATS_SHEET);
    records["nextStar"] = serde_json::json!(NEXT_STAR);
    records["gateRow"] = serde_json::json!(GATE_ROW);
    records["elevatorRow"] = serde_json::json!(ELEVATOR_ROW);
    records["mixRow"] = serde_json::json!(MIX_ROW);
    records["unitFacts"] = serde_json::json!(&UNIT_FACTS[..]);
    layout["ledgerCats"] = serde_json::json!(LEDGER_CATS);
    layout["milestones"] = serde_json::json!(MILESTONE_IDS);
    layout["starGates"] = serde_json::json!(STAR_GATES);
    layout["accessLines"] = serde_json::json!(ACCESS_LINES);
    layout["noRateLines"] = serde_json::json!(NO_RATE_LINES);
    layout["bindings"] = serde_json::json!(BINDINGS);
}

fn opt(n: Option<i64>) -> f64 {
    n.map_or(f64::NAN, |n| n as f64)
}

fn opt_flag(b: Option<bool>) -> f64 {
    b.map_or(f64::NAN, flag)
}

/// A gripe's eight slots (present flag first), NaN when there is none.
fn gripe_slots(r: &mut Vec<f64>, g: Option<&GripeFacts>) {
    match g {
        Some(g) => r.extend_from_slice(&[
            1.0,
            code_of(&VACATE_REASONS, Some(g.cause)),
            code_of(&BINDINGS, g.binding),
            opt_flag(g.elevator_here),
            opt_flag(g.adjacent),
            opt_flag(g.club),
            g.coverage.unwrap_or(f64::NAN),
            opt_flag(g.floor_reachable),
        ]),
        None => r.extend_from_slice(&[
            0.0,
            f64::NAN,
            f64::NAN,
            f64::NAN,
            f64::NAN,
            f64::NAN,
            f64::NAN,
            f64::NAN,
        ]),
    }
}

impl Engine {
    /// The stats screen as one record: [`STATS_SHEET`], then the sections
    /// its counts name. Takes `&mut self` only because the stranded-floor
    /// scan memoizes reachability by tower revision, as `statsReport` does.
    pub(crate) fn port_stats_sheet(&mut self) -> Vec<f64> {
        let sim = &mut self.sim;
        let stranded = sim.stranded_floors(false);
        let parking = sim.parking_demand();
        let next = sim.next_star();
        let rows = sim.elevator_rows();
        let (households, residents, mix) = sim.household_mix();
        let achieved: Vec<bool> = MILESTONE_IDS
            .iter()
            .map(|id| sim.milestones.iter().any(|m| m == id))
            .collect();
        let (cleaned, leftover) = sim
            .housekeeping
            .yesterday
            .map_or((f64::NAN, f64::NAN), |(c, l)| (c as f64, l as f64));
        let mut r = vec![
            sim.rating_population() as f64,
            flag(sim.star < 4),
            sim.tower.functional_parking_set().len() as f64,
            parking.office_pop,
            parking.offices,
            parking.suites,
            parking.total,
            cleaned,
            leftover,
            sim.recycling_capacity(),
            flag(sim.recycling_demand_met()),
            opt(sim.next_star_threshold()),
            sim.vip_visits as f64,
            flag(sim.vip_favorable),
            sim.extermination_due_day.unwrap_or(f64::NAN),
            flag(sim.ledger.has_data()),
            households as f64,
            residents as f64,
            achieved.iter().filter(|d| **d).count() as f64,
            flag(next.is_some()),
            next.as_ref().map_or(0, |n| n.gates.len()) as f64,
            stranded.len() as f64,
            achieved.len() as f64,
            rows.len() as f64,
            mix.len() as f64,
        ];
        r.extend_from_slice(&sim.tower_stats_record());
        let c = sim.housekeeping_coverage();
        r.extend(
            [
                c.rooms,
                c.crews,
                c.maids,
                c.daily_capacity,
                c.out_of_reach,
                c.dirty,
                c.infested,
            ]
            .map(|n| n as f64),
        );
        r.extend_from_slice(&sim.ledger.average_per_day());
        if let Some(n) = &next {
            r.extend_from_slice(&[
                n.star as f64,
                flag(n.is_tower),
                n.pop_have as f64,
                n.pop_need as f64,
                flag(n.pop_met),
                flag(n.all_met),
            ]);
            for (id, met) in &n.gates {
                r.extend_from_slice(&[code_of(&STAR_GATES, Some(id)), flag(*met)]);
            }
        }
        r.extend(stranded.iter().map(|f| *f as f64));
        r.extend(achieved.iter().map(|d| flag(*d)));
        for e in &rows {
            r.extend_from_slice(&[
                e.id as f64,
                e.kind as usize as f64,
                e.bottom as f64,
                e.top as f64,
                e.cars as f64,
                e.capacity,
                e.utilization,
            ]);
        }
        for (size, n) in &mix {
            r.extend_from_slice(&[*size as f64, *n as f64]);
        }
        r
    }

    /// Unit `id`'s diagnostics facts as [`UNIT_FACTS`] slots, or an empty
    /// record for an id that names no unit (a transport's, or a malformed
    /// one). Like `diagnosticFacts`, the read may fill caches outside the
    /// save; it changes nothing in the game.
    /// Inspector-only keyed read; the native Rust and WASM engines both
    /// serialize the same typed ServiceDiagnosticFacts struct.
    pub(crate) fn port_service_diagnostics(&mut self, id: f64) -> Option<String> {
        let id = crate::charges::whole(id)?;
        let facts = self.sim.service_diagnostic_facts(id)?;
        serde_json::to_string(&facts).ok()
    }

    pub(crate) fn port_unit_facts(&mut self, id: f64) -> Vec<f64> {
        let Some(id) = crate::charges::whole(id) else {
            return Vec::new();
        };
        let Some(kind) = self.sim.tower.get_unit(id).map(|u| u.kind) else {
            return Vec::new();
        };
        let Some(f) = self.sim.diagnostic_facts(id) else {
            return Vec::new();
        };
        let mut r = Vec::with_capacity(UNIT_FACTS.len());
        r.extend_from_slice(&[
            f.id as f64,
            kind as usize as f64,
            code_of(&MODES, Some(f.mode)),
            code_of(&ACCESS_LINES, f.access),
            code_of(&NO_RATE_LINES, f.no_rate),
            flag(f.far_walk),
        ]);
        match &f.lobby {
            Some(l) => {
                r.extend_from_slice(&[1.0, l.distance as f64, flag(l.sinking)]);
                match &l.slot {
                    Some(s) => r.extend_from_slice(&[
                        1.0,
                        s.floor as f64,
                        flag(s.on_slot),
                        flag(s.needs_support),
                        flag(s.clear_first),
                    ]),
                    None => r.extend_from_slice(&[0.0, f64::NAN, f64::NAN, f64::NAN, f64::NAN]),
                }
            }
            None => r.extend_from_slice(&[
                0.0,
                f64::NAN,
                f64::NAN,
                0.0,
                f64::NAN,
                f64::NAN,
                f64::NAN,
                f64::NAN,
            ]),
        }
        gripe_slots(&mut r, f.gripe.as_ref());
        match &f.wont_lease {
            Some(w) => {
                r.extend_from_slice(&[1.0, w.carry]);
                gripe_slots(&mut r, w.gripe.as_ref());
            }
            None => {
                r.extend_from_slice(&[0.0, f64::NAN]);
                gripe_slots(&mut r, None);
            }
        }
        match &f.notice {
            Some(n) => r.extend_from_slice(&[
                1.0,
                code_of(&VACATE_REASONS, Some(n.reason)),
                n.minutes_left,
                n.satisfaction,
                n.keep_at,
            ]),
            None => r.extend_from_slice(&[0.0, f64::NAN, f64::NAN, f64::NAN, f64::NAN]),
        }
        r
    }
}

#[cfg(test)]
#[path = "wasm_port_reports_tests.rs"]
mod tests;
