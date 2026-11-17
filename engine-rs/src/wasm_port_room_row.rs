//! The port's row of rooms (Modern, `sim_room_row.rs`): one drag along a
//! floor places the same room as many times as fits. They follow
//! `wasm_port.rs`: numbers in, a result record out, a refusal's text in
//! `lastReason()`.
use crate::charges::{whole, INVALID_REQUEST};

use super::facade_commands::UNKNOWN_FACILITY;
use super::port::kind_of;
use super::Engine;

/// The request's kind and tiles, or `None` when one is not what it must be,
/// with the refusal's text.
fn row_request(
    kind: f64,
    floor: f64,
    from: f64,
    to: f64,
) -> Result<(crate::facilities::Kind, [i64; 3]), &'static str> {
    let kind = kind_of(kind).ok_or(UNKNOWN_FACILITY)?;
    match (whole(floor), whole(from), whole(to)) {
        (Some(floor), Some(from), Some(to)) => Ok((kind, [floor, from, to])),
        _ => Err(INVALID_REQUEST),
    }
}

impl Engine {
    /// `buildRoomRow(kind, floor, from, to)`: places the rooms the drag
    /// from the room at `from` to the room at `to` names; the delta is their
    /// price and `placed` how many were placed.
    pub(crate) fn port_build_room_row(
        &mut self,
        kind: f64,
        floor: f64,
        from: f64,
        to: f64,
    ) -> Vec<f64> {
        self.reason = None;
        let (kind, [floor, from, to]) = match row_request(kind, floor, from, to) {
            Ok(request) => request,
            Err(reason) => return self.refuse(reason, &[0.0]),
        };
        let before = self.sim.money;
        let r = self.sim.build_room_row(kind, floor, from, to);
        self.finish(before, r.ok, r.reason, &[r.placed as f64])
    }

    /// `quoteRoomRow(kind, floor, from, to)`: `[ok, cost, rooms]`, then each
    /// room's left tile in the order a drag places them: the dry run
    /// `buildRoomRow` makes first. The cost is set even when the money does
    /// not cover it; a refusal's text is `lastReason()`.
    pub(crate) fn port_quote_room_row(
        &mut self,
        kind: f64,
        floor: f64,
        from: f64,
        to: f64,
    ) -> Vec<f64> {
        self.reason = None;
        let (kind, [floor, from, to]) = match row_request(kind, floor, from, to) {
            Ok(request) => request,
            Err(reason) => {
                self.reason = Some(reason.into());
                return vec![0.0; 3];
            }
        };
        let q = self.sim.quote_room_row(kind, floor, from, to);
        if !q.ok {
            self.reason = q.reason;
        }
        let mut record = Vec::with_capacity(3 + q.rooms.len());
        record.extend([f64::from(u8::from(q.ok)), q.cost, q.rooms.len() as f64]);
        record.extend(q.rooms.iter().map(|&x| x as f64));
        record
    }
}

#[cfg(test)]
#[path = "wasm_port_room_row_tests.rs"]
mod tests;
