//! Sky bridges (Modern): a row of lobby tiles laid over open air on a sky
//! lobby floor, from one wing's sky lobby to another's. The tiles are plain
//! lobby tiles, so a finished bridge joins the two wings' floors into one
//! walkable floor and routing needs nothing new. What makes a tile a bridge
//! tile is only where it stands: a lobby tile with no story under it.
//!
//! A bridge carries nothing: no story stands on it and no shaft lands on
//! it. A bridge tile goes in beside a lobby tile, and only across a gap
//! that a sky lobby closes on the far side within [`SKYBRIDGE_MAX_SPAN`]
//! tiles, so a bridge never juts into the sky. While one is half built, each
//! piece hangs from the wing it started from. A bridge is one story high,
//! beside a tall lobby hall too. The bulldozer takes a tile
//! only where no piece would be left hanging from nothing, and leaves a
//! wing's lobby tile standing while a bridge hangs from it. Classic has no
//! bridges, as in 1994 (`GameMode::builds_skybridges`).

use super::{Tower, Unit};
use crate::facilities::{is_sky_lobby_floor, Kind, LOT_WIDTH};

/// The most tiles of open air one bridge spans, wall to wall.
pub const SKYBRIDGE_MAX_SPAN: i64 = 24;

/// What a bridge tile costs against a lobby tile on a story: a bridge is
/// built out over the street, so it costs twice as much.
pub(crate) const SKYBRIDGE_PRICE_FACTOR: f64 = 2.0;

/// The refusal for a bridge tile that touches nothing.
pub(crate) const STARTS_AT_A_LOBBY: &str =
    "A sky bridge starts at a sky lobby. Lay it out from the lobby's edge.";

/// The refusal for a bridge tile with no sky lobby across the gap.
pub(crate) const REACHES_A_LOBBY: &str =
    "A sky bridge must reach a sky lobby on the far side of the gap.";

/// The refusal for a gap wider than a bridge spans.
pub(crate) const SPAN_TOO_LONG: &str = "A sky bridge spans at most 24 tiles of open air.";

/// The refusal for selling a wing's lobby tile that a bridge hangs from.
pub(crate) const BRIDGE_HANGS_HERE: &str =
    "A sky bridge hangs from this lobby. Bulldoze the bridge first.";

/// The refusal for selling a bridge tile that holds up the rest of a piece.
pub(crate) const PIECE_WOULD_FALL: &str =
    "The bridge beyond this tile would fall. Bulldoze it from the open end.";

/// One floor's tiles as a bridge sees them: what stands at a column, and
/// whether a story stands under it.
pub(crate) struct Row<K, R> {
    /// The kind of floor or lobby tile at column `x`, if any.
    pub kind_at: K,
    /// Whether column `x` has a floor or lobby tile on the story below.
    pub rests: R,
}

impl<K: Fn(i64) -> Option<Kind>, R: Fn(i64) -> bool> Row<K, R> {
    fn is_bridge(&self, x: i64) -> bool {
        (self.kind_at)(x) == Some(Kind::Lobby) && !(self.rests)(x)
    }

    fn is_anchor(&self, x: i64) -> bool {
        (self.kind_at)(x) == Some(Kind::Lobby) && (self.rests)(x)
    }

    /// The column past the bridge tiles next to `x` in direction `step`.
    fn past_bridge(&self, x: i64, step: i64) -> i64 {
        let mut c = x + step;
        while self.is_bridge(c) {
            c += step;
        }
        c
    }

