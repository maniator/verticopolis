//! Port of `src/engine/ElevatorDispatch.ts`: the SCAN controller that moves
//! each car against the statistical waiting estimate and the crowd's calls.

use std::collections::{BTreeMap, HashMap, HashSet};

use indexmap::IndexMap;

use crate::crowd::ElevatorCalls;
use crate::jsmath;
use crate::schedule::Schedule;
use crate::tower::Tower;

pub const CAR_FLOORS_PER_MINUTE: f64 = 0.8;
const DWELL_MINUTES: f64 = 0.8;

/// Stop flag: a live hall call (the crowd's, or the statistical estimate's
/// on a passenger shaft).
const CALL: u8 = 1;
/// Stop flag: a car of this shaft is heading to the stop or dwelling at it.
const CLAIMED: u8 = 2;

#[derive(Default)]
pub struct ElevatorDispatch {
    /// Transient per-car dwell timers.
    car_dwell: HashMap<i64, Vec<f64>>,
    /// Waiting passengers per floor, kept in ascending floor order so the
    /// shaft's floor lookups stay by key instead of hashing every stop. The
    /// per-stop flag pass still walks the shaft's sorted stop list, but every
    /// read and write remains a floor lookup (`get`/`entry`/`insert`), with
    /// the ordering used only to keep floor-wise state consistent.
    waiting: BTreeMap<i64, f64>,
    /// The boarding tally since the last drain (#465): shaft id to origin
    /// floor to boarded count. Counting only, never read back into behavior.
    board_tally: HashMap<i64, IndexMap<i64, f64>>,
    /// Scratch for the waiting pass, one slot per served floor: that
    /// floor's running estimate this step, `None` until a room touches it.
    acc: Vec<Option<f64>>,
    /// Scratch for `move_cars`, one byte per stop of the shaft in hand:
    /// `CALL` and `CLAIMED`, the TypeScript's `calls` and `claimed` sets.
    flags: Vec<u8>,
}

impl ElevatorDispatch {
    pub fn new() -> ElevatorDispatch {
        ElevatorDispatch::default()
    }

    /// `drainBoardings()`: hand over the tally and clear it.
    pub fn drain_boardings(&mut self) -> HashMap<i64, IndexMap<i64, f64>> {
        std::mem::take(&mut self.board_tally)
    }

    pub fn waiting_at(&self, floor: i64) -> f64 {
        self.waiting.get(&floor).copied().unwrap_or(0.0)
    }

    fn prune_removed_shafts(&mut self, tower: &Tower) {
        // The shaft index answers "is this id live" without building a set.
        self.car_dwell
            .retain(|id, _| tower.transport_index(*id).is_some());
    }

    /// `accumulate(tower, dt, rush)`: once per outer step.
    pub fn accumulate(&mut self, tower: &Tower, dt: f64, rush: f64) {
        self.prune_removed_shafts(tower);
        self.accumulate_waiting(tower, dt, rush);
    }

    fn accumulate_waiting(&mut self, tower: &Tower, dt: f64, rush: f64) {
        self.waiting.retain(|_, n| {
            let v = *n - dt * 0.03;
            if v <= 0.0 {
                false
            } else {
                *n = v;
                true
            }
        });
        let floors = tower.dispatch_floors();
        let served = &floors.served;
        self.acc.clear();
        self.acc.resize(served.len(), None);
        // `totalPopulation` rides along: the same rooms in the same order,
        // so one pass over the rooms instead of two.
        let mut pop = 0;
        for u in tower.room_units() {
            if u.is_present() {
                pop += u.census_count();
            }
            if u.kind.attendance_cap().is_some() || u.occupants <= 0 {
                continue;
            }
            let Ok(slot) = served.binary_search(&u.floor) else {
                continue;
            };
            // Each floor folds its rooms in room order, starting from the
            // value the map held, exactly as the per-room map updates did.
            let w = self.acc[slot]
                .get_or_insert_with(|| self.waiting.get(&u.floor).copied().unwrap_or(0.0));
            *w = (*w + u.occupants as f64 * rush * dt * 0.012).min(25.0);
        }
        for (slot, w) in self.acc.iter().enumerate() {
            if let Some(w) = *w {
                self.waiting.insert(served[slot], w);
            }
        }
        debug_assert_eq!(pop, tower.total_population());
        if pop > 0 {
            for &fl in &floors.lobbies {
                let w = self.waiting.entry(fl).or_insert(0.0);
                *w = (*w + pop as f64 * rush * dt * 0.0015).min(25.0);
            }
        }
    }

