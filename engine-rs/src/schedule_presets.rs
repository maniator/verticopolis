//! The Modern intent presets for an elevator's schedule: a read-only query
//! that answers the active-car rows and home floors a named preset sets for
//! one shaft. A port of `presetSchedule` and `recommendedPreset`
//! (`src/engine/scheduleAuthoring.ts`) so the host reads the preset instead of
//! building it. The rule is unchanged: morning and evening rush hours, a
//! two-car overnight cap, half-fleet shoulders, and staging drawn from the
//! shaft's own lobbies.
//!
//! Nothing here writes, and no wording lives here: the host names the buttons
//! and applies the answer through the ordinary schedule command (one undo
//! step). Positioning is the point of a preset, so no row treats a lower count
//! as an economy win; the count axis has no running cost.

use std::ops::Range;

use serde::Serialize;

use crate::facilities::Kind;
use crate::schedule::SCHEDULE_HOURS;
use crate::schedule_geometry::ShaftGeometry;
use crate::sim::Simulation;

/// Hours the Rush preset runs the full fleet: the morning up-rush and the
/// evening down-rush.
const MORNING_PEAK: Range<usize> = 7..10;
const EVENING_PEAK: Range<usize> = 17..20;
/// The Balanced preset's full-fleet daytime hump.
const DAYTIME: Range<usize> = 8..18;
/// Cars kept on the graveyard hours (22:00 to 05:59).
const OVERNIGHT_CAP: i64 = 2;
/// The hours that are not overnight: 06:00 through 21:59.
const WAKING_HOURS: Range<usize> = 6..22;

/// A named schedule intent. The first three are the Modern presets;
/// `StageUpTower` is the one-press staging play the raw grid offers in both
/// modes, so it carries homes only.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Preset {
    Rush,
    Balanced,
    Feeder,
    StageUpTower,
}

impl Preset {
    /// The name a host asks by; `None` for anything else.
    pub fn from_name(name: &str) -> Option<Preset> {
        match name {
            "rush" => Some(Preset::Rush),
            "balanced" => Some(Preset::Balanced),
            "feeder" => Some(Preset::Feeder),
            "stage-up-tower" => Some(Preset::StageUpTower),
            _ => None,
        }
    }

    /// Whether the player gets this intent only as an assisted proposal.
    fn is_assisted(self) -> bool {
        self != Preset::StageUpTower
    }
}

/// How the preset query ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PresetStatus {
    Available,
    /// The mode offers no assisted presets (Classic). Manual scheduling,
    /// including a schedule that happens to match a preset, stays valid.
    UnavailableInMode,
    /// The shaft holds no cars (a loaded save can), so no preset has a row or
    /// a home to set.
    NoCars,
    /// The id names a stair or escalator.
    NotAnElevator,
    /// The id names no shaft.
    MissingShaft,
    /// The name is not one the engine knows.
    UnknownPreset,
}

/// The rows and homes a preset sets. `weekday` and `weekend` are `None` for
/// the staging-only play and on every refusal.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetProposal {
    pub status: PresetStatus,
    pub weekday: Option<Vec<i64>>,
    pub weekend: Option<Vec<i64>>,
    pub home_floors: Vec<i64>,
}

impl PresetProposal {
    pub fn refused(status: PresetStatus) -> PresetProposal {
        PresetProposal {
            status,
            weekday: None,
            weekend: None,
            home_floors: Vec::new(),
        }
    }
}

/// The presets the dialog offers as buttons, the only ones it can recommend.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AssistedPreset {
    Rush,
    Balanced,
    Feeder,
}

/// The preset the dialog highlights: Feeder for an express trunk (a
/// lobby-only feeder), Rush for a busy local.
pub fn recommended_preset(kind: Kind) -> AssistedPreset {
    if kind == Kind::ElevatorExpress {
        AssistedPreset::Feeder
    } else {
        AssistedPreset::Rush
    }
}

fn is_overnight(h: usize) -> bool {
    !WAKING_HOURS.contains(&h)
}

fn half(cars: i64) -> i64 {
    ((cars + 1) / 2).max(1)
}

fn row(f: impl Fn(usize) -> i64) -> Vec<i64> {
    (0..SCHEDULE_HOURS).map(f).collect()
}

/// A day row with `peak` hours at `peak_cars`, the graveyard hours at the
/// overnight cap and every other hour at half the fleet.
fn shaped_row(cars: i64, peak: impl Fn(usize) -> bool) -> Vec<i64> {
    row(|h| {
        if peak(h) {
            cars
        } else if is_overnight(h) {
            OVERNIGHT_CAP.min(cars)
        } else {
            half(cars)
        }
    })
}

/// The preset's rows and homes for a shaft, held to its cars and span.
fn build(preset: Preset, geo: &ShaftGeometry) -> PresetProposal {
    let cars = geo.cars;
    let (weekday, weekend, homes) = match preset {
        // Full fleet at the peaks, half midday and shoulders, a skeleton
        // overnight; the fleet is split-staged so the upper half waits
        // up-tower for the down-rush.
        Preset::Rush => (
            Some(shaped_row(cars, |h| {
                MORNING_PEAK.contains(&h) || EVENING_PEAK.contains(&h)
            })),
            // The midday-half curve all weekend.
            Some(row(|_| half(cars))),
            geo.seeded_homes(geo.up_tower_target()),
        ),
        // A daytime hump, half the shoulders, a skeleton overnight; every car
        // home at the base lobby. The safe default.
        Preset::Balanced => {
            let day = shaped_row(cars, |h| DAYTIME.contains(&h));
            (
                Some(day.clone()),
                Some(day),
                geo.uniform_homes(geo.base_lobby()),
            )
        }
        // Steady half-fleet all day and night, every car homed at the
        // up-tower target to feed an express transfer.
        Preset::Feeder => {
            let steady = row(|_| half(cars));
            (
                Some(steady.clone()),
                Some(steady),
                geo.uniform_homes(geo.up_tower_target()),
            )
        }
        Preset::StageUpTower => (None, None, geo.split_homes(geo.up_tower_target())),
    };
    PresetProposal {
        status: PresetStatus::Available,
        weekday,
        weekend,
        home_floors: homes
            .into_iter()
            .map(|f| f.clamp(geo.bottom, geo.top))
            .collect(),
    }
}

impl Simulation {
    /// The rows and homes the named `preset` sets for shaft `id`. Read-only.
    pub fn schedule_preset(&self, id: i64, preset: &str) -> PresetProposal {
        let Some(t) = self.tower.get_transport(id) else {
            return PresetProposal::refused(PresetStatus::MissingShaft);
        };
        if !t.kind.is_elevator() {
            return PresetProposal::refused(PresetStatus::NotAnElevator);
        }
        let Some(preset) = Preset::from_name(preset) else {
            return PresetProposal::refused(PresetStatus::UnknownPreset);
        };
        if preset.is_assisted() && !self.mode.schedule_assist() {
            return PresetProposal::refused(PresetStatus::UnavailableInMode);
        }
        if t.cars <= 0 {
            return PresetProposal::refused(PresetStatus::NoCars);
        }
        build(preset, &self.shaft_geometry(t))
    }
}

#[cfg(test)]
#[path = "schedule_presets_tests.rs"]
mod tests;
