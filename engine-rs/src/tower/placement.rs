//! Placing rooms and structure, and the support rules behind it.

use std::collections::HashMap;

use super::{PlaceResult, Tower, Unit, UnitState};
use crate::facilities::*;

impl Tower {
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

    /// The metro rules: SimTower's station is three stories on B8 to B10 with
    /// its tunnel along the bottom row, and nothing can be built below it. The
    /// bottom basement row holds only the station and its tunnel.
    fn metro_reason(&self, kind: Kind, floor: i64) -> Option<String> {
        if kind == Kind::Metro {
            if self.floor_bounds().0 < floor {
                return Some(
                    "Nothing can be built below the metro station. Clear the floors under it first."
                        .into(),
                );
            }
            if self.floor_has_room(floor) {
                return Some("The metro's bottom row is its tunnel. Clear it first.".into());
            }
            return None;
        }
        let structural = kind.is_structural();
        if let Some(station) = self.metro_floor() {
            if floor < station {
                return Some("Nothing can be built below the metro station.".into());
            }
            if floor == station && !structural {
                return Some("The metro's bottom row is its tunnel.".into());
            }
        }
        if floor == MIN_FLOOR && !structural {
            return Some("The bottom basement row is only for the metro tunnel.".into());
        }
        None
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
        if x < 0 || x.saturating_add(f.width) > LOT_WIDTH {
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
        if let Some(r) = self.metro_reason(kind, floor) {
            return Some(r);
        }
        None
    }

    pub fn can_place(&self, kind: Kind, floor: i64, x: i64) -> PlaceResult {
        let f = kind.facility();
        if !(MIN_FLOOR..=MAX_FLOOR).contains(&floor) {
            return PlaceResult::fail("Outside the buildable range.");
        }
        if x < 0 || x.saturating_add(f.width) > LOT_WIDTH {
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
            if let Some(r) = self.metro_reason(kind, floor) {
                return PlaceResult::fail(r);
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
        if x < 0 || x.saturating_add(f.width) > LOT_WIDTH {
            return PlaceResult::fail("Off the edge of the lot.");
        }
        if kind == Kind::Lobby && !is_lobby_floor(floor) {
            return PlaceResult::fail(
                "Lobbies only go on the ground floor and every 15th floor (15, 30, 45…).",
            );
        }
        if let Some(r) = self.metro_reason(kind, floor) {
            return PlaceResult::fail(r);
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
            complete_at_raw: None,
            dirty_days: None,
        };
        // In-place floor to lobby upgrade: clear the plain floor tiles being
        // replaced before registering the lobby. Inside the lobby brush a
        // lobby over one tile takes that tile's place in the unit list, and
        // the brush moves what it placed to the end once (tower_removal.rs).
        let mut slot = None;
        if kind == Kind::Lobby {
            let under: Vec<i64> = (0..f.width)
                .filter_map(|i| self.structure.get(&(floor, x + i)).copied())
                .collect();
            if let [only] = under[..] {
                slot = self.take_floor_slot(only);
            }
            if slot.is_none() {
                self.remove_units(&under);
            }
        }
        let idx = self.add_unit(unit, slot);
        self.register(idx);
        if kind == Kind::WeddingHall {
            self.built_wedding_hall = Some(true);
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
            self.remove_units(&placed);
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
        // A footprint off the lot or outside the floor range has no bridge:
        // every caller refuses it on those rules before the plan can count,
        // so skipping the scan changes no answer, and an x far off the lot no
        // longer scans one tile at a time back to it (#1003).
        if x < 0
            || x.saturating_add(w) > LOT_WIDTH
            || floor < MIN_FLOOR
            || floor.saturating_add(hgt - 1) > MAX_FLOOR
        {
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
}
