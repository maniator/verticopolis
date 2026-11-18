//! The Sky Bridge tool (Modern, `tower/skybridge.rs`): one click on the open
//! air between two sky lobbies lays the whole bridge, or nothing.
//! [`Simulation::quote_skybridge`] is its dry run, the span and the full
//! price a placement ghost shows; [`Simulation::build_skybridge`] lays it,
//! and [`Simulation::restyle_skybridge`] changes a bridge's look.

use crate::build::BuildResult;
use crate::facilities::Kind;
use crate::gameplay::GameplayEvent;
use crate::sim::Simulation;
use crate::tower::{
    look_subtype, OverAir, FINISH_THE_BRIDGE, NEW_SKYBRIDGE_LOOK, POINT_AT_A_BRIDGE,
    SKYBRIDGE_MIN_STAR,
};
use std::ops::Range;

/// The refusal in Classic, which has no bridges, as in 1994.
pub(crate) const MODERN_ONLY: &str = "Sky bridges are a Modern-only feature.";

/// The answer to the Sky Bridge tool's dry run.
#[derive(Debug, Clone, PartialEq)]
pub struct SkybridgeQuote {
    /// Whether a click would lay the bridge.
    pub ok: bool,
    /// Why it would be refused. `None` when it would be laid.
    pub reason: Option<String>,
    /// The columns a click lays, left to right, one run: the whole gap for a
    /// new bridge, the missing part of a half bridge. Empty when no gap
    /// between two sky lobbies is found.
    pub tiles: Range<i64>,
    /// The full price of every tile in `tiles`, set even when the money
    /// does not cover it; 0 when `tiles` is empty.
    pub cost: f64,
}

impl SkybridgeQuote {
    fn refuse(reason: &str) -> SkybridgeQuote {
        SkybridgeQuote {
            ok: false,
            reason: Some(reason.into()),
            tiles: 0..0,
            cost: 0.0,
        }
    }
}

impl Simulation {
    /// The dry run [`build_skybridge`](Simulation::build_skybridge) makes
    /// first: the bridge a click at (`floor`, `x`) would lay, its full price,
    /// and why not. Changes nothing.
    ///
    /// ```
    /// use verticopolis_engine::clock::GameMode;
    /// use verticopolis_engine::sim::Simulation;
    ///
    /// let sim = Simulation::new_game(1, GameMode::Classic);
    /// assert!(!sim.quote_skybridge(15, 120).ok);
    /// ```
    pub fn quote_skybridge(&self, floor: i64, x: i64) -> SkybridgeQuote {
        if let Some(reason) = self.edit_refusal() {
            return SkybridgeQuote::refuse(reason);
        }
        if !self.mode.builds_skybridges() {
            return SkybridgeQuote::refuse(MODERN_ONLY);
        }
        if self.star < SKYBRIDGE_MIN_STAR {
            return SkybridgeQuote::refuse(&format!(
                "Sky Bridge unlocks at {SKYBRIDGE_MIN_STAR}★."
            ));
        }
        let span = match self.tower.skybridge_span(floor, x) {
            Ok(span) => span,
            Err(reason) => return SkybridgeQuote::refuse(reason),
        };
        let (first, last) = (span.missing[0], span.missing[span.missing.len() - 1]);
        let tiles = first..last + 1;
        let mut cost = 0.0;
        let mut reason = None;
        for c in tiles.clone() {
            let check = self
                .tower
                .can_place_as(Kind::Lobby, floor, c, OverAir::Bridge);
            if reason.is_none() && !check.ok {
                reason = check.reason;
            }
            let stories = self.tile_stories(Kind::Lobby, floor, c);
            cost += self.structure_tile_cost(Kind::Lobby, floor, c, stories);
        }
        if reason.is_none() && self.money < cost {
            reason = Some("Not enough money.".into());
        }
        SkybridgeQuote {
            ok: reason.is_none(),
            reason,
            tiles,
            cost,
        }
    }

    /// Lays the whole sky bridge a click at (`floor`, `x`) asks for, every
    /// missing tile of the gap between two sky lobbies, and charges its
    /// full price, or lays nothing and says why
    /// ([`quote_skybridge`](Simulation::quote_skybridge)).
    pub fn build_skybridge(&mut self, floor: i64, x: i64) -> BuildResult {
        self.build_skybridge_as(floor, x, NEW_SKYBRIDGE_LOOK)
    }

    /// [`build_skybridge`](Simulation::build_skybridge) in look `look`, an
    /// index into [`SKYBRIDGE_LOOKS`](crate::tower::SKYBRIDGE_LOOKS); an
    /// index past the list lays the new bridge's look. Finishing a half
    /// bridge dresses the whole bridge in it.
    pub fn build_skybridge_as(&mut self, floor: i64, x: i64, look: usize) -> BuildResult {
        let subtype =
            look_subtype(look).unwrap_or_else(|| look_subtype(NEW_SKYBRIDGE_LOOK).flatten());
        let quote = self.quote_skybridge(floor, x);
        if !quote.ok {
            return BuildResult {
                ok: false,
                reason: quote.reason,
            };
        }
        let mut laid = Vec::new();
        for c in quote.tiles.clone() {
            let r = self.tower.place_as(Kind::Lobby, floor, c, OverAir::Bridge);
            match r.unit_id {
                Some(id) if r.ok => laid.push(id),
                _ => {
                    self.tower.remove_units(&laid);
                    return BuildResult {
                        ok: false,
                        reason: r.reason,
                    };
                }
            }
        }
        if let Some(cols) = self.tower.skybridge_at(floor, quote.tiles.start) {
            self.tower.dress_skybridge(floor, cols, subtype);
        }
        self.money -= quote.cost;
        self.note_edit_cash(-quote.cost);
        self.gameplay.push(GameplayEvent::FacilityPlaced {
            kind: Kind::Lobby,
            floor,
            count: laid.len() as i64,
        });
        BuildResult {
            ok: true,
            reason: None,
        }
    }

    /// Dress the whole bridge a tile at (`floor`, `x`) belongs to in look
    /// `look`, an index into [`SKYBRIDGE_LOOKS`](crate::tower::SKYBRIDGE_LOOKS).
    /// A look costs nothing. Refused off a bridge tile, on a half bridge
    /// (a click finishes it instead), for an index past the list, and in
    /// Classic.
    ///
    /// ```
    /// use verticopolis_engine::clock::GameMode;
    /// use verticopolis_engine::sim::Simulation;
    ///
    /// let mut sim = Simulation::new_game(1, GameMode::Modern);
    /// assert!(!sim.restyle_skybridge(15, 120, 2).ok);
    /// ```
    pub fn restyle_skybridge(&mut self, floor: i64, x: i64, look: usize) -> BuildResult {
        let refuse = |reason: &str| BuildResult {
            ok: false,
            reason: Some(reason.into()),
        };
        if let Some(reason) = self.edit_refusal() {
            return refuse(reason);
        }
        if !self.mode.builds_skybridges() {
            return refuse(MODERN_ONLY);
        }
        let (Some(subtype), Some(cols)) = (look_subtype(look), self.tower.skybridge_at(floor, x))
        else {
            return refuse(POINT_AT_A_BRIDGE);
        };
        if !self.tower.skybridge_finished(floor, &cols) {
            return refuse(FINISH_THE_BRIDGE);
        }
        self.tower.dress_skybridge(floor, cols, subtype);
        BuildResult {
            ok: true,
            reason: None,
        }
    }
}