    /// The nearest wing lobby from `x` in direction `step` across bridge
    /// tiles and open air, or why there is none. It looks no farther than
    /// twice a bridge's span, far enough to tell a gap too wide from one
    /// with no lobby across, so a check costs at most that many tiles.
    fn far_anchor(&self, x: i64, step: i64) -> Result<i64, &'static str> {
        let mut c = x + step;
        while (0..LOT_WIDTH).contains(&c) {
            if (c - x).abs() > 2 * SKYBRIDGE_MAX_SPAN {
                return Err(REACHES_A_LOBBY);
            }
            match (self.kind_at)(c) {
                None => {}
                Some(_) if self.is_bridge(c) => {}
                Some(_) if self.is_anchor(c) => return Ok(c),
                Some(_) => return Err(REACHES_A_LOBBY),
            }
            c += step;
        }
        Err(REACHES_A_LOBBY)
    }

    /// Why a bridge tile can't stand at column `x`, or `None`: it hangs
    /// from a wing lobby through the tiles beside it, and the gap it is in
    /// has a wing lobby on each side within [`SKYBRIDGE_MAX_SPAN`] tiles.
    pub fn fault(&self, x: i64) -> Option<&'static str> {
        let hangs = |step: i64| self.is_anchor(self.past_bridge(x, step));
        if !hangs(-1) && !hangs(1) {
            return Some(STARTS_AT_A_LOBBY);
        }
        let left = match self.far_anchor(x, -1) {
            Ok(c) => c,
            Err(r) => return Some(r),
        };
        let right = match self.far_anchor(x, 1) {
            Ok(c) => c,
            Err(r) => return Some(r),
        };
        (right - left - 1 > SKYBRIDGE_MAX_SPAN).then_some(SPAN_TOO_LONG)
    }

    /// Whether selling the bridge tile at `x` leaves a piece of bridge
    /// beside it hanging from nothing.
    pub fn leaves_a_piece_hanging(&self, x: i64) -> bool {
        [-1, 1].into_iter().any(|step| {
            let end = self.past_bridge(x, step);
            end != x + step && !self.is_anchor(end)
        })
    }
}

impl Tower {
    /// The tiles of `floor` as a bridge sees them in this tower.
    fn bridge_row(
        &self,
        floor: i64,
    ) -> Row<impl Fn(i64) -> Option<Kind> + '_, impl Fn(i64) -> bool + '_> {
        Row {
            kind_at: move |x| self.struct_kind.get(&(floor, x)).copied(),
            rests: move |x| self.structure.contains_key(&(floor - 1, x)),
        }
    }

    /// Whether `floor` is one a sky bridge may cross in this tower's mode.
    pub(crate) fn bridges_floor(&self, floor: i64) -> bool {
        floor >= 2 && is_sky_lobby_floor(floor) && self.mode.builds_skybridges()
    }

    /// Whether the tile at (`floor`, `x`) is a sky bridge tile: a lobby
    /// tile with no story under it.
    pub fn is_skybridge_tile(&self, floor: i64, x: i64) -> bool {
        self.bridges_floor(floor) && self.bridge_row(floor).is_bridge(x)
    }

    /// Whether a lobby tile laid at (`floor`, `x`) now would be a bridge
    /// tile: a floor a bridge may cross, with no story under the column.
    pub(crate) fn lays_skybridge_at(&self, floor: i64, x: i64) -> bool {
        self.bridges_floor(floor) && !self.structure.contains_key(&(floor - 1, x))
    }

    /// Whether any of the `w` tiles from `x` on `floor` is a bridge tile.
    pub(crate) fn span_has_skybridge(&self, floor: i64, x: i64, w: i64) -> bool {
        (x..x + w).any(|c| self.is_skybridge_tile(floor, c))
    }

    /// Why a lobby tile can't go over open air at (`floor`, `x`) as a sky
    /// bridge, or `None` when it can. Only asked for a lobby tile with no
    /// story under it on a floor a bridge may cross.
    pub(crate) fn skybridge_reason(&self, floor: i64, x: i64, w: i64) -> Option<&'static str> {
        let row = self.bridge_row(floor);
        (x..x + w).find_map(|c| row.fault(c))
    }

    /// Why the bulldozer leaves floor or lobby tile `u` for a bridge's sake,
    /// or `None`.
    pub(crate) fn skybridge_removal_reason(&self, u: &Unit) -> Option<&'static str> {
        if u.kind != Kind::Lobby || !self.bridges_floor(u.floor) {
            return None;
        }
        let row = self.bridge_row(u.floor);
        let tiles = u.x..u.x + u.width;
        if tiles.clone().any(|c| row.is_bridge(c)) {
            return tiles
                .clone()
                .any(|c| row.leaves_a_piece_hanging(c))
                .then_some(PIECE_WOULD_FALL);
        }
        let beside = [u.x - 1, u.x + u.width];
        beside
            .into_iter()
            .any(|c| row.is_bridge(c))
            .then_some(BRIDGE_HANGS_HERE)
    }
}

#[cfg(test)]
#[path = "skybridge_tests.rs"]
mod tests;
