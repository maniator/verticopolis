//! Revision-keyed indexes over the unit list, for queries the step makes
//! many times over (#1051). Most of a large tower's units are floor and
//! lobby tiles: a 100-floor tower has tens of thousands of them and a few
//! thousand rooms. `roomUnits` walks past every tile to reach the rooms, and
//! `pickX` and `pickXInSegment` walk every unit to list one floor's tiles,
//! once or twice for each person spawned. These indexes answer from one walk
//! per tower revision. They are keyed on `revision` like the memos in
//! `tower_query.rs`: every placement and removal bumps it, a load resets the
//! memo, and no other path adds, removes, moves or resizes a unit.

use std::cell::Ref;
use std::collections::HashMap;
use std::rc::Rc;

use crate::tower::Tower;

/// Floor to the x of every structural tile on it, in unit order and with a
/// unit's tiles left to right: the list `pickX` builds.
pub type FloorTiles = HashMap<i64, Vec<i64>>;

impl Tower {
    /// The positions in `units` of every room (non-structural) unit, in list
    /// order. Shared rather than borrowed, so a loop over it can still call
    /// the other memoized queries.
    pub(crate) fn room_index(&self) -> Rc<[usize]> {
        if let Some((rev, rooms)) = &self.memo.borrow().rooms {
            if *rev == self.revision {
                return rooms.clone();
            }
        }
        let rooms: Rc<[usize]> = (0..self.units.len())
            .filter(|&i| !self.units[i].kind.is_structural())
            .collect();
        self.memo.borrow_mut().rooms = Some((self.revision, rooms.clone()));
        rooms
    }

    /// The structural tiles of `floor` in the order `pickX` lists them,
    /// borrowed from the memo. The borrow must end before the next memoized
    /// query, which may rebuild its own entry.
    pub(crate) fn structural_tiles(&self, floor: i64) -> Ref<'_, [i64]> {
        let fresh = matches!(&self.memo.borrow().tiles, Some((rev, _)) if *rev == self.revision);
        if !fresh {
            let mut tiles = FloorTiles::new();
            for u in &self.units {
                if u.kind.is_structural() {
                    let row = tiles.entry(u.floor).or_default();
                    row.extend((0..u.width).map(|i| u.x + i));
                }
            }
            self.memo.borrow_mut().tiles = Some((self.revision, tiles));
        }
        Ref::map(self.memo.borrow(), |m| {
            let tiles = &m.tiles.as_ref().expect("built above").1;
            tiles.get(&floor).map_or(&[][..], Vec::as_slice)
        })
    }
}

#[cfg(test)]
#[path = "tower_index_tests.rs"]
mod tests;
