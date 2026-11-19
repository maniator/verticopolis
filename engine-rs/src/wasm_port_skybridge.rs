//! The port's Sky Bridge tool (Modern, `sim_skybridge_build.rs`): one click
//! lays the whole bridge across a gap between two sky lobbies, in the look
//! the player picked, and a click on a bridge changes its look. They follow
//! `wasm_port.rs`: numbers in, a result record out, a refusal's text in
//! `lastReason()`.
use crate::charges::{whole, INVALID_REQUEST};

use super::Engine;

impl Engine {
    /// `buildSkyBridge(floor, x)`: lays the bridge a click at the cell asks
    /// for, whole or not at all; the delta is its price and `tiles` the
    /// tiles it laid.
    pub(crate) fn port_build_skybridge(&mut self, floor: f64, x: f64, look: f64) -> Vec<f64> {
        self.reason = None;
        let (Some(floor), Some(x)) = (whole(floor), whole(x)) else {
            return self.refuse(INVALID_REQUEST, &[0.0]);
        };
        let span = self.sim.quote_skybridge(floor, x).tiles;
        let tiles = (span.end - span.start) as f64;
        let before = self.sim.money;
        let r = self.sim.build_skybridge_as(floor, x, look_or_new(look));
        let laid = if r.ok { tiles } else { 0.0 };
        self.finish(before, r.ok, r.reason, &[laid])
    }

    /// `quoteSkyBridge(floor, x)`: `[ok, cost, from, to]`, the dry run
    /// `buildSkyBridge` makes first: the tiles `from..to` a click lays (empty
    /// when no gap between two sky lobbies is found) and their full price; a
    /// refusal's text is `lastReason()`.
    pub(crate) fn port_quote_skybridge(&mut self, floor: f64, x: f64) -> [f64; 4] {
        self.reason = None;
        let (Some(floor), Some(x)) = (whole(floor), whole(x)) else {
            self.reason = Some(INVALID_REQUEST.into());
            return [0.0; 4];
        };
        let q = self.sim.quote_skybridge(floor, x);
        if !q.ok {
            self.reason = q.reason;
        }
        let ok = f64::from(u8::from(q.ok));
        [ok, q.cost, q.tiles.start as f64, q.tiles.end as f64]
    }

    /// `restyleSkyBridge(floor, x, look)`: dresses the whole bridge at the
    /// cell in look `look`, an index into the catalog's `rules.skyBridge.looks`.
    /// Free, so the delta is 0.
    pub(crate) fn port_restyle_skybridge(&mut self, floor: f64, x: f64, look: f64) -> Vec<f64> {
        self.reason = None;
        let (Some(floor), Some(x), Some(look)) = (whole(floor), whole(x), whole(look)) else {
            return self.refuse(INVALID_REQUEST, &[]);
        };
        let before = self.sim.money;
        let Ok(look) = usize::try_from(look) else {
            return self.refuse(INVALID_REQUEST, &[]);
        };
        let r = self.sim.restyle_skybridge(floor, x, look);
        self.finish(before, r.ok, r.reason, &[])
    }

    /// `skyBridgeLooks()`: every bridge in the tower as `[floor, from, to,
    /// look]`, four numbers each, by floor and then column; `look` indexes the
    /// catalog's `rules.skyBridge.looks`.
    pub(crate) fn port_skybridge_looks(&self) -> Vec<f64> {
        let mut out = Vec::new();
        for b in self.sim.tower.skybridge_looks() {
            out.extend([
                b.floor as f64,
                b.cols.start as f64,
                b.cols.end as f64,
                b.look as f64,
            ]);
        }
        out
    }
}

/// The look a build asks for: a whole index, or the new bridge's look when
/// the caller passed none (`undefined` reads as NaN).
fn look_or_new(look: f64) -> usize {
    whole(look)
        .and_then(|l| usize::try_from(l).ok())
        .unwrap_or(crate::tower::NEW_SKYBRIDGE_LOOK)
}
