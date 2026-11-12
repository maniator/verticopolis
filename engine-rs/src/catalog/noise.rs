//! The catalog's view of the same-floor noise rule
//! ([`crate::rules::NOISE_RULES`]), which the placement overlay draws in
//! Modern: how far a room's noise carries along its floor, and how far it
//! hears its noisy neighbors.

use serde::Serialize;

use crate::clock::GameMode;
use crate::facilities::{Kind, FACILITIES};
use crate::rules::NOISE_RULES;

/// One reach of a room's same-floor noise.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoiseEntry {
    /// `carries` (the room makes noise these kinds hear) or `hears` (the
    /// room hears noise these kinds make).
    pub role: &'static str,
    /// How many tiles past each of the room's edges the noise counts, the
    /// tile beside the room being tile 0. A lobby tile or a gap in the floor
    /// stops it.
    pub tiles: i64,
    /// The other side's kinds, in catalog order.
    pub kinds: Vec<&'static str>,
}

fn keys(matches: impl Fn(Kind) -> bool) -> Vec<&'static str> {
    FACILITIES
        .iter()
        .filter(|f| matches(f.kind))
        .map(|f| f.key)
        .collect()
}

/// The reaches a room of `kind` shows while it is placed: the rule it hears
/// first, then each rule it is a source for. Empty in a mode that keeps the
/// rule unshown.
pub(super) fn noise_entries(mode: GameMode, kind: Kind) -> Vec<NoiseEntry> {
    if !mode.shows_noise_reach() {
        return Vec::new();
    }
    let hears = NOISE_RULES
        .iter()
        .filter(|r| r.heard_by(kind))
        .map(|r| NoiseEntry {
            role: "hears",
            tiles: r.tiles,
            kinds: keys(|k| r.made_by(k)),
        });
    let carries = NOISE_RULES
        .iter()
        .filter(|r| r.made_by(kind))
        .map(|r| NoiseEntry {
            role: "carries",
            tiles: r.tiles,
            kinds: keys(|k| r.heard_by(k)),
        });
    hears.chain(carries).collect()
}
