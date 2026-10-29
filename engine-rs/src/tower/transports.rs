//! Elevators, stairs and escalators

use serde_json::Value;

use super::{PlaceResult, ResizeResult, Tower, Transport};
use crate::facilities::*;
use crate::schedule::Schedule;

impl Tower {
    // ---- transports ------------------------------------------------------

    pub fn transport_index(&self, id: i64) -> Option<usize> {
        debug_assert_eq!(self.transport_by_id.len(), self.transports.len());
        let i = *self.transport_by_id.get(&id)?;
        // One index and compare on every lookup, in release builds too: a
        // stale map is a programming error, and the referee runs in release,
        // where a silent miss would surface only as unexplained digest drift.
        assert_eq!(
            self.transports.get(i).map(|t| t.id),
            Some(id),
            "transport index points at the wrong shaft; writes to `transports` go through add, remove or reindex"
        );
        Some(i)
    }

    /// Rebuild `transport_by_id`. `Vec::remove` shifts every later index,
    /// so a removal (called from player edits and from load today) rebuilds the
    /// map where the TypeScript `Map.delete` is O(1).
    pub(super) fn reindex_transports(&mut self) {
        self.transport_by_id.clear();
        for (i, t) in self.transports.iter().enumerate() {
            self.transport_by_id.insert(t.id, i);
        }
    }

    pub fn transport_at(&self, floor: i64, x: i64) -> Option<&Transport> {
        self.transports
            .iter()
            .find(|t| t.bottom <= floor && floor <= t.top && t.x <= x && x < t.x + t.width)
    }

