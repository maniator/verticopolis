//! Read-side tower queries: ports of the retired TypeScript
//! `src/engine/tower/routing.ts`, `src/engine/tower/transport.ts` (the stop and
//! distance helpers), `src/engine/tower/segments.ts`, `src/engine/tower/rooms.ts`
//! and `src/engine/census.ts`. Memos are keyed on `revision` the way the
//! TypeScript caches are.

use std::collections::{HashMap, HashSet};

use crate::facilities::*;
use crate::tower::{Tower, Transport, Unit};

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
    #[inline]
    pub fn get_transport(&self, id: i64) -> Option<&Transport> {
        self.transport_index(id).map(|i| &self.transports[i])
    }

    pub fn get_transport_mut(&mut self, id: i64) -> Option<&mut Transport> {
        let i = self.transport_index(id)?;
        if let Some(j) = self.journal.as_mut() {
            j.transport_edit(i, &self.transports[i]);
        }
        Some(&mut self.transports[i])
    }

    /// `roomAt`: the room covering a tile, structure excluded.
    pub fn room_at(&self, floor: i64, x: i64) -> Option<&Unit> {
        let id = self.rooms.get(&(floor, x))?;
        self.get_unit(*id)
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
        let s = t.stop_floors();
        let entry = (self.revision, s.clone());
        self.memo.borrow_mut().stops.insert(t.id, entry);
        s
    }

    /// `servedFloors`: the fixpoint of floors a passenger transport chain
    /// connects to the ground lobby.
    pub fn served_floors(&self) -> HashSet<i64> {
        self.fill_served();
        let memo = self.memo.borrow();
        let (_, served, _) = memo.served.as_ref().expect("fill_served built it");
        served.clone()
    }

    /// Builds the served-floor memo when this revision has none, so a reader
    /// can answer from it in place. Each transport's stops are listed once,
    /// and a transport that has joined adds nothing on later sweeps, so a
    /// rebuild costs the stops once plus one membership test per stop of the
    /// transports still unjoined on each sweep (#1237). The closure is the
    /// one the TypeScript fixpoint reaches, and the set is only queried.
    fn fill_served(&self) {
        if matches!(&self.memo.borrow().served, Some((rev, ..)) if *rev == self.revision) {
            return;
        }
        let mut pending: Vec<Vec<i64>> = self
            .transports
            .iter()
            .filter(|t| !t.kind.is_staff_only_transport())
            .map(Transport::stop_floors)
            .collect();
        let mut reachable: HashSet<i64> = HashSet::new();
        reachable.insert(1);
        let mut changed = true;
        while changed {
            changed = false;
            pending.retain(|stops| {
                if !stops.iter().any(|fl| reachable.contains(fl)) {
                    return true;
                }
                reachable.extend(stops.iter().copied());
                changed = true;
                false
            });
        }
        let fast = reachable.iter().copied().collect();
        self.memo.borrow_mut().served = Some((self.revision, reachable, fast));
    }

    /// `isFloorServed`, read from the memo without copying the set (#859,
    /// #1237): the stranded-floor scans ask once per room.
    pub fn is_floor_served(&self, floor: i64) -> bool {
        if floor == 1 {
            return true;
        }
        self.fill_served();
        let memo = self.memo.borrow();
        let (.., served) = memo.served.as_ref().expect("fill_served built it");
        served.contains(&floor)
    }

    pub fn is_metro_platform_served(&self, station: &Unit) -> bool {
        self.is_floor_served(station.floor + 1)
    }

    /// `staffComponents`: floor -> component id over service elevators and stairs.
    pub fn staff_components(&self) -> HashMap<i64, i64> {
        self.fill_staff();
        let memo = self.memo.borrow();
        memo.staff.as_ref().expect("fill_staff built it").1.clone()
    }

    /// Builds the staff-component memo when this revision has none, so
    /// `staff_component`, which dispatch asks for every crew and floor, reads
    /// it in place instead of copying the map on each call (#1143 item 6).
    fn fill_staff(&self) {
        if matches!(&self.memo.borrow().staff, Some((rev, _)) if *rev == self.revision) {
            return;
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
        self.memo.borrow_mut().staff = Some((self.revision, comp));
    }

    /// The staff component `floor` lies in, read in place; `None` for a
    /// floor no staff transport serves.
    pub(crate) fn staff_component(&self, floor: i64) -> Option<i64> {
        self.fill_staff();
        let memo = self.memo.borrow();
        let (_, comp) = memo.staff.as_ref().expect("fill_staff built it");
        comp.get(&floor).copied()
    }

    pub fn staff_connected(&self, a: i64, b: i64) -> bool {
        if a == b {
            return true;
        }
        let ca = self.staff_component(a);
        ca.is_some() && ca == self.staff_component(b)
    }

    /// `functionalParkingSet`: parking-space ids chained to a ramp.
    pub fn functional_parking_set(&self) -> HashSet<i64> {
        self.reached_parking().into_iter().collect()
    }

    pub fn functional_parking_spots(&self) -> i64 {
        self.reached_parking().len() as i64
    }

    /// Each parking space a working ramp reaches, once: a fill room by room
    /// from the ramps, a ramp also reaching the floors above and below it.
    fn reached_parking(&self) -> Vec<i64> {
        let usable =
            |u: &Unit| matches!(u.kind, Kind::Parking | Kind::ParkingRamp) && u.is_operational();
        let mut stack: Vec<(i64, i64)> = Vec::new();
        // A ramp is a room, so the room index lists every seed (#1237).
        for u in self.room_units() {
            if u.kind == Kind::ParkingRamp && u.is_operational() {
                stack.push((u.floor, u.x));
            }
        }
        let mut visited = crate::crowd::fasthash::FastSet::default();
        let mut reached = Vec::new();
        while let Some((f, x)) = stack.pop() {
            let Some(u) = self.room_at(f, x).filter(|u| usable(u)) else {
                continue;
            };
            if !visited.insert(u.id) {
                continue; // the room was filled from another tile
            }
            if u.kind == Kind::Parking {
                reached.push(u.id);
            }
            stack.push((f, u.x - 1));
            stack.push((f, u.x + u.width));
            if u.kind == Kind::ParkingRamp {
                for c in u.x..u.x + u.width {
                    stack.push((f - 1, c));
                    stack.push((f + 1, c));
                }
            }
        }
        reached
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

    /// `nearestLobbyFloorDistance`: how many floors `floor` sits from the
    /// nearest lobby. A tall lobby (#308) counts on every story its hall
    /// fills, so the floor just above a three-story hall is one floor from
    /// it, the same as the floor above a one-story lobby. Without this a
    /// shop over a tall sky lobby read as three floors away and lost half
    /// its trade. The lobby floors and their tallest halls are read once per
    /// lobby change ([`Memo::lobby_reach`]), not walked per call.
    ///
    /// [`Memo::lobby_reach`]: crate::tower_query_state::Memo::lobby_reach
    pub fn nearest_lobby_floor_distance(&self, floor: i64) -> i64 {
        let nearest = |reach: &[(i64, i64)]| {
            let mut best = (floor - 1).abs();
            for &(lf, top) in reach {
                let d = if floor > top {
                    floor - top
                } else {
                    (lf - floor).max(0)
                };
                best = best.min(d);
            }
            best
        };
        {
            let memo = self.memo.borrow();
            if let Some((built, reach)) = &memo.lobby_reach {
                if *built == memo.lobby_changes {
                    return nearest(reach);
                }
            }
        }
        nearest(&self.fill_lobby_reach())
    }

    /// Each lobby floor with the top story of its tallest hall, in floor
    /// order, stored in [`Memo::lobby_reach`]. Both lists run up the tower,
    /// so one walk of each finds every lobby floor's tallest hall (a floor's
    /// halls come tallest last).
    ///
    /// [`Memo::lobby_reach`]: crate::tower_query_state::Memo::lobby_reach
    #[cold]
    fn fill_lobby_reach(&self) -> std::sync::Arc<[(i64, i64)]> {
        let mut tall = self.tall_lobby_tiles.keys().peekable();
        let mut reach = Vec::with_capacity(self.lobby_tiles.len());
        for &lf in self.lobby_tiles.keys() {
            let mut top = lf;
            while let Some(&&(hall, height)) = tall.peek() {
                if hall > lf {
                    break;
                }
                if hall == lf {
                    top = lf + height - 1;
                }
                tall.next();
            }
            reach.push((lf, top));
        }
        let reach: std::sync::Arc<[(i64, i64)]> = reach.into();
        let mut memo = self.memo.borrow_mut();
        memo.lobby_reach = Some((memo.lobby_changes, reach.clone()));
        reach
    }

    /// `transportColumns`.
    pub fn transport_columns(&self, floor: i64) -> Vec<(i64, i64)> {
        self.fill_columns();
        let memo = self.memo.borrow();
        let cols = memo.cols.as_ref().and_then(|(_, m)| m.get(&floor));
        cols.cloned().unwrap_or_default()
    }

    // ---- segments (the retired TypeScript `src/engine/tower/segments.ts`) ----

    /// `segmentsOf`: the contiguous structural runs on a floor.
    pub fn segments_of(&self, floor: i64) -> Vec<(i64, i64)> {
        self.segment_runs(floor).to_vec()
    }

    /// The contiguous structural runs on a floor, left to right, as the
    /// per-edit memo shares them: a read copies no list, so the per-person
    /// lookups (`seg_at`, `run_at`, the lobby a trip uses) allocate nothing.
    pub(crate) fn segment_runs(&self, floor: i64) -> crate::tower_query_state::Runs {
        {
            let key = self.index_key();
            let mut memo = self.memo.borrow_mut();
            match &memo.segs {
                Some((built, _)) if *built == key => {}
                _ => memo.segs = Some((key, Default::default())),
            }
            if let Some(v) = memo.segs.as_ref().unwrap().1.get(&floor) {
                return v.clone();
            }
        }
        // One pass over the units fills every floor's tile list
        // (`structural_tiles`, cached on the same edit), so filling the
        // runs of every floor after an edit is O(units), not one whole-unit
        // walk per floor (A9 in #1158).
        let mut xs: Vec<i64> = self
            .structural_tiles(floor)
            .map_or_else(Vec::new, |tiles| tiles.to_vec());
        xs.sort_unstable();
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
        let runs: crate::tower_query_state::Runs = runs.into();
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
        for &(start, end) in self.segment_runs(floor).iter() {
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
            for &(start, end) in self.segment_runs(floor).iter() {
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
        let runs = self.segment_runs(floor);
        seg_id(floor, runs.first().map(|r| r.0).unwrap_or(0))
    }

    /// `runAt` (the retired TypeScript `src/engine/crowd/walk.ts`).
    pub fn run_at(&self, floor: i64, x: i64) -> Option<(i64, i64)> {
        for &run in self.segment_runs(floor).iter() {
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
        crate::tower_index::work_counts::landing_segs_called();
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

    /// `alightX`. One walk of the shaft's tiles finds the structural tile
    /// nearest `toward_x` and whether they span two walkways (more than one
    /// `landing_segs`), with no landing list built.
    pub fn alight_x(&self, t: &Transport, floor: i64, toward_x: f64) -> f64 {
        let center = t.x as f64 + t.width as f64 / 2.0;
        let (mut first_run, mut two_walkways) = (None, false);
        let (mut best, mut best_dist) = (center, f64::INFINITY);
        for c in (t.x..t.x + t.width).filter(|&c| self.has_structure(floor, c)) {
            let run = self.segment_start_x(floor, c);
            two_walkways |= *first_run.get_or_insert(run) != run;
            let d = (c as f64 - toward_x).abs();
            if d < best_dist {
                (best, best_dist) = (c as f64, d);
            }
        }
        if two_walkways {
            best
        } else {
            center
        }
    }

    /// `lobbySegs` (the retired TypeScript `src/engine/crowd/segmentGraph.ts`).
    pub fn lobby_segs(&self) -> Vec<i64> {
        let runs = self.segment_runs(1);
        if runs.is_empty() {
            vec![seg_id(1, 0)]
        } else {
            runs.iter().map(|r| seg_id(1, r.0)).collect()
        }
    }
}

#[cfg(test)]
#[path = "tower_landing_tests.rs"]
mod landing_tests;
