//! The Auto-tune proposal for an elevator's schedule: a read-only query that
//! turns the shaft's own measured telemetry into the active-car rows and
//! staging the Modern dialog offers. A port of `autoTuneSchedule`
//! (`src/engine/scheduleAuthoring.ts`) with the dialog's warm-up gate and
//! origin aim (`src/ui/uiElevatorSchedule.ts`) moved into the engine, so the
//! host reads what is ready and what to propose instead of recomputing it.
//!
//! Nothing here writes: no tower, telemetry, rng, cash or event stream is
//! touched, and the proposal is only ever applied by the player through the
//! ordinary schedule command (one undo step). No wording lives here; the host
//! renders the buttons and the copy.
//!
//! The tuning is the same simple rule the dialog always used: each hour's
//! car count follows that hour's measured load fraction, never below one car.
//! It is not a validated wait-time optimization, and nothing here claims it
//! is.

use indexmap::IndexMap;
use serde::Serialize;

use crate::schedule::{Schedule, SCHEDULE_HOURS};
use crate::schedule_geometry::ShaftGeometry;
use crate::sim::Simulation;
use crate::telemetry::{HourlyByDay, OriginRings};

/// Sampled hours (nonzero slots) a day's curve needs before it counts as
/// measured. One busy hour must not arm Auto-tune against 23 empty slots.
pub const WARMED_MIN_HOURS: usize = 6;

/// How the query ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProposalStatus {
    /// At least one day type is warm; `proposal` carries the rows.
    Available,
    /// Neither day type has a warm curve yet.
    InsufficientData,
    /// The tower's mode offers no Auto-tune (Classic). Readiness is still
    /// reported.
    UnavailableInMode,
    /// The shaft holds no cars (a loaded save can), so there is nothing to
    /// tune. Readiness is still reported.
    NoCars,
    /// The id names a stair or escalator.
    NotAnElevator,
    /// The id names no shaft.
    MissingShaft,
    /// The working draft is not a schedule the engine reads.
    InvalidDraft,
}

/// One day type's readiness. A warm day is the one Auto-tune tunes, and its
/// measured 24-hour `curve` (0 to 1 per hour of day) is handed back so the host
/// draws and advises from the ring the engine tuned from, which stays current
/// while a dialog is open. A cold day has no curve.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayReadiness {
    pub warm: bool,
    pub sampled_hours: usize,
    pub curve: Option<Vec<f64>>,
}

/// The rows and staging to offer. A day type that is not warm keeps the
/// draft's own row (`None` when the draft has none), never the other day's.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposedSchedule {
    pub weekday: Option<Vec<i64>>,
    pub weekend: Option<Vec<i64>>,
    pub home_floors: Vec<i64>,
    /// True when the homes were seeded here, false when they are the draft's
    /// own hand-set staging, kept as is.
    pub homes_seeded: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoTuneProposal {
    pub status: ProposalStatus,
    pub weekday: DayReadiness,
    pub weekend: DayReadiness,
    pub proposal: Option<ProposedSchedule>,
}

impl AutoTuneProposal {
    /// An answer with no readiness and no proposal.
    pub fn refused(status: ProposalStatus) -> AutoTuneProposal {
        AutoTuneProposal {
            status,
            weekday: DayReadiness::default(),
            weekend: DayReadiness::default(),
            proposal: None,
        }
    }
}

/// The hours of a day's ring with a measured load, the count the warm gate
/// reads.
fn sampled_hours(curve: &[f64]) -> usize {
    curve.iter().filter(|v| **v > 0.0).count()
}

/// The ring when the day is warm, for a caller that only reads it.
pub(crate) fn warm_curve(curve: &[f64]) -> Option<&[f64]> {
    (sampled_hours(curve) >= WARMED_MIN_HOURS).then_some(curve)
}

pub(crate) fn readiness(curve: &[f64]) -> DayReadiness {
    let sampled = sampled_hours(curve);
    let warm = sampled >= WARMED_MIN_HOURS;
    DayReadiness {
        warm,
        sampled_hours: sampled,
        curve: warm.then(|| curve.to_vec()),
    }
}

/// Each hour's cars from its load fraction: proportional, at least one,
/// at most the installed cars.
fn tuned_row(curve: &[f64], cars: i64) -> Vec<i64> {
    (0..SCHEDULE_HOURS)
        .map(|h| {
            let want = crate::jsmath::round(curve.get(h).copied().unwrap_or(0.0) * cars as f64);
            (want as i64).clamp(1, cars)
        })
        .collect()
}

/// The origin floors summed over the day's 24 slots, in first-seen order.
fn day_origin_totals(ring: &[IndexMap<i64, f64>]) -> IndexMap<i64, f64> {
    let mut totals: IndexMap<i64, f64> = IndexMap::new();
    for slot in ring {
        for (&floor, &n) in slot {
            *totals.entry(floor).or_insert(0.0) += n;
        }
    }
    totals
}