    fn span_reason(&self, kind: Kind, bottom: i64, top: i64) -> Option<String> {
        let max_span = kind.max_span();
        if top.saturating_sub(bottom) <= max_span {
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
        if x < 0 || x.saturating_add(f.width) > LOT_WIDTH {
            return PlaceResult::fail("Off the edge of the lot.");
        }
        if let Some(r) = self.span_reason(kind, bottom, top) {
            return PlaceResult::fail(r);
        }
        if kind == Kind::Escalator && !self.allows_escalator_on_office_floors {
            for fl in [bottom, top] {
                if self.has_office_on(fl) {
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
        self.transport_by_id.insert(id, self.transports.len());
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
        let skip: Vec<f64> = (bottom + 1..top)
            .filter(|fl| !lobbies.contains(fl))
            .map(|fl| fl as f64)
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
        let mut skip: Vec<f64> = self.transports[i].skip_floors.clone().unwrap_or_default();
        let floor = floor as f64;
        if stop {
            skip.retain(|&f| f != floor);
        } else if !skip.contains(&floor) {
            skip.push(floor);
        }
        skip.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        // The TypeScript rebuilds the list from a Set, so a loaded duplicate
        // goes away on the first toggle.
        skip.dedup();
        self.transports[i].skip_floors = Some(skip);
        self.revision += 1;
        if self.transports[i].schedule.is_some() {
            let stops = self.stops_of(&self.transports[i]);
            let t = &mut self.transports[i];
            t.schedule = Some(t.schedule.as_ref().unwrap().snap_homes_to_stops(&stops));
        }
        true
    }

    /// `transportOverlaps(t, x, width, floor)`.
    fn transport_overlaps(t: &Transport, x: i64, width: i64, floor: i64) -> bool {
        if floor < t.bottom || floor > t.top {
            return false;
        }
        x < t.x + t.width && x + width > t.x
    }

    /// `layShaftFloors(floors, x, width)`: plain floor across the shaft's
    /// footprint on each floor that lacks it, in support order; `None` (with
    /// the batch rolled back) when a tile can never be supported.
    pub fn lay_shaft_floors(&mut self, floors: &[i64], x: i64, width: i64) -> Option<Vec<i64>> {
        let mut tiles = Vec::new();
        for &fl in floors {
            for i in 0..width {
                if !self.structure.contains_key(&(fl, x + i)) {
                    tiles.push((fl, x + i));
                }
            }
        }
        if tiles.is_empty() {
            return Some(Vec::new());
        }
        let (placed, stuck) = self.place_structure_run(&tiles, Kind::Floor);
        if !stuck.is_empty() {
            self.remove_units(&placed);
            return None;
        }
        Some(placed)
    }

    /// `resizeTransport(id, newBottom, newTop)`: grow or shrink a shaft's
    /// served range, laying plain floor behind newly served floors. Returns
    /// the floors added (negative for a shrink) and the floor tiles laid.
    pub fn resize_transport(&mut self, id: i64, new_bottom: i64, new_top: i64) -> ResizeResult {
        let Some(i) = self.transport_index(id) else {
            return ResizeResult::fail("No such transport.");
        };
        if new_top <= new_bottom {
            return ResizeResult::fail("Transport needs height.");
        }
        if new_bottom < MIN_FLOOR || new_top > MAX_FLOOR {
            return ResizeResult::fail("Outside the buildable range.");
        }
        let (kind, tx, twidth, prev_bottom, prev_top) = {
            let t = &self.transports[i];
            (t.kind, t.x, t.width, t.bottom, t.top)
        };
        if let Some(reason) = self.span_reason(kind, new_bottom, new_top) {
            return ResizeResult::fail(reason);
        }
        let mut new_floors = Vec::new();
        for fl in new_bottom..=new_top {
            if fl >= prev_bottom && fl <= prev_top {
                continue;
            }
            for other in &self.transports {
                if other.id == id {
                    continue;
                }
                if Self::transport_overlaps(other, tx, twidth, fl) {
                    return ResizeResult::fail(SHAFT_OVERLAP);
                }
            }
            if is_sky_lobby_floor(fl) && !self.span_has_floor(fl, tx, twidth) {
                return ResizeResult::fail(format!(
                    "Build the sky lobby on floor {fl} first, then extend through it."
                ));
            }
            new_floors.push(fl);
        }
        let Some(created) = self.lay_shaft_floors(&new_floors, tx, twidth) else {
            return ResizeResult::fail(NEEDS_FLOORS);
        };
        let before = prev_top - prev_bottom + 1;
        {
            let t = &mut self.transports[i];
            t.bottom = new_bottom;
            t.top = new_top;
            for p in t.car_positions.iter_mut() {
                *p = p.min(new_top as f64).max(new_bottom as f64);
            }
        }
        if kind == Kind::ElevatorExpress {
            // Keep the in-span choices, drop the new endpoints, skip the
            // newly served non-lobby floors.
            let mut skip: Vec<f64> = Vec::new();
            for &f in self.transports[i].skip_floors.as_deref().unwrap_or(&[]) {
                if f > new_bottom as f64 && f < new_top as f64 && !skip.contains(&f) {
                    skip.push(f);
                }
            }
            for fl in new_bottom + 1..new_top {
                if fl >= prev_bottom && fl <= prev_top {
                    continue;
                }
                let f = fl as f64;
                if !self.floor_has_lobby(fl) && !skip.contains(&f) {
                    skip.push(f);
                }
            }
            skip.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            self.transports[i].skip_floors = Some(skip);
        }
        self.revision += 1;
        let (cars, bottom, top) = {
            let t = &self.transports[i];
            (t.cars, t.bottom, t.top)
        };
        if let Some(sch) = self.transports[i].schedule.take() {
            let raw = sch.to_json();
            self.transports[i].schedule = Schedule::coerce(Some(&raw), cars, bottom, top);
        }
        if self.transports[i].schedule.is_some() {
            let stops = self.stops_of(&self.transports[i]);
            let t = &mut self.transports[i];
            t.schedule = Some(t.schedule.as_ref().unwrap().snap_homes_to_stops(&stops));
        }
        ResizeResult {
            ok: true,
            reason: None,
            added: new_top - new_bottom + 1 - before,
            floor_tiles_created: created.len() as i64,
        }
    }

    /// `clearStops(id)`: every floor stops again (an express keeps its
    /// lobby-only rule).
    pub fn clear_stops(&mut self, id: i64) -> bool {
        let Some(i) = self.transport_index(id) else {
            return false;
        };
        if self.transports[i].kind == Kind::ElevatorExpress {
            self.set_express_stops(id);
            return true;
        }
        self.transports[i].skip_floors = Some(Vec::new());
        self.revision += 1;
        true
    }

    pub fn remove_transport(&mut self, id: i64) -> Option<Transport> {
        let i = self.transport_index(id)?;
        let t = self.transports.remove(i);
        self.reindex_transports();
        self.revision += 1;
        Some(t)
    }

    /// `setSchedule(id, raw)`: an authored per-shaft schedule, hardened
    /// through `Schedule::coerce` against the live cars and span, homes
    /// snapped onto the shaft's stops. False for a non-elevator id.
    pub fn set_schedule(&mut self, id: i64, raw: &Value) -> bool {
        let Some(i) = self.transport_index(id) else {
            return false;
        };
        if !self.transports[i].kind.is_elevator() {
            return false;
        }
        self.revision += 1;
        let (cars, bottom, top) = {
            let t = &self.transports[i];
            (t.cars, t.bottom, t.top)
        };
        let coerced = Schedule::coerce(Some(raw), cars, bottom, top);
        self.transports[i].schedule = coerced.map(|sch| {
            let stops = self.stops_of(&self.transports[i]);
            sch.snap_homes_to_stops(&stops)
        });
        true
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
