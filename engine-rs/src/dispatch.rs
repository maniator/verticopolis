//! Port of `src/engine/ElevatorDispatch.ts`: the SCAN controller that moves
//! each car against the statistical waiting estimate and the crowd's calls.

use std::collections::{HashMap, HashSet};

use indexmap::IndexMap;

use crate::crowd::ElevatorCalls;
use crate::jsmath;
use crate::schedule::Schedule;
use crate::tower::Tower;

pub const CAR_FLOORS_PER_MINUTE: f64 = 0.8;
const DWELL_MINUTES: f64 = 0.8;

#[derive(Default)]
pub struct ElevatorDispatch {
    /// Transient per-car dwell timers.
    car_dwell: HashMap<i64, Vec<f64>>,
    /// Waiting passengers per floor.
    waiting: HashMap<i64, f64>,
    /// The boarding tally since the last drain (#465): shaft id to origin
    /// floor to boarded count. Counting only, never read back into behavior.
    board_tally: HashMap<i64, IndexMap<i64, f64>>,
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
        if self.car_dwell.is_empty() {
            return;
        }
        let live: HashSet<i64> = tower.transports.iter().map(|t| t.id).collect();
        self.car_dwell.retain(|id, _| live.contains(id));
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
        let served = tower.served_floors();
        for u in tower.room_units() {
            if u.kind.attendance_cap().is_some() {
                continue;
            }
            if u.occupants <= 0 || !served.contains(&u.floor) {
                continue;
            }
            let w = self.waiting.entry(u.floor).or_insert(0.0);
            *w = (*w + u.occupants as f64 * rush * dt * 0.012).min(25.0);
        }
        let pop = tower.total_population();
        if pop > 0 {
            for fl in tower.lobby_floors() {
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
        let lobby_set: HashSet<i64> = tower.lobby_floors().into_iter().collect();
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
            let idle_floor = stops
                .iter()
                .copied()
                .find(|s| lobby_set.contains(s))
                .unwrap_or(stops[0]);
            let t = &mut tower.transports[ti];
            let sched = t.schedule.clone();
            let active_count =
                Schedule::active_car_count(sched.as_ref(), is_weekend, hour, t.cars) as usize;
            let shaft_dwell = Schedule::dwell_minutes_for(sched.as_ref(), DWELL_MINUTES);
            let response = Schedule::waiting_response_for(sched.as_ref());
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
            let mut call_set: HashSet<i64> = HashSet::new();
            for &fl in &stops {
                if hall_at(fl) >= 1.0
                    || (!staff_only && self.waiting.get(&fl).copied().unwrap_or(0.0) >= 1.0)
                {
                    call_set.insert(fl);
                }
            }
            let mut claimed: HashSet<i64> = HashSet::new();
            for i in 0..cars {
                let car_home =
                    Schedule::home_floor_for(sched.as_ref(), i, idle_floor).clamp(t.bottom, t.top);
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
                        claimed.insert(jsmath::round(t.car_positions[i]) as i64);
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
                let mut target = held(next_demand_stop(&stops, pos, dir, &call_set, &claimed, cab));
                if target.is_none() {
                    dir = -dir;
                    target = held(next_demand_stop(&stops, pos, dir, &call_set, &claimed, cab));
                }
                if let Some(tg) = target {
                    claimed.insert(tg);
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
                        if call_set.contains(&tf) {
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

fn next_demand_stop(
    stops: &[i64],
    pos: f64,
    dir: i64,
    calls: &HashSet<i64>,
    claimed: &HashSet<i64>,
    cab: Option<&HashSet<i64>>,
) -> Option<i64> {
    let mut best: Option<i64> = None;
    let mut best_dist = f64::INFINITY;
    for &fl in stops {
        let f = fl as f64;
        if dir > 0 && f <= pos + 0.05 {
            continue;
        }
        if dir < 0 && f >= pos - 0.05 {
            continue;
        }
        if !cab.is_some_and(|c| c.contains(&fl)) {
            if claimed.contains(&fl) {
                continue;
            }
            if !calls.contains(&fl) {
                continue;
            }
        }
        let dist = (f - pos).abs();
        if dist < best_dist {
            best_dist = dist;
            best = Some(fl);
        }
    }
    best
}
