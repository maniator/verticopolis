//! Tall lobbies (#308): a lobby one, two or three stories high.
//!
//! A tall lobby is lobby units each covering the stories above their floor
//! as well: the tower's structure index holds the lobby on every story it
//! covers, so nothing else can be built there, the story above it stands on
//! it, and like any lobby it stays unless Modern's bulldozer takes a sky
//! hall's tile (`Tower::removal_reason`). Only its own floor counts
//! as a lobby floor (`lobby_tiles`), though the distance to a lobby counts
//! from every story the hall fills (`nearest_lobby_floor_distance`), so the
//! floor over a tall hall is next to it. The stories it rises through are no
//! stop: a shaft may pass through them but never stops or ends there, as in
//! the original, where the shaft shows no floor number on them.
//!
//! Each lobby unit carries its own height (`Extras::lobby_stories`), set when
//! it is laid and never changed after. How a tile's height is chosen is a
//! mode rule, `GameMode::lobby_height_per_hall`:
//!
//! - Classic keeps one height per floor. The floor's first lobby takes the
//!   height asked for while [`crate::sim::Simulation::with_lobby_height`]
//!   runs, every later tile takes the same, and the stories it rises through
//!   are claimed across the whole lot, as the `.TDT` header describes.
//! - Modern keeps one height per hall (#2068), a hall being a row of lobby
//!   tiles of one height. A tile laid against a hall takes that hall's
//!   height (the hall on its left first, so a tile that closes a gap between
//!   two heights joins the left one); a tile on its own takes the height
//!   asked for. A tall hall claims only the stories over its own tiles, and
//!   halls of different heights sit side by side, with a wall and a
//!   revolving door between them that only the frontend draws.
//!
//! Which floors may rise at all is `GameMode::raises_lobby_on`.

use super::{Tower, Transport, Unit};
use crate::facilities::*;

impl Tower {
    /// How many stories `u` covers: a lobby rises to its own height, every
    /// other unit to its kind's.
    pub(crate) fn unit_stories(&self, u: &Unit) -> i64 {
        if u.kind == Kind::Lobby {
            u.extras().lobby_stories.map_or(1, i64::from)
        } else {
            u.kind.floors()
        }
    }

    /// The height in stories of the tallest lobby hall on `floor`: 1 for a
    /// one-story lobby and for a floor with no lobby. In Classic every hall
    /// on a floor has this height.
    pub fn lobby_height(&self, floor: i64) -> i64 {
        if !self.floor_has_lobby(floor) {
            return 1;
        }
        (2..=MAX_LOBBY_HEIGHT)
            .rev()
            .find(|&h| self.tall_lobby_tiles.contains_key(&(floor, h)))
            .unwrap_or(1)
    }

    /// The lobby unit laid on `floor` itself at column `x`, if any: not one
    /// rising through `floor` from below. One index lookup.
    pub(crate) fn hall_at(&self, floor: i64, x: i64) -> Option<&Unit> {
        let id = self.structure.get(&(floor, x))?;
        let u = self.get_unit(*id)?;
        (u.kind == Kind::Lobby && u.floor == floor).then_some(u)
    }

    /// The height in stories of the lobby hall at `(floor, x)`: 1 where no
    /// lobby is laid on that floor at that column.
    pub fn lobby_height_at(&self, floor: i64, x: i64) -> i64 {
        self.hall_at(floor, x).map_or(1, |u| self.unit_stories(u))
    }

    /// The floor of the tall lobby that rises through some part of `story`,
    /// when one does. The lobby's own floor is not one of the stories it
    /// rises through.
    pub fn tall_lobby_below(&self, story: i64) -> Option<i64> {
        (1..MAX_LOBBY_HEIGHT)
            .find(|&rise| self.lobby_height(story.saturating_sub(rise)) > rise)
            .map(|rise| story - rise)
    }

