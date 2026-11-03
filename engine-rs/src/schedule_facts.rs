//! The factual readouts the schedule dialog shows beside the grid: the advice
//! comparison (hours where the authored count sits well off the measured
//! load) and the Simulate staging summary (the busiest hour, the cars on shift
//! then, and how the fleet is staged). A port of `scheduleAdvice`,
//! `stagingSummary` and the preset recommendation
//! (`src/engine/scheduleAuthoring.ts`) so the host reads facts instead of
//! recomputing them.
//!
//! Data only: no sentence, number format or "critical" styling lives here, and
//! nothing is written. The measured curve is the day's warm one (the same
//! six-hour gate Auto-tune uses), so a cold day answers `insufficient-data`
//! and never reads a mostly-empty ring as a day of traffic. Measured car load
//! is a staffing signal.

use serde::Serialize;

use crate::clock::GameMode;
use crate::jsmath;
use crate::schedule::{Schedule, SCHEDULE_HOURS};
use crate::schedule_authoring::warm_curve;
use crate::schedule_geometry::ShaftGeometry;
use crate::schedule_presets::{recommended_preset, AssistedPreset};
use crate::sim::Simulation;
use crate::telemetry::HourlyByDay;

/// A day's advice names an hour over-staffed when its authored cars reach the
/// measured want plus this, and short when they fall this far under it.
const ADVICE_MARGIN: i64 = 2;
/// The hour Simulate assumes when a day has no measured curve: the evening
/// down-rush.
const DEFAULT_PEAK_HOUR: usize = 17;

/// How the facts query ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum FactsStatus {
    Available,
    /// The id names a stair or escalator.
    NotAnElevator,
    /// The id names no shaft.
    MissingShaft,
    /// The working draft is not a schedule the engine reads.
    InvalidDraft,
}

/// Whether the advice comparison could run.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AdviceStatus {
    /// Measured demand exists for the day; `over` and `short` may be empty,
    /// which means the schedule and the demand line up.
    Ready,
    /// The named day has no warm curve yet.
    InsufficientData,
    /// The mode gives no advice; the staging summary still answers.
    UnavailableInMode,
    /// The shaft holds no cars (a loaded save can), so there is no fleet to
    /// compare against the load.
    NoCars,
    /// The query itself was refused (see the answer's `status`), so there is
    /// no advice to give.
    Refused,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Advice {
    pub status: AdviceStatus,
    /// Hours (0 to 23) where the authored count is well above the measured want.
    pub over: Vec<i64>,
    /// Hours where it is well below, never an hour that already runs the
    /// whole fleet.
    pub short: Vec<i64>,
}

/// The Simulate staging summary: how the fleet is positioned. It promises no
/// wait time.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagingSummary {
    /// True when `peak_hour` is the day's measured busiest hour, false when it
    /// is the assumed evening down-rush.
    pub measured: bool,
    pub peak_hour: i64,
    pub active_at_peak: i64,
    /// Cars on shift at the peak whose home sits above the base lobby.
    pub up_tower_cars: i64,
    pub lobby_cars: i64,
    pub top_lobby: i64,
    pub base_lobby: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleFacts {
    pub status: FactsStatus,
    /// The preset to highlight (Feeder on an express trunk, Rush on a local);
    /// `None` where the mode offers no assisted presets.
    pub recommended: Option<AssistedPreset>,
    pub advice: Advice,
    pub staging: Option<StagingSummary>,
    /// The draft's homes as the shaft would hold them: one per car, each on
    /// the nearest served floor (ties to the lower one), a car the draft lists
    /// no home for at the base lobby. Empty on a refusal.
    pub home_floors: Vec<i64>,
}

impl ScheduleFacts {
    pub fn refused(status: FactsStatus) -> ScheduleFacts {
        ScheduleFacts {
            status,
            recommended: None,
            advice: Advice {
                status: AdviceStatus::Refused,
                over: Vec::new(),
                short: Vec::new(),
            },
            staging: None,
            home_floors: Vec::new(),
        }
    }
}

/// The cars on shift at hour `h`: the draft's row entry held to the fleet, or
/// the whole fleet when the draft sets no row.
fn active_at(row: Option<&Vec<i64>>, h: usize, cars: i64) -> i64 {
    row.and_then(|r| r.get(h))
        .map_or(cars, |&n| n.clamp(0, cars))
}

