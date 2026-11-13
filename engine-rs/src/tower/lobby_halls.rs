//! Lobby halls in the save (#308, #2068): the runs `lobbyHeights` lists,
//! and the loader that gives each lobby tile its height back.
//!
//! A save lists each hall taller than one story as `[floor, x0, x1,
//! height]`, `x1` being the hall's last column (version 9). A version 8
//! save, and a tower read from a `.TDT`, list a whole floor as `[floor,
//! height]`: every lobby tile on that floor takes the height, which is
//! version 8's migration to per-hall heights. In Classic every entry covers
//! its whole floor, since a Classic floor has one lobby height.

use std::sync::Arc;

use serde_json::Value;

use super::Tower;
use crate::facilities::*;

/// One lobby hall taller than one story: `[floor, x0, x1, height]`, where
/// `x1` is the hall's last column.
pub type HallRun = [i64; 4];

/// One `lobbyHeights` entry as a save writes it.
struct HeightEntry {
    floor: i64,
    /// The hall's first and last column, or `None` for a whole floor.
    span: Option<(i64, i64)>,
    height: i64,
}

impl HeightEntry {
    /// The entry, or `None` for anything but two or four whole numbers with
    /// a height from 2 to [`MAX_LOBBY_HEIGHT`] and a span in order.
    fn read(entry: &Value) -> Option<HeightEntry> {
        let list = entry.as_array()?;
        let whole = |i: usize| {
            let v = list.get(i)?.as_f64()?;
            (v.fract() == 0.0 && v.abs() < 1e9).then_some(v as i64)
        };
        let (floor, span, height) = match list.len() {
            2 => (whole(0)?, None, whole(1)?),
            4 => (whole(0)?, Some((whole(1)?, whole(2)?)), whole(3)?),
            _ => return None,
        };
        let ordered = span.is_none_or(|(x0, x1)| x0 <= x1);
        ((2..=MAX_LOBBY_HEIGHT).contains(&height) && ordered).then_some(HeightEntry {
            floor,
            span,
            height,
        })
    }
}

impl Tower {
    /// Every lobby hall taller than one story, by floor and then column.
    /// Neighboring tiles of one height make one run; a gap or a change of
    /// height starts the next. Kept per revision: the build preview asks on
    /// pointer moves. A fresh answer probes each column of the floors that
    /// hold a tall hall, never the unit list.
    pub fn tall_lobby_runs(&self) -> Arc<[HallRun]> {
        if let Some((revision, runs)) = &self.memo.borrow().tall_runs {
            if *revision == self.revision {
                return runs.clone();
            }
        }
        let mut runs: Vec<HallRun> = Vec::new();
        for (floor, _) in self.tall_lobbies() {
            for col in 0..LOT_WIDTH {
                let height = self.lobby_height_at(floor, col);
                if height <= 1 {
                    continue;
                }
                match runs.last_mut() {
                    Some(r) if r[0] == floor && r[3] == height && r[2] + 1 == col => r[2] = col,
                    _ => runs.push([floor, col, col, height]),
                }
            }
        }
        let runs: Arc<[HallRun]> = runs.into();
        self.memo.borrow_mut().tall_runs = Some((self.revision, runs.clone()));
        runs
    }

    /// Takes a loaded save's `lobbyHeights` before the tower is indexed,
    /// setting each listed lobby tile's height. An entry is kept only where
    /// this tower could have built it: a floor the mode lets rise, lobby
    /// tiles there not yet given a height, and every story it rises through
    /// on the lot, with no unit on it and no shaft ending there, over the
    /// whole lot for a whole-floor entry and over the hall's own columns for
    /// a hall. Anything else loads as a one-story lobby, so a hand-edited
    /// save can never stack the lobby onto another unit. One pass over the
    /// units per entry, and a save holds a few.
    pub(crate) fn adopt_lobby_heights(&mut self, raw: Option<&Value>) {
        let Some(entries) = raw.and_then(Value::as_array) else {
            return;
        };
        let per_hall = self.mode.lobby_height_per_hall();
        for entry in entries {
            let Some(e) = HeightEntry::read(entry) else {
                continue;
            };
            let span = if per_hall { e.span } else { None };
            let picked: Vec<usize> = (0..self.units.len())
                .filter(|&i| {
                    let u = &self.units[i];
                    u.kind == Kind::Lobby
                        && u.floor == e.floor
                        && u.extras().lobby_stories.is_none()
                        && span.is_none_or(|(x0, x1)| x0 <= u.x && u.x + u.width - 1 <= x1)
                })
                .collect();
            let columns = span.and_then(|_| {
                let x0 = picked.iter().map(|&i| self.units[i].x).min()?;
                let x1 = picked
                    .iter()
                    .map(|&i| self.units[i].x + self.units[i].width)
                    .max()?;
                Some((x0, x1))
            });
            if picked.is_empty() || !self.loaded_hall_fits(e.floor, e.height, columns) {
                continue;
            }
            for i in picked {
                self.units[i].extras_mut().lobby_stories = Some(e.height as u8);
            }
        }
    }

    /// Whether the units and shafts as loaded leave room for a lobby on
    /// `floor` `height` stories high, over the columns `[x0, x1)` or, for
    /// `None`, the whole lot. One pass over the units.
    fn loaded_hall_fits(&self, floor: i64, height: i64, columns: Option<(i64, i64)>) -> bool {
        let rises = floor + 1..floor + height;
        let over = |x: i64, w: i64| columns.is_none_or(|(x0, x1)| x < x1 && x0 < x + w);
        self.mode.raises_lobby_on(floor)
            && floor + height - 1 <= self.lot().top_floor()
            && !self.units.iter().any(|u| {
                let top = u.floor + self.unit_stories(u) - 1;
                u.floor < rises.end && top >= rises.start && over(u.x, u.width)
            })
            && !self.transports.iter().any(|t| {
                (rises.contains(&t.bottom) || rises.contains(&t.top)) && over(t.x, t.width)
            })
    }

    /// Re-asserts on load that no shaft stops inside a tall lobby.
    pub(crate) fn coerce_tall_lobby_stops(&mut self) {
        if self.tall_lobby_tiles.is_empty() {
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
#[path = "lobby_halls_tests.rs"]
mod tests;
