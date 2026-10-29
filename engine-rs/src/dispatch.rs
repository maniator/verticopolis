//! Port of `src/engine/ElevatorDispatch.ts`: the SCAN controller that moves
//! each car against the statistical waiting estimate and the crowd's calls.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use indexmap::IndexMap;

use crate::crowd::ElevatorCalls;
use crate::jsmath;
use crate::schedule::Schedule;
use crate::tower::Tower;

pub const CAR_FLOORS_PER_MINUTE: f64 = 0.8;
const DWELL_MINUTES: f64 = 0.8;

/// Stops per word of a stop bit set: stop `k` of the shaft in hand is bit
/// `k % 64` of word `k / 64`.
const WORD: usize = 64;

#[derive(Default)]
pub struct ElevatorDispatch {
    /// Transient per-car dwell timers, by shaft id. An ordered map, so the
    /// prune's `retain` iterates no hashed collection.
    car_dwell: BTreeMap<i64, Vec<f64>>,
    /// Waiting passengers per floor. An ordered map, so a floor lookup
    /// compares small integer keys where a hash map ran SipHash on each.
    /// Every read and write is by floor, and `retain` decays each entry on
    /// its own, so no result depends on the order.
    waiting: BTreeMap<i64, f64>,
    /// The boarding tally since the last drain (#465): shaft id to origin
    /// floor to boarded count. Counting only, never read back into behavior.
    board_tally: HashMap<i64, IndexMap<i64, f64>>,
    /// Scratch for the waiting pass, one slot per served floor: that
    /// floor's running estimate this step, `None` until a room touches it.
    acc: Vec<Option<f64>>,
    /// Scratch for `move_cars`, bit sets over the stops of the shaft in
    /// hand: the TypeScript's `calls` (a live hall call, the crowd's or the
    /// statistical estimate's) and `claimed` (a car is heading to the stop or
    /// dwelling at it), and the current car's cab stops.
    call_bits: Vec<u64>,
    claimed: Vec<u64>,
    cab_stops: Vec<u64>,
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

    /// `accumulate(tower, dt, rush)`: once per outer step. Returns the tower's
    /// `totalPopulation`, which the pass over the rooms already sums, so the
    /// crowd's spawn step reuses it instead of walking the rooms again.
    pub fn accumulate(&mut self, tower: &Tower, dt: f64, rush: f64) -> i64 {
        self.prune_removed_shafts(tower);
        self.accumulate_waiting(tower, dt, rush)
    }

    fn accumulate_waiting(&mut self, tower: &Tower, dt: f64, rush: f64) -> i64 {
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
        pop
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
            // `calls` and `claimed` as bit sets over the stops. `stops` is
            // ascending, so a floor's stop is a binary search away, and a
            // floor that is not a stop is never asked about.
            let words = stops.len().div_ceil(WORD);
            let (call_bits, claimed) = (&mut self.call_bits, &mut self.claimed);
            call_bits.clear();
            call_bits.resize(words, 0);
            claimed.clear();
            claimed.resize(words, 0);
            for (k, &fl) in stops.iter().enumerate() {
                // A crowd call already raises the stop, so the estimate is
                // only looked up when it would decide.
                if hall_at(fl) >= 1.0
                    || (!staff_only && self.waiting.get(&fl).copied().unwrap_or(0.0) >= 1.0)
                {
                    set_bit(call_bits, k);
                }
            }
            let stop_index = |floor: i64| stops.binary_search(&floor).ok();
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
                        if let Some(k) = stop_index(jsmath::round(t.car_positions[i]) as i64) {
                            set_bit(claimed, k);
                        }
                        continue;
                    }
                }
                let v = car_dt * CAR_FLOORS_PER_MINUTE;
                let mut pos = t.car_positions[i];
                let was_parked = t.car_dir[i] == 0;
                let mut dir = if t.car_dir[i] == 0 { 1 } else { t.car_dir[i] };
                let cab_stops = cabs
                    .and_then(|c| c.get(&(i as i64)))
                    .filter(|c| !c.is_empty())
                    .map(|c| fill_cab_stops(&stops, c, &mut self.cab_stops));
                let reach = match response {
                    Some(r) if was_parked => (span - r).max(0.0),
                    _ => f64::INFINITY,
                };
                let demand = Demand {
                    stops: &stops,
                    calls: &call_bits[..],
                    claimed: &claimed[..],
                    cab: cab_stops,
                };
                // A parked car leaves a stop beyond its reach alone unless the
                // stop is in its own cab. The search only returns a stop at a
                // finite distance and `reach` is never NaN, so `<=` is the
                // TypeScript's `!(dist > reach)`.
                let held = |k: Option<usize>| {
                    k.filter(|&k| demand.is_cab(k) || (stops[k] as f64 - pos).abs() <= reach)
                };
                let mut target = held(demand.next_stop(pos, dir));
                if target.is_none() {
                    dir = -dir;
                    target = held(demand.next_stop(pos, dir));
                }
                if let Some(k) = target {
                    set_bit(claimed, k);
                }
                let target = match target {
                    Some(k) => stops[k] as f64,
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
                        if stop_index(tf).is_some_and(|k| has_bit(call_bits, k)) {
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

fn set_bit(bits: &mut [u64], k: usize) {
    bits[k / WORD] |= 1u64 << (k % WORD);
}

fn has_bit(bits: &[u64], k: usize) -> bool {
    bits[k / WORD] & (1u64 << (k % WORD)) != 0
}

/// The car's cab floors as a bit set over `stops`, in `bits`. A cab floor
/// that is not a stop is left out, as the scan never reached it. The set is
/// ordered, so the floors are read in floor order.
fn fill_cab_stops<'a>(stops: &[i64], cab: &BTreeSet<i64>, bits: &'a mut Vec<u64>) -> &'a [u64] {
    bits.clear();
    bits.resize(stops.len().div_ceil(WORD), 0);
    for fl in cab {
        if let Ok(k) = stops.binary_search(fl) {
            set_bit(bits, k);
        }
    }
    bits
}