    /// Whether some part of `story` is inside a tall lobby, above its floor.
    pub fn is_tall_lobby_story(&self, story: i64) -> bool {
        self.tall_lobby_below(story).is_some()
    }

    /// The tall lobby that claims `story` over the columns `x..x + w`, as
    /// `(its floor, its height)`, or `None` where nothing claims it. In
    /// Classic a tall lobby claims every story it rises through across the
    /// lot; in Modern a hall claims only the tiles over its own (#2068),
    /// which the structure index holds, so this is a lookup per column.
    pub(crate) fn raised_lobby_at(&self, story: i64, x: i64, w: i64) -> Option<(i64, i64)> {
        if !self.mode.lobby_height_per_hall() {
            let floor = self.tall_lobby_below(story)?;
            return Some((floor, self.lobby_height(floor)));
        }
        (x..x.saturating_add(w)).find_map(|col| {
            let u = self.get_unit(*self.structure.get(&(story, col))?)?;
            (u.kind == Kind::Lobby && u.floor < story).then(|| (u.floor, self.unit_stories(u)))
        })
    }

    /// Every floor with a lobby taller than one story, as `(floor, height)`
    /// with its tallest hall's height, by floor. Reads the tile counts, a few
    /// entries at most.
    pub fn tall_lobbies(&self) -> Vec<(i64, i64)> {
        let mut out: Vec<(i64, i64)> = Vec::new();
        for &(floor, height) in self.tall_lobby_tiles.keys() {
            match out.last_mut() {
                Some(last) if last.0 == floor => last.1 = last.1.max(height),
                _ => out.push((floor, height)),
            }
        }
        out
    }

    /// The height a lobby tile laid on `floor` now gets: the floor's own
    /// height once it holds a lobby, so it never changes; otherwise the
    /// height asked for, where the mode lets this floor's lobby rise. The
    /// Classic rule, and the rule for a floor as a whole; a tile's own
    /// height is [`Self::placement_lobby_height_at`].
    pub(crate) fn placement_lobby_height(&self, floor: i64) -> i64 {
        if self.floor_has_lobby(floor) {
            self.lobby_height(floor)
        } else if self.mode.raises_lobby_on(floor) {
            self.requested_lobby_height.clamp(1, MAX_LOBBY_HEIGHT)
        } else {
            1
        }
    }

    /// The height a lobby `w` tiles wide laid at `(floor, x)` gets. In
    /// Classic, the floor's ([`Self::placement_lobby_height`]). In Modern,
    /// the height of the hall it is laid against, the left one first, or
    /// the height asked for when it stands on its own (#2068).
    pub(crate) fn placement_lobby_height_at(&self, floor: i64, x: i64, w: i64) -> i64 {
        if !self.mode.lobby_height_per_hall() {
            return self.placement_lobby_height(floor);
        }
        if !self.mode.raises_lobby_on(floor) {
            return 1;
        }
        let beside = |col: i64| self.hall_at(floor, col).map(|u| self.unit_stories(u));
        beside(x - 1)
            .or_else(|| beside(x.saturating_add(w)))
            .unwrap_or_else(|| self.requested_lobby_height.clamp(1, MAX_LOBBY_HEIGHT))
    }

    /// Why a lobby `w` tiles wide at `(floor, x)` cannot rise to the height
    /// it would be built at, or `None` when it can (or stays one story).
    /// A Classic floor's first lobby needs every story it rises through
    /// empty, since the whole story becomes part of the lobby; any other
    /// tile needs only the tiles over its own.
    pub(crate) fn tall_lobby_reason(&self, floor: i64, x: i64, w: i64) -> Option<String> {
        if let Some(reason) = self.lobby_cannot_rise_reason(floor) {
            return Some(reason);
        }
        let height = self.placement_lobby_height_at(floor, x, w);
        if height <= 1 {
            return None;
        }
        let whole_story = !self.mode.lobby_height_per_hall() && !self.floor_has_lobby(floor);
        for story in floor + 1..floor + height {
            if story > self.lot().top_floor() {
                return Some(format!(
                    "A {height}-story lobby needs {height} stories here, and the lot ends at floor {}.",
                    self.lot().top_floor()
                ));
            }
            let blocked = if whole_story {
                self.story_has_structure(story)
            } else {
                !self.structure_span_free(story, x, w) || !self.room_span_free(story, x, w)
            };
            if blocked {
                return Some(format!(
                    "A {height}-story lobby rises through floor {story}. Clear floor {story} first."
                ));
            }
        }
        None
    }

