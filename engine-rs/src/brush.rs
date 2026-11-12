//! The floor and lobby brush: [`Simulation::paint_brush`] lays a run of
//! floor or lobby tiles in one command.

use crate::charges::INVALID_REQUEST;
use crate::facilities::Kind;
use crate::sim::Simulation;

/// The most tiles one brush may carry.
pub const BRUSH_TILE_LIMIT: usize = 32;

/// What a brush laid.
#[derive(Clone, Debug, PartialEq)]
pub struct BrushResult {
    /// How many tiles it laid.
    pub placed: i64,
    /// The last refusal one of its tiles got, if any did.
    pub reason: Option<String>,
}

impl BrushResult {
    #[doc(hidden)]
    pub fn invalid() -> BrushResult {
        BrushResult {
            placed: 0,
            reason: Some(INVALID_REQUEST.into()),
        }
    }
}

impl Simulation {
    /// Lays `kind` (floor or lobby) on each tile column in `tiles` on
    /// `floor`, charging as that many [`build`](Simulation::build) calls
    /// would, in one command. It skips a tile that already carries `kind`,
    /// and tries a refused tile again once a neighbor it needed is laid, so
    /// the order of `tiles` does not matter.
    ///
    /// A lobby brush also turns plain floor into lobby (a sky lobby). Any
    /// other kind, or more than [`BRUSH_TILE_LIMIT`] tiles, lays nothing and
    /// answers `INVALID_REQUEST`.
    ///
    /// ```
    /// use verticopolis_engine::clock::GameMode;
    /// use verticopolis_engine::facilities::Kind;
    /// use verticopolis_engine::sim::Simulation;
    ///
    /// let mut sim = Simulation::new_game(1, GameMode::Classic);
    /// let tiles: Vec<i64> = (100..124).collect();
    /// let laid = sim.paint_brush(Kind::Lobby, 1, &tiles);
    /// assert_eq!(laid.placed, 24);
    /// ```
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
