//! The catalog's view of a venue's cross-floor halo ([`crate::rules::Halo`]),
//! which the placement range rings draw (#1980).

use serde::Serialize;

use crate::clock::GameMode;
use crate::facilities::{Kind, FACILITIES};

/// A venue's halo: who feels it, over how many floors and how hard.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HaloEntry {
    /// `lift` (an amenity) or `drain` (a nuisance).
    pub effect: &'static str,
    /// How far it reaches: a room `d` floors away feels `max * (1 - d /
    /// floors)`, and none at `floors` or beyond.
    pub floors: f64,
    /// The hourly bonus or drain on the venue's own floor.
    pub max: f64,
    /// How far a lift raises a capped room's ceiling at full strength, or
    /// null for a drain.
    pub cap_lift: Option<f64>,
    /// The kinds that feel it, in catalog order.
    pub felt_by: Vec<&'static str>,
    /// Felt only in the venue's open hours (its `openHours`).
    pub open_hours_only: bool,
    /// Scaled by the household's size, largest for the biggest family.
    pub family_scaled: bool,
}

pub(super) fn halo_entry(mode: GameMode, kind: Kind) -> Option<HaloEntry> {
    let h = mode.halo_of(kind)?;
    Some(HaloEntry {
        effect: h.effect.as_str(),
        floors: h.floors,
        max: h.max,
        cap_lift: h.cap_lift_max(),
        felt_by: FACILITIES
            .iter()
            .filter(|f| h.felt_by(f.kind))
            .map(|f| f.key)
            .collect(),
        open_hours_only: h.open_hours_only,
        family_scaled: h.family_scaled,
    })
}
