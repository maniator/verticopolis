//! Tall lobbies (#308): a lobby one, two or three stories high.
//!
//! A tall lobby is the lobby units on its floor, each covering the stories
//! above it as well: the tower's structure index holds the lobby on every
//! story it covers, so nothing else can be built there, the story above it
//! stands on it, and like any lobby it can never be removed. Only its own
//! floor counts as a lobby floor (`lobby_tiles`). The stories it rises
//! through are no stop: a shaft may pass through them but never stops or
//! ends there, as in the original, where the shaft shows no floor number
//! on them.
//!
//! A floor's height is set by its first lobby placement, from the height
//! asked for while [`crate::sim::Simulation::with_lobby_height`] runs, and
//! never changes after: every later section on that floor is built at it.
//! Which floors may rise is a mode rule, `GameMode::raises_lobby_on`.

use super::{Tower, Transport, Unit};
use crate::facilities::*;

impl Tower {
    /// How many stories `u` covers: a lobby rises to its floor's height,
    /// every other unit to its kind's.
    pub(crate) fn unit_stories(&self, u: &Unit) -> i64 {
        if u.kind == Kind::Lobby {
            self.lobby_heights.get(&u.floor).copied().unwrap_or(1)
        } else {
            u.kind.floors()
        }
    }

    /// The height in stories of the lobby on `floor`: 1 for a one-story
    /// lobby and for a floor with no lobby.
    pub fn lobby_height(&self, floor: i64) -> i64 {
        if !self.floor_has_lobby(floor) {
            return 1;
        }
        self.lobby_heights.get(&floor).copied().unwrap_or(1)
    }

    /// The floor of the tall lobby that rises through `story`, when one
    /// does. The lobby's own floor is not one of the stories it rises
    /// through.
    pub fn tall_lobby_below(&self, story: i64) -> Option<i64> {
        (1..MAX_LOBBY_HEIGHT)
            .find(|&rise| self.lobby_height(story.saturating_sub(rise)) > rise)
            .map(|rise| story - rise)
    }

    /// Whether `story` is inside a tall lobby, above its floor: nothing is
    /// built there and no shaft stops there.
    pub fn is_tall_lobby_story(&self, story: i64) -> bool {
        self.tall_lobby_below(story).is_some()
    }

    /// Every lobby taller than one story, as `(floor, height)`, by floor.
    pub fn tall_lobbies(&self) -> Vec<(i64, i64)> {
        self.lobby_heights
            .iter()
            .filter(|&(&floor, &height)| height > 1 && self.floor_has_lobby(floor))
            .map(|(&floor, &height)| (floor, height))
            .collect()
    }

    /// The height a lobby tile laid on `floor` now gets: the floor's own
    /// height once it holds a lobby, so it never changes; otherwise the
    /// height asked for, where the mode lets this floor's lobby rise.
    pub(crate) fn placement_lobby_height(&self, floor: i64) -> i64 {
        if self.floor_has_lobby(floor) {
            self.lobby_height(floor)
        } else if self.mode.raises_lobby_on(floor) {
            self.requested_lobby_height.clamp(1, MAX_LOBBY_HEIGHT)
        } else {
            1
        }
    }

