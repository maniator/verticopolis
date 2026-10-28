//! Unit removal, twin of `src/engine/tower/removal.ts`. The unit list keeps
//! its order, which saves, `pick_x` and every pass over the list read, so a
//! removal closes the gap instead of swapping the last unit in. Each function
//! costs one pass over the list however many units it removes (HP-6 in
//! `docs/performance/hot-path-review.md`): a command that removes several
//! units hands them over together, and only the indexes after the first
//! removed unit are rewritten.

use std::collections::HashMap;

use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::{Tower, Unit};

/// The lobby brush's state while it runs
/// ([`Simulation::with_lobby_upgrades`]): the ids of the units placed, in the
/// order placed, and whether a lobby took a floor tile's place.
#[derive(Default)]
pub(crate) struct LobbyUpgrades {
    placed: Vec<i64>,
    upgraded: bool,
}

impl Tower {
    /// `removeUnit`: remove one unit by id, or `None` when no unit has it.
    pub fn remove_unit(&mut self, id: i64) -> Option<Unit> {
        let idx = self.index_of(id)?;
        let u = self.units.remove(idx);
        self.reindex_from(idx);
        self.settle_removals(std::slice::from_ref(&u));
        Some(u)
    }

    /// `removeUnits`: remove every unit `ids` names in one pass, with the
    /// same result as removing them one by one in that order: the same list,
    /// indexes, express stops, wedding hall flag and revision. An id that
    /// names nothing, or that repeats, removes nothing. Answers the units
    /// removed, in `ids` order.
    pub fn remove_units(&mut self, ids: &[i64]) -> Vec<Unit> {
        let at = self.indexes_of(ids);
        let (first, gone) = self.take_out(at);
        self.reindex_from(first);
        self.settle_removals(&gone);
        gone
    }

    /// What removing `gone` (in that order) changes besides the list: the
    /// indexes, the wedding hall flag, the express stops of each floor that
    /// lost its last lobby tile, synced in the order the one-by-one removals
    /// would sync them, and one revision per unit.
    fn settle_removals(&mut self, gone: &[Unit]) {
        let mut wedding = false;
        let mut last_lobby: HashMap<i64, i64> = HashMap::new();
        for u in gone {
            self.unregister(u);
            wedding |= u.kind == Kind::WeddingHall;
            if u.kind == Kind::Lobby {
                last_lobby.insert(u.floor, u.id);
            }
        }
        // Derive from what actually still stands, so bulldozing one of two
        // halls doesn't wrongly clear the flag while a hall remains.
        if wedding {
            self.built_wedding_hall = Some(self.units.iter().any(|u| u.kind == Kind::WeddingHall));
        }
        // Last lobby tile gone: the floor is no longer a lobby, so express
        // elevators spanning it stop stopping there.
        if !last_lobby.is_empty() {
            for u in gone {
                if last_lobby.get(&u.floor) == Some(&u.id) && !self.floor_has_lobby(u.floor) {
                    self.sync_express_stops_for_floor(u.floor);
                }
            }
        }
        self.revision += gone.len() as i64;
    }

    /// The list index of each unit `ids` names, paired with its place in
    /// `ids`; ids that name nothing are left out.
    fn indexes_of(&self, ids: &[i64]) -> Vec<(usize, usize)> {
        ids.iter()
            .enumerate()
            .filter_map(|(k, &id)| self.index_of(id).map(|idx| (idx, k)))
            .collect()
    }

    /// The list index `by_id` holds for `id`, when the unit there has that
    /// id. A stale entry is a broken invariant: a debug build stops on it,
    /// and a release build answers `None`, so a removal never takes another
    /// unit.
    fn index_of(&self, id: i64) -> Option<usize> {
        let idx = *self.by_id.get(&id)?;
        let stands = self.units.get(idx).is_some_and(|u| u.id == id);
        debug_assert!(stands, "by_id holds a stale index for unit {id}");
        stands.then_some(idx)
    }

    /// Take the units at the indexes in `at` out of the list in one pass,
    /// answered in the order of their paired keys (a repeated index is taken
    /// once, at its first key), with the first index taken: the indexes from
    /// there on are stale until the caller reindexes.
    fn take_out(&mut self, mut at: Vec<(usize, usize)>) -> (usize, Vec<Unit>) {
        at.sort_unstable();
        at.dedup_by_key(|&mut (idx, _)| idx);
        let Some(&(first, _)) = at.first() else {
            return (self.units.len(), Vec::new());
        };
        debug_assert!(at.last().is_some_and(|&(idx, _)| idx < self.units.len()));
        let (mut i, mut next) = (first, 0);
        let taken: Vec<Unit> = self
            .units
            .extract_if(first.., |_| {
                let hit = at.get(next).is_some_and(|&(idx, _)| idx == i);
                if hit {
                    next += 1;
                }
                i += 1;
                hit
            })
            .collect();
        debug_assert_eq!(taken.len(), at.len(), "every index was taken once");
        let mut keyed: Vec<(usize, Unit)> = at.iter().map(|&(_, key)| key).zip(taken).collect();
        keyed.sort_unstable_by_key(|&(key, _)| key);
        (first, keyed.into_iter().map(|(_, u)| u).collect())
    }

