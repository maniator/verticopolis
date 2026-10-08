//! Read-side tower queries: ports of `tower/routing.ts`, `tower/transport.ts`
//! (the stop and distance helpers), `tower/segments.ts`, `tower/rooms.ts` and
//! `census.ts`. Memos are keyed on `revision` the way the TypeScript caches are.

use std::collections::{HashMap, HashSet};

use crate::facilities::*;
use crate::tower::{Tower, Transport, Unit, UnitState};

#[derive(Default)]
pub struct Memo {
    pub served: Option<(i64, HashSet<i64>)>,
    pub stops: HashMap<i64, (i64, Vec<i64>)>,
    pub segs: Option<(i64, HashMap<i64, Vec<(i64, i64)>>)>,
    pub staff: Option<(i64, HashMap<i64, i64>)>,
    pub cols: Option<(i64, HashMap<i64, Vec<(i64, i64)>>)>,
}

// ---- unit state predicates (types.ts) --------------------------------------

impl Unit {
    pub fn is_operational(&self) -> bool {
        !matches!(
            self.state,
            UnitState::Construction | UnitState::Fire | UnitState::Gutted
        )
    }

    pub fn is_present(&self) -> bool {
        matches!(
            self.state,
            UnitState::Occupied | UnitState::Asleep | UnitState::MovingIn | UnitState::Vacating
        )
    }

    pub fn is_tenanted(&self) -> bool {
        matches!(self.state, UnitState::Occupied | UnitState::Vacating)
    }

    pub fn is_dormant(&self) -> bool {
        matches!(
            self.state,
            UnitState::Empty
                | UnitState::Construction
                | UnitState::Fire
                | UnitState::Gutted
                | UnitState::Infested
        )
    }

    /// `residentCount`.
    pub fn resident_count(&self) -> i64 {
        if self.kind.has_household() {
            if let Some(r) = self.residents {
                return r;
            }
        }
        self.kind.facility().population
    }

    /// `censusCount`.
    pub fn census_count(&self) -> i64 {
        if self.kind.is_commercial() && self.kind.facility().population > 0 {
            return self.customers_in.unwrap_or(0);
        }
        self.resident_count()
    }

    /// `syncAttendanceOccupants`.
    pub fn sync_attendance_occupants(&mut self) {
        if self.kind.attendance_cap().is_none() {
            return;
        }
        self.occupants = if self.is_operational() {
            self.customers_in.unwrap_or(0)
        } else {
            0
        };
    }

    /// `visibleOccupants`.
    pub fn visible_occupants(&self) -> i64 {
        (self.occupants - self.out_for_meal.unwrap_or(0)).max(0)
    }
}

/// `segId`.
pub fn seg_id(floor: i64, start_x: i64) -> i64 {
    (floor - MIN_FLOOR) * LOT_WIDTH + start_x
}

/// A segment id no node can carry (a fractional JavaScript id).
pub const NO_SEGMENT: i64 = i64::MIN + 1;

/// `floorOfSeg`.
pub fn floor_of_seg(seg: i64) -> i64 {
    seg.div_euclid(LOT_WIDTH) + MIN_FLOOR
}

impl Tower {
    pub fn get_transport(&self, id: i64) -> Option<&Transport> {
        self.transports.iter().find(|t| t.id == id)
    }

    pub fn get_transport_mut(&mut self, id: i64) -> Option<&mut Transport> {
        self.transports.iter_mut().find(|t| t.id == id)
    }

    /// `roomAt`: the room covering a tile, structure excluded.
    pub fn room_at(&self, floor: i64, x: i64) -> Option<&Unit> {
        let id = self.rooms.get(&(floor, x))?;
        self.get_unit(*id)
    }

    /// `roomUnits`: every non-structural unit, in list order.
    pub fn room_units(&self) -> impl Iterator<Item = &Unit> {
        self.units.iter().filter(|u| !u.kind.is_structural())
    }