    /// Why a floor's first lobby, asked to rise, cannot be laid here: the
    /// mode keeps this floor's lobby one story. Refused rather than laid one
    /// story high, since a Classic lobby is never removed and the player asked
    /// for a taller one. `None` once the floor holds a lobby (every later
    /// tile takes its height) or when the height asked is one story.
    fn lobby_cannot_rise_reason(&self, floor: i64) -> Option<String> {
        if self.requested_lobby_height <= 1
            || self.floor_has_lobby(floor)
            || self.mode.raises_lobby_on(floor)
        {
            return None;
        }
        let which = if self.mode.raises_sky_lobbies() {
            "Only the ground lobby and sky lobbies can be taller than one story."
        } else {
            "In Classic, only the ground lobby can be taller than one story."
        };
        Some(format!(
            "{which} Pick 1 story to build a lobby on floor {floor}."
        ))
    }

    /// The refusal for building over the columns `x..x + w` of `story` when
    /// a tall lobby claims them.
    pub(super) fn tall_lobby_story_reason(&self, story: i64, x: i64, w: i64) -> Option<String> {
        let (lobby, _) = self.raised_lobby_at(story, x, w)?;
        Some(format!(
            "Floor {story} is part of the tall lobby on floor {lobby}. Build above the lobby instead."
        ))
    }

    /// The tall-lobby refusal for a structural tile of `kind`, `w` wide at
    /// `(floor, x)`: a lobby needs room for the stories it rises through
    /// itself. A story a tall lobby claims is named earlier, with the
    /// structure already standing (`structure_taken_reason`).
    pub(super) fn tall_lobby_structure_reason(
        &self,
        kind: Kind,
        floor: i64,
        x: i64,
        w: i64,
    ) -> Option<String> {
        (kind == Kind::Lobby)
            .then(|| self.tall_lobby_reason(floor, x, w))
            .flatten()
    }

    /// The `Extras::lobby_stories` value a lobby `w` wide laid at
    /// `(floor, x)` now carries: unset for one story.
    pub(crate) fn placement_lobby_stories(&self, floor: i64, x: i64, w: i64) -> Option<u8> {
        let height = self.placement_lobby_height_at(floor, x, w);
        (height > 1).then(|| height.clamp(1, MAX_LOBBY_HEIGHT) as u8)
    }

    /// Whether any tile of `story` holds structure. The build preview asks on
    /// every pointer move, so it reads the revision-keyed structural tile
    /// index (one lookup) rather than probing each column. That index lists
    /// the structural units by their own floor, which is every structure a
    /// story above a floor's first lobby can hold: a tall lobby's raised
    /// story would make that floor a lobby story, refused before this runs.
    fn story_has_structure(&self, story: i64) -> bool {
        self.structural_tiles(story).is_some()
    }

    /// Why a shaft over the columns `x..x + w` with ends at `bottom` and
    /// `top` cannot be, or `None`: no shaft stops inside a tall lobby, so
    /// none ends there either.
    pub(crate) fn tall_lobby_shaft_reason(
        &self,
        x: i64,
        w: i64,
        bottom: i64,
        top: i64,
    ) -> Option<String> {
        let (inside, (floor, height)) = [bottom, top]
            .into_iter()
            .find_map(|end| Some((end, self.raised_lobby_at(end, x, w)?)))?;
        Some(format!(
            "Floor {inside} is inside the {height}-story lobby on floor {floor}. A shaft can pass through it but can't stop there."
        ))
    }