    /// Point `by_id` at the units from `from` to the end of the list.
    fn reindex_from(&mut self, from: usize) {
        for (i, u) in self.units.iter().enumerate().skip(from) {
            self.by_id.insert(u.id, i);
        }
    }

    // ---- the lobby brush ---------------------------------------------------

    /// End the lobby brush's batch: when a lobby took a floor tile's place,
    /// move everything the brush placed to the end of the list, in the order
    /// placed, and bump the revision once.
    fn end_lobby_upgrades(&mut self) {
        let Some(batch) = self.lobby_upgrades.take() else {
            return;
        };
        if !batch.upgraded {
            return;
        }
        let at = self.indexes_of(&batch.placed);
        let (first, moved) = self.take_out(at);
        self.units.extend(moved);
        self.reindex_from(first);
        self.revision += 1;
    }

    /// Inside the lobby brush, take plain floor tile `id` off the tower
    /// (indexes, revision) and answer its place in the list for the lobby
    /// laid over it; outside, answer `None` and leave the tile for the caller
    /// to remove. The slot still holds the tile, which no index names, so the
    /// caller adds the lobby there next ([`Tower::add_unit`]).
    pub(crate) fn take_floor_slot(&mut self, id: i64) -> Option<usize> {
        self.lobby_upgrades.as_ref()?;
        let idx = self.index_of(id)?;
        if self.units[idx].kind != Kind::Floor {
            return None;
        }
        let u = self.units[idx].clone();
        self.settle_removals(std::slice::from_ref(&u));
        Some(idx)
    }

    /// Add a newly placed unit to the list: at the end, or at `slot`, the
    /// place [`Tower::take_floor_slot`] answered. Answers its index. The
    /// lobby brush notes it for the move.
    pub(crate) fn add_unit(&mut self, unit: Unit, slot: Option<usize>) -> usize {
        let id = unit.id;
        let idx = match slot {
            Some(idx) => {
                self.units[idx] = unit;
                idx
            }
            None => {
                self.units.push(unit);
                self.units.len() - 1
            }
        };
        if let Some(batch) = &mut self.lobby_upgrades {
            batch.placed.push(id);
            batch.upgraded |= slot.is_some();
        }
        idx
    }
}

impl Simulation {
    /// `withLobbyUpgrades`: run `run` (the lobby brush) with each lobby it
    /// lays over plain floor taking the floor tile's place in the list.
    /// Laying them one by one would remove each floor tile from the list (a
    /// pass per tile) and append its lobby, so when a lobby took a tile's
    /// place, everything `run` placed moves to the end of the list once, in
    /// the order placed. The list then ends as laying one by one would leave
    /// it: the units that stood before, in their order, then the units placed
    /// that still stand. Between the brush's tiles the list holds exactly the
    /// units that stand. The move bumps the revision, so a cache keyed on it
    /// rebuilds in the final order. A brush inside a brush joins the outer
    /// one.
    ///
    /// Cost: the move is one pass over the list from the first unit it moves,
    /// plus rewriting the indexes from there, however many tiles the brush
    /// upgrades. Each upgrade looks its tile up by id.
    pub(crate) fn with_lobby_upgrades<T>(&mut self, run: impl FnOnce(&mut Simulation) -> T) -> T {
        if self.tower.lobby_upgrades.is_some() {
            return run(self);
        }
        self.tower.lobby_upgrades = Some(LobbyUpgrades::default());
        // The batch ends even when `run` panics, as TypeScript's `finally`
        // ends it, so a native host that catches the panic keeps a tower
        // with no batch left open. Should ending it panic too (a removal cut
        // short leaves `by_id` behind the list), the first panic is the one
        // raised.
        use std::panic::{catch_unwind, resume_unwind, AssertUnwindSafe};
        let out = catch_unwind(AssertUnwindSafe(|| run(self)));
        let end = catch_unwind(AssertUnwindSafe(|| self.tower.end_lobby_upgrades()));
        match (out, end) {
            (Err(panic), _) | (Ok(_), Err(panic)) => resume_unwind(panic),
            (Ok(out), Ok(())) => out,
        }
    }
}

#[cfg(test)]
#[path = "tower_removal_tests.rs"]
mod tests;