    /// Indices of the room units, for loops that must mutate them.
    pub fn room_indices(&self) -> Vec<usize> {
        (0..self.units.len())
            .filter(|&i| !self.units[i].kind.is_structural())
            .collect()
    }

    pub fn bump_meal_overlay_revision(&mut self) {
        self.meal_overlay_revision += 1;
    }

    /// `stopsOf`.
    pub fn stops_of(&self, t: &Transport) -> Vec<i64> {
        {
            let memo = self.memo.borrow();
            if let Some((rev, s)) = memo.stops.get(&t.id) {
                if *rev == self.revision {
                    return s.clone();
                }
            }
        }
        let s: Vec<i64> = (t.bottom..=t.top).filter(|&fl| t.stops_at(fl)).collect();
        self.memo
            .borrow_mut()
            .stops
            .insert(t.id, (self.revision, s.clone()));
        s
    }

    /// `servedFloors`: the fixpoint of floors a passenger transport chain
    /// connects to the ground lobby.
    pub fn served_floors(&self) -> HashSet<i64> {
        {
            let memo = self.memo.borrow();
            if let Some((rev, s)) = &memo.served {
                if *rev == self.revision {
                    return s.clone();
                }
            }
        }
        let mut reachable: HashSet<i64> = HashSet::new();
        reachable.insert(1);
        let mut changed = true;
        while changed {
            changed = false;
            for t in &self.transports {
                if t.kind.is_staff_only_transport() {
                    continue;
                }
                let connects = (t.bottom..=t.top).any(|fl| t.stops_at(fl) && reachable.contains(&fl));
                if connects {
                    for fl in t.bottom..=t.top {
                        if t.stops_at(fl) && !reachable.contains(&fl) {
                            reachable.insert(fl);
                            changed = true;
                        }
                    }
                }
            }
        }
        self.memo.borrow_mut().served = Some((self.revision, reachable.clone()));
        reachable
    }

    pub fn is_floor_served(&self, floor: i64) -> bool {
        floor == 1 || self.served_floors().contains(&floor)
    }

    pub fn is_metro_platform_served(&self, station: &Unit) -> bool {
        self.is_floor_served(station.floor + 1)
    }

    /// `staffComponents`: floor -> component id over service elevators and stairs.
    pub fn staff_components(&self) -> HashMap<i64, i64> {
        {
            let memo = self.memo.borrow();
            if let Some((rev, s)) = &memo.staff {
                if *rev == self.revision {
                    return s.clone();
                }
            }
        }
        let mut comp: HashMap<i64, i64> = HashMap::new();
        let mut next = 0;
        for t in &self.transports {
            if !t.kind.is_staff_transport() {
                continue;
            }
            let stops = self.stops_of(t);
            if stops.len() < 2 {
                continue;
            }
            let mut id: Option<i64> = None;
            for f in &stops {
                let Some(&c) = comp.get(f) else { continue };
                match id {
                    None => id = Some(c),
                    Some(i) if c != i => {
                        for v in comp.values_mut() {
                            if *v == c {
                                *v = i;
                            }
                        }
                    }
                    _ => {}
                }
            }
            let id = id.unwrap_or_else(|| {
                next += 1;
                next - 1
            });
            for f in &stops {
                comp.insert(*f, id);
            }
        }
        self.memo.borrow_mut().staff = Some((self.revision, comp.clone()));
        comp
    }

    pub fn staff_connected(&self, a: i64, b: i64) -> bool {
        if a == b {
            return true;
        }
        let comp = self.staff_components();
        match comp.get(&a) {
            Some(ca) => comp.get(&b) == Some(ca),
            None => false,
        }
    }

