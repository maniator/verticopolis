//! Floor tiles written as runs (save version 11).
//!
//! Most of a built tower's units are plain floor tiles: a large Modern tower
//! lists about 19,000 of them, each one `{"id":43,"kind":"floor","floor":2,"x":167}`,
//! and they were about 70% of its save. From version 11 the writer folds a
//! row of them into the first tile's entry with a `run` count:
//! `{"id":43,"kind":"floor","floor":2,"x":167,"run":60}` stands for 60 tiles
//! on floor 2, at x 167 to 226, with ids 43 to 102.
//!
//! A run only takes tiles that sit next to each other in the unit list, one
//! tile to the right and one id up from the tile before, and whose save entry
//! holds nothing but `id`, `kind`, `floor` and `x`. So unfolding a run in
//! place gives back exactly the list a version 10 writer would have written,
//! in the same order, with the same ids. The loader unfolds it
//! (`load::floor_runs`).

use crate::facilities::{Kind, LOT_WIDTH};
use crate::tower::{SavedUnit, Tower, Unit};

/// The key on a run's first floor tile: how many tiles the run holds.
pub const FLOOR_RUN_KEY: &str = "run";

/// The save version that first writes floor runs. A build from before it
/// would read a run as its first tile alone, so it refuses the save instead.
pub const FLOOR_RUN_SAVE_VERSION: i64 = 11;

/// Whether `next` could follow `tile` in a floor run: both floor tiles on
/// the same floor, `next` one tile to the right and with the next id. Their
/// other facts are not compared, so this holds wherever the writer might
/// fold, and the version stamp leans on that.
pub(crate) fn could_continue_run(tile: &Unit, next: &Unit) -> bool {
    tile.kind == Kind::Floor
        && next.kind == Kind::Floor
        && tile.floor == next.floor
        && next.x == tile.x + 1
        && next.id == tile.id + 1
}

/// Whether the writer could fold any two of `units` into a run, so the save
/// must be stamped [`FLOOR_RUN_SAVE_VERSION`]. One pass over the list with
/// no allocation; it stops at the first pair.
pub(crate) fn lists_a_floor_run(units: &[Unit]) -> bool {
    units.windows(2).any(|w| could_continue_run(&w[0], &w[1]))
}

impl Tower {
    /// [`lists_a_floor_run`] over this tower's units, walked once per tower
    /// revision like the other unit indexes (`tower_index`): every save and
    /// every sync delta stamps its version from it.
    pub(crate) fn lists_a_floor_run(&self) -> bool {
        // A list too short for a pair answers at once and leaves the memo
        // alone: the sync delta writes the rest of a save with the units lent
        // out, and that must not replace the tower's own answer.
        if self.units.len() < 2 {
            return false;
        }
        let key = self.index_key();
        if let Some((built, listed)) = self.memo.borrow().floor_run {
            if built == key {
                return listed;
            }
        }
        let listed = lists_a_floor_run(&self.units);
        self.memo.borrow_mut().floor_run = Some((key, listed));
        listed
    }
}

/// Whether a unit's save entry is a plain floor tile, nothing but `id`,
/// `kind`, `floor` and `x`: only such a tile joins a run, so a tile that
/// carries any other fact keeps its own entry.
fn is_plain_floor_tile(unit: &Unit) -> bool {
    unit.kind == Kind::Floor && unit.saves_only_position()
}

/// Each unit's save entry in list order, with every run of plain floor tiles
/// folded into its first tile's entry. Nothing is built: each entry is
/// written straight from its unit (`SavedUnit`).
pub(crate) struct SavedUnits<'a> {
    units: &'a [Unit],
    next: usize,
}

impl<'a> SavedUnits<'a> {
    pub(crate) fn new(units: &'a [Unit]) -> Self {
        SavedUnits { units, next: 0 }
    }
}

impl<'a> Iterator for SavedUnits<'a> {
    type Item = SavedUnit<'a>;

    fn next(&mut self) -> Option<SavedUnit<'a>> {
        let first = self.units.get(self.next)?;
        self.next += 1;
        if !is_plain_floor_tile(first) {
            return Some(SavedUnit {
                unit: first,
                run: None,
            });
        }
        let mut tiles = 1usize;
        while let Some(unit) = self.units.get(self.next) {
            // A run never holds more tiles than the lot is wide: the loader
            // reads a longer one as its first tile alone. A labeled tile ends
            // the run and opens the next entry.
            if tiles >= LOT_WIDTH as usize
                || !could_continue_run(&self.units[self.next - 1], unit)
                || !is_plain_floor_tile(unit)
            {
                break;
            }
            tiles += 1;
            self.next += 1;
        }
        Some(SavedUnit {
            unit: first,
            run: (tiles > 1).then_some(tiles),
        })
    }
}

#[cfg(test)]
#[path = "save_floor_runs_tests.rs"]
mod tests;
