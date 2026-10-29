//! Port of `src/engine/Tower.ts`, `tower/placement.ts`, `tower/transport.ts`
//! and `tower/expressStops.ts`.

use std::cell::RefCell;
use std::collections::HashMap;

use crate::clock::GameMode;
use crate::crowd::fasthash::FastMap;
use crate::facilities::*;

mod placement;
mod transports;
mod types;

pub use types::{PlaceResult, ResizeResult, Transport, Unit, UnitState};

pub struct Tower {
    pub units: Vec<Unit>,
    pub transports: Vec<Transport>,
    /// One counter shared by units and transports.
    pub next_id: i64,
    /// `towerName`; `None` when the save carried no key (and none is written).
    pub tower_name: Option<String>,
    /// `builtWeddingHall`; `None` when the save carried no key.
    pub built_wedding_hall: Option<bool>,
    pub revision: i64,
    pub allows_escalator_on_office_floors: bool,
    /// The rule set the tower was founded under (`tower.rules.mode`).
    pub mode: GameMode,
    pub(crate) structure: HashMap<(i64, i64), i64>,
    pub(crate) struct_kind: HashMap<(i64, i64), Kind>,
    pub(crate) rooms: HashMap<(i64, i64), i64>,
    /// Unit id to its index in `units` (`FastMap`: never iterated).
    pub(crate) by_id: FastMap<i64, usize>,
    /// `transportsById`: shaft id to its index in `transports`.
    pub(crate) transport_by_id: HashMap<i64, usize>,
    pub(crate) lobby_tiles: HashMap<i64, i64>,
    pub(crate) room_tiles: HashMap<i64, i64>,
    /// Revision-keyed memos and indexes (`servedSet`, `stopsCache`, segment
    /// runs, staff components and the `tower_index.rs` indexes), see
    /// `tower_query_state.rs`.
    pub(crate) memo: RefCell<crate::tower_query_state::Memo>,
    /// `mealOverlayRevision`: bumped on every customersIn/outForMeal change.
    pub meal_overlay_revision: i64,
    /// The unit metadata revision: starts at 1 and is bumped by the label
    /// and subtype setters (`view/meta.rs`) when a value changes. Never saved
    /// or hashed.
    pub meta_revision: i64,
    /// What the renderer-facing view keeps between reads (`view/mod.rs`).
    pub(crate) view: crate::view::ViewState,
    /// The lobby brush's batch while it runs (`tower_removal.rs`).
    pub(crate) lobby_upgrades: Option<crate::tower_removal::LobbyUpgrades>,
}

/// The room a loaded game's unit list keeps past its units. A list with no
/// spare room moves to a new block on the first placement while it still holds
/// the old one, which on the large perf tower took the engine's WASM memory
/// from 24.6 to 52.4 MiB for one floor tile (#1259), and a WASM memory keeps
/// its peak for the session. An eighth, at least 64, holds the placements most
/// sessions make; past it `Tower::add_unit` grows the list by a quarter.
pub(crate) fn unit_list_headroom(units: usize) -> usize {
    (units / 8).max(64)
}

impl Tower {
    pub fn new() -> Tower {
        Tower {
            units: Vec::new(),
            transports: Vec::new(),
            next_id: 1,
            tower_name: Some("Tower One".into()),
            built_wedding_hall: Some(false),
            revision: 0,
            allows_escalator_on_office_floors: false,
            mode: GameMode::Classic,
            structure: HashMap::new(),
            struct_kind: HashMap::new(),
            rooms: HashMap::new(),
            by_id: FastMap::default(),
            transport_by_id: HashMap::new(),
            lobby_tiles: HashMap::new(),
            room_tiles: HashMap::new(),
            memo: RefCell::new(Default::default()),
            meal_overlay_revision: 0,
            meta_revision: crate::view::FIRST_META_REVISION,
            view: Default::default(),
            lobby_upgrades: None,
        }
    }

    // ---- lookups ---------------------------------------------------------