/// The busiest boarding floor among `served`, ties to the lower floor; `None`
/// with no mass.
fn peak_origin_floor(totals: &IndexMap<i64, f64>, served: &[i64]) -> Option<i64> {
    let mut best: Option<(i64, f64)> = None;
    let mut total = 0.0;
    for (&floor, &n) in totals {
        if served.binary_search(&floor).is_err() {
            continue;
        }
        total += n;
        let better = match best {
            None => true,
            Some((bf, bn)) => n > bn || (n == bn && floor < bf),
        };
        if better {
            best = Some((floor, n));
        }
    }
    if total > 0.0 {
        best.map(|(floor, _)| floor)
    } else {
        None
    }
}

/// The staging seed: the lower half of the fleet at the base lobby (the only
/// car of a one-car shaft included), the upper half up-tower, aimed at the
/// busiest measured boarding floor when it sits above the base.
fn seeded_homes(geo: &ShaftGeometry, aim: Option<i64>) -> Vec<i64> {
    let up = match aim {
        Some(a) if a > geo.base_lobby() => a.clamp(geo.bottom, geo.top),
        _ => geo.up_tower_target(),
    };
    geo.seeded_homes(up)
}

#[doc(hidden)]
impl Simulation {
    /// The Auto-tune proposal for shaft `id` against the player's working
    /// `draft` (the schedule as the dialog holds it, homes left out when the
    /// player has not staged by hand). `weekend_view` names the day type the
    /// player is looking at, which picks the day whose boarding geography
    /// aims the staging seed. Read-only.
    pub fn auto_tune_proposal(
        &self,
        id: i64,
        draft: Option<&Schedule>,
        weekend_view: bool,
    ) -> AutoTuneProposal {
        let Some(t) = self.tower.get_transport(id) else {
            return AutoTuneProposal::refused(ProposalStatus::MissingShaft);
        };
        if !t.kind.is_elevator() {
            return AutoTuneProposal::refused(ProposalStatus::NotAnElevator);
        }
        let empty = HourlyByDay {
            weekday: Vec::new(),
            weekend: Vec::new(),
        };
        let rings = self.telemetry.hourly.get(&id).unwrap_or(&empty);
        let (wd, we) = (readiness(&rings.weekday), readiness(&rings.weekend));
        // Readiness is the shaft's, whatever the mode offers: the Classic grid
        // still shows a measured curve, it just gets no proposal.
        let unavailable = if !self.mode.schedule_assist() {
            Some(ProposalStatus::UnavailableInMode)
        } else if t.cars <= 0 {
            Some(ProposalStatus::NoCars)
        } else {
            None
        };
        if let Some(status) = unavailable {
            return AutoTuneProposal {
                status,
                weekday: wd,
                weekend: we,
                proposal: None,
            };
        }
        if !wd.warm && !we.warm {
            return AutoTuneProposal {
                status: ProposalStatus::InsufficientData,
                weekday: wd,
                weekend: we,
                proposal: None,
            };
        }
        let cars = t.cars;
        // A day that is not warm keeps the draft's own row, held to the cars
        // installed in case the draft was written for a bigger fleet.
        let draft_row = |weekend: bool| {
            let row = draft.and_then(|d| {
                if weekend {
                    d.weekend.as_ref()
                } else {
                    d.weekday.as_ref()
                }
            });
            row.map(|r| r.iter().map(|&n| n.clamp(0, cars)).collect::<Vec<i64>>())
        };
        let weekday = if wd.warm {
            Some(tuned_row(&rings.weekday, cars))
        } else {
            draft_row(false)
        };
        let weekend = if we.warm {
            Some(tuned_row(&rings.weekend, cars))
        } else {
            draft_row(true)
        };

        let geo = self.shaft_geometry(t);
        let authored = draft
            .and_then(|d| d.home_floors.as_ref())
            .filter(|h| !h.is_empty());
        let homes_seeded = authored.is_none();
        let homes = match authored {
            Some(h) => h.clone(),
            None => {
                let aim = aim_on_weekend(weekend_view, wd.warm, we.warm).and_then(|weekend| {
                    let origins = self.telemetry.origins.get(&id)?;
                    origin_aim(origins, weekend, &geo.served)
                });
                seeded_homes(&geo, aim)
            }
        };
        let home_floors = homes
            .into_iter()
            .take(cars as usize)
            .map(|f| geo.snap_to_served(f.clamp(geo.bottom, geo.top)))
            .collect();
        AutoTuneProposal {
            status: ProposalStatus::Available,
            weekday: wd,
            weekend: we,
            proposal: Some(ProposedSchedule {
                weekday,
                weekend,
                home_floors,
                homes_seeded,
            }),
        }
    }
}

/// Which day type's boarding geography aims the staging: the one on screen
/// when it is warm, else the other warm day; `None` when neither is warm.
fn aim_on_weekend(weekend_view: bool, wd_warm: bool, we_warm: bool) -> Option<bool> {
    match (weekend_view, wd_warm, we_warm) {
        (_, false, false) => None,
        (true, _, true) | (false, false, true) => Some(true),
        _ => Some(false),
    }
}

/// The staging aim: the busiest served boarding floor over the whole day's rings.
fn origin_aim(origins: &OriginRings, weekend: bool, served: &[i64]) -> Option<i64> {
    let ring = if weekend {
        &origins.weekend
    } else {
        &origins.weekday
    };
    peak_origin_floor(&day_origin_totals(ring), served)
}

#[cfg(test)]
#[path = "schedule_authoring_tests.rs"]
pub(crate) mod tests;
