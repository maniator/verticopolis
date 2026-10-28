//! The port's panel queries (facade slice 7, PR 1c; the contract is
//! `architecture-rust-facade-2026-10-20/engine-port-contract.md`): the
//! overlay's cells, the crew coverage and the unit and shaft cards as
//! numeric records. Each reads the same typed core its legacy JSON getter
//! wraps (`floor_heatmap`, `housekeeping_coverage`, `card_flags`, the
//! telemetry), so the port computes nothing the game does not already.
use crate::charges::whole;
use crate::frame::unit_state_code;
use crate::panels::heatmap::HeatmapMode;
use crate::panels::unit_detail::{unit_price, CardFlags};
use crate::sim::Simulation;
use crate::telemetry::ORIGIN_HOURS;

use super::port::FILM_POLICIES;
use super::Engine;

/// The overlay modes by code, as `heatCells` takes them.
pub(crate) const HEAT_MODES: [&str; 4] = ["congestion", "occupancy", "satisfaction", "cleanliness"];

/// A cell's tint by code: 0 for none, then the named tints.
pub(crate) const HEAT_TINTS: [&str; 3] = ["none", "na", "infested"];

/// The slots of one overlay cell; `heatCells` repeats them per cell.
pub(crate) const HEAT_CELL: [&str; 5] = ["floor", "minX", "maxX", "severity", "tint"];

/// `crewCoverage`'s slots, in `HousekeepingCoverage` order.
pub(crate) const CREW_COVERAGE: [&str; 7] = [
    "rooms",
    "crews",
    "maids",
    "dailyCapacity",
    "outOfReach",
    "dirty",
    "infested",
];

/// Why a tenant left, by code (`vacateReason` in `unitCard`).
pub(crate) const VACATE_REASONS: [&str; 9] = [
    "access",
    "noTransport",
    "congestion",
    "rent",
    "noise",
    "transportFar",
    "lobbyFar",
    "unmetDemand",
    "relocation",
];

/// `unitCard`'s slots. NaN marks a field the unit does not carry (a code
/// with no value, a count only some kinds keep, a cinema's booking on any
/// other kind); the flags are 0 or 1. The label and subtype come from
/// `unitLabel` and `unitSubtype`.
pub(crate) const UNIT_CARD: [&str; 20] = [
    "id",
    "kindCode",
    "floor",
    "x",
    "width",
    "stateCode",
    "satisfaction",
    "occupants",
    "customersIn",
    "residents",
    "everOccupied",
    "noRate",
    "rent",
    "price",
    "vacateReason",
    "filmPolicy",
    "served",
    "reachable",
    "floorHasLobby",
    "blockbuster",
];

/// `shaftCard`'s header. `utilization` is NaN when the shaft has no reading.
/// `hourly` is 1 when the 24 weekday then 24 weekend demand slots follow,
/// `stops` the number of stop rows after them (top to bottom, each
/// [`STOP_ROW`]), and `origins` 1 when the origin rings follow the stops:
/// for each weekday hour, then each weekend hour, a pair count and then that
/// many (floor, count) pairs.
pub(crate) const SHAFT_CARD: [&str; 12] = [
    "id",
    "kindCode",
    "x",
    "width",
    "bottom",
    "top",
    "cars",
    "capacity",
    "utilization",
    "hourly",
    "stops",
    "origins",
];

/// One stop row of `shaftCard`.
pub(crate) const STOP_ROW: [&str; 4] = ["floor", "served", "lobby", "endpoint"];

/// The panel records and codes, beside the port's others in the layout.
pub(crate) fn add_panel_records(layout: &mut serde_json::Value) {
    let records = &mut layout["records"];
    records["heatCell"] = serde_json::json!(HEAT_CELL);
    records["crewCoverage"] = serde_json::json!(CREW_COVERAGE);
    records["unitCard"] = serde_json::json!(UNIT_CARD);
    records["shaftCard"] = serde_json::json!(SHAFT_CARD);
    records["stopRow"] = serde_json::json!(STOP_ROW);
    layout["heatModes"] = serde_json::json!(HEAT_MODES);
    layout["heatTints"] = serde_json::json!(HEAT_TINTS);
    layout["vacateReasons"] = serde_json::json!(VACATE_REASONS);
    super::port_reports::add_report_records(layout);
}

fn heat_mode(code: f64) -> Option<HeatmapMode> {
    Some(match whole(code)? {
        0 => HeatmapMode::Congestion,
        1 => HeatmapMode::Occupancy,
        2 => HeatmapMode::Satisfaction,
        3 => HeatmapMode::Cleanliness,
        _ => return None,
    })
}

pub(crate) fn flag(b: bool) -> f64 {
    f64::from(u8::from(b))
}

/// The index of `name` in `table`, or NaN for none.
pub(crate) fn code_of(table: &[&str], name: Option<&str>) -> f64 {
    name.and_then(|n| table.iter().position(|t| *t == n))
        .map_or(f64::NAN, |i| i as f64)
}

