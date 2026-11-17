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

    /// The index of shaft `id` that the caller is about to write, noted for
    /// the open undo gesture.
    pub(super) fn transport_index_edit(&mut self, id: i64) -> Option<usize> {
        let i = self.transport_index(id)?;
        if let Some(j) = self.journal.as_mut() {
            j.transport_edit(i, &self.transports[i]);
        }
        Some(i)
    }

    /// Someone got on shaft `id` ([`Transport::rides`]).
    pub(crate) fn note_ride(&mut self, id: i64) {
        if let Some(i) = self.transport_index(id) {
            self.transports[i].rides += 1;
        }
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

    fn span_reason(&self, kind: Kind, x: i64, bottom: i64, top: i64) -> Option<String> {
        let mut max_span = self.lot().max_span(kind);
        if kind.is_fixed_span() {
            max_span = max_span.max(self.walkway_span_under(kind, x, bottom)); // #308
        }
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
        let top = self.walkway_top(kind, x, bottom, top);
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
        if let Some(r) = self.span_reason(kind, x, bottom, top) {
            return PlaceResult::fail(r);
        }
        if let Some(r) = self.express_anchor_reason(kind, bottom, top) {
            return PlaceResult::fail(r);
        }
        if let Some(r) = self.tall_lobby_shaft_reason(x, f.width, bottom, top) {
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
        let top = self.walkway_top(kind, x, bottom, top);
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
            preserve_basement_stops: kind == Kind::ElevatorExpress,
            classic_express_stops: kind == Kind::ElevatorExpress
                && self.mode.express_stops_on_15th_floors(),
            // A Modern elevator starts with Auto on (owner, 2026-11-17).
            schedule: (kind.is_elevator() && self.mode.schedule_assist())
                .then(Schedule::auto_only),
            rides: 0,
        };
        self.transport_by_id.insert(id, self.transports.len());
        if let Some(j) = self.journal.as_mut() {
            j.transport_in(t.id);
        }
        self.transports.push(t);
        if kind == Kind::ElevatorExpress {
            self.set_express_stops(id);
        }
        self.skip_tall_lobby_stories(id);
        self.revision += 1;
        PlaceResult {
            ok: true,
            reason: None,
            unit_id: Some(id),
        }
    }

    pub fn set_stop(&mut self, id: i64, floor: i64, stop: bool) -> bool {
        let Some(i) = self.transport_index_edit(id) else {
            return false;
        };
        let t = &self.transports[i];
        if floor < t.bottom || floor > t.top {
            return false;
        }
        let express = t.kind == Kind::ElevatorExpress;
        // A Classic express's ends follow the same rule as its other floors;
        // every other shaft always stops at both ends.
        let ends_toggle = express && self.mode.express_stops_on_15th_floors();
        if (floor == t.bottom || floor == t.top) && !ends_toggle {
            return true;
        }
        let express_cannot_stop = express && !self.express_may_stop(floor);
        let in_tall_lobby = self.raised_lobby_at(floor, t.x, t.width).is_some();
        if stop && (express_cannot_stop || in_tall_lobby) {
            return false;
        }
        let mut skip: Vec<f64> = self.transports[i].skip_floors.clone().unwrap_or_default();
        let floor = floor as f64;
        if stop {
            skip.retain(|&f| f != floor);
        } else if !skip.contains(&floor) {
            skip.push(floor);
        }
        // A Classic express keeps at least one stop: with none its cars
        // would stand and its riders have nowhere to get off.
        if ends_toggle && !(t.bottom..=t.top).any(|fl| !skip.contains(&(fl as f64))) {
            return false;
        }
        skip.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        // The TypeScript rebuilds the list from a Set, so a loaded duplicate
        // goes away on the first toggle.
        skip.dedup();
        self.transports[i].skip_floors = Some(skip);
        self.revision += 1;
        self.snap_schedule_homes(i);
        true
    }

    /// `transportOverlaps(t, x, width, floor)`.
    pub(super) fn transport_overlaps(t: &Transport, x: i64, width: i64, floor: i64) -> bool {
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
        self.resize_transport_noting(id, new_bottom, new_top, &mut None)
    }

    /// `resize_transport`, also noting in `refused_at` the newly served floor
    /// that refused it (another shaft in the way, or a lobby not built). New
    /// floors are checked outward from the old span, so for a one-ended
    /// extend that is the refusing floor nearest the old end, and the extend
    /// can stop just short of it without walking the floors twice (#1847).
    pub(crate) fn resize_transport_noting(
        &mut self,
        id: i64,
        new_bottom: i64,
        new_top: i64,
        refused_at: &mut Option<i64>,
    ) -> ResizeResult {
        let Some(i) = self.transport_index_edit(id) else {
            return ResizeResult::fail("No such transport.");
        };
        if new_top <= new_bottom {
            return ResizeResult::fail("Transport needs height.");
        }
        if new_bottom < MIN_FLOOR || new_top > self.lot().top_floor() {
            return ResizeResult::fail("Outside the buildable range.");
        }
        let (kind, tx, twidth, prev_bottom, prev_top) = {
            let t = &self.transports[i];
            (t.kind, t.x, t.width, t.bottom, t.top)
        };
        if let Some(reason) = self
            .span_reason(kind, tx, new_bottom, new_top)
            .or_else(|| {
                self.express_anchor_reason(kind, new_bottom, new_top)
                    .map(String::from)
            })
            .or_else(|| self.tall_lobby_shaft_reason(tx, twidth, new_bottom, new_top))
        {
            return ResizeResult::fail(reason);
        }
        let above = (prev_top + 1).max(new_bottom)..=new_top;
        let below = (new_bottom..=(prev_bottom - 1).min(new_top)).rev();
        let mut new_floors = Vec::new();
        for fl in above.chain(below) {
            if let Some(reason) = self.new_floor_refusal(id, tx, twidth, fl) {
                *refused_at = Some(fl);
                return ResizeResult::fail(reason);
            }
            new_floors.push(fl);
        }
        new_floors.sort_unstable();
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
        if kind == Kind::ElevatorExpress && self.mode.express_stops_on_15th_floors() {
            self.transports[i].skip_floors = Some(self.classic_express_resized_skips(i));
        } else if kind == Kind::ElevatorExpress {
            // Keep old strict-interior choices, drop the new endpoints, and
            // skip newly interior non-lobby floors above the basements.
            // Former endpoints no longer
            // qualify for an unconditional stop after an extension.
            let mut skip: Vec<f64> = Vec::new();
            for &f in self.transports[i].skip_floors.as_deref().unwrap_or(&[]) {
                if f > new_bottom as f64 && f < new_top as f64 && !skip.contains(&f) {
                    skip.push(f);
                }
            }
            for fl in new_bottom + 1..new_top {
                // Preserve old strict-interior choices, but reclassify the
                // former endpoints when they become interior floors.
                if fl > prev_bottom && fl < prev_top {
                    continue;
                }
                let f = fl as f64;
                if !is_basement(fl) && !self.floor_has_lobby(fl) && !skip.contains(&f) {
                    skip.push(f);
                }
            }
            skip.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            self.transports[i].skip_floors = Some(skip);
        }
        self.skip_tall_lobby_stories(id);
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

    /// `clearStops(id)`: every floor stops again (an express goes back to
    /// every stop its rule allows).
    pub fn clear_stops(&mut self, id: i64) -> bool {
        let Some(i) = self.transport_index_edit(id) else {
            return false;
        };
        if self.transports[i].kind == Kind::ElevatorExpress {
            self.set_express_stops(id);
            return true;
        }
        self.transports[i].skip_floors = Some(Vec::new());
        self.skip_tall_lobby_stories(id);
        self.revision += 1;
        true
    }

    pub fn remove_transport(&mut self, id: i64) -> Option<Transport> {
        let i = self.transport_index(id)?;
        if let Some(j) = self.journal.as_mut() {
            j.transport_out(i, &self.transports[i]);
        }
        let t = self.transports.remove(i);
        self.reindex_transports();
        self.revision += 1;
        Some(t)
    }

    /// `setSchedule(id, raw)`: an authored per-shaft schedule, hardened
    /// through `Schedule::coerce` against the live cars and span. New or
    /// changed staging homes snap to stops, but editing shift counts must not
    /// move unchanged legacy homes (#1557). False for a non-elevator id.
    pub fn set_schedule(&mut self, id: i64, raw: &Value) -> bool {
        let Some(i) = self.transport_index_edit(id) else {
            return false;
        };
        if !self.transports[i].kind.is_elevator() {
            return false;
        }
        self.revision += 1;
        let t = &self.transports[i];
        let (cars, bottom, top) = (t.cars, t.bottom, t.top);
        let raw = &Schedule::keeping_untouched_held(raw, t.schedule.as_ref());
        // A legacy save may keep a home floor that later stop rules would
        // otherwise snap. Editing only the active-car rows must preserve it.
        let previous_homes = self.transports[i]
            .schedule
            .as_ref()
            .and_then(|s| s.home_floors.clone());
        let mut coerced = Schedule::coerce(Some(raw), cars, bottom, top);
        if !self.mode.schedule_assist() {
            // Auto is a Modern assist; a Classic schedule never carries it.
            coerced = coerced.and_then(|mut sch| {
                sch.auto_tune = false;
                (!sch.is_empty()).then_some(sch)
            });
        }
        self.transports[i].schedule = coerced.map(|sch| {
            if sch.home_floors == previous_homes {
                sch
            } else {
                let stops = self.stops_of(&self.transports[i]);
                sch.snap_homes_to_stops(&stops)
            }
        });
        true
    }

    /// Whether a shaft's schedule has Auto on, which a save carries as
    /// version 12.
    pub fn runs_an_auto_schedule(&self) -> bool {
        let auto = |t: &Transport| t.schedule.as_ref().is_some_and(|s| s.auto_tune);
        self.transports.iter().any(auto)
    }

    /// Whether a shaft's schedule holds an hour back (#1546), which a save
    /// carries as version 10.
    pub fn holds_an_hour_back(&self) -> bool {
        let held = |t: &Transport| t.schedule.as_ref().is_some_and(Schedule::holds_an_hour);
        self.transports.iter().any(held)
    }

    pub fn set_cars(&mut self, id: i64, cars: i64) -> bool {
        let Some(i) = self.transport_index_edit(id) else {
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
        let was = t.cars;
        t.cars = cars;
        // The duty pattern follows the fleet (#1546, `Schedule::refit`).
        if let Some(s) = t.schedule.as_mut() {
            s.refit(was, cars);
            let raw = s.to_json();
            t.schedule = Schedule::coerce(Some(&raw), t.cars, t.bottom, t.top);
        }
        self.revision += 1;
        true
    }
}