    /// `functionalParkingSet`: parking-space ids chained to a ramp.
    pub fn functional_parking_set(&self) -> HashSet<i64> {
        let usable = |u: Option<&Unit>| {
            u.is_some_and(|u| matches!(u.kind, Kind::Parking | Kind::ParkingRamp) && u.is_operational())
        };
        let mut stack: Vec<(i64, i64)> = Vec::new();
        for u in &self.units {
            if u.kind == Kind::ParkingRamp && u.is_operational() {
                for i in 0..u.width {
                    stack.push((u.floor, u.x + i));
                }
            }
        }
        let mut visited: HashSet<(i64, i64)> = HashSet::new();
        let mut reached: HashSet<i64> = HashSet::new();
        while let Some((f, x)) = stack.pop() {
            if !visited.insert((f, x)) {
                continue;
            }
            let u = self.room_at(f, x);
            if !usable(u) {
                continue;
            }
            let u = u.unwrap();
            if u.kind == Kind::Parking {
                reached.insert(u.id);
            }
            stack.push((f, x - 1));
            stack.push((f, x + 1));
            if u.kind == Kind::ParkingRamp {
                stack.push((f - 1, x));
                stack.push((f + 1, x));
            }
        }
        reached
    }

    pub fn functional_parking_spots(&self) -> i64 {
        self.functional_parking_set().len() as i64
    }

    /// `totalPopulation`.
    pub fn total_population(&self) -> i64 {
        self.room_units()
            .filter(|u| u.is_present())
            .map(|u| u.census_count())
            .sum()
    }

    /// `associatedPopulation`.
    pub fn associated_population(&self, exclude_hotel_origin: bool) -> i64 {
        let mut pop = 0;
        for u in self.room_units() {
            let out = u.out_for_meal.unwrap_or(0);
            if out <= 0 || !u.is_present() {
                continue;
            }
            if exclude_hotel_origin && u.kind.is_hotel() {
                continue;
            }
            pop += out;
        }
        pop
    }

    /// `nearestLobbyFloorDistance`.
    pub fn nearest_lobby_floor_distance(&self, floor: i64) -> i64 {
        let mut best = (floor - 1).abs();
        for lf in self.lobby_tiles.keys() {
            let d = (floor - lf).abs();
            if d < best {
                best = d;
            }
        }
        best
    }

    /// `transportColumns`.
    pub fn transport_columns(&self, floor: i64) -> Vec<(i64, i64)> {
        {
            let memo = self.memo.borrow();
            if let Some((rev, m)) = &memo.cols {
                if *rev == self.revision {
                    return m.get(&floor).cloned().unwrap_or_default();
                }
            }
        }
        let served = self.served_floors();
        let mut m: HashMap<i64, Vec<(i64, i64)>> = HashMap::new();
        for t in &self.transports {
            if t.kind.is_staff_only_transport() {
                continue;
            }
            for fl in t.bottom..=t.top {
                if !t.stops_at(fl) || !served.contains(&fl) {
                    continue;
                }
                let span = (t.x.max(0), (t.x + t.width).min(LOT_WIDTH));
                m.entry(fl).or_default().push(span);
            }
        }
        let out = m.get(&floor).cloned().unwrap_or_default();
        self.memo.borrow_mut().cols = Some((self.revision, m));
        out
    }

    /// `nearestTransportDistance`: `None` stands for `Infinity`.
    pub fn nearest_transport_distance(&self, u: &Unit) -> Option<i64> {
        let cols = self.transport_columns(u.floor);
        if cols.is_empty() {
            return None;
        }
        let left = u.x;
        let right = u.x + u.width;
        let mut best: Option<i64> = None;
        for (x0, x1) in cols {
            let gap = if x1 <= left {
                left - x1
            } else if x0 >= right {
                x0 - right
            } else {
                0
            };
            if best.is_none_or(|b| gap < b) {
                best = Some(gap);
            }
            if best == Some(0) {
                break;
            }
        }
        best
    }

    // ---- segments (tower/segments.ts) --------------------------------------