fn count(n: Option<i64>) -> f64 {
    n.map_or(f64::NAN, |n| n as f64)
}

/// The shaft card for `id`, or `None` for an id that names no shaft.
fn shaft_card(sim: &Simulation, id: i64) -> Option<Vec<f64>> {
    let t = sim.tower.get_transport(id)?;
    let tel = &sim.telemetry;
    let utilization = t
        .kind
        .is_elevator()
        .then(|| tel.util.get(&id).copied())
        .flatten()
        .unwrap_or(f64::NAN);
    let hourly = tel.hourly.get(&id);
    let origins = tel.origins.get(&id);
    let stops = if t.kind.is_elevator() {
        (t.top - t.bottom + 1) as usize
    } else {
        0
    };
    let mut r = vec![
        t.id as f64,
        t.kind as usize as f64,
        t.x as f64,
        t.width as f64,
        t.bottom as f64,
        t.top as f64,
        t.cars as f64,
        Simulation::transport_capacity(t.kind, t.cars),
        utilization,
        flag(hourly.is_some()),
        stops as f64,
        flag(origins.is_some()),
    ];
    if let Some(h) = hourly {
        r.extend_from_slice(&h.weekday);
        r.extend_from_slice(&h.weekend);
    }
    if stops > 0 {
        let lobbies = sim.tower.lobby_floors();
        for fl in (t.bottom..=t.top).rev() {
            r.extend_from_slice(&[
                fl as f64,
                flag(t.stops_at(fl)),
                flag(lobbies.binary_search(&fl).is_ok()),
                flag(fl == t.bottom || fl == t.top),
            ]);
        }
    }
    if let Some(o) = origins {
        for ring in o.weekday.iter().chain(&o.weekend).take(2 * ORIGIN_HOURS) {
            r.push(ring.len() as f64);
            for (floor, n) in ring {
                r.extend_from_slice(&[*floor as f64, *n]);
            }
        }
    }
    Some(r)
}

impl Engine {
    /// The overlay for mode `modeCode` ([`HEAT_MODES`]) as [`HEAT_CELL`]
    /// rows, in the order the JSON getter lists them. An unknown mode answers
    /// no cells.
    pub(crate) fn port_heat_cells(&self, mode: f64) -> Vec<f64> {
        let Some(mode) = heat_mode(mode) else {
            return Vec::new();
        };
        let cells = self.sim.floor_heatmap(mode);
        let mut r = Vec::with_capacity(cells.len() * HEAT_CELL.len());
        for c in cells {
            let tint = c.tint.map_or(0.0, |t| code_of(&HEAT_TINTS, Some(t)));
            r.extend_from_slice(&[
                c.floor as f64,
                c.min_x as f64,
                c.max_x as f64,
                c.severity,
                tint,
            ]);
        }
        r
    }

    /// The housekeeping coverage the exterminator gate reads, in
    /// [`CREW_COVERAGE`] order.
    pub(crate) fn port_crew_coverage(&self) -> Vec<f64> {
        let c = self.sim.housekeeping_coverage();
        [
            c.rooms,
            c.crews,
            c.maids,
            c.daily_capacity,
            c.out_of_reach,
            c.dirty,
            c.infested,
        ]
        .map(|n| n as f64)
        .to_vec()
    }

    /// Unit `id`'s card as [`UNIT_CARD`] slots, or an empty record for an id
    /// that names no unit (a malformed one included).
    pub(crate) fn port_unit_card(&mut self, id: f64) -> Vec<f64> {
        let Some(id) = whole(id) else {
            return Vec::new();
        };
        let Some(CardFlags {
            served,
            reachable,
            has_lobby,
            blockbuster,
        }) = self.sim.card_flags(id)
        else {
            return Vec::new();
        };
        let mode = self.sim.mode;
        let Some(u) = self.sim.tower.get_unit(id) else {
            return Vec::new();
        };
        vec![
            u.id as f64,
            u.kind as usize as f64,
            u.floor as f64,
            u.x as f64,
            u.width as f64,
            unit_state_code(u.state),
            u.satisfaction,
            u.occupants as f64,
            count(u.customers_in),
            count(u.residents),
            flag(u.ever_occupied),
            flag(u.no_rate),
            u.rent.unwrap_or(f64::NAN),
            unit_price(mode, u),
            code_of(&VACATE_REASONS, u.vacate_reason),
            code_of(&FILM_POLICIES, u.film_policy),
            flag(served),
            flag(reachable),
            flag(has_lobby),
            blockbuster.map_or(f64::NAN, flag),
        ]
    }

    /// Shaft `id`'s card ([`SHAFT_CARD`] and what follows it), or an empty
    /// record for an id that names no shaft.
    pub(crate) fn port_shaft_card(&self, id: f64) -> Vec<f64> {
        whole(id)
            .and_then(|id| shaft_card(&self.sim, id))
            .unwrap_or_default()
    }
}

#[cfg(test)]
#[path = "wasm_port_panels_tests.rs"]
mod tests;
