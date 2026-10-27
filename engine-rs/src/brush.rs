//! The floor and lobby brush (`paintBrush`), twin of
//! `src/engine/sim/brush.ts`.

use crate::charges::INVALID_REQUEST;
use crate::facilities::Kind;
use crate::sim::Simulation;

/// The most tiles one brush may carry (`BRUSH_TILE_LIMIT`). The binding
/// refuses more with `INVALID_REQUEST`.
pub const BRUSH_TILE_LIMIT: usize = 32;

/// `BrushResult`: how many tiles the brush laid, and the last refusal reason
/// a build gave.
#[derive(Clone, Debug, PartialEq)]
pub struct BrushResult {
    pub placed: i64,
    pub reason: Option<String>,
}

impl BrushResult {
    /// The refusal for a malformed brush: nothing laid.
    pub fn invalid() -> BrushResult {
        BrushResult {
            placed: 0,
            reason: Some(INVALID_REQUEST.into()),
        }
    }
}

impl Simulation {
    /// `paintBrush(kind, floor, tiles)`: `build(kind, floor, x)` over the
    /// brush's tiles, the same builds in the same order as laying them one at
    /// a time, so the brush charges, logs and reports exactly as those builds
    /// do. One engine call, so no step runs between its tiles.
    ///
    /// Each pass walks `tiles` in order and skips a tile that already carries
    /// `kind`, or any structure when the brush is not a lobby brush (a lobby
    /// brush upgrades plain floor in place, the sky-lobby conversion). Passes
    /// repeat while one laid something, so a tile refused for want of support
    /// is tried again once its neighbor stands. A repeated column is laid
    /// once and then skipped, and a refused one is tried again, as the same
    /// builds issued one by one would be.
    ///
    /// A lobby laid over plain floor takes the tile's place in the unit list,
    /// and what the brush placed moves to the end of the list in one pass at
    /// the end ([`Simulation::with_lobby_upgrades`]), where laying them one at
    /// a time would make a pass per tile.
    ///
    /// A kind other than floor or lobby, or more than [`BRUSH_TILE_LIMIT`]
    /// tiles, lays nothing and answers `INVALID_REQUEST`. The binding refuses
    /// a floor or tile that is not a whole number the same way.
    pub fn paint_brush(&mut self, kind: Kind, floor: i64, tiles: &[i64]) -> BrushResult {
        if !matches!(kind, Kind::Floor | Kind::Lobby) || tiles.len() > BRUSH_TILE_LIMIT {
            return BrushResult::invalid();
        }
        self.with_lobby_upgrades(|sim| {
            let mut placed = 0;
            let mut reason = None;
            let mut progress = true;
            while progress {
                progress = false;
                for &tx in tiles {
                    let existing = sim.tower.structure_kind_at(floor, tx);
                    if existing == Some(kind) || (existing.is_some() && kind != Kind::Lobby) {
                        continue;
                    }
                    let r = sim.build(kind, floor, tx);
                    if r.ok {
                        placed += 1;
                        progress = true;
                    } else {
                        reason = r.reason;
                    }
                }
            }
            BrushResult { placed, reason }
        })
    }
}