    /// `segmentsOf`: the contiguous structural runs on a floor.
    pub fn segments_of(&self, floor: i64) -> Vec<(i64, i64)> {
        {
            let mut memo = self.memo.borrow_mut();
            match &memo.segs {
                Some((rev, _)) if *rev == self.revision => {}
                _ => memo.segs = Some((self.revision, HashMap::new())),
            }
            if let Some(v) = memo.segs.as_ref().unwrap().1.get(&floor) {
                return v.clone();
            }
        }
        let mut xs: Vec<i64> = Vec::new();
        for u in &self.units {
            if u.kind.is_structural() && u.floor == floor {
                for i in 0..u.width {
                    xs.push(u.x + i);
                }
            }
        }
        xs.sort();
        let mut runs: Vec<(i64, i64)> = Vec::new();
        for i in 0..xs.len() {
            let x = xs[i];
            if i > 0 && x == xs[i - 1] {
                continue;
            }
            match runs.last_mut() {
                Some(last) if x == last.1 + 1 => last.1 = x,
                _ => runs.push((x, x)),
            }
        }
        self.memo
            .borrow_mut()
            .segs
            .as_mut()
            .unwrap()
            .1
            .insert(floor, runs.clone());
        runs
    }

    /// `segmentStartX`.
    pub fn segment_start_x(&self, floor: i64, x: i64) -> i64 {
        for (start, end) in self.segments_of(floor) {
            if x < start {
                break;
            }
            if x <= end {
                return start;
            }
        }
        x
    }

    /// `segAt`. The x may be a float (a person's live position): a float that
    /// sits over a gap gets a fractional id in JavaScript, which no graph node
    /// ever matches, so it maps to a sentinel here.
    pub fn seg_at(&self, floor: i64, x: Option<f64>) -> i64 {
        if let Some(x) = x {
            for (start, end) in self.segments_of(floor) {
                if x < start as f64 {
                    break;
                }
                if x <= end as f64 {
                    return seg_id(floor, start);
                }
            }
            if x.fract() != 0.0 {
                return NO_SEGMENT;
            }
            return seg_id(floor, x as i64);
        }
        let runs = self.segments_of(floor);
        seg_id(floor, runs.first().map(|r| r.0).unwrap_or(0))
    }

    /// `runAt` (crowd/walk.ts).
    pub fn run_at(&self, floor: i64, x: i64) -> Option<(i64, i64)> {
        for run in self.segments_of(floor) {
            if x < run.0 {
                return None;
            }
            if x <= run.1 {
                return Some(run);
            }
        }
        None
    }

    /// `landingSegs`.
    pub fn landing_segs(&self, t: &Transport, floor: i64) -> Vec<i64> {
        let mut segs: Vec<i64> = Vec::new();
        for i in 0..t.width {
            if self.has_structure(floor, t.x + i) {
                let s = self.seg_at(floor, Some((t.x + i) as f64));
                if !segs.contains(&s) {
                    segs.push(s);
                }
            }
        }
        if segs.is_empty() {
            return vec![seg_id(floor, t.x)];
        }
        segs.sort();
        segs
    }

    /// `alightX`.
    pub fn alight_x(&self, t: &Transport, floor: i64, toward_x: f64) -> f64 {
        let center = t.x as f64 + t.width as f64 / 2.0;
        if self.landing_segs(t, floor).len() <= 1 {
            return center;
        }
        let mut best = center;
        let mut best_dist = f64::INFINITY;
        for i in 0..t.width {
            let c = t.x + i;
            if !self.has_structure(floor, c) {
                continue;
            }
            let d = (c as f64 - toward_x).abs();
            if d < best_dist {
                best_dist = d;
                best = c as f64;
            }
        }
        best
    }

    /// `lobbySegs` (crowd/segmentGraph.ts).
    pub fn lobby_segs(&self) -> Vec<i64> {
        let runs = self.segments_of(1);
        if runs.is_empty() {
            vec![seg_id(1, 0)]
        } else {
            runs.iter().map(|r| seg_id(1, r.0)).collect()
        }
    }
}