    /// Why a lobby `w` tiles wide at `(floor, x)` cannot rise to the height
    /// it would be built at, or `None` when it can (or stays one story).
    /// The first placement on a floor needs every story it rises through
    /// empty, since the whole story becomes part of the lobby; a later one
    /// needs only the tiles it covers.
    pub(crate) fn tall_lobby_reason(&self, floor: i64, x: i64, w: i64) -> Option<String> {
        let height = self.placement_lobby_height(floor);
        if height <= 1 {
            return None;
        }
        let first = !self.floor_has_lobby(floor);
        for story in floor + 1..floor + height {
            if story > self.lot().top_floor() {
                return Some(format!(
                    "A {height}-story lobby needs {height} stories here, and the lot ends at floor {}.",
                    self.lot().top_floor()
                ));
            }
            let blocked = if first {
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

    /// The refusal for building anything on `story` when a tall lobby
    /// rises through it.
    pub(super) fn tall_lobby_story_reason(&self, story: i64) -> Option<String> {
        let lobby = self.tall_lobby_below(story)?;
        Some(format!(
            "Floor {story} is part of the tall lobby on floor {lobby}. Build above the lobby instead."
        ))
    }

    /// The tall-lobby refusal for a structural tile of `kind`, `w` wide at
    /// `(floor, x)`: none goes on a story a tall lobby rises through, and a
    /// lobby needs room for the stories it rises through itself.
    pub(super) fn tall_lobby_structure_reason(
        &self,
        kind: Kind,
        floor: i64,
        x: i64,
        w: i64,
    ) -> Option<String> {
        self.tall_lobby_story_reason(floor).or_else(|| {
            (kind == Kind::Lobby)
                .then(|| self.tall_lobby_reason(floor, x, w))
                .flatten()
        })
    }

    /// Sets the height of the lobby about to be laid on `floor`, before its
    /// first tile is registered, so every tile on the floor covers the same
    /// stories. Only a floor with no lobby yet takes a new height.
    pub(crate) fn begin_lobby_floor(&mut self, floor: i64) {
        if self.floor_has_lobby(floor) {
            return;
        }
        let height = self.placement_lobby_height(floor);
        if height > 1 {
            self.lobby_heights.insert(floor, height);
        } else {
            self.lobby_heights.remove(&floor);
        }
    }

    /// Whether any tile of `story` holds structure. One lookup per column,
    /// so only a floor's first lobby placement asks.
    fn story_has_structure(&self, story: i64) -> bool {
        (0..LOT_WIDTH).any(|x| self.structure.contains_key(&(story, x)))
    }

    /// Why shaft ends at `bottom` and `top` cannot be, or `None`: no shaft
    /// stops inside a tall lobby, so none ends there either.
    pub(crate) fn tall_lobby_shaft_reason(&self, bottom: i64, top: i64) -> Option<String> {
        let inside = [bottom, top]
            .into_iter()
            .find(|&end| self.is_tall_lobby_story(end))?;
        let floor = self.tall_lobby_below(inside).unwrap_or(1);
        Some(format!(
            "Floor {inside} is inside the {}-story lobby on floor {floor}. A shaft can pass through it but can't stop there.",
            self.lobby_height(floor)
        ))
    }

    /// The top a flight of stairs or an escalator from `bottom` to `top`
    /// gets: a one-story flight out of a tall lobby climbs the whole lobby,
    /// to the floor above it, as the original's tall flights do (its
    /// two- and three-story stair types). Any other span stays as asked.
    pub fn walkway_top(&self, kind: Kind, bottom: i64, top: i64) -> i64 {
        let height = self.lobby_height(bottom);
        if kind.is_fixed_span() && top == bottom + 1 && height > 1 {
            bottom + height
        } else {
            top
        }
    }

    /// The stories inside a tall lobby strictly between `t`'s ends, which
    /// it passes without stopping.
    pub(crate) fn tall_lobby_stories_in(&self, t: &Transport) -> Vec<i64> {
        // Walks the tall lobbies, a few at most, never the shaft's span.
        let tall = self.tall_lobbies().into_iter();
        tall.flat_map(|(floor, height)| floor + 1..floor + height)
            .filter(|&story| t.bottom < story && story < t.top)
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

    /// Takes a loaded save's `lobbyHeights` (`[[floor, height], ...]`)
    /// before the tower is indexed. An entry is kept only where this tower
    /// could have built it: a floor the mode lets rise that holds a lobby, a
    /// whole height from 2 to [`MAX_LOBBY_HEIGHT`], and every story it rises
    /// through on the lot, with no unit on it and no shaft ending there.
    /// Anything else loads as a one-story lobby, so a hand-edited save can
    /// never stack the lobby onto another unit.
    pub(crate) fn adopt_lobby_heights(&mut self, raw: Option<&serde_json::Value>) {
        self.lobby_heights.clear();
        let Some(entries) = raw.and_then(serde_json::Value::as_array) else {
            return;
        };
        for entry in entries {
            let whole = |i: usize| {
                let v = entry.get(i)?.as_f64()?;
                (v.fract() == 0.0 && v.abs() < 1e9).then_some(v as i64)
            };
            let (Some(floor), Some(height)) = (whole(0), whole(1)) else {
                continue;
            };
            if (2..=MAX_LOBBY_HEIGHT).contains(&height)
                && !self.lobby_heights.contains_key(&floor)
                && self.loaded_lobby_fits(floor, height)
            {
                self.lobby_heights.insert(floor, height);
            }
        }
    }

    /// Whether the units and shafts as loaded leave room for a lobby on
    /// `floor` `height` stories high. One pass over the units.
    fn loaded_lobby_fits(&self, floor: i64, height: i64) -> bool {
        let rises = floor + 1..floor + height;
        self.mode.raises_lobby_on(floor)
            && floor + height - 1 <= self.lot().top_floor()
            && self
                .units
                .iter()
                .any(|u| u.kind == Kind::Lobby && u.floor == floor)
            && !self.units.iter().any(|u| {
                let top = u.floor + u.kind.floors() - 1;
                u.floor < rises.end && top >= rises.start
            })
            && !self
                .transports
                .iter()
                .any(|t| rises.contains(&t.bottom) || rises.contains(&t.top))
    }

    /// Re-asserts on load that no shaft stops inside a tall lobby.
    pub(crate) fn coerce_tall_lobby_stops(&mut self) {
        if self.lobby_heights.is_empty() {
            return;
        }
        let ids: Vec<i64> = self.transports.iter().map(|t| t.id).collect();
        let mut changed = false;
        for id in ids {
            changed |= self.skip_tall_lobby_stories(id);
        }
        if changed {
            self.revision += 1;
        }
    }
}

#[cfg(test)]
#[path = "tall_lobby_tests.rs"]
mod tests;
