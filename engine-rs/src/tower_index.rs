//! Revision-keyed indexes over the unit list, for queries the step makes
//! many times over (#1051). Most of a large tower's units are floor and
//! lobby tiles: a 100-floor tower has tens of thousands of them and a few
//! thousand rooms. `roomUnits` walks past every tile to reach the rooms, and
//! `pickX` and `pickXInSegment` walk every unit to list one floor's tiles,
//! once or twice for each person spawned. These indexes answer from one walk
//! per tower revision.
//!
//! They are keyed on `revision` and the unit count. Every placement and
//! removal bumps the revision, a load ends in `reindex`, which resets the
//! memo and bumps it too, and no other path adds, removes, moves or resizes
//! a unit. The count guards one case only: a list cut behind the revision
//! rebuilds instead of indexing past its end. A change that keeps the count
//! and skips the bump would be served stale; no production path makes one.
//! (`roomUnits` in `tower/rooms.ts` also keys on the array's identity. Here
//! only a load replaces the list, and it reindexes.)
//!
//! Both hand out shared slices rather than borrows of the memo, so a caller
//! can hold one while it makes any other memoized query. The slices are
//! `Arc`, which fits #1051's rule against WASM threads, atomics and
//! `SharedArrayBuffer`: the wasm32 build enables no atomics
//! (`scripts/wasm-build.ts`), so the count compiles to plain loads and
//! stores in unshared memory, as the `OnceLock` in `fflate.rs` already does.
//! `Arc` also keeps `Tower` `Send`, as it was on `main`, though nothing needs
//! that today and nothing here runs on another thread.

use std::collections::HashMap;
use std::sync::Arc;

use crate::tower::{Tower, Unit};

/// What an index was built from: the tower revision and the unit count.
pub type IndexKey = (i64, usize);

/// Floor to the x of every structural tile on it, in unit order and with a
/// unit's tiles left to right: the list `pickX` builds. A floor with no
/// tiles has no entry.
pub type FloorTiles = HashMap<i64, Arc<[i64]>>;

impl Tower {
    fn index_key(&self) -> IndexKey {
        (self.revision, self.units.len())
    }

    /// `roomUnits`: every non-structural unit, in list order.
    pub fn room_units(&self) -> impl Iterator<Item = &Unit> {
        let rooms = self.room_index();
        (0..rooms.len()).map(move |k| &self.units[rooms[k]])
    }

    /// Indices of the room units, for loops that must mutate them.
    pub fn room_indices(&self) -> Vec<usize> {
        self.room_index().to_vec()
    }

    /// The positions in `units` of every room (non-structural) unit, in list
    /// order.
    pub(crate) fn room_index(&self) -> Arc<[usize]> {
        let key = self.index_key();
        if let Some((built, rooms)) = &self.memo.borrow().rooms {
            if *built == key {
                return rooms.clone();
            }
        }
        let rooms: Arc<[usize]> = (0..self.units.len())
            .filter(|&i| !self.units[i].kind.is_structural())
            .collect();
        self.memo.borrow_mut().rooms = Some((key, rooms.clone()));
        rooms
    }

    /// The structural tiles of `floor` in the order `pickX` lists them, or
    /// `None` when the floor has none.
    pub(crate) fn structural_tiles(&self, floor: i64) -> Option<Arc<[i64]>> {
        let key = self.index_key();
        if let Some((built, tiles)) = &self.memo.borrow().tiles {
            if *built == key {
                return tiles.get(&floor).cloned();
            }
        }
        let mut rows: HashMap<i64, Vec<i64>> = HashMap::new();
        for u in &self.units {
            if u.kind.is_structural() && u.width > 0 {
                let row = rows.entry(u.floor).or_default();
                row.extend((0..u.width).map(|i| u.x + i));
            }
        }
        let tiles: FloorTiles = rows.into_iter().map(|(f, row)| (f, row.into())).collect();
        let hit = tiles.get(&floor).cloned();
        self.memo.borrow_mut().tiles = Some((key, tiles));
        hit
    }
}

#[cfg(test)]
#[path = "tower_index_tests.rs"]
mod tests;
