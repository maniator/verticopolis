//! The Auto-tune proposal for an elevator's schedule: a read-only query that
//! turns the shaft's own measured telemetry into the active-car rows and
//! staging the Modern dialog offers. A port of `autoTuneSchedule`
//! (the retired TypeScript `src/engine/scheduleAuthoring.ts`) with the dialog's warm-up gate and
//! origin aim (`src/ui/uiElevatorSchedule.ts`) moved into the engine, so the
//! host reads what is ready and what to propose instead of recomputing it.
//!
//! Nothing here writes: no tower, telemetry, rng, cash or event stream is
//! touched, and the proposal is only ever applied by the player through the
//! ordinary schedule command (one undo step). No wording lives here; the host
//! renders the buttons and the copy.
//!
//! The tuning is a simple rule: each hour gets the fewest cars that carry
//! that hour's measured load with room, never below one car.
//! It is not a validated wait-time optimization, and nothing here claims it
//! is.

use indexmap::IndexMap;
use serde::Serialize;

use crate::floor_bits::FloorBits;
use crate::schedule::{Schedule, SCHEDULE_HOURS};
use crate::schedule_geometry::ShaftGeometry;
use crate::sim::Simulation;
use crate::telemetry::{HourlyByDay, OriginRings};
use crate::tower::Transport;
use crate::tower_index::floor_slot;

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

/// The hours of a day's ring that have been sampled, a measured zero
/// included (#474): the count the warm gate reads.
fn sampled_hours(sampled: &[bool]) -> usize {
    sampled.iter().filter(|s| **s).count()
}

/// The ring when the day is warm, for a caller that only reads it.
pub(crate) fn warm_curve<'a>((curve, sampled): (&'a [f64], &[bool])) -> Option<&'a [f64]> {
    (sampled_hours(sampled) >= WARMED_MIN_HOURS).then_some(curve)
}

pub(crate) fn readiness((curve, sampled): (&[f64], &[bool])) -> DayReadiness {
    let sampled = sampled_hours(sampled);
    let warm = sampled >= WARMED_MIN_HOURS;
    DayReadiness {
        warm,
        sampled_hours: sampled,
        curve: warm.then(|| curve.to_vec()),
    }
}

/// The share of capacity at which the cars running an hour count as full at
/// a sample: riders step off at each stop, so a busy car rarely reads 1.0.
const SATURATED: f64 = 0.9;

/// Each hour's cars from its load fraction: the fewest that carry the hour's
/// riders with room ([`cars_for`]), at least one, at most the installed cars.
fn tuned_row(curve: &[f64], cars: i64) -> Vec<i64> {
    (0..SCHEDULE_HOURS)
        .map(|h| cars_for(curve.get(h).copied().unwrap_or(0.0) * cars as f64, cars))
        .collect()
}

/// The fewest cars, from 1 to `cars`, that carry `load` cars' worth of
/// riders below [`SATURATED`] each. A proposal of just the load (its rounded
/// share) left those cars full, and full cars measure no more than they
/// carry, so a shaft cut to one car never won a car back. Now a tuned row
/// has room by construction, so tuning it again proposes the same row, and
/// an hour whose cars ran full measures at least `SATURATED` of each and is
/// proposed one more car each tune until it has room.
fn cars_for(load: f64, cars: i64) -> i64 {
    let mut n = 1;
    while n < cars && load / n as f64 >= SATURATED {
        n += 1;
    }
    n
}

