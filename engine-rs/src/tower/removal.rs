//! Why the bulldozer leaves a floor or lobby tile standing, and what a sold
//! tile refunds.
//!
//! A lobby tile stays for good in Classic, as in the 1994 game. Modern lets
//! the bulldozer take a sky lobby tile, a tall hall's included, under the
//! rules a floor tile keeps to; the ground lobby, the tower's front door,
//! stays in both modes (party findings
//! `_bmad-output/party-mode/modern-lobby-bulldoze-party-findings-2026-11-14.md`).

use super::{Tower, Unit};
use crate::facilities::Kind;

/// The floor the ground lobby stands on.
const GROUND_FLOOR: i64 = 1;

/// The Classic refusal for any lobby tile.
pub(crate) const LOBBY_PERMANENT: &str =
    "Lobby tiles are permanent. The 1994 game does not let you remove them.";

/// The refusal for a ground lobby tile in a mode that sells sky lobby tiles.
pub(crate) const GROUND_LOBBY_STAYS: &str =
    "The ground lobby is the tower's front door, so it stays.";

/// The refusal for a tile whose story above still stands on it.
pub(crate) const STORY_ABOVE_STANDS: &str =
    "Remove the story above first. Floors can't hang in midair.";

/// The refusal for a tile a shaft would be left hanging without.
pub(crate) const SHAFT_STANDS_HERE: &str =
    "An elevator, stairway or escalator needs this tile. Remove it first.";

impl Tower {
    /// `removalReason`: why a structure tile cannot be sold. A lobby tile
    /// stays unless the mode sells lobby tiles
    /// ([`GameMode::removes_lobby_tiles`](crate::clock::GameMode::removes_lobby_tiles)),
    /// and the ground lobby always stays. A tile, a tall hall's every story
    /// with it, comes out only with nothing on the story over it and no
    /// shaft left without floor in its column. In Classic that includes a
    /// floor tile with floor on both sides
    /// ([`GameMode::removes_mid_floor_tiles`](crate::clock::GameMode::removes_mid_floor_tiles)).
    pub fn removal_reason(&self, id: i64) -> Option<&'static str> {
        let u = self.get_unit(id)?;
        if !u.kind.is_structural() {
            return None;
        }
        if u.kind == Kind::Lobby && !self.mode.removes_lobby_tiles() {
            return Some(LOBBY_PERMANENT);
        }
        if u.kind == Kind::Lobby && u.floor == GROUND_FLOOR {
            return Some(GROUND_LOBBY_STAYS);
        }
        let stories = self.unit_stories(u);
        if u.floor >= GROUND_FLOOR && !self.structure_span_free(u.floor + stories, u.x, u.width) {
            return Some(STORY_ABOVE_STANDS);
        }
        if self.leaves_a_shaft_hanging(u, stories) {
            return Some(SHAFT_STANDS_HERE);
        }
        if !self.mode.removes_mid_floor_tiles() && self.floor_on_both_sides(u.floor, u.x, u.width) {
            return Some(super::MID_FLOOR_GAP);
        }
        None
    }

    /// Whether lobby tile `u` stays for good, whatever stands around it: in
    /// a mode that keeps every lobby, or on the ground floor. Undo's advice
    /// to sell a build instead reads it, so the two cannot disagree.
    pub(crate) fn lobby_stays(&self, u: &Unit) -> bool {
        u.kind == Kind::Lobby && (!self.mode.removes_lobby_tiles() || u.floor == GROUND_FLOOR)
    }

    /// Whether taking out structure tile `u`, `stories` high, leaves some
    /// shaft spanning one of those stories with no floor or lobby in its
    /// column there, which every shaft needs on each story it spans
    /// (`Tower::shaft_has_structure_at`). One pass over the shafts, an edit's
    /// cost, never a step's.
    fn leaves_a_shaft_hanging(&self, u: &Unit, stories: i64) -> bool {
        let (left, right) = (u.x, u.x + u.width);
        let (low, high) = (u.floor, u.floor + stories - 1);
        self.transports
            .iter()
            .filter(|t| t.x < right && left < t.x + t.width)
            .any(|t| {
                (low.max(t.bottom)..=high.min(t.top)).any(|f| {
                    !(t.x..t.x + t.width).any(|x| {
                        !(left..right).contains(&x) && self.structure.contains_key(&(f, x))
                    })
                })
            })
    }

    /// What selling unit `u` refunds when nothing gutted it: half its
    /// kind's price, once for each story a tall lobby tile was paid for. A
    /// room of several stories was priced once, so it refunds once.
    pub(crate) fn sale_refund(&self, u: &Unit) -> f64 {
        let paid_stories = if u.kind == Kind::Lobby {
            self.unit_stories(u)
        } else {
            1
        };
        u.kind.resale_refund() * paid_stories as f64
    }
}

#[cfg(test)]
#[path = "removal_tests.rs"]
mod tests;