    pub fn get_unit(&self, id: i64) -> Option<&Unit> {
        self.by_id.get(&id).map(|&i| &self.units[i])
    }

    pub fn get_unit_mut(&mut self, id: i64) -> Option<&mut Unit> {
        match self.by_id.get(&id) {
            Some(&i) => Some(&mut self.units[i]),
            None => None,
        }
    }

    /// `unitAt`: a room wins over structure.
    pub fn unit_at(&self, floor: i64, x: i64) -> Option<&Unit> {
        let id = self
            .rooms
            .get(&(floor, x))
            .or_else(|| self.structure.get(&(floor, x)))?;
        self.get_unit(*id)
    }

    pub fn structure_kind_at(&self, floor: i64, x: i64) -> Option<Kind> {
        self.struct_kind.get(&(floor, x)).copied()
    }

    pub fn has_structure(&self, floor: i64, x: i64) -> bool {
        self.structure.contains_key(&(floor, x))
    }

    pub fn floor_has_room(&self, floor: i64) -> bool {
        self.room_tiles.get(&floor).copied().unwrap_or(0) > 0
    }

    pub fn floor_has_lobby(&self, floor: i64) -> bool {
        self.lobby_tiles.get(&floor).copied().unwrap_or(0) > 0
    }

    pub fn lobby_tile_count(&self, floor: i64) -> i64 {
        self.lobby_tiles.get(&floor).copied().unwrap_or(0)
    }

    /// `lobbyFloors()`: ascending.
    pub fn lobby_floors(&self) -> Vec<i64> {
        let mut v: Vec<i64> = self.lobby_tiles.keys().copied().collect();
        v.sort();
        v
    }

    pub fn count_kind(&self, kind: Kind) -> i64 {
        let placed = if kind.is_structural() {
            self.units.iter().filter(|u| u.kind == kind).count() as i64
        } else {
            self.census().kinds[kind as usize]
        };
        placed + self.transports.iter().filter(|t| t.kind == kind).count() as i64
    }

    fn span_every(
        &self,
        floor: i64,
        x: i64,
        w: i64,
        pred: impl Fn(&Tower, i64, i64) -> bool,
    ) -> bool {
        (0..w).all(|i| pred(self, floor, x + i))
    }

    pub fn room_span_free(&self, floor: i64, x: i64, w: i64) -> bool {
        self.span_every(floor, x, w, |t, f, x| !t.rooms.contains_key(&(f, x)))
    }

    pub fn structure_span_free(&self, floor: i64, x: i64, w: i64) -> bool {
        self.span_every(floor, x, w, |t, f, x| !t.structure.contains_key(&(f, x)))
    }

    pub fn span_has_floor(&self, floor: i64, x: i64, w: i64) -> bool {
        self.span_every(floor, x, w, |t, f, x| t.structure.contains_key(&(f, x)))
    }

    pub fn span_upgradeable_to_lobby(&self, floor: i64, x: i64, w: i64) -> bool {
        self.span_every(floor, x, w, |t, f, x| {
            t.struct_kind.get(&(f, x)) != Some(&Kind::Lobby)
        })
    }

    pub fn span_has_lobby(&self, floor: i64, x: i64, w: i64) -> bool {
        !self.span_every(floor, x, w, |t, f, x| {
            t.struct_kind.get(&(f, x)) != Some(&Kind::Lobby)
        })
    }

    pub fn shaft_has_structure_at(&self, floor: i64, x: i64, w: i64) -> bool {
        (0..w).any(|i| self.structure.contains_key(&(floor, x + i)))
    }

    // ---- registration ----------------------------------------------------

