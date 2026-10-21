//! Revision-keyed indexes over the unit list, for queries the step makes
//! many times over (#1051). Most of a large tower's units are floor and
//! lobby tiles: a 100-floor tower has tens of thousands of them and a few
//! thousand rooms. `roomUnits` walks past every tile to reach the rooms, and
//! `pickX` and `pickXInSegment` walk every unit to list one floor's tiles,
//! once or twice for each person spawned. `maxStaffFor` counted every unit
//! for each staff spawn attempt (#1143). These indexes answer from one walk
//! per tower revision.
//!
//! They are keyed on `revision` and the unit count. Every placement and
//! removal bumps the revision, a load ends in `reindex`, which resets the
//! memo and bumps it too, and no other path adds, removes, moves, resizes or
//! retypes a unit (the census reads each unit's kind and floor). The count guards one case only: a list cut behind the revision
//! rebuilds instead of indexing past its end. A change that keeps the count
//! and skips the bump would be served stale; no production path makes one.
//! (`roomUnits` in `tower/rooms.ts` also keys on the array's identity. Here
//! only a load replaces the list, and it reindexes.)
//!
//! The room and tile indexes hand out shared slices rather than borrows of
//! the memo, so a caller can hold one while it makes any other memoized
//! query. The slices are `Arc`, which fits #1051's rule against WASM
//! threads, atomics and `SharedArrayBuffer`: the wasm32 build enables no
//! atomics (`scripts/wasm-build.ts`), so the reference count compiles to
//! plain loads and stores in unshared memory, as the `OnceLock` in
//! `fflate.rs` already does. `Arc` also keeps `Tower` `Send`, as it was on
//! `main`, though nothing needs that today and nothing here runs on another
//! thread.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use crate::facilities::{Kind, FACILITIES};
use crate::tower::{Tower, Unit};

/// What an index was built from: the tower revision and the unit count.
pub type IndexKey = (i64, usize);

/// Floor to the x of every structural tile on it, in unit order and with a
/// unit's tiles left to right: the list `pickX` builds. A floor with no
/// tiles has no entry.
pub type FloorTiles = HashMap<i64, Arc<[i64]>>;

/// The room census: units of each kind, indexed by `Kind as usize`, and the
/// floors that hold an office. Structural kinds count zero here; `count_kind`
/// walks the tiles for them.
pub struct Census {
    pub kinds: Vec<i64>,
    pub office_floors: HashSet<i64>,
}

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

    /// What the per-move build checks count over the rooms, built once per
    /// revision (#1239): `count_kind` for the build caps and the pooled
    /// caps, and the office floors behind the Classic escalator rule.
    pub(crate) fn census(&self) -> Arc<Census> {
        let key = self.index_key();
        if let Some((built, census)) = &self.memo.borrow().census {
            if *built == key {
                return census.clone();
            }
        }
        let mut census = Census {
            kinds: vec![0; FACILITIES.len()],
            office_floors: HashSet::new(),
        };
        for u in self.room_units() {
            census.kinds[u.kind as usize] += 1;
            if u.kind == Kind::Office {
                census.office_floors.insert(u.floor);
            }
        }
        let census = Arc::new(census);
        self.memo.borrow_mut().census = Some((key, census.clone()));
        census
    }

    /// How many housekeeping units the tower has: the crews behind
    /// `maxStaffFor`'s ceiling (`staffCeiling` in `crowd/spawn.ts`). Read
    /// from the census, since a housekeeping unit is never a tile.
    pub(crate) fn housekeeping_units(&self) -> i64 {
        self.census().kinds[Kind::Housekeeping as usize]
    }

    /// Whether `floor` has an office on it, in any state.
    pub(crate) fn has_office_on(&self, floor: i64) -> bool {
        self.census().office_floors.contains(&floor)
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

#[cfg(test)]
#[path = "tower_census_tests.rs"]
mod census_tests;
