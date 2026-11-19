//! A sky bridge's look (Modern; owner, 2026-11-16: "let the users choose").
//! The player picks one per bridge on the Sky Bridge tool. Every tile of a
//! bridge carries its look as the lobby tile's subtype, so the look saves
//! with the tile and needs no new save field: a save from before the looks
//! loads its bridges in the plain lobby look, and an older build drops the
//! subtype of a lobby tile and loads the bridge as it always drew it.

use super::Tower;
use crate::facilities::LOT_WIDTH;

/// The looks a bridge can wear, in the order the tool lists them. The first
/// is the plain lobby a bridge wore before the looks, stored as no subtype.
pub const SKYBRIDGE_LOOKS: [&str; 5] = [
    "Lobby",
    "Glass Skywalk",
    "Steel Truss",
    "Deco Arcade",
    "Garden Walk",
];

/// The look a new bridge wears unless the player picks another: the glass
/// skywalk the design roundtable picked (2026-11-16).
pub const NEW_SKYBRIDGE_LOOK: usize = 1;

/// The refusal for restyling anything but a bridge tile.
pub(crate) const POINT_AT_A_BRIDGE: &str = "Point at a sky bridge to change its look.";

/// The refusal for restyling a half bridge, which a click finishes instead.
pub(crate) const FINISH_THE_BRIDGE: &str =
    "Finish this sky bridge before changing its look: click it to lay the rest.";

/// The subtype a bridge tile of look `look` carries: none for the plain
/// lobby, the look's name otherwise. `None` for an index past the list.
pub(crate) fn look_subtype(look: usize) -> Option<Option<&'static str>> {
    match look {
        0 => Some(None),
        i => SKYBRIDGE_LOOKS.get(i).map(|name| Some(*name)),
    }
}

/// The look a lobby tile's saved subtype names, or `None` when it names no
/// look. The loader keeps a lobby tile's subtype only when it names one.
pub(crate) fn look_named(subtype: &str) -> Option<&'static str> {
    SKYBRIDGE_LOOKS[1..].iter().copied().find(|s| *s == subtype)
}

/// The index of the look a bridge tile's subtype names; 0 for none.
pub fn look_index(subtype: Option<&str>) -> usize {
    subtype
        .and_then(|s| SKYBRIDGE_LOOKS.iter().position(|l| *l == s))
        .unwrap_or(0)
}

/// A bridge as the renderer and the tool read it: its floor, its columns
/// (from the tile after one wing to the tile before the other, or the open
/// end) and its look's index in [`SKYBRIDGE_LOOKS`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkybridgeLook {
    pub floor: i64,
    pub cols: std::ops::Range<i64>,
    pub look: usize,
}

impl Tower {
    /// Every bridge in the tower with its look, by floor and then column.
    /// It reads only the sky lobby floors a bridge may cross, column by
    /// column across the lot, so its cost is that handful of floors times
    /// the lot's width however many rooms the tower holds; the caller reads
    /// it once per layout change. Every path dresses a whole bridge, so a run
    /// is one bridge; a run whose tiles disagree would split where the look
    /// changes rather than report one look for all of it.
    pub fn skybridge_looks(&self) -> Vec<SkybridgeLook> {
        let mut out: Vec<SkybridgeLook> = Vec::new();
        for floor in self.lobby_tiles.keys().copied() {
            if !self.bridges_floor(floor) {
                continue;
            }
            for x in 0..LOT_WIDTH {
                if !self.is_skybridge_tile(floor, x) {
                    continue;
                }
                let look = look_index(self.unit_at(floor, x).and_then(|u| u.subtype));
                match out.last_mut() {
                    Some(b) if b.floor == floor && b.cols.end == x && b.look == look => {
                        b.cols.end = x + 1
                    }
                    _ => out.push(SkybridgeLook {
                        floor,
                        cols: x..x + 1,
                        look,
                    }),
                }
            }
        }
        out
    }

    /// Give every tile of the bridge on `cols` of `floor` look `subtype`,
    /// and move the revision so the renderer draws it. Returns whether any
    /// tile changed.
    pub(crate) fn dress_skybridge(
        &mut self,
        floor: i64,
        cols: std::ops::Range<i64>,
        subtype: Option<&'static str>,
    ) -> bool {
        let mut changed = false;
        for id in self.units_on(floor, cols) {
            changed |= self.set_unit_subtype(id, subtype);
        }
        if changed {
            self.revision += 1;
        }
        changed
    }

    /// The columns of the bridge a tile at (`floor`, `x`) belongs to, or
    /// `None` when it is no bridge tile.
    pub(crate) fn skybridge_at(&self, floor: i64, x: i64) -> Option<std::ops::Range<i64>> {
        let u = self.unit_at(floor, x)?;
        if !self.is_skybridge_tile(floor, x) {
            return None;
        }
        self.skybridge_of(u)
    }
}