    fn register(&mut self, idx: usize) {
        let u = self.units[idx].clone();
        self.by_id.insert(u.id, idx);
        let hgt = u.kind.floors();
        let structural = u.kind.is_structural();
        for fl in 0..hgt {
            for i in 0..u.width {
                let key = (u.floor + fl, u.x + i);
                if structural {
                    self.structure.insert(key, u.id);
                    self.struct_kind.insert(key, u.kind);
                } else {
                    self.rooms.insert(key, u.id);
                }
            }
            if !structural {
                *self.room_tiles.entry(u.floor + fl).or_insert(0) += u.width;
            }
        }
        if u.kind == Kind::Lobby {
            *self.lobby_tiles.entry(u.floor).or_insert(0) += u.width;
        }
    }

    pub(crate) fn unregister(&mut self, u: &Unit) {
        self.by_id.remove(&u.id);
        let hgt = u.kind.floors();
        let structural = u.kind.is_structural();
        for fl in 0..hgt {
            for i in 0..u.width {
                let key = (u.floor + fl, u.x + i);
                if structural {
                    self.structure.remove(&key);
                    self.struct_kind.remove(&key);
                } else {
                    self.rooms.remove(&key);
                }
            }
            if !structural {
                Self::dec_count(&mut self.room_tiles, u.floor + fl, u.width);
            }
        }
        if u.kind == Kind::Lobby {
            Self::dec_count(&mut self.lobby_tiles, u.floor, u.width);
        }
    }

    fn dec_count(map: &mut HashMap<i64, i64>, floor: i64, by: i64) {
        if let Some(c) = map.get_mut(&floor) {
            *c -= by;
            if *c <= 0 {
                map.remove(&floor);
            }
        }
    }

    // ---- placement rules -------------------------------------------------

    pub fn cap_reason(&self, kind: Kind) -> Option<String> {
        if let Some(single) = build_cap(kind) {
            if self.count_kind(kind) >= single {
                let f = kind.facility();
                return Some(format!(
                    "Only {single} {}{} allowed per tower.",
                    f.name,
                    if single == 1 { "" } else { "s" }
                ));
            }
        }
        for pool in POOLED_CAPS.iter() {
            if !pool.kinds.contains(&kind) {
                continue;
            }
            let total: i64 = pool.kinds.iter().map(|&k| self.count_kind(k)).sum();
            if total >= pool.cap {
                return Some(format!(
                    "Only {} {} allowed per tower.",
                    pool.cap, pool.label
                ));
            }
        }
        None
    }
}

impl Tower {
    /// `reindex()`: rebuild every per-tile index after a bulk unit assignment.
    pub fn reindex(&mut self) {
        self.structure.clear();
        self.struct_kind.clear();
        self.rooms.clear();
        self.by_id.clear();
        self.lobby_tiles.clear();
        self.room_tiles.clear();
        for i in 0..self.units.len() {
            self.register(i);
        }
        self.reindex_transports();
        *self.memo.borrow_mut() = Default::default();
        self.revision += 1;
    }

    /// `coerceExpressStops()`: re-assert the lobby-only express rule on load.
    pub fn coerce_express_stops(&mut self) {
        let mut changed = false;
        for i in 0..self.transports.len() {
            if self.transports[i].kind != Kind::ElevatorExpress {
                continue;
            }
            let (bottom, top) = (self.transports[i].bottom, self.transports[i].top);
            let mut skip: Vec<f64> = self.transports[i].skip_floors.clone().unwrap_or_default();
            for fl in bottom + 1..top {
                if !self.floor_has_lobby(fl) && !skip.contains(&(fl as f64)) {
                    skip.push(fl as f64);
                }
            }
            skip.retain(|&f| f != bottom as f64 && f != top as f64);
            let mut next: Vec<f64> = Vec::new();
            for f in skip {
                if !next.contains(&f) {
                    next.push(f);
                }
            }
            next.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            let before = self.transports[i].skip_floors.clone().unwrap_or_default();
            if next != before {
                self.transports[i].skip_floors = Some(next);
                changed = true;
            }
        }
        if changed {
            self.revision += 1;
        }
    }
}

impl Default for Tower {
    fn default() -> Self {
        Tower::new()
    }
}

#[cfg(test)]
mod tests;
