//! Sky bridges (Modern): a row of lobby tiles laid over open air on a sky
//! lobby floor, from one wing's sky lobby to another's. The tiles are plain
//! lobby tiles, so a finished bridge joins the two wings' floors into one
//! walkable floor and routing needs nothing new. What makes a tile a bridge
//! tile is only where it stands: a lobby tile with no story under it.
//!
//! A bridge goes in whole, with the Sky Bridge tool (party, 2026-11-16): one
//! click on the open air between two sky lobbies lays every tile of the gap
//! ([`Tower::skybridge_span`], `Simulation::build_skybridge`), and the Lobby
//! tool lays no tile over open air ([`LOBBY_OVER_OPEN_AIR`]). The gap needs a
//! sky lobby on each side within [`SKYBRIDGE_MAX_SPAN`] tiles, so a bridge
//! never juts into the sky. A half bridge from a save made before the tool
//! loads as it was, and the tool finishes it, laying only its missing tiles.
//!
//! A bridge carries nothing: no story stands on it and no shaft lands on
//! it. A bridge is one story high, beside a tall lobby hall too. The
//! bulldozer takes a bridge whole, every tile from wing to wing (or to a half
//! bridge's open end), so it never cuts one in two, and only while nobody is
//! crossing it (`Simulation::remove_skybridge`); it leaves a wing's lobby
//! tile standing while a bridge hangs from it. Classic has no bridges, as in
//! 1994 (`GameMode::builds_skybridges`).

use super::{Tower, Unit};
use crate::facilities::{is_sky_lobby_floor, Kind, LOT_WIDTH};

/// The most tiles of open air one bridge spans, wall to wall.
pub const SKYBRIDGE_MAX_SPAN: i64 = 24;

/// The star rating the Sky Bridge tool opens at, the Express Elevator's
/// (party, 2026-11-16): a bridge between sky lobbies pays off once
/// expresses carry people up to them.
pub const SKYBRIDGE_MIN_STAR: i64 = 3;

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

/// The Lobby tool's refusal for a tile over open air on a floor a bridge
/// may cross: only the Sky Bridge tool lays one, and it lays the gap whole.
pub(crate) const LOBBY_OVER_OPEN_AIR: &str =
    "A lobby can't hang over open air. To join two sky lobbies, use the Sky Bridge tool.";

/// The Sky Bridge tool's refusal off the open air between two wings.
pub(crate) const POINT_AT_THE_GAP: &str =
    "A sky bridge crosses open air. Point at the gap between two sky lobbies.";

/// The Sky Bridge tool's refusal on a floor no bridge may cross.
pub(crate) const NOT_A_SKY_LOBBY_FLOOR: &str =
    "A sky bridge goes on a sky lobby floor (15, 30, 45…).";

/// The Sky Bridge tool's refusal over a finished bridge.
pub(crate) const ALREADY_BRIDGED: &str = "This sky bridge is already finished.";

/// How a placement treats a lobby tile over open air on a floor a bridge
/// may cross.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum OverAir {
    /// The Lobby tool: refused with [`LOBBY_OVER_OPEN_AIR`].
    Refuse,
    /// The Sky Bridge tool, laying a gap [`Tower::skybridge_span`] checked.
    Bridge,
}

/// The bridge one click of the Sky Bridge tool lays.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkybridgeSpan {
    /// The gap's columns, from the tile after one wing's sky lobby to the
    /// tile before the other's.
    pub cols: std::ops::Range<i64>,
    /// The columns in the gap with no tile yet, left to right: the whole gap
    /// for a new bridge, the missing part of a half bridge.
    pub missing: Vec<i64>,
}

/// The refusal for a story laid right under a sky bridge: a bridge keeps
/// open air below it, so floors or a room built up to one never cut it in
/// two, and its look's underside has room to hang.
pub(crate) const UNDER_A_BRIDGE: &str =
    "A sky bridge needs open air under it. Bulldoze the bridge first to build up to it.";

/// The refusal for selling a wing's lobby tile that a bridge hangs from.
pub(crate) const BRIDGE_HANGS_HERE: &str =
    "A sky bridge hangs from this lobby. Bulldoze the bridge first.";

