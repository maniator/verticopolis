//! A row of rooms (Modern, #646): one drag along a floor places the same room
//! as many times as fits between the press and the pointer, as one command.
//! [`Simulation::quote_room_row`] is its dry run, the rooms and their full
//! price a placement ghost shows; [`Simulation::build_room_row`] places them.
//!
//! The row starts at the press and steps one room width at a time toward the
//! pointer. A spot a room can't take (a shaft, a room already there, open air)
//! is passed one tile at a time, so the row goes on past it rather than being
//! refused as a whole. Each room is placed by [`Simulation::build`], so a row
//! follows every rule, price and cap a single click does.

use crate::build::BuildResult;
use crate::facilities::{Kind, LOT_WIDTH};
use crate::sim::Simulation;

/// The refusal in Classic, which places one room per click, as in 1994.
pub(crate) const MODERN_ONLY: &str = "Rows of rooms are a Modern-only feature.";

/// The refusal for a floor, lobby or transport kind, which have their own
/// drags (the brush and the shaft).
pub(crate) const ROOMS_ONLY: &str = "Only rooms can be placed in a row.";

/// The answer to the row's dry run.
#[derive(Debug, Clone, PartialEq)]
pub struct RoomRowQuote {
    /// Whether the drag would place the row.
    pub ok: bool,
    /// Why it would be refused. `None` when it would be placed.
    pub reason: Option<String>,
    /// Each room's left tile, in the order the row places them, from the
    /// press toward the pointer. Empty when no room fits.
    pub rooms: Vec<i64>,
    /// The full price of every room in `rooms` with the floor tiles they lay,
    /// set even when the money does not cover it; 0 when `rooms` is empty.
    pub cost: f64,
}

impl RoomRowQuote {
    fn refuse(reason: &str) -> RoomRowQuote {
        RoomRowQuote {
            ok: false,
            reason: Some(reason.into()),
            rooms: Vec::new(),
            cost: 0.0,
        }
    }
}

/// What [`Simulation::build_room_row`] did.
#[derive(Debug, Clone, PartialEq)]
pub struct RoomRowResult {
    /// Whether any room was placed.
    pub ok: bool,
    /// Why the row was refused, or stopped short. `None` when every quoted
    /// room was placed.
    pub reason: Option<String>,
    /// How many rooms were placed.
    pub placed: i64,
}

impl Simulation {
    /// The dry run [`build_room_row`](Simulation::build_room_row) makes
    /// first: the rooms of `kind` a drag on `floor` from the room at `from`
    /// to the room at `to` (left tiles) would place, their full price, and
    /// why not. Changes nothing.
    ///
    /// ```
    /// use verticopolis_engine::clock::GameMode;
    /// use verticopolis_engine::facilities::Kind;
    /// use verticopolis_engine::sim::Simulation;
    ///
    /// let sim = Simulation::new_game(1, GameMode::Classic);
    /// assert!(!sim.quote_room_row(Kind::Office, 2, 100, 140).ok);
    /// ```
    pub fn quote_room_row(&self, kind: Kind, floor: i64, from: i64, to: i64) -> RoomRowQuote {
        if let Some(reason) = self.edit_refusal() {
            return RoomRowQuote::refuse(reason);
        }
        if !self.mode.lays_room_rows() {
            return RoomRowQuote::refuse(MODERN_ONLY);
        }
        if !kind.is_room() {
            return RoomRowQuote::refuse(ROOMS_ONLY);
        }
        let width = kind.facility().width;
        let last = (LOT_WIDTH - width).max(0);
        let (from, to) = (from.clamp(0, last), to.clamp(0, last));
        let step = if to >= from { 1 } else { -1 };
        let headroom = self.tower.cap_headroom(kind);
        let hgt = self.tower.lot().slab_stories(kind, floor);
        let mut rooms = Vec::new();
        let mut first_refusal = None;
        // The floor tiles the rooms lay under themselves and bridge to the
        // tower. A room's bridge can reach across a room nearer the tower,
        // whose own floor that is, so each tile is priced once.
        let mut floor_tiles = Vec::new();
        let mut x = from;
        while (x - to) * step <= 0 && (rooms.len() as i64) < headroom {
            // Money is counted for the whole row below.
            let c = self.can_build_with(kind, floor, x, f64::INFINITY);
            if !c.ok {
                first_refusal.get_or_insert(c.reason);
                x += step;
                continue;
            }
            rooms.push(x);
            for fl in floor..floor + hgt {
                for tx in x..x + width {
                    if !self.tower.structure.contains_key(&(fl, tx)) {
                        floor_tiles.push((fl, tx));
                    }
                }
            }
            if self.auto_bridge {
                floor_tiles.extend(self.tower.bridge_fill_plan(kind, floor, x, width, hgt));
            }
            x += step * width;
        }
        if rooms.is_empty() {
            let reason = first_refusal.flatten();
            return RoomRowQuote::refuse(reason.as_deref().unwrap_or(ROOMS_ONLY));
        }
        floor_tiles.sort_unstable();
        floor_tiles.dedup();
        let cost = rooms.len() as f64 * kind.facility().cost
            + floor_tiles.len() as f64 * Kind::Floor.facility().cost;
        let reason = (self.money < cost).then(|| "Not enough money.".to_owned());
        RoomRowQuote {
            ok: reason.is_none(),
            reason,
            rooms,
            cost,
        }
    }

    /// Places the row of rooms a drag asks for, every room
    /// [`quote_room_row`](Simulation::quote_room_row) names, one
    /// [`build`](Simulation::build) each in order, or places nothing and
    /// says why. A host opens one undo step around it.
    pub fn build_room_row(&mut self, kind: Kind, floor: i64, from: i64, to: i64) -> RoomRowResult {
        let quote = self.quote_room_row(kind, floor, from, to);
        if !quote.ok {
            return RoomRowResult {
                ok: false,
                reason: quote.reason,
                placed: 0,
            };
        }
        let mut placed = 0;
        for x in quote.rooms {
            let BuildResult { ok, reason } = self.build(kind, floor, x);
            if !ok {
                // The quote checked each room and the whole price, so this
                // is a rule the quote does not foresee; the rooms placed
                // stay, inside the host's one undo step.
                return RoomRowResult {
                    ok: placed > 0,
                    reason,
                    placed,
                };
            }
            placed += 1;
        }
        RoomRowResult {
            ok: true,
            reason: None,
            placed,
        }
    }
}

#[cfg(test)]
#[path = "sim_room_row_tests.rs"]
mod tests;
