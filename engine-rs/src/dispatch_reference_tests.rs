//! `ElevatorDispatch` as it was before #1143 item 5 (A20 in #1158): hashed
//! `calls` and `claimed` sets, a full scan per car and per-call rebuilds of
//! the floor lists. Kept so `dispatch_tests.rs` can pin byte identity step
//! for step. Test-only: `dispatch_tests.rs` mounts it.

use std::collections::{BTreeSet, HashMap, HashSet};

use indexmap::IndexMap;

use super::super::*;
use crate::schedule::Schedule;
use crate::tower::Tower;

/// `ElevatorDispatch` as it was before #1143 item 5, kept to pin byte identity.
#[derive(Default)]
pub(super) struct Reference {
    pub(super) car_dwell: HashMap<i64, Vec<f64>>,
    pub(super) waiting: HashMap<i64, f64>,
    pub(super) board_tally: HashMap<i64, IndexMap<i64, f64>>,
}

impl Reference {
    pub(super) fn accumulate(&mut self, tower: &Tower, dt: f64, rush: f64) {
        if !self.car_dwell.is_empty() {
            let live: HashSet<i64> = tower.transports.iter().map(|t| t.id).collect();
            self.car_dwell.retain(|id, _| live.contains(id));
        }
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

    pub(super) fn move_cars(
        &mut self,
        tower: &mut Tower,
        dt: f64,
        calls: &ElevatorCalls,
        hour: i64,
        wk: bool,
    ) {
        let lobby_set: HashSet<i64> = tower.lobby_floors().into_iter().collect();
        for ti in 0..tower.transports.len() {
            let (kind, id) = (tower.transports[ti].kind, tower.transports[ti].id);
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
            let idle = stops
                .iter()
                .copied()
                .find(|s| lobby_set.contains(s))
                .unwrap_or(stops[0]);
            let t = &mut tower.transports[ti];
            let sched = t.schedule.clone();
            let active = Schedule::active_car_count(sched.as_ref(), wk, hour, t.cars) as usize;
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
                let home = Schedule::home_floor_for(sched.as_ref(), i, idle).clamp(t.bottom, t.top);
                if i >= active {
                    car_load[i] = 0.0;
                    dwell[i] = 0.0;
                    let (cur, home) = (t.car_positions[i], home as f64);
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
                let held = |tg: Option<i64>| match tg {
                    Some(f)
                        if !cab.is_some_and(|c| c.contains(&f))
                            && (f as f64 - pos).abs() > reach =>
                    {
                        None
                    }
                    other => other,
                };
                let mut target = held(ref_next(&stops, pos, dir, &call_set, &claimed, cab));
                if target.is_none() {
                    dir = -dir;
                    target = held(ref_next(&stops, pos, dir, &call_set, &claimed, cab));
                }
                if let Some(tg) = target {
                    claimed.insert(tg);
                }
                let target = match target {
                    Some(tg) => tg as f64,
                    None => {
                        if (pos - home as f64).abs() < 0.05 {
                            t.car_dir[i] = 0;
                            car_load[i] = 0.0;
                            continue;
                        }
                        home as f64
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

fn ref_next(
    stops: &[i64],
    pos: f64,
    dir: i64,
    calls: &HashSet<i64>,
    claimed: &HashSet<i64>,
    cab: Option<&BTreeSet<i64>>,
) -> Option<i64> {
    let (mut best, mut best_dist) = (None, f64::INFINITY);
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