/// What one car asks of its shaft: the stops in ascending order, the
/// `calls` and `claimed` bit sets over them, and the car's own cab stops.
struct Demand<'a> {
    stops: &'a [i64],
    calls: &'a [u64],
    claimed: &'a [u64],
    cab: Option<&'a [u64]>,
}

impl Demand<'_> {
    /// The stops that answer in word `w`: a live call no car has claimed,
    /// or one of this car's cab stops (never blocked by a claim).
    fn word(&self, w: usize) -> u64 {
        (self.calls[w] & !self.claimed[w]) | self.cab.map_or(0, |c| c[w])
    }

    /// Whether stop `k` is one of this car's cab stops.
    fn is_cab(&self, k: usize) -> bool {
        self.cab.is_some_and(|c| has_bit(c, k))
    }

    /// The lowest answering stop at or above index `from`.
    fn first_from(&self, from: usize) -> Option<usize> {
        let mut w = from / WORD;
        if w >= self.calls.len() {
            return None;
        }
        let mut bits = self.word(w) & (u64::MAX << (from % WORD));
        while bits == 0 {
            w += 1;
            if w >= self.calls.len() {
                return None;
            }
            bits = self.word(w);
        }
        Some(w * WORD + bits.trailing_zeros() as usize)
    }

    /// The highest answering stop below index `end`.
    fn last_below(&self, end: usize) -> Option<usize> {
        let last = end.checked_sub(1)?;
        let mut w = last / WORD;
        let mut bits = self.word(w) & (u64::MAX >> (WORD - 1 - last % WORD));
        while bits == 0 {
            w = w.checked_sub(1)?;
            bits = self.word(w);
        }
        Some(w * WORD + (WORD - 1) - bits.leading_zeros() as usize)
    }

    /// `nextDemandStop`: the index of the nearest stop strictly ahead that
    /// answers.
    ///
    /// The TypeScript scans every stop and keeps the first strict minimum,
    /// which is the lowest floor among equal distances. `stops` ascends, so
    /// going up the nearest is the lowest answering stop ahead, and going
    /// down it is the highest one below, then any lower stop at the same
    /// distance. Ties need a position far beyond any tower, where rounding
    /// merges distances. Each search reads a word or two (a shaft built in
    /// play has at most 31 stops, and a floor range of about 110 caps any
    /// shaft at two words); going down, the tie check makes one more search.
    /// So a car with nothing to serve no longer tests its shaft's stops one
    /// by one.
    fn next_stop(&self, pos: f64, dir: i64) -> Option<usize> {
        debug_assert_ne!(dir, 0);
        let stops = self.stops;
        let dist = |k: usize| (stops[k] as f64 - pos).abs();
        let k = if dir > 0 {
            self.first_from(stops.partition_point(|&s| s as f64 <= pos + 0.05))?
        } else {
            self.last_below(stops.partition_point(|&s| (s as f64) < pos - 0.05))?
        };
        let d = dist(k);
        // Going down, a lower stop at the same distance wins. Only a finite
        // distance can tie usefully: the check below drops the rest.
        let mut k = k;
        if dir < 0 && d < f64::INFINITY {
            while let Some(j) = self.last_below(k).filter(|&j| dist(j) == d) {
                k = j;
            }
        }
        // The scan's `dist < best_dist` from infinity: a position that is not
        // finite finds no stop.
        (d < f64::INFINITY).then_some(k)
    }
}

#[cfg(test)]
#[path = "dispatch_tests.rs"]
mod tests;