/// The first hour of the busiest measured load, or the down-rush default.
fn peak_hour(curve: Option<&[f64]>) -> usize {
    let Some(curve) = curve.filter(|c| c.len() == SCHEDULE_HOURS) else {
        return DEFAULT_PEAK_HOUR;
    };
    let mut best = -1.0;
    let mut peak = DEFAULT_PEAK_HOUR;
    for (h, &v) in curve.iter().enumerate() {
        if v > best {
            best = v;
            peak = h;
        }
    }
    peak
}

/// One home per car on a served floor; a car with no listed home waits at the
/// base lobby.
fn served_homes(draft: Option<&Schedule>, geo: &ShaftGeometry) -> Vec<i64> {
    let homes = draft.and_then(|d| d.home_floors.as_ref());
    (0..geo.cars.max(0) as usize)
        .map(|i| {
            homes
                .and_then(|h| h.get(i))
                .map_or(geo.base_lobby(), |&f| geo.snap_to_served(f))
        })
        .collect()
}

fn advice(row: Option<&Vec<i64>>, curve: &[f64], cars: i64) -> Advice {
    let mut over = Vec::new();
    let mut short = Vec::new();
    for h in 0..SCHEDULE_HOURS {
        let active = active_at(row, h, cars);
        let load = curve.get(h).copied().unwrap_or(0.0);
        let want = (jsmath::round(load * cars as f64) as i64).clamp(1, cars);
        if active >= want + ADVICE_MARGIN {
            over.push(h as i64);
        } else if active <= want - ADVICE_MARGIN && active < cars {
            // There is no car left to add when the hour already runs the fleet.
            short.push(h as i64);
        }
    }
    Advice {
        status: AdviceStatus::Ready,
        over,
        short,
    }
}

fn staging(
    draft: Option<&Schedule>,
    row: Option<&Vec<i64>>,
    geo: &ShaftGeometry,
    curve: Option<&[f64]>,
) -> StagingSummary {
    let peak = peak_hour(curve);
    let active = active_at(row, peak, geo.cars);
    let base = geo.base_lobby();
    let homes = draft.and_then(|d| d.home_floors.as_ref());
    // A car counts as staged up-tower the moment its home sits above the base
    // lobby, whatever the lobby layout; a car with no home idles at the base.
    let up_tower = (0..active as usize)
        .filter(|&i| homes.and_then(|h| h.get(i)).copied().unwrap_or(base) > base)
        .count() as i64;
    StagingSummary {
        measured: curve.is_some(),
        peak_hour: peak as i64,
        active_at_peak: active,
        up_tower_cars: up_tower,
        lobby_cars: active - up_tower,
        top_lobby: geo.up_tower_target(),
        base_lobby: base,
    }
}

impl Simulation {
    /// The advice and staging facts for shaft `id` against the player's working
    /// `draft`, for the day tab `weekend_view`. Read-only.
    pub fn schedule_facts(
        &self,
        id: i64,
        draft: Option<&Schedule>,
        weekend_view: bool,
    ) -> ScheduleFacts {
        let Some(t) = self.tower.get_transport(id) else {
            return ScheduleFacts::refused(FactsStatus::MissingShaft);
        };
        if !t.kind.is_elevator() {
            return ScheduleFacts::refused(FactsStatus::NotAnElevator);
        }
        let geo = self.shaft_geometry(t);
        let empty = HourlyByDay {
            weekday: Vec::new(),
            weekend: Vec::new(),
        };
        let rings = self.telemetry.hourly.get(&id).unwrap_or(&empty);
        let curve = warm_curve(if weekend_view {
            &rings.weekend
        } else {
            &rings.weekday
        });
        let row = draft.and_then(|d| {
            if weekend_view {
                d.weekend.as_ref()
            } else {
                d.weekday.as_ref()
            }
        });
        let assisted = self.mode == GameMode::Modern && geo.cars > 0;
        let no_advice = |status| Advice {
            status,
            over: Vec::new(),
            short: Vec::new(),
        };
        let advice = if self.mode != GameMode::Modern {
            no_advice(AdviceStatus::UnavailableInMode)
        } else if geo.cars <= 0 {
            no_advice(AdviceStatus::NoCars)
        } else {
            curve.map_or_else(
                || no_advice(AdviceStatus::InsufficientData),
                |c| advice(row, c, geo.cars),
            )
        };
        ScheduleFacts {
            status: FactsStatus::Available,
            recommended: assisted.then(|| recommended_preset(t.kind)),
            advice,
            staging: Some(staging(draft, row, &geo, curve)),
            home_floors: served_homes(draft, &geo),
        }
    }
}

#[cfg(test)]
#[path = "schedule_facts_tests.rs"]
mod tests;