    /// `moveCars(tower, dt, crowdCalls, clock)`.
    pub fn move_cars(
        &mut self,
        tower: &mut Tower,
        dt: f64,
        calls: &ElevatorCalls,
        hour: i64,
        is_weekend: bool,
    ) {
        let floors = tower.dispatch_floors();
        let n = tower.transports.len();
        for ti in 0..n {
            let (kind, id) = {
                let t = &tower.transports[ti];
                (t.kind, t.id)
            };
            if !kind.is_elevator() {
                continue;
            }
            let staff_only = kind.is_staff_only_transport();
            let hall = calls.hall.get(&id);
            let cabs = calls.cab.get(&id);
            let stops = tower.stops_of(&tower.transports[ti]);
            if stops.is_empty() {
                continue;
            }
            debug_assert!(stops.windows(2).all(|w| w[0] < w[1]));
            let idle_floor = stops
                .iter()
                .copied()
                .find(|s| floors.lobbies.binary_search(s).is_ok())
                .unwrap_or(stops[0]);
            let t = &mut tower.transports[ti];
            // Dispatch only reads the schedule, so it borrows it.
            let sched = t.schedule.as_ref();
            let active_count = Schedule::active_car_count(sched, is_weekend, hour, t.cars) as usize;
            let shaft_dwell = Schedule::dwell_minutes_for(sched, DWELL_MINUTES);
            let response = Schedule::waiting_response_for(sched);
            let span = (t.top - t.bottom) as f64;
            let cars = t.cars as usize;
            let dwell = self.car_dwell.entry(id).or_default();
            if dwell.len() != cars {
                *dwell = vec![0.0; cars];
            }
            if t.car_load.as_ref().is_none_or(|l| l.len() != cars) {
                t.car_load = Some(vec![0.0; cars]);
            }
            let car_load = t.car_load.as_mut().unwrap();
            let cap = kind.car_capacity();

            let hall_at = |fl: i64| hall.and_then(|h| h.get(&fl)).copied().unwrap_or(0.0);
            // `calls` and `claimed` as one flag byte per stop. `stops` is
            // ascending, so a floor's stop is a binary search away, and a
            // floor that is not a stop is never asked about.
            let flags = &mut self.flags;
            flags.clear();
            flags.resize(stops.len(), 0);
            if hall.is_some() {
                for (k, &fl) in stops.iter().enumerate() {
                    if hall_at(fl) >= 1.0 {
                        flags[k] = CALL;
                    }
                }
            }
            if !staff_only {
                for (k, &fl) in stops.iter().enumerate() {
                    if self.waiting.get(&fl).copied().unwrap_or(0.0) >= 1.0 {
                        flags[k] |= CALL;
                    }
                }
            }
            let flag_at = |floor: i64| stops.binary_search(&floor).ok();
            for i in 0..cars {
                let car_home =
                    Schedule::home_floor_for(sched, i, idle_floor).clamp(t.bottom, t.top);
                if i >= active_count {
                    car_load[i] = 0.0;
                    dwell[i] = 0.0;
                    let cur = t.car_positions[i];
                    let home = car_home as f64;
                    if (cur - home).abs() < 0.05 {
                        t.car_positions[i] = home;
                        t.car_dir[i] = 0;
                    } else {
                        let step = dt * CAR_FLOORS_PER_MINUTE;
                        let dir = if home > cur { 1 } else { -1 };
                        let np = if (home - cur).abs() <= step {
                            home
                        } else {
                            cur + dir as f64 * step
                        };
                        t.car_positions[i] = np.max(t.bottom as f64).min(t.top as f64);
                        t.car_dir[i] = if np == home { 0 } else { dir };
                    }
                    continue;
                }
                let mut car_dt = dt;
                if dwell[i] > 0.0 {
                    let pause = dwell[i].min(car_dt);
                    dwell[i] -= pause;
                    car_dt -= pause;
                    if car_dt <= 0.0 {
                        if let Some(k) = flag_at(jsmath::round(t.car_positions[i]) as i64) {
                            flags[k] |= CLAIMED;
                        }
                        continue;
                    }
                }
                let v = car_dt * CAR_FLOORS_PER_MINUTE;
                let mut pos = t.car_positions[i];
                let was_parked = t.car_dir[i] == 0;
                let mut dir = if t.car_dir[i] == 0 { 1 } else { t.car_dir[i] };
                let cab = cabs.and_then(|c| c.get(&(i as i64)));
                let reach = match response {
                    Some(r) if was_parked => (span - r).max(0.0),
                    _ => f64::INFINITY,
                };
                let held = |tg: Option<i64>| -> Option<i64> {
                    match tg {
                        Some(f)
                            if !cab.is_some_and(|c| c.contains(&f))
                                && (f as f64 - pos).abs() > reach =>
                        {
                            None
                        }
                        other => other,
                    }
                };
                let mut target = held(next_demand_stop(&stops, flags, pos, dir, cab));
                if target.is_none() {
                    dir = -dir;
                    target = held(next_demand_stop(&stops, flags, pos, dir, cab));
                }
                if let Some(k) = target.and_then(flag_at) {
                    flags[k] |= CLAIMED;
                }
                let target = match target {
                    Some(tg) => tg as f64,
                    None => {
                        let tg = car_home as f64;
                        if (pos - tg).abs() < 0.05 {
                            t.car_dir[i] = 0;
                            car_load[i] = 0.0;
                            continue;
                        }
                        tg
                    }
                };
                if (target - pos).abs() <= v {
                    pos = target;
                    dwell[i] = shaft_dwell;
                    car_load[i] = (car_load[i] - (car_load[i] * 0.45).ceil()).max(0.0);
                    let tf = target as i64;
                    let w = if staff_only {
                        hall_at(tf)
                    } else {
                        self.waiting.get(&tf).copied().unwrap_or(0.0)
                    };
                    let board = (cap - car_load[i]).min(w).max(0.0);
                    if board > 0.0 {
                        car_load[i] += board;
                        if !staff_only {
                            self.waiting.insert(tf, (w - board).max(0.0));
                        }
                        // Origin tally (#465), only at a stop with a live call.
                        if flag_at(tf).is_some_and(|k| flags[k] & CALL != 0) {
                            let n = self
                                .board_tally
                                .entry(id)
                                .or_default()
                                .entry(tf)
                                .or_insert(0.0);
                            *n = (*n + board).min(5000.0);
                        }
                    }
                    if pos >= t.top as f64 {
                        dir = -1;
                    } else if pos <= t.bottom as f64 {
                        dir = 1;
                    }
                } else {
                    dir = if target > pos { 1 } else { -1 };
                    pos += dir as f64 * v;
                }
                t.car_positions[i] = pos.max(t.bottom as f64).min(t.top as f64);
                t.car_dir[i] = dir;
            }
        }
    }
}