/// The refusal for bulldozing a bridge while people walk on it.
pub(crate) const PEOPLE_CROSSING: &str =
    "People are crossing this sky bridge. Bulldoze it once they are across.";

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

    /// The columns of the bridge that the bridge tiles in `cols` belong to,
    /// from the tile after one wing to the tile before the other wing (or
    /// the open end), or `None` when no column in `cols` is a bridge tile.
    pub fn bridge_around(&self, cols: std::ops::Range<i64>) -> Option<std::ops::Range<i64>> {
        let first = cols.clone().find(|&c| self.is_bridge(c))?;
        let last = cols.rev().find(|&c| self.is_bridge(c))?;
        Some(self.past_bridge(first, -1) + 1..self.past_bridge(last, 1))
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

    /// The bridge the Sky Bridge tool lays for a click at (`floor`, `x`),
    /// or why it lays none: `x` must be open air, or a half bridge's tile,
    /// on a floor a bridge may cross, in a gap with a wing's sky lobby on
    /// each side within [`SKYBRIDGE_MAX_SPAN`] tiles. It looks at most twice
    /// that span each way, as a tile's own check does.
    pub fn skybridge_span(&self, floor: i64, x: i64) -> Result<SkybridgeSpan, &'static str> {
        if !self.bridges_floor(floor) || !self.lot().holds_floor(floor) {
            return Err(NOT_A_SKY_LOBBY_FLOOR);
        }
        let row = self.bridge_row(floor);
        let open = (row.kind_at)(x).is_none() && !(row.rests)(x);
        if !(0..LOT_WIDTH).contains(&x) || !(open || row.is_bridge(x)) {
            return Err(POINT_AT_THE_GAP);
        }
        let left = row.far_anchor(x, -1)?;
        let right = row.far_anchor(x, 1)?;
        if right - left - 1 > SKYBRIDGE_MAX_SPAN {
            return Err(SPAN_TOO_LONG);
        }
        let cols = left + 1..right;
        let missing: Vec<i64> = cols
            .clone()
            .filter(|&c| (row.kind_at)(c).is_none())
            .collect();
        if missing.is_empty() {
            return Err(ALREADY_BRIDGED);
        }
        Ok(SkybridgeSpan { cols, missing })
    }

    /// The columns of the whole bridge that lobby tile `u` is part of, or
    /// `None` when `u` is no bridge tile. The bulldozer takes them together.
    pub(crate) fn skybridge_of(&self, u: &Unit) -> Option<std::ops::Range<i64>> {
        if u.kind != Kind::Lobby || !self.bridges_floor(u.floor) {
            return None;
        }
        self.bridge_row(u.floor).bridge_around(u.x..u.x + u.width)
    }

    /// Whether the bridge on `cols` of `floor` reaches a wing's sky lobby
    /// at each end, as a finished bridge does; a half bridge has an open end.
    pub(crate) fn skybridge_finished(&self, floor: i64, cols: &std::ops::Range<i64>) -> bool {
        let row = self.bridge_row(floor);
        row.is_anchor(cols.start - 1) && row.is_anchor(cols.end)
    }

    /// The ids of the units on `cols` of `floor`, each once, left to right.
    pub(crate) fn units_on(&self, floor: i64, cols: std::ops::Range<i64>) -> Vec<i64> {
        let mut ids: Vec<i64> = Vec::new();
        for id in cols.filter_map(|c| self.unit_at(floor, c).map(|u| u.id)) {
            if ids.last() != Some(&id) {
                ids.push(id);
            }
        }
        ids
    }

    /// Why the bulldozer leaves lobby tile `u` for a bridge's sake, or
    /// `None`. A bridge tile is no reason: the bulldozer takes its bridge
    /// whole, which leaves no piece hanging.
    pub(crate) fn skybridge_removal_reason(&self, u: &Unit) -> Option<&'static str> {
        if u.kind != Kind::Lobby || !self.bridges_floor(u.floor) {
            return None;
        }
        let row = self.bridge_row(u.floor);
        if (u.x..u.x + u.width).any(|c| row.is_bridge(c)) {
            return None;
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
