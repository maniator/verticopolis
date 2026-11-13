//! The floor and lobby brush: [`Simulation::paint_brush`] lays a run of
//! floor or lobby tiles in one command.

use crate::build::substrate_cost;
use crate::charges::INVALID_REQUEST;
use crate::facilities::Kind;
use crate::sim::Simulation;

/// A structural tile and the bridge laid with it, as `build` lays them.
pub(crate) struct BridgedTile {
    /// How many stories the tile itself rises.
    pub stories: i64,
    /// The price of every bridged substrate tile.
    pub bridge_cost: f64,
}

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
    /// How many stories a structural tile of `kind` laid at `(floor, x)`
    /// covers: the height a lobby tile there gets ([`Self::with_lobby_height`]
    /// and the hall it is laid against), 1 for a floor tile.
    pub(crate) fn tile_stories(&self, kind: Kind, floor: i64, x: i64) -> i64 {
        if kind == Kind::Lobby {
            self.tower
                .placement_lobby_height_at(floor, x, kind.facility().width)
        } else {
            1
        }
    }

    /// How many stories a structural tile of `kind` at `(floor, x)` rises
    /// once `plan`, its bridge, is laid, and that bridge's price.
    /// `fill_bridge` lays each side of a bridge out from the structure it
    /// reaches, so in Modern a lobby bridge takes the height of the hall on
    /// its side, and the tile joins the left side's (#2068): it is laid last,
    /// against the left bridge, or against the right one when only that side
    /// bridges and nothing stands beside it. In Classic, and for any tile but
    /// a lobby, every tile takes [`Self::tile_stories`]. `build` charges the
    /// tiles a bridge did lay at the height each one took.
    pub(crate) fn bridged_tile(
        &self,
        kind: Kind,
        floor: i64,
        x: i64,
        plan: &[(i64, i64)],
    ) -> BridgedTile {
        let own = self.tile_stories(kind, floor, x);
        let per_hall = kind == Kind::Lobby && self.mode.lobby_height_per_hall();
        let w = kind.facility().width;
        let hall = |col: i64| {
            self.tower
                .hall_at(floor, col)
                .map(|u| self.tower.unit_stories(u))
        };
        // The height of the hall a side's bridge reaches, past its far end.
        let reach = |left: bool| -> Option<i64> {
            let cols = plan
                .iter()
                .filter(|&&(fl, g)| fl == floor && (g < x) == left)
                .map(|&(_, g)| g);
            let end = if left {
                cols.min()? - 1
            } else {
                cols.max()? + 1
            };
            per_hall.then(|| hall(end)).flatten()
        };
        let (left, right) = (reach(true), reach(false));
        let beside = hall(x - 1).is_some() || hall(x + w).is_some();
        let stories = left.or(if beside { None } else { right }).unwrap_or(own);
        let side = |fl: i64, g: i64| {
            if fl != floor {
                None
            } else if g < x {
                left
            } else {
                right
            }
        };
        let bridge_cost = plan
            .iter()
            .map(|&(fl, g)| substrate_cost(kind, side(fl, g).unwrap_or(own)))
            .sum();
        BridgedTile {
            stories,
            bridge_cost,
        }
    }

    /// How many stories a lobby tile laid at `(floor, x)` now rises, with
    /// the bridge the engine would lay for it when bridging is on: what
    /// [`Self::can_build`] prices it at, and what `lobbyRise` reports.
    pub fn lobby_rise_at(&self, floor: i64, x: i64) -> i64 {
        let plan = if self.auto_bridge {
            self.tower.bridge_fill_plan(Kind::Lobby, floor, x, 1, 1)
        } else {
            Vec::new()
        };
        self.bridged_tile(Kind::Lobby, floor, x, &plan).stories
    }

    /// Runs `run` with `height` as the height a floor's first lobby
    /// placement asks for (#308), so a lobby built, quoted or brushed inside
    /// it on a floor that holds no lobby yet rises that many stories, where
    /// the mode lets that floor's lobby rise. A floor that holds a lobby
    /// keeps its height whatever is asked. Outside it, a first lobby is one
    /// story. The height is clamped to 1 through
    /// [`MAX_LOBBY_HEIGHT`](crate::facilities::MAX_LOBBY_HEIGHT).
    ///
    /// ```
    /// use verticopolis_engine::clock::GameMode;
    /// use verticopolis_engine::facilities::Kind;
    /// use verticopolis_engine::sim::Simulation;
    ///
    /// let mut sim = Simulation::new_game(1, GameMode::Classic);
    /// let tiles: Vec<i64> = (100..104).collect();
    /// sim.with_lobby_height(2, |sim| sim.paint_brush(Kind::Lobby, 1, &tiles));
    /// assert_eq!(sim.tower.lobby_height(1), 2);
    /// ```
    pub fn with_lobby_height<T>(
        &mut self,
        height: i64,
        run: impl FnOnce(&mut Simulation) -> T,
    ) -> T {
        let before = self.tower.requested_lobby_height;
        self.set_lobby_height(height);
        let out = run(self);
        self.tower.requested_lobby_height = before;
        out
    }

    /// Sets the height a floor's first lobby placement asks for until it is
    /// set again, as a frontend's lobby tool holds its choice between
    /// clicks; [`Self::with_lobby_height`] is the scoped form. Clamped to 1
    /// through [`MAX_LOBBY_HEIGHT`](crate::facilities::MAX_LOBBY_HEIGHT).
    /// Tool state only: never saved, and a loaded tower starts at 1.
    pub fn set_lobby_height(&mut self, height: i64) {
        self.tower.requested_lobby_height = height.clamp(1, crate::facilities::MAX_LOBBY_HEIGHT);
    }

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