/// A tuned row with every hour the ring has not sampled set back to the
/// draft's count (every car where the draft has no row).
fn keep_unmeasured_hours(
    mut row: Vec<i64>,
    draft: Option<&[i64]>,
    sampled: &[bool],
    cars: i64,
) -> Vec<i64> {
    for (h, n) in row.iter_mut().enumerate() {
        if sampled.get(h) != Some(&true) {
            *n = draft.and_then(|d| d.get(h)).copied().unwrap_or(cars);
        }
    }
    row
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
        let Some(i) = self.tower.transport_index(id) else {
            return AutoTuneProposal::refused(ProposalStatus::MissingShaft);
        };
        let t = &self.tower.transports[i];
        if !t.kind.is_elevator() {
            return AutoTuneProposal::refused(ProposalStatus::NotAnElevator);
        }
        let empty = HourlyByDay::default();
        let rings = self.telemetry.hourly.get(&id).unwrap_or(&empty);
        let (wd, we) = (readiness(rings.day(false)), readiness(rings.day(true)));
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
        let twins = self.twins_of(i, &self.elevator_stop_sets());
        let (weekday, weekend) = self.tuned_rows(t, draft, &twins).unwrap_or_default();

        let geo = self.shaft_geometry(t);
        let authored = draft
            .and_then(|d| d.home_floors.as_ref())
            .filter(|h| !h.is_empty());
        let homes_seeded = authored.is_none();
        let homes = match authored {
            Some(h) => h.clone(),
            None => {
                // The up-tower half aims above the base lobby, where every
                // crowd rider coming in boards (#477), so only floors above
                // it compete for the aim.
                let base = geo.base_lobby();
                let above = &geo.served[geo.served.partition_point(|&f| f <= base)..];
                let aim = aim_on_weekend(weekend_view, wd.warm, we.warm).and_then(|weekend| {
                    let origins = self.telemetry.origins.get(&id)?;
                    origin_aim(origins, weekend, above)
                });
                seeded_homes(&geo, aim)
            }
        };
        let home_floors = homes
            .into_iter()
            .take(t.cars as usize)
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

/// The rows of one shaft Auto-tune proposes: weekday, then weekend.
type TunedRows = (Option<Vec<i64>>, Option<Vec<i64>>);

impl Simulation {
    /// The active-car rows Auto-tune gives `t` against `draft`: a warm day's
    /// from the load `t` and its `twins` measured, a cold day's the draft's
    /// own. `None` when the shaft has no cars or neither day is warm. The
    /// proposal and the morning pass share it; the pass needs no staging.
    pub(crate) fn tuned_rows(
        &self,
        t: &Transport,
        draft: Option<&Schedule>,
        twins: &[i64],
    ) -> Option<TunedRows> {
        let empty = HourlyByDay::default();
        let rings = self.telemetry.hourly.get(&t.id).unwrap_or(&empty);
        let wd_warm = warm_curve(rings.day(false)).is_some();
        let we_warm = warm_curve(rings.day(true)).is_some();
        if t.cars <= 0 || !(wd_warm || we_warm) {
            return None;
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
        // A warm day still keeps the hours its ring has not measured (the
        // hours before a reload, a new shaft's first night) at the draft's
        // count: read as idle, they would drop to one car, a rush included.
        let tuned = |weekend: bool| {
            let (ring, sampled) = rings.day(weekend);
            let row = tuned_row(&self.twin_load(twins, ring, weekend), cars);
            keep_unmeasured_hours(row, draft_row(weekend).as_deref(), sampled, cars)
        };
        let weekday = if wd_warm {
            Some(tuned(false))
        } else {
            draft_row(false)
        };
        let weekend = if we_warm {
            Some(tuned(true))
        } else {
            draft_row(true)
        };
        Some((weekday, weekend))
    }

    /// Each elevator's stops as a floor set, with its index in
    /// `tower.transports`, ascending: read once for a caller that looks for
    /// twins, so a pass over many shafts compares sets, not stop lists.
    /// Stairs and escalators are left out, so the twin search never walks
    /// a Modern tower's links.
    pub(crate) fn elevator_stop_sets(&self) -> Vec<(usize, FloorBits)> {
        let set = |(i, t): (usize, &Transport)| {
            t.kind.is_elevator().then(|| {
                let mut floors = FloorBits::default();
                for f in self.tower.stops_of(t) {
                    // Every stop is a buildable floor, which has a slot.
                    if let Some(slot) = floor_slot(f) {
                        floors.insert(slot);
                    }
                }
                (i, floors)
            })
        };
        self.tower
            .transports
            .iter()
            .enumerate()
            .filter_map(set)
            .collect()
    }

    /// The ids of the twins of the transport at index `i`: elevators of the
    /// same kind stopping at every floor it stops at, so it could carry
    /// their riders. `sets` is [`Self::elevator_stop_sets`]; each pair is
    /// one set comparison.
    pub(crate) fn twins_of(&self, i: usize, sets: &[(usize, FloorBits)]) -> Vec<i64> {
        let Ok(at) = sets.binary_search_by_key(&i, |&(j, _)| j) else {
            return Vec::new();
        };
        let (t, mine) = (&self.tower.transports[i], &sets[at].1);
        let twin = |&(j, ref theirs): &(usize, FloorBits)| {
            let other = &self.tower.transports[j];
            (j != i && other.kind == t.kind && theirs.covers(mine)).then_some(other.id)
        };
        sets.iter().filter_map(twin).collect()
    }

    /// Each hour's load to tune a shaft by: its `own`, or its `twins'`
    /// ([`Self::twins_of`]) when they carried more. Modern riders route
    /// around a shaft cut to one car, so its own reading falls with each cut
    /// and never wins its cars back (owner, 2026-11-17); the twins' reading
    /// is what it would carry. Each twin counts on a day it has measured
    /// (`warm_curve`), and the twins' load is their mean.
    fn twin_load(&self, twins: &[i64], own: &[f64], weekend: bool) -> Vec<f64> {
        let (mut sum, mut counted) = (vec![0.0; SCHEDULE_HOURS], 0.0);
        for id in twins {
            let Some(rings) = self.telemetry.hourly.get(id) else {
                continue;
            };
            let Some(curve) = warm_curve(rings.day(weekend)) else {
                continue;
            };
            for (h, load) in sum.iter_mut().zip(curve) {
                *h += load;
            }
            counted += 1.0;
        }
        (0..SCHEDULE_HOURS)
            .map(|h| {
                let mine = own.get(h).copied().unwrap_or(0.0);
                if counted > 0.0 {
                    mine.max(sum[h] / counted)
                } else {
                    mine
                }
            })
            .collect()
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

/// The staging aim: the busiest boarding floor in `served` (ascending) over
/// the whole day's rings.
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
#[cfg(test)]
#[path = "schedule_authoring_twins_tests.rs"]
mod twins_tests;
