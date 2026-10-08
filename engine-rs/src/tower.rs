//! Port of `src/engine/Tower.ts`, `tower/placement.ts`, `tower/transport.ts`
//! and `tower/expressStops.ts`.

use std::cell::RefCell;
use std::collections::HashMap;

use serde_json::{json, Map, Value};

use crate::clock::GameMode;
use crate::facilities::*;
use crate::schedule::Schedule;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnitState {
    Construction,
    Empty,
    Occupied,
    MovingIn,
    Vacating,
    Asleep,
    Dirty,
    Infested,
    Fire,
    Gutted,
}

impl UnitState {
    pub fn as_str(self) -> &'static str {
        match self {
            UnitState::Construction => "construction",
            UnitState::Empty => "empty",
            UnitState::Occupied => "occupied",
            UnitState::MovingIn => "moving_in",
            UnitState::Vacating => "vacating",
            UnitState::Asleep => "asleep",
            UnitState::Dirty => "dirty",
            UnitState::Infested => "infested",
            UnitState::Fire => "fire",
            UnitState::Gutted => "gutted",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Unit {
    pub id: i64,
    pub kind: Kind,
    pub floor: i64,
    pub x: i64,
    pub width: i64,
    pub state: UnitState,
    pub satisfaction: f64,
    pub occupants: i64,
    pub customers_in: Option<i64>,
    pub hotel_customers_in: Option<i64>,
    pub out_for_meal: Option<i64>,
    pub residents: Option<i64>,
    pub ever_occupied: bool,
    pub pending_income: f64,
    pub rent: Option<f64>,
    pub no_rate: bool,
    pub label: String,
    pub vacate_reason: Option<&'static str>,
    pub vacate_at: Option<f64>,
    pub film_policy: Option<&'static str>,
    pub subtype: Option<&'static str>,
    pub patronage_today: Option<f64>,
    pub patronage_yest: Option<f64>,
    pub profit_today: Option<f64>,
    pub profit_yest: Option<f64>,
    pub complete_at: Option<f64>,
    pub dirty_days: Option<i64>,
}

impl Unit {
    /// `serializeUnit` (sim/coerce.ts).
    pub fn serialize(&self) -> Value {
        let f = self.kind.facility();
        let mut m = Map::new();
        m.insert("id".into(), json!(self.id));
        m.insert("kind".into(), json!(self.kind.as_str()));
        m.insert("floor".into(), json!(self.floor));
        m.insert("x".into(), json!(self.x));
        if !(self.width == 1 && f.width == 1 && self.kind.is_structural()) {
            m.insert("width".into(), json!(self.width));
        }
        if self.state != UnitState::Empty {
            m.insert("state".into(), json!(self.state.as_str()));
        }
        if self.satisfaction != 1.0 {
            m.insert("satisfaction".into(), json!(self.satisfaction));
        }
        if self.occupants != 0 && f.attendance.is_none() {
            m.insert("occupants".into(), json!(self.occupants));
        }
        if self.ever_occupied {
            m.insert("everOccupied".into(), json!(true));
        }
        if self.pending_income != 0.0 {
            m.insert("pendingIncome".into(), json!(self.pending_income));
        }
        if self.label != f.name {
            m.insert("label".into(), json!(self.label));
        }
        if let Some(r) = self.residents {
            m.insert("residents".into(), json!(r));
        }
        if let Some(r) = self.rent {
            m.insert("rent".into(), json!(r));
        }
        if self.no_rate {
            m.insert("noRate".into(), json!(true));
        }
        if let Some(v) = self.vacate_reason {
            m.insert("vacateReason".into(), json!(v));
        }
        if let Some(v) = self.vacate_at {
            m.insert("vacateAt".into(), json!(v));
        }
        if let Some(v) = self.film_policy {
            m.insert("filmPolicy".into(), json!(v));
        }
        if let Some(v) = self.subtype {
            m.insert("subtype".into(), json!(v));
        }
        if self.kind.subtype_list().is_some() {
            if let Some(v) = self.patronage_today {
                m.insert("patronageToday".into(), json!(v));
            }
            if let Some(v) = self.patronage_yest {
                m.insert("patronageYest".into(), json!(v));
            }
            if let Some(v) = self.profit_today {
                m.insert("profitToday".into(), json!(v));
            }
            if let Some(v) = self.profit_yest {
                m.insert("profitYest".into(), json!(v));
            }
        }
        if let Some(v) = self.complete_at {
            m.insert("completeAt".into(), json!(v));
        }
        if let Some(d) = self.dirty_days {
            if d != 0 && self.state == UnitState::Dirty {
                m.insert("dirtyDays".into(), json!(d));
            }
        }
        Value::Object(m)
    }
}

#[derive(Clone, Debug)]
pub struct Transport {
    pub id: i64,
    pub kind: Kind,
    pub x: i64,
    pub width: i64,
    pub bottom: i64,
    pub top: i64,
    pub cars: i64,
    pub car_positions: Vec<f64>,
    pub car_dir: Vec<i64>,
    pub car_load: Option<Vec<f64>>,
    pub load: i64,
    pub skip_floors: Option<Vec<i64>>,
    pub schedule: Option<Schedule>,
}

impl Transport {
    /// `serializeTransport` (sim/coerce.ts).
    pub fn serialize(&self) -> Value {
        let mut m = Map::new();
        m.insert("id".into(), json!(self.id));
        m.insert("kind".into(), json!(self.kind.as_str()));
        m.insert("x".into(), json!(self.x));
        m.insert("width".into(), json!(self.width));
        m.insert("bottom".into(), json!(self.bottom));
        m.insert("top".into(), json!(self.top));
        m.insert("cars".into(), json!(self.cars));
        m.insert("carPositions".into(), json!(self.car_positions));
        m.insert("carDir".into(), json!(self.car_dir));
        if let Some(l) = &self.car_load {
            m.insert("carLoad".into(), json!(l));
        }
        m.insert("load".into(), json!(self.load));
        if let Some(s) = &self.skip_floors {
            m.insert("skipFloors".into(), json!(s));
        }
        if let Some(s) = &self.schedule {
            if !s.is_empty() {
                m.insert("schedule".into(), s.to_json());
            }
        }
        Value::Object(m)
    }

    pub fn stops_at(&self, fl: i64) -> bool {
        fl >= self.bottom
            && fl <= self.top
            && !self.skip_floors.as_ref().is_some_and(|s| s.contains(&fl))
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlaceResult {
    pub ok: bool,
    pub reason: Option<String>,
    pub unit_id: Option<i64>,
}

impl PlaceResult {
    fn fail(reason: impl Into<String>) -> PlaceResult {
        PlaceResult {
            ok: false,
            reason: Some(reason.into()),
            unit_id: None,
        }
    }
    fn ok() -> PlaceResult {
        PlaceResult {
            ok: true,
            reason: None,
            unit_id: None,
        }
    }
}

pub struct Tower {
    pub units: Vec<Unit>,
    pub transports: Vec<Transport>,
    /// One counter shared by units and transports.
    pub next_id: i64,
    pub tower_name: String,
    pub built_wedding_hall: bool,
    pub revision: i64,
    pub allows_escalator_on_office_floors: bool,
    /// The rule set the tower was founded under (`tower.rules.mode`).
    pub mode: GameMode,
    pub(crate) structure: HashMap<(i64, i64), i64>,
    pub(crate) struct_kind: HashMap<(i64, i64), Kind>,
    pub(crate) rooms: HashMap<(i64, i64), i64>,
    pub(crate) by_id: HashMap<i64, usize>,
    pub(crate) lobby_tiles: HashMap<i64, i64>,
    pub(crate) room_tiles: HashMap<i64, i64>,
    /// Revision-keyed memos (`servedSet`, `stopsCache`, segment runs, staff
    /// components), see `tower_query.rs`.
    pub(crate) memo: RefCell<crate::tower_query::Memo>,
    /// `mealOverlayRevision`: bumped on every customersIn/outForMeal change.
    pub meal_overlay_revision: i64,
}

impl Tower {
    pub fn new() -> Tower {
        Tower {
            units: Vec::new(),
            transports: Vec::new(),
            next_id: 1,
            tower_name: "Tower One".into(),
            built_wedding_hall: false,
            revision: 0,
            allows_escalator_on_office_floors: false,
            mode: GameMode::Classic,
            structure: HashMap::new(),
            struct_kind: HashMap::new(),
            rooms: HashMap::new(),
            by_id: HashMap::new(),
            lobby_tiles: HashMap::new(),
            room_tiles: HashMap::new(),
            memo: RefCell::new(Default::default()),
            meal_overlay_revision: 0,
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
        self.units.iter().filter(|u| u.kind == kind).count() as i64
            + self.transports.iter().filter(|t| t.kind == kind).count() as i64
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

    fn unregister(&mut self, u: &Unit) {
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

    fn reindex_ids(&mut self) {
        self.by_id.clear();
        for (i, u) in self.units.iter().enumerate() {
            self.by_id.insert(u.id, i);
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

    fn rests_on_story_below(&self, floor: i64, x: i64, w: i64) -> bool {
        self.span_has_floor(floor - 1, x, w)
    }

    pub fn is_supported(&self, floor: i64, x: i64, w: i64) -> bool {
        if self.units.is_empty() {
            return floor == 1;
        }
        if floor >= 2 {
            return self.rests_on_story_below(floor, x, w);
        }
        for i in -1..=w {
            if self.structure.contains_key(&(floor, x + i)) {
                return true;
            }
        }
        for i in 0..w {
            if self.structure.contains_key(&(floor - 1, x + i))
                || self.structure.contains_key(&(floor + 1, x + i))
            {
                return true;
            }
        }
        false
    }

    pub fn span_connects(&self, floor: i64, x: i64, w: i64, hgt: i64) -> bool {
        if self.units.is_empty() {
            return false;
        }
        if floor >= 2 {
            return self.rests_on_story_below(floor, x, w);
        }
        for fl in floor..floor + hgt {
            for i in -1..=w {
                if self.structure.contains_key(&(fl, x + i)) {
                    return true;
                }
            }
        }
        for i in 0..w {
            if self.structure.contains_key(&(floor - 1, x + i))
                || self.structure.contains_key(&(floor + hgt, x + i))
            {
                return true;
            }
        }
        false
    }

    pub fn missing_floor_count(&self, floor: i64, x: i64, w: i64, hgt: i64) -> i64 {
        let mut n = 0;
        for fl in floor..floor + hgt {
            for i in 0..w {
                if !self.structure.contains_key(&(fl, x + i)) {
                    n += 1;
                }
            }
        }
        n
    }

    fn room_placement_reason(
        &self,
        kind: Kind,
        floor: i64,
        x: i64,
        require_floor: bool,
    ) -> Option<String> {
        let f = kind.facility();
        let hgt = kind.floors();
        if !(MIN_FLOOR..=MAX_FLOOR).contains(&floor) {
            return Some("Outside the buildable range.".into());
        }
        if x < 0 || x + f.width > LOT_WIDTH {
            return Some("Off the edge of the lot.".into());
        }
        if kind == Kind::WeddingHall && floor != 100 {
            return Some("The wedding hall can only crown floor 100.".into());
        }
        if let Some(r) = self.cap_reason(kind) {
            return Some(r);
        }
        if floor + hgt - 1 > MAX_FLOOR {
            return Some("Not enough floors above for this facility.".into());
        }
        if f.basement && floor + hgt > 1 {
            return Some(format!("{} can only be built in the basement.", f.name));
        }
        if covers_ground_floor(floor, hgt) {
            return Some(
                "The ground floor is a lobby concourse. Build rooms on floor 2 and up.".into(),
            );
        }
        if floor < 1 && no_basement(kind) {
            return Some(format!("{} can't be built in the basement.", f.name));
        }
        for fl in floor..floor + hgt {
            if !self.room_span_free(fl, x, f.width) {
                return Some("Something is already here.".into());
            }
            if require_floor && !self.span_has_floor(fl, x, f.width) {
                return Some("Build floors on every story first.".into());
            }
            if self.span_has_lobby(fl, x, f.width) {
                return Some("Lobbies are transit-only. Build rooms on a standard floor.".into());
            }
            if is_sky_lobby_floor(fl) && self.floor_has_lobby(fl) {
                return Some(
                    "This room would sit on a sky lobby. Move it up or down a story.".into(),
                );
            }
        }
        None
    }

    pub fn can_place(&self, kind: Kind, floor: i64, x: i64) -> PlaceResult {
        let f = kind.facility();
        if !(MIN_FLOOR..=MAX_FLOOR).contains(&floor) {
            return PlaceResult::fail("Outside the buildable range.");
        }
        if x < 0 || x + f.width > LOT_WIDTH {
            return PlaceResult::fail("Off the edge of the lot.");
        }
        if f.transport {
            return PlaceResult::fail("Use placeTransport for vertical transport.");
        }
        if self.units.is_empty() && kind != Kind::Lobby {
            return PlaceResult::fail("Lay a lobby on the ground line first to open your tower.");
        }
        if kind.is_structural() {
            if kind == Kind::Lobby && !is_lobby_floor(floor) {
                return PlaceResult::fail(
                    "Lobbies only go on the ground floor and every 15th floor (15, 30, 45…).",
                );
            }
            if kind == Kind::Floor && is_sky_lobby_floor(floor) && self.floor_has_lobby(floor) {
                return PlaceResult::fail("Sky lobbies are concourses. Only lobby tiles go here.");
            }
            if kind == Kind::Lobby && is_sky_lobby_floor(floor) && self.floor_has_room(floor) {
                return PlaceResult::fail("Clear the rooms here first, then place your sky lobby.");
            }
            if !self.structure_span_free(floor, x, f.width) {
                if kind != Kind::Lobby || !self.span_upgradeable_to_lobby(floor, x, f.width) {
                    return PlaceResult::fail("Structure already here.");
                }
                if !self.room_span_free(floor, x, f.width) {
                    return PlaceResult::fail(
                        "Lobbies are transit-only. Clear the rooms here first.",
                    );
                }
            }
            if !self.is_supported(floor, x, f.width) {
                return PlaceResult::fail(if floor >= 2 {
                    "Floors and lobbies must sit on the story below: no floating overhangs."
                } else {
                    "Floors and lobbies must connect to the existing tower."
                });
            }
            return PlaceResult::ok();
        }
        match self.room_placement_reason(kind, floor, x, true) {
            Some(r) => PlaceResult::fail(r),
            None => PlaceResult::ok(),
        }
    }

    pub fn can_place_room_ignoring_floor(&self, kind: Kind, floor: i64, x: i64) -> PlaceResult {
        if kind.is_structural() || kind.is_transport() {
            return PlaceResult::fail("Not a room.");
        }
        match self.room_placement_reason(kind, floor, x, false) {
            Some(r) => PlaceResult::fail(r),
            None => PlaceResult::ok(),
        }
    }

    pub fn can_place_structure_ignoring_support(
        &self,
        kind: Kind,
        floor: i64,
        x: i64,
    ) -> PlaceResult {
        let f = kind.facility();
        if !kind.is_structural() {
            return PlaceResult::fail("Not a structural tile.");
        }
        if !(MIN_FLOOR..=MAX_FLOOR).contains(&floor) {
            return PlaceResult::fail("Outside the buildable range.");
        }
        if x < 0 || x + f.width > LOT_WIDTH {
            return PlaceResult::fail("Off the edge of the lot.");
        }
        if kind == Kind::Lobby && !is_lobby_floor(floor) {
            return PlaceResult::fail(
                "Lobbies only go on the ground floor and every 15th floor (15, 30, 45…).",
            );
        }
        if !self.structure_span_free(floor, x, f.width) {
            if kind != Kind::Lobby || !self.span_upgradeable_to_lobby(floor, x, f.width) {
                return PlaceResult::fail("Structure already here.");
            }
            if !self.room_span_free(floor, x, f.width) {
                return PlaceResult::fail("Lobbies are transit-only. Clear the rooms here first.");
            }
        }
        PlaceResult::ok()
    }

    // ---- mutation --------------------------------------------------------

    pub fn place(&mut self, kind: Kind, floor: i64, x: i64) -> PlaceResult {
        let check = self.can_place(kind, floor, x);
        if !check.ok {
            return check;
        }
        let f = kind.facility();
        if kind == Kind::Lobby {
            for i in 0..f.width {
                if let Some(&sid) = self.structure.get(&(floor, x + i)) {
                    self.remove_unit(sid);
                }
            }
        }
        let id = self.next_id;
        self.next_id += 1;
        let unit = Unit {
            id,
            kind,
            floor,
            x,
            width: f.width,
            state: UnitState::Empty,
            satisfaction: 1.0,
            occupants: 0,
            customers_in: None,
            hotel_customers_in: None,
            out_for_meal: None,
            residents: None,
            ever_occupied: false,
            pending_income: 0.0,
            rent: None,
            no_rate: false,
            label: f.name.to_string(),
            vacate_reason: None,
            vacate_at: None,
            film_policy: None,
            subtype: None,
            patronage_today: None,
            patronage_yest: None,
            profit_today: None,
            profit_yest: None,
            complete_at: None,
            dirty_days: None,
        };
        self.units.push(unit);
        let idx = self.units.len() - 1;
        self.register(idx);
        if kind == Kind::WeddingHall {
            self.built_wedding_hall = true;
        }
        if kind == Kind::Lobby && self.lobby_tile_count(floor) == f.width {
            self.sync_express_stops_for_floor(floor);
        }
        self.revision += 1;
        PlaceResult {
            ok: true,
            reason: None,
            unit_id: Some(id),
        }
    }

    pub fn remove_unit(&mut self, id: i64) -> Option<Unit> {
        let idx = self.units.iter().position(|u| u.id == id)?;
        let u = self.units.remove(idx);
        self.unregister(&u);
        self.reindex_ids();
        if u.kind == Kind::WeddingHall {
            self.built_wedding_hall = self.units.iter().any(|u| u.kind == Kind::WeddingHall);
        }
        if u.kind == Kind::Lobby && !self.floor_has_lobby(u.floor) {
            self.sync_express_stops_for_floor(u.floor);
        }
        self.revision += 1;
        Some(u)
    }

    /// `removalReason`: why a structure tile cannot be sold.
    pub fn removal_reason(&self, id: i64) -> Option<&'static str> {
        let u = self.get_unit(id)?;
        if !u.kind.is_structural() {
            return None;
        }
        if u.kind == Kind::Lobby {
            return Some("Lobby tiles are permanent. The 1994 game does not let you remove them.");
        }
        if u.floor >= 1 && !self.structure_span_free(u.floor + 1, u.x, u.width) {
            return Some("Remove the story above first. Floors can't hang in midair.");
        }
        None
    }

    /// `placeStructureRun`: passes over the tiles until none place.
    pub fn place_structure_run(
        &mut self,
        tiles: &[(i64, i64)],
        kind: Kind,
    ) -> (Vec<i64>, Vec<(i64, i64)>) {
        let mut remaining: Vec<(i64, i64)> = tiles.to_vec();
        let mut placed = Vec::new();
        let mut progress = true;
        while !remaining.is_empty() && progress {
            progress = false;
            let mut next = Vec::new();
            for &(fl, x) in &remaining {
                let r = self.place(kind, fl, x);
                if r.ok {
                    placed.push(r.unit_id.unwrap());
                    progress = true;
                } else {
                    next.push((fl, x));
                }
            }
            remaining = next;
        }
        (placed, remaining)
    }

    /// `ensureFloorUnder`.
    pub fn ensure_floor_under(
        &mut self,
        floor: i64,
        x: i64,
        w: i64,
        hgt: i64,
    ) -> Result<i64, String> {
        let mut tiles = Vec::new();
        for fl in floor..floor + hgt {
            for i in 0..w {
                if !self.structure.contains_key(&(fl, x + i)) {
                    tiles.push((fl, x + i));
                }
            }
        }
        if tiles.is_empty() {
            return Ok(0);
        }
        let (placed, stuck) = self.place_structure_run(&tiles, Kind::Floor);
        if !stuck.is_empty() {
            for id in placed {
                self.remove_unit(id);
            }
            return Err("Build next to the tower. You can't build in midair.".into());
        }
        Ok(placed.len() as i64)
    }

    /// `bridgeFillPlan`: non-mutating.
    pub fn bridge_fill_plan(
        &self,
        kind: Kind,
        floor: i64,
        x: i64,
        w: i64,
        hgt: i64,
    ) -> Vec<(i64, i64)> {
        if kind.is_transport() {
            return Vec::new();
        }
        let substrate = if kind == Kind::Lobby {
            Kind::Lobby
        } else {
            Kind::Floor
        };
        let mut plan: Vec<(i64, i64)> = Vec::new();
        let mut planned: HashMap<i64, Vec<i64>> = HashMap::new();
        for fl in floor..floor + hgt {
            let supportable = |tx: i64, planned: &HashMap<i64, Vec<i64>>| -> bool {
                if fl < 2 {
                    return true;
                }
                self.structure.contains_key(&(fl - 1, tx))
                    || planned.get(&(fl - 1)).is_some_and(|v| v.contains(&tx))
            };
            let mut tx = x - 1;
            while tx >= 0 {
                if let Some(k) = self.struct_kind.get(&(fl, tx)) {
                    if *k == substrate {
                        for g in tx + 1..x {
                            if supportable(g, &planned) {
                                plan.push((fl, g));
                                planned.entry(fl).or_default().push(g);
                            }
                        }
                    }
                    break;
                }
                tx -= 1;
            }
            let mut tx = x + w;
            while tx < LOT_WIDTH {
                if let Some(k) = self.struct_kind.get(&(fl, tx)) {
                    if *k == substrate {
                        let mut g = tx - 1;
                        while g >= x + w {
                            if supportable(g, &planned) {
                                plan.push((fl, g));
                                planned.entry(fl).or_default().push(g);
                            }
                            g -= 1;
                        }
                    }
                    break;
                }
                tx += 1;
            }
        }
        plan
    }

    pub fn fill_bridge(&mut self, kind: Kind, floor: i64, x: i64, w: i64, hgt: i64) -> Vec<i64> {
        let substrate = if kind == Kind::Lobby {
            Kind::Lobby
        } else {
            Kind::Floor
        };
        let plan = self.bridge_fill_plan(kind, floor, x, w, hgt);
        self.place_structure_run(&plan, substrate).0
    }

    // ---- transports ------------------------------------------------------

    pub fn transport_index(&self, id: i64) -> Option<usize> {
        self.transports.iter().position(|t| t.id == id)
    }

    pub fn transport_at(&self, floor: i64, x: i64) -> Option<&Transport> {
        self.transports
            .iter()
            .find(|t| t.bottom <= floor && floor <= t.top && t.x <= x && x < t.x + t.width)
    }

    fn span_reason(&self, kind: Kind, bottom: i64, top: i64) -> Option<String> {
        let max_span = kind.max_span();
        if top - bottom <= max_span {
            return None;
        }
        if kind.is_fixed_span() {
            return Some(format!(
                "{} links exactly two floors.",
                kind.facility().name
            ));
        }
        Some(format!(
            "This elevator can span at most {max_span} floors ({} stops).",
            max_span + 1
        ))
    }

    pub fn validate_transport(&self, kind: Kind, x: i64, bottom: i64, top: i64) -> PlaceResult {
        let f = kind.facility();
        if !f.transport {
            return PlaceResult::fail("Not a transport.");
        }
        if let Some(r) = self.cap_reason(kind) {
            return PlaceResult::fail(r);
        }
        if top <= bottom {
            return PlaceResult::fail("Transport needs height.");
        }
        if x < 0 || x + f.width > LOT_WIDTH {
            return PlaceResult::fail("Off the edge of the lot.");
        }
        if let Some(r) = self.span_reason(kind, bottom, top) {
            return PlaceResult::fail(r);
        }
        if kind == Kind::Escalator && !self.allows_escalator_on_office_floors {
            for fl in [bottom, top] {
                if self
                    .units
                    .iter()
                    .any(|u| u.kind == Kind::Office && u.floor == fl)
                {
                    return PlaceResult::fail(
                        "Escalators can't serve office floors. They link commercial floors only.",
                    );
                }
            }
        }
        for fl in bottom..=top {
            if !self.shaft_has_structure_at(fl, x, f.width) {
                return PlaceResult::fail(NEEDS_FLOORS);
            }
            for t in &self.transports {
                let overlaps =
                    fl >= t.bottom && fl <= t.top && x < t.x + t.width && x + f.width > t.x;
                if overlaps {
                    let stacked = kind.is_fixed_span()
                        && t.kind.is_fixed_span()
                        && t.x == x
                        && t.width == f.width
                        && (bottom == t.top || top == t.bottom);
                    if !stacked {
                        return PlaceResult::fail(SHAFT_OVERLAP);
                    }
                }
            }
        }
        PlaceResult::ok()
    }

    pub fn place_transport(&mut self, kind: Kind, x: i64, bottom: i64, top: i64) -> PlaceResult {
        let v = self.validate_transport(kind, x, bottom, top);
        if !v.ok {
            return v;
        }
        let f = kind.facility();
        let span = top - bottom;
        let cars = if kind.is_elevator() {
            kind.max_cars()
                .min(1.max((span as f64 / 6.0).ceil() as i64))
        } else {
            0
        };
        let id = self.next_id;
        self.next_id += 1;
        let t = Transport {
            id,
            kind,
            x,
            width: f.width,
            bottom,
            top,
            cars,
            car_positions: (0..cars).map(|i| (bottom + i) as f64).collect(),
            car_dir: vec![0; cars as usize],
            car_load: None,
            load: 0,
            skip_floors: None,
            schedule: None,
        };
        self.transports.push(t);
        if kind == Kind::ElevatorExpress {
            self.set_express_stops(id);
        }
        self.revision += 1;
        PlaceResult {
            ok: true,
            reason: None,
            unit_id: Some(id),
        }
    }

    /// `setExpressStops`: skip every non-lobby floor strictly inside the span.
    pub fn set_express_stops(&mut self, id: i64) {
        let lobbies = self.lobby_floors();
        let Some(i) = self.transport_index(id) else {
            return;
        };
        let (bottom, top) = (self.transports[i].bottom, self.transports[i].top);
        let skip: Vec<i64> = (bottom + 1..top)
            .filter(|fl| !lobbies.contains(fl))
            .collect();
        self.transports[i].skip_floors = Some(skip);
        self.revision += 1;
        if self.transports[i].schedule.is_some() {
            let stops = self.stops_of(&self.transports[i]);
            let t = &mut self.transports[i];
            t.schedule = Some(t.schedule.as_ref().unwrap().snap_homes_to_stops(&stops));
        }
    }

    pub fn sync_express_stops_for_floor(&mut self, floor: i64) {
        let has_lobby = self.floor_has_lobby(floor);
        let ids: Vec<i64> = self
            .transports
            .iter()
            .filter(|t| t.kind == Kind::ElevatorExpress && t.bottom < floor && floor < t.top)
            .map(|t| t.id)
            .collect();
        for id in ids {
            self.set_stop(id, floor, has_lobby);
        }
    }

    pub fn set_stop(&mut self, id: i64, floor: i64, stop: bool) -> bool {
        let Some(i) = self.transport_index(id) else {
            return false;
        };
        let t = &self.transports[i];
        if floor < t.bottom || floor > t.top {
            return false;
        }
        if floor == t.bottom || floor == t.top {
            return true;
        }
        if t.kind == Kind::ElevatorExpress && stop && !self.floor_has_lobby(floor) {
            return false;
        }
        let mut skip: Vec<i64> = self.transports[i].skip_floors.clone().unwrap_or_default();
        if stop {
            skip.retain(|&f| f != floor);
        } else if !skip.contains(&floor) {
            skip.push(floor);
        }
        skip.sort();
        self.transports[i].skip_floors = Some(skip);
        self.revision += 1;
        if self.transports[i].schedule.is_some() {
            let stops = self.stops_of(&self.transports[i]);
            let t = &mut self.transports[i];
            t.schedule = Some(t.schedule.as_ref().unwrap().snap_homes_to_stops(&stops));
        }
        true
    }

    pub fn remove_transport(&mut self, id: i64) -> Option<Transport> {
        let i = self.transport_index(id)?;
        let t = self.transports.remove(i);
        self.revision += 1;
        Some(t)
    }

    pub fn set_cars(&mut self, id: i64, cars: i64) -> bool {
        let Some(i) = self.transport_index(id) else {
            return false;
        };
        let t = &mut self.transports[i];
        if !t.kind.is_elevator() {
            return false;
        }
        let cars = 1.max(t.kind.max_cars().min(cars));
        if cars == t.cars {
            return false;
        }
        if cars > t.cars {
            for _ in t.cars..cars {
                t.car_positions.push(t.bottom as f64);
                t.car_dir.push(1);
            }
        } else {
            t.car_positions.truncate(cars as usize);
            t.car_dir.truncate(cars as usize);
        }
        if let Some(load) = &t.car_load {
            t.car_load = Some(
                (0..cars as usize)
                    .map(|i| load.get(i).copied().unwrap_or(0.0))
                    .collect(),
            );
        }
        t.cars = cars;
        if t.schedule.is_some() {
            let raw = t.schedule.as_ref().unwrap().to_json();
            t.schedule = Schedule::coerce(Some(&raw), t.cars, t.bottom, t.top);
        }
        self.revision += 1;
        true
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
            let mut skip: Vec<i64> = self.transports[i].skip_floors.clone().unwrap_or_default();
            for fl in bottom + 1..top {
                if !self.floor_has_lobby(fl) && !skip.contains(&fl) {
                    skip.push(fl);
                }
            }
            skip.retain(|&f| f != bottom && f != top);
            let mut next: Vec<i64> = Vec::new();
            for f in skip {
                if !next.contains(&f) {
                    next.push(f);
                }
            }
            next.sort();
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
