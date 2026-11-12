//! The same-floor noise rule as one table: which rooms hear which neighbors,
//! and over how many tiles. The noise scan (`Simulation::noise_afflicted_fresh`)
//! reads this table, the catalog publishes it in Modern for the placement
//! overlay, and both modes keep the rule itself. The scan walks out from a
//! room's edges and stops at a lobby tile or a gap in the structure.

use crate::facilities::Kind;
use crate::satisfaction::{HOTEL_NOISE_TILES, OFFICE_NOISE_TILES};

/// One listener's noise rule.
#[derive(Clone, Copy, Debug)]
pub struct NoiseRule {
    /// The rooms that hear it.
    listener: fn(Kind) -> bool,
    /// The rooms that make the noise they hear.
    source: fn(Kind) -> bool,
    /// How many tiles past each of the listener's edges a source is still
    /// heard (the tile right beside the room is tile 0, so a source starting
    /// `tiles + 1` tiles out or nearer counts).
    pub tiles: i64,
}

impl NoiseRule {
    /// Whether a room of `kind` hears this rule's sources.
    pub fn heard_by(&self, kind: Kind) -> bool {
        (self.listener)(kind)
    }

    /// Whether a room of `kind` is a source this rule's listeners hear.
    pub fn made_by(&self, kind: Kind) -> bool {
        (self.source)(kind)
    }
}

fn is_office(kind: Kind) -> bool {
    kind == Kind::Office
}

fn is_home_or_hotel(kind: Kind) -> bool {
    kind.is_hotel() || kind == Kind::Condo || kind.is_rental()
}

fn is_office_or_noisy_venue(kind: Kind) -> bool {
    kind == Kind::Office || kind.is_noisy_venue()
}

/// Every noise rule. The listeners are disjoint, so a room hears one rule
/// at most.
pub const NOISE_RULES: [NoiseRule; 2] = [
    NoiseRule {
        listener: is_office,
        source: Kind::is_noisy_venue,
        tiles: OFFICE_NOISE_TILES,
    },
    NoiseRule {
        listener: is_home_or_hotel,
        source: is_office_or_noisy_venue,
        tiles: HOTEL_NOISE_TILES,
    },
];

/// The rule a room of `kind` hears, if any.
pub fn noise_rule_for(kind: Kind) -> Option<&'static NoiseRule> {
    NOISE_RULES.iter().find(|r| r.heard_by(kind))
}