    /// How many stories the lobby under a flight `w` wide at `(floor, x)`
    /// rises: the floor's tallest in Classic, the tallest hall under the
    /// flight's columns in Modern.
    fn lobby_rise_under(&self, floor: i64, x: i64, w: i64) -> i64 {
        if !self.mode.lobby_height_per_hall() {
            return self.lobby_height(floor);
        }
        (x..x.saturating_add(w))
            .map(|col| self.lobby_height_at(floor, col))
            .max()
            .unwrap_or(1)
    }

    /// The top a flight of stairs or an escalator at `x` from `bottom` to
    /// `top` gets: a one-story flight out of a tall lobby climbs the whole
    /// lobby, to the floor above it, as the original's tall flights do (its
    /// two- and three-story stair types). Any other span stays as asked.
    pub fn walkway_top(&self, kind: Kind, x: i64, bottom: i64, top: i64) -> i64 {
        if !(kind.is_fixed_span() && top == bottom + 1) {
            return top;
        }
        let height = self.lobby_rise_under(bottom, x, kind.facility().width);
        if height > 1 {
            bottom + height
        } else {
            top
        }
    }

    /// The most floors a flight at `x` from `bottom` may span: a tall lobby
    /// under it lets it climb the whole lobby.
    pub(super) fn walkway_span_under(&self, kind: Kind, x: i64, bottom: i64) -> i64 {
        self.lobby_rise_under(bottom, x, kind.facility().width)
    }

    /// The stories inside a tall lobby strictly between `t`'s ends, which
    /// it passes without stopping.
    pub(crate) fn tall_lobby_stories_in(&self, t: &Transport) -> Vec<i64> {
        // Walks the tall lobbies, a few at most, never the shaft's span.
        let tall = self.tall_lobbies().into_iter();
        tall.flat_map(|(floor, height)| floor + 1..floor + height)
            .filter(|&story| t.bottom < story && story < t.top)
            .filter(|&story| self.raised_lobby_at(story, t.x, t.width).is_some())
            .collect()
    }

    /// Adds every tall-lobby story shaft `id` passes to its skip list, so
    /// it never stops there. Answers whether the list changed; a change is
    /// noted for the open undo gesture, and the caller bumps the revision.
    pub(crate) fn skip_tall_lobby_stories(&mut self, id: i64) -> bool {
        let Some(i) = self.transport_index(id) else {
            return false;
        };
        let skip = self.transports[i].skip_floors.as_deref().unwrap_or(&[]);
        let missing: Vec<f64> = self
            .tall_lobby_stories_in(&self.transports[i])
            .into_iter()
            .map(|story| story as f64)
            .filter(|story| !skip.contains(story))
            .collect();
        if missing.is_empty() {
            return false;
        }
        let Some(i) = self.transport_index_edit(id) else {
            return false;
        };
        let t = &mut self.transports[i];
        let mut skip = t.skip_floors.take().unwrap_or_default();
        skip.extend(missing);
        skip.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        t.skip_floors = Some(skip);
        true
    }

    /// After a tall lobby tile `w` wide is laid at `(floor, x)`, the shafts
    /// already passing over it skip the stories it now rises through. In
    /// Classic those shafts skipped them already. Answers whether a skip
    /// list changed.
    pub(crate) fn skip_over_new_hall(&mut self, floor: i64, x: i64, w: i64, height: i64) -> bool {
        let passing: Vec<i64> = self
            .transports
            .iter()
            .filter(|t| t.x < x + w && x < t.x + t.width)
            .filter(|t| t.bottom < floor + height && t.top > floor + 1)
            .map(|t| t.id)
            .collect();
        let mut changed = false;
        for id in passing {
            changed |= self.skip_tall_lobby_stories(id);
        }
        changed
    }
}

#[cfg(test)]
#[path = "tall_lobby_tests.rs"]
mod tests;
