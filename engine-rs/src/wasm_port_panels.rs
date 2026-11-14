//! The port's panel queries (facade slice 7, PR 1c; the contract is
//! `architecture-rust-facade-2026-10-20/engine-port-contract.md`): the
//! overlay's cells, the crew coverage and the unit and shaft cards as
//! numeric records. Each reads the same typed core its legacy JSON getter
//! wraps (`floor_heatmap`, `housekeeping_coverage`, `card_flags`, the
//! telemetry), so the port computes nothing the game does not already.
use crate::charges::whole;
use crate::clock::GameMode;
use crate::economy::films::FilmTier;
use crate::economy::screens::screens;
use crate::economy::tickets::shown_ticket_price;
use crate::facilities::Kind;
use crate::frame::unit_state_code;
use crate::panels::heatmap::HeatmapMode;
use crate::panels::room_tiers::{EvalTier, RentTier};
use crate::panels::unit_detail::{unit_price, CardFlags};
use crate::sim::Simulation;
use crate::telemetry::ORIGIN_HOURS;
use crate::tower::Unit;

use super::port::{FILM_POLICIES, TICKET_PRICES};
use super::Engine;

/// A theater's ticket price by code in `ticketPrices`: its step, or Normal
/// where it has none; NaN for any other room and in a mode without ticket
/// prices (#1950).
fn ticket_price_code(mode: GameMode, u: &Unit) -> f64 {
    code_of(&TICKET_PRICES, shown_ticket_price(mode, u))
}

/// A film tier's code in `filmTiers`.
fn film_tier_code(tier: FilmTier) -> f64 {
    FilmTier::ALL.iter().position(|&t| t == tier).unwrap_or(0) as f64
}

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
pub(crate) const VACATE_REASONS: [&str; 12] = [
    "access",
    "noTransport",
    "congestion",
    "rent",
    "noise",
    "transportFar",
    "lobbyFar",
    "unmetDemand",
    "relocation",
    "trash",
    "parking",
    "homeParking",
];

/// `unitCard`'s slots. NaN marks a field the unit does not carry (a code
/// with no value, a count only some kinds keep, a cinema's booking and film
/// on any other kind); the flags are 0 or 1. `filmDays` is the mornings a
/// theater's film has shown and `filmTier` its film by code (`filmTiers`,
/// #1932, #1950). `ticketPrice` is a Modern theater's ticket price by code
/// (`ticketPrices`, #1950). `screen2Policy`, `screen2Days` and
/// `screen2Tier` are a Modern theater's second screen, read like the first
/// screen's slots, and NaN where the theater runs one screen (#1950). The
/// label and subtype come from `unitLabel` and `unitSubtype`.
pub(crate) const UNIT_CARD: [&str; 26] = [
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
    "filmDays",
    "filmTier",
    "ticketPrice",
    "screen2Policy",
    "screen2Days",
    "screen2Tier",
];

/// `shaftCard`'s header. `utilization` is NaN when the shaft has no reading.
/// `nearCapacity` is 1 when the engine calls that load near capacity, else 0.
/// `hourly` is 1 when the 24 weekday then 24 weekend demand slots follow,
/// `stops` the number of stop rows after them (top to bottom, each
/// [`STOP_ROW`]), and `origins` 1 when the origin rings follow the stops:
/// for each weekday hour, then each weekend hour, a pair count and then that
/// many (floor, count) pairs.
pub(crate) const SHAFT_CARD: [&str; 13] = [
    "id",
    "kindCode",
    "x",
    "width",
    "bottom",
    "top",
    "cars",
    "capacity",
    "utilization",
    "nearCapacity",
    "hourly",
    "stops",
    "origins",
];

/// One stop row of `shaftCard`.
pub(crate) const STOP_ROW: [&str; 4] = ["floor", "served", "lobby", "endpoint"];

/// One row of `roomTiers`, which repeats it for each room that carries an
/// evaluation or a rent level: the room's id and anchor tile, then its tier
/// codes from `evalTiers` and `rentTiers`.
pub(crate) const ROOM_TIER: [&str; 5] = ["id", "floor", "x", "evalTier", "rentTier"];

/// The panel records and codes, beside the port's others in the layout.
pub(crate) fn add_panel_records(layout: &mut serde_json::Value) {
    let records = &mut layout["records"];
    records["heatCell"] = serde_json::json!(HEAT_CELL);
    records["crewCoverage"] = serde_json::json!(CREW_COVERAGE);
    records["unitCard"] = serde_json::json!(UNIT_CARD);
    records["shaftCard"] = serde_json::json!(SHAFT_CARD);
    records["stopRow"] = serde_json::json!(STOP_ROW);
    records["roomTier"] = serde_json::json!(ROOM_TIER);
    layout["heatModes"] = serde_json::json!(HEAT_MODES);
    layout["heatTints"] = serde_json::json!(HEAT_TINTS);
    layout["vacateReasons"] = serde_json::json!(VACATE_REASONS);
    layout["evalTiers"] = serde_json::json!(EvalTier::ALL.map(EvalTier::name));
    layout["rentTiers"] = serde_json::json!(RentTier::ALL.map(RentTier::name));
    super::port_person::add_person_records(layout);
    super::port_reports::add_report_records(layout);
    super::port_render::add_render_records(layout);
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
        flag(crate::panels::elevators::is_near_capacity(utilization)),
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
        let served = t.stop_floors();
        for fl in (t.bottom..=t.top).rev() {
            r.extend_from_slice(&[
                fl as f64,
                flag(served.binary_search(&fl).is_ok()),
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
        let cinema = (u.kind == Kind::Cinema).then(|| u.extras());
        let second =
            (u.kind == Kind::Cinema && mode.cinema_screens() > 1).then(|| screens(mode, u)[1]);
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
            code_of(&VACATE_REASONS, u.extras().vacate_reason),
            code_of(&FILM_POLICIES, u.extras().film_policy),
            flag(served),
            flag(reachable),
            flag(has_lobby),
            blockbuster.map_or(f64::NAN, flag),
            cinema.map_or(f64::NAN, |e| f64::from(e.film_days.unwrap_or(0))),
            cinema.map_or(f64::NAN, |e| film_tier_code(FilmTier::showing(e))),
            ticket_price_code(mode, u),
            second.map_or(f64::NAN, |f| code_of(&FILM_POLICIES, f.policy)),
            second.map_or(f64::NAN, |f| f.days_shown() as f64),
            second.map_or(f64::NAN, |f| film_tier_code(f.tier)),
        ]
    }

    /// Shaft `id`'s card ([`SHAFT_CARD`] and what follows it), or an empty
    /// record for an id that names no shaft.
    pub(crate) fn port_shaft_card(&self, id: f64) -> Vec<f64> {
        whole(id)
            .and_then(|id| shaft_card(&self.sim, id))
            .unwrap_or_default()
    }

    /// The rooms' evaluation and rent tiers as [`ROOM_TIER`] rows, in the
    /// rooms' order (`Simulation::room_tiers`): one pass over the rooms and
    /// one record, sized for every room up front.
    pub(crate) fn port_room_tiers(&self) -> Vec<f64> {
        let rooms = self.sim.tower.room_index().len();
        let mut r = Vec::with_capacity(rooms * ROOM_TIER.len());
        for t in self.sim.room_tiers() {
            r.extend_from_slice(&[
                t.id as f64,
                t.floor as f64,
                t.x as f64,
                t.eval.code(),
                t.rent.code(),
            ]);
        }
        r
    }
}

#[cfg(test)]
#[path = "wasm_port_panels_tests.rs"]
mod tests;
