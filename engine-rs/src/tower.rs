//! Port of `src/engine/Tower.ts`, `tower/placement.ts`, `tower/transport.ts`
//! and `tower/expressStops.ts`.

use std::cell::RefCell;
use std::collections::HashMap;

use crate::clock::GameMode;
use crate::crowd::fasthash::FastMap;
use crate::facilities::*;
use crate::lot::Lot;

mod placement;
mod transports;
mod types;
mod undoing;

pub use types::{Extras, ExtrasMut, PlaceResult, ResizeResult, Transport, Unit, UnitState};

/// The refusal for a Classic floor tile with floor on both sides: taking it
/// out would leave a gap the story above could not be built across.
pub(crate) const MID_FLOOR_GAP: &str =
    "In Classic, only the tile at either end of a floor can be removed, so a floor never has a gap in the middle.";

/// Whether the `w` tiles from `x` on one story have floor on both sides,
/// so they are not at either end of the story and taking them out in
/// Classic would leave a gap in its middle, or widen one a loaded save
/// already has. `tile_at` answers the kind of the floor or lobby tile at a
/// tile of that story, if one stands there. The bulldozer
/// (`Tower::removal_reason`) asks it, and the undo's sale advice
/// (`Ground::sells_from_an_end`) asks its two sides, so they agree.
pub(crate) fn span_has_floor_on_both_sides(
    x: i64,
    w: i64,
    tile_at: impl Fn(i64) -> Option<Kind>,
) -> bool {
    floor_left_of(x, &tile_at) && floor_right_of(x + w, &tile_at)
}

/// Whether the story has floor on the left of the tile at `x`, by Classic's
/// floor end rule: plain floor stands anywhere left of it, or the tiles
/// touching it on the left, unbroken by a gap, hold a lobby tile (owner
/// ruling, 2026-11-13, on #2062). Lobby tiles are never removed, so counting
/// one beyond a gap would trap the plain floor between it and the far end
/// for good; a lobby the tile touches still counts, so a floor tile right
/// beside a lobby is not an end. Plain floor anywhere counts, so the tiles
/// beside a gap a saved tower has are not ends and the gap is not cut wider
/// one tile at a time. A plain tile in the touching run counts on its own,
/// so the touching run counts exactly when the tile right beside holds floor
/// or lobby.
pub(crate) fn floor_left_of(x: i64, tile_at: impl Fn(i64) -> Option<Kind>) -> bool {
    touches_floor_or_lobby(x - 1, &tile_at) || plain_floor_on(0..x, &tile_at)
}

/// Whether the story has floor on the right of the tiles that end before
/// `end`, by the rule of [`floor_left_of`].
pub(crate) fn floor_right_of(end: i64, tile_at: impl Fn(i64) -> Option<Kind>) -> bool {
    touches_floor_or_lobby(end, &tile_at) || plain_floor_on(end..LOT_WIDTH, &tile_at)
}

fn touches_floor_or_lobby(beside: i64, tile_at: impl Fn(i64) -> Option<Kind>) -> bool {
    (0..LOT_WIDTH).contains(&beside) && tile_at(beside).is_some()
}

fn plain_floor_on(side: std::ops::Range<i64>, tile_at: impl Fn(i64) -> Option<Kind>) -> bool {
    side.into_iter().any(|tx| tile_at(tx) == Some(Kind::Floor))
}

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
    /// The open undo gesture's journal, while one is open (`undo_journal.rs`).
    pub(crate) journal: Option<Box<crate::undo_journal::Journal>>,
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
    /// The lot this tower stands on. Every tower stands on the standard lot
    /// today; a lot shape a save names (the tall lot, #1983) changes this one
    /// answer, and every top-floor rule reads it.
    pub(crate) fn lot(&self) -> Lot {
        Lot::STANDARD
    }

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
            journal: None,
        }
    }

    // ---- lookups ---------------------------------------------------------

    pub fn get_unit(&self, id: i64) -> Option<&Unit> {
        self.by_id.get(&id).map(|&i| &self.units[i])
    }

    pub fn get_unit_mut(&mut self, id: i64) -> Option<&mut Unit> {
        match self.by_id.get(&id) {
            Some(&i) => {
                if let Some(j) = self.journal.as_mut() {
                    j.unit_edit(i, &self.units[i]);
                }
                Some(&mut self.units[i])
            }
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

    /// Whether the `w` tiles from `x` on story `floor` have floor on both
    /// sides, by [`span_has_floor_on_both_sides`], so they are not at either
    /// end of the story. A sale asks it once per structure tile, so the scan
    /// of at most one story's width (`LOT_WIDTH`) stays off every per-frame
    /// path.
    pub(crate) fn floor_on_both_sides(&self, floor: i64, x: i64, w: i64) -> bool {
        span_has_floor_on_both_sides(x, w, |tx| self.structure_kind_at(floor, tx))
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

    pub(crate) fn register(&mut self, idx: usize) {
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
        if u.kind == Kind::Metro {
            self.memo.get_mut().metro_changes += 1;
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
        if u.kind == Kind::Metro {
            self.memo.get_mut().metro_changes += 1;
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
        for pool in pools_for(self.mode) {
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
            // Never infer PC TDT provenance from skip-list signs. An authentic
            // file can skip none, some, or all underground floors.
            let keep_basement_stops = self.mode.keeps_preserved_basement_stops()
                && bottom < 0
                && self.transports[i].preserve_basement_stops;
            for fl in bottom + 1..top {
                if keep_basement_stops && fl <= 0 {
                    continue;
                }
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
