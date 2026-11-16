//! The port's Sky Bridge tool (Modern, `sim_skybridge_build.rs`): one click
//! lays the whole bridge across a gap between two sky lobbies. They follow
//! `wasm_port.rs`: numbers in, a result record out, a refusal's text in
//! `lastReason()`.
use crate::charges::{whole, INVALID_REQUEST};

use super::Engine;

impl Engine {
    /// `buildSkyBridge(floor, x)`: lays the bridge a click at the cell asks
    /// for, whole or not at all; the delta is its price and `tiles` the
    /// tiles it laid.
    pub(crate) fn port_build_skybridge(&mut self, floor: f64, x: f64) -> Vec<f64> {
        self.reason = None;
        let (Some(floor), Some(x)) = (whole(floor), whole(x)) else {
            return self.refuse(INVALID_REQUEST, &[0.0]);
        };
        let span = self.sim.quote_skybridge(floor, x).tiles;
        let tiles = (span.end - span.start) as f64;
        let before = self.sim.money;
        let r = self.sim.build_skybridge(floor, x);
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
}