/// `nextDemandStop`: the nearest stop strictly ahead with a live call no
/// other car has claimed, or one of this car's own cab stops (never blocked
/// by a claim). `flags` runs parallel to `stops`.
///
/// `stops` ascends, so the distance never shrinks as the walk leaves the
/// car, and the walk stops at the first stop that answers instead of
/// testing every stop of the shaft. The TypeScript scans every stop and
/// keeps the first strict minimum, which is the lowest floor among equal
/// distances, so the downward walk runs on through any tie. Ties need a
/// position far beyond any tower, where rounding merges distances.
fn next_demand_stop(
    stops: &[i64],
    flags: &[u8],
    pos: f64,
    dir: i64,
    cab: Option<&HashSet<i64>>,
) -> Option<i64> {
    debug_assert_ne!(dir, 0);
    // The flags first, so the cab set is only hashed for a stop without a
    // free call. The test is pure, so the order is free.
    let wanted = |k: usize| {
        (flags[k] & (CALL | CLAIMED)) == CALL || cab.is_some_and(|c| c.contains(&stops[k]))
    };
    let dist = |k: usize| (stops[k] as f64 - pos).abs();
    let (k, d) = if dir > 0 {
        let first = stops.partition_point(|&s| s as f64 <= pos + 0.05);
        let mut best: Option<(usize, f64)> = None;
        for k in first..stops.len() {
            if !wanted(k) {
                continue;
            }
            let d = dist(k);
            match best {
                Some((_, best_d)) if d > best_d => break,
                Some((_, best_d)) if d == best_d => continue,
                _ => best = Some((k, d)),
            }
        }
        best?
    } else {
        let end = stops.partition_point(|&s| (s as f64) < pos - 0.05);
        let mut best: Option<(usize, f64)> = None;
        for k in (0..end).rev() {
            if !wanted(k) {
                continue;
            }
            let d = dist(k);
            match best {
                Some((_, best_d)) if d > best_d => break,
                _ => best = Some((k, d)),
            }
        }
        best?
    };
    // The scan's `dist < best_dist` from infinity: a position that is not
    // finite finds no stop.
    (d < f64::INFINITY).then_some(stops[k])
}

#[cfg(test)]
#[path = "dispatch_tests.rs"]
mod tests;
