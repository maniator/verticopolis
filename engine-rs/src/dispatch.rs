//! Port of the retired TypeScript `src/engine/ElevatorDispatch.ts`: the SCAN controller that moves
//! each car against the statistical waiting estimate and the crowd's calls.

use std::collections::{BTreeMap, HashMap};

use indexmap::IndexMap;

use crate::crowd::ElevatorCalls;
use crate::facilities::Kind;
use crate::jsmath;
use crate::schedule::Schedule;
use crate::tower::Tower;
use demand::{fill_cab_stops, has_bit, set_bit, Claims, Demand};

#[path = "dispatch_classic.rs"]
mod classic;
use classic::{first_answering, moving_car_covers, Boarding};

#[path = "dispatch_modern.rs"]
mod modern;

#[path = "dispatch_save.rs"]
mod save;

#[path = "dispatch_leaving.rs"]
mod leaving;

#[path = "dispatch_lists.rs"]
mod lists;

#[path = "dispatch_cars.rs"]
mod car_state;
use leaving::{departure, toward_riders};
pub use leaving::{first_aboard, leaving_at, Leaving, OpenCar};
pub(crate) use modern::{idle_home, DispatchRules};
use modern::{BestCars, CarView};

pub const CAR_FLOORS_PER_MINUTE: f64 = 0.8;
pub(crate) const DWELL_MINUTES: f64 = 0.8;
/// How close, in floors, a car counts as standing at a stop: the stop
/// search looks past a stop this near, so a car that ends a move this near
/// its target lands on it instead of skipping it.
const AT_STOP_FLOORS: f64 = 0.05;

/// Stops per word of a stop bit set: stop `k` of the shaft in hand is bit
/// `k % 64` of word `k / 64`.
const WORD: usize = 64;

#[derive(Default)]
pub struct ElevatorDispatch {
    /// Transient per-car dwell timers, by shaft id. An ordered map, so the
    /// prune's `retain` iterates no hashed collection.
    car_dwell: BTreeMap<i64, Vec<f64>>,
    /// Each car's callers seen, time waited and estimate seats, by shaft id
    /// (`dispatch_cars.rs`). Ordered for the prune, as above.
    cars: BTreeMap<i64, car_state::Cars>,
    /// Waiting passengers per floor. An ordered map, so a floor lookup
    /// compares small integer keys where a hash map ran SipHash on each.
    /// Every read and write is by floor, and `retain` decays each entry on
    /// its own, so no result depends on the order.
    waiting: BTreeMap<i64, f64>,
    /// The estimate's boarding tally since the last drain (#465): shaft id
    /// to origin floor to boarded count. The crowd counts its own riders
    /// (`Crowd::elevator_boardings`). Counting only, never read back into
    /// behavior.
    board_tally: HashMap<i64, IndexMap<i64, f64>>,
    /// Scratch for the waiting pass, one slot per served floor: that
    /// floor's running estimate this step, `None` until a room touches it.
    acc: Vec<Option<f64>>,
    /// Scratch for `move_cars`, bit sets over the stops of the shaft in
    /// hand: the TypeScript's `calls` (a live hall call, the crowd's or the
    /// statistical estimate's) and `claimed` (a car is heading to the stop or
    /// dwelling at it, by the way it leaves), and the current car's cab stops.
    call_bits: Vec<u64>,
    claimed: Claims,
    cab_stops: Vec<u64>,
    /// The cars the schedule has stood down, as (shaft id, car index),
    /// rebuilt by every `move_cars`. A person waiting at a floor boards only a
    /// car outside this set, so nobody boards a car that is parked or about
    /// to park (the crowd keeps its own copy).
    closed_cars: Vec<(i64, i64)>,
    /// The cars standing at a stop with their doors open after this
    /// `move_cars`, as (shaft id, car index, floor), ascending: a car that
    /// arrived, one still dwelling, or one parked at its home floor. People
    /// step on and off only these cars, so nobody boards or leaves a car
    /// that is passing a floor. Each says which way the car leaves.
    open_cars: Vec<OpenCar>,
    /// Where each shaft's run starts in the two lists, to put them in id order.
    door_runs: lists::DoorRuns,
    /// Scratch of zero words, the calls a stood-down car answers: none.
    no_calls: Vec<u64>,
    /// Scratch: the shaft's called stops whose callers are all bound one way.
    ways: leaving::Ways,
    /// Scratch for Modern's best car: the on-shift cars as the choice sees
    /// them, and each called stop's chosen car.
    best: BestCars,
    /// A rules profile run in place of the tower's mode. Only tests set it
    /// (`DispatchRules::plain_scan`); the game always reads the mode.
    pub(crate) profile: Option<DispatchRules>,
}

impl ElevatorDispatch {
    pub fn new() -> ElevatorDispatch {
        ElevatorDispatch::default()
    }

    /// `accumulate(tower, dt, rush)`: once per outer step. Returns the tower's
    /// `totalPopulation`, which the pass over the rooms already sums, so the
    /// crowd's spawn step reuses it instead of walking the rooms again.
    pub fn accumulate(&mut self, tower: &Tower, dt: f64, rush: f64) -> i64 {
        self.prune_removed_shafts(tower);
        self.accumulate_waiting(tower, dt, rush)
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
        let rules = self
            .profile
            .unwrap_or_else(|| DispatchRules::for_mode(tower.mode));
        self.closed_cars.clear();
        self.open_cars.clear();
        self.door_runs.clear();
        // The elevators alone: a tower may hold thousands of flights.
        for &ti in &floors.elevators {
            (self.door_runs).start_shaft(&self.closed_cars, &self.open_cars);
            let (kind, id) = {
                let t = &tower.transports[ti];
                (t.kind, t.id)
            };
            debug_assert!(kind.is_elevator(), "the elevator list is stale");
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
            let mut active_count =
                Schedule::active_car_count(sched, is_weekend, hour, t.cars) as usize;
            let shaft_dwell = Schedule::dwell_minutes_for(sched, DWELL_MINUTES);
            let response = Schedule::waiting_response_for(sched);
            let span = (t.top - t.bottom) as f64;
            let cars = t.cars as usize;
            let wait_limit = rules.departure_limit.map(|m| m * shaft_dwell);
            let floors_per_minute = CAR_FLOORS_PER_MINUTE
                * if kind == Kind::ElevatorExpress {
                    rules.express_speed
                } else {
                    rules.car_speed
                };
            let dwell = self.car_dwell.entry(id).or_default();
            let car_state::Cars { seen, held, seats } = self.cars.entry(id).or_default();
            if dwell.len() != cars || seen.len() != cars || held.len() != cars {
                (*dwell, *seen, *held) = (vec![0.0; cars], vec![0.0; cars], vec![0.0; cars]);
            }
            if t.car_load.as_ref().is_none_or(|l| l.len() != cars) {
                t.car_load = Some(vec![0.0; cars]);
            }
            let car_load = t.car_load.as_mut().unwrap();
            let est = car_state::Cars::seats(seats, car_load, staff_only);
            let cap = kind.car_capacity();
            // Most steps fill no car, and then nothing is looked up.
            let any_full = rules.full_car_passes && !calls.full.is_empty();
            let full = |j: usize| any_full && calls.full.binary_search(&(id, j as i64)).is_ok();

            let call_at = |fl: i64| hall.and_then(|h| h.get(&fl)).copied().unwrap_or_default();
            let hall_at = |fl: i64| call_at(fl).callers;
            // The callers at `fl` a car leaving `dir` takes: every one bound
            // its way, and every one whose way is not known.
            let ways_known = rules.riders_go_their_way;
            let takes_at = |fl: i64, dir: i64| leaving::their_way(call_at(fl), ways_known, dir);
            // `calls` and `claimed` as bit sets over the stops. `stops` is
            // ascending, so a floor's stop is a binary search away, and a
            // floor that is not a stop is never asked about.
            let words = stops.len().div_ceil(WORD);
            let (call_bits, claimed) = (&mut self.call_bits, &mut self.claimed);
            call_bits.clear();
            call_bits.resize(words, 0);
            claimed.reset(words);
            self.no_calls.clear();
            self.no_calls.resize(words, 0);
            self.ways
                .reset(if rules.riders_go_their_way { words } else { 0 });
            let mut waiting = 0.0;
            for (k, &fl) in stops.iter().enumerate() {
                // A crowd call already raises the stop, so the estimate is
                // only looked up when it would decide (or, with riders
                // bound their way, whether the stop is the crowd's alone).
                let call = call_at(fl);
                let callers = call.callers;
                waiting += callers;
                let estimate =
                    || !staff_only && self.waiting.get(&fl).copied().unwrap_or(0.0) >= 1.0;
                if callers >= 1.0 && ways_known {
                    self.ways.mark(k, call, !estimate());
                }
                if callers >= 1.0 || estimate() {
                    set_bit(call_bits, k);
                }
            }
            let auto = sched.filter(|_| rules.auto_backlog);
            active_count = Schedule::cars_while_anyone_waits(auto, active_count, cars, waiting);
            let stop_index = |floor: i64| stops.binary_search(&floor).ok();
            if rules.best_car {
                // The on-shift cars as they begin the step; each called
                // stop's best car is worked out when a sweep first asks.
                self.best.start(stops.len(), response, span);
                for j in 0..active_count.min(cars) {
                    let cab = cabs.and_then(|c| c.get(&(j as i64)));
                    let (pos, dir) = (t.car_positions[j], t.car_dir[j]);
                    self.best.push(
                        CarView::of(pos, dir, dwell[j], cab, shaft_dwell, floors_per_minute),
                        full(j),
                    );
                }
            }
            for i in 0..cars {
                let unset = idle_home(rules.spread_homes, &stops, idle_floor, i, cars);
                let car_home = Schedule::home_floor_for(sched, i, unset).clamp(t.bottom, t.top);
                // A car the schedule has stood down takes no new riders and
                // answers no hall calls, but still takes the riders aboard to
                // their floors; it parks once the cab is empty.
                let stood_down = i >= active_count;
                if stood_down {
                    self.closed_cars.push((id, i as i64));
                }
                let riders_aboard = cabs
                    .and_then(|c| c.get(&(i as i64)))
                    .is_some_and(|c| !c.is_empty());
                if stood_down && !riders_aboard {
                    (car_load[i], est[i]) = (0.0, 0.0);
                    dwell[i] = 0.0;
                    let cur = t.car_positions[i];
                    let home = car_home as f64;
                    if (cur - home).abs() < 0.05 {
                        t.car_positions[i] = home;
                        t.car_dir[i] = 0;
                    } else {
                        let step = dt * floors_per_minute;
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
                if dwell[i] > 0.0 && rules.departure_restarts && !stood_down && !full(i) {
                    // Standard Floor Departure: whoever arrives while the car
                    // waits boards and starts the wait over, up to the limit.
                    let fl = jsmath::round(t.car_positions[i]) as i64;
                    if let Some(k) = stop_index(fl) {
                        let mut b = Boarding {
                            waiting: &mut self.waiting,
                            tally: &mut self.board_tally,
                        };
                        let (room, live) = (cap - car_load[i], has_bit(call_bits, k));
                        let (got, from_estimate) = b.arrivals(
                            id,
                            fl,
                            (takes_at(fl, t.car_dir[i]), &mut seen[i]),
                            room,
                            staff_only,
                            live,
                        );
                        if got > 0.0 {
                            // Seats left on a car whose load emptied between steps (sold
                            // and bought back while paused) go with the load.
                            let kept = est[i].min(car_load[i]);
                            (car_load[i], est[i]) = (car_load[i] + got, kept + from_estimate);
                            let left = wait_limit.map_or(shaft_dwell, |l| l - held[i]);
                            dwell[i] = shaft_dwell.min(left).max(0.0);
                        }
                    }
                }
                let was_parked = t.car_dir[i] == 0;
                let mut dir = if was_parked { 1 } else { t.car_dir[i] };
                // Modern: a call is another car's when that car is its best.
                // Classic's Waiting Car Response: a parked car leaves a call
                // to a car already heading there within that many floors.
                let best = &self.best;
                let covered = |k: usize| {
                    if rules.best_car {
                        return best.owner(k, stops[k], self.ways.bound(k)) != i;
                    }
                    let r = response.filter(|_| rules.parked_car_yields && was_parked);
                    r.is_some_and(|r| {
                        let floor = stops[k] as f64;
                        let call = (floor, self.ways.bound(k));
                        moving_car_covers(&t.car_positions, &t.car_dir, i, active_count, call, r)
                    })
                };
                let calls_now = if stood_down {
                    &self.no_calls[..]
                } else {
                    &call_bits[..]
                };
                // A car at a stop this step leaves it, with its riders first.
                let at_stop = rules.riders_go_their_way && (was_parked || dwell[i] > 0.0);
                if dwell[i] > 0.0 {
                    let pause = dwell[i].min(car_dt);
                    dwell[i] -= pause;
                    held[i] += pause;
                    car_dt -= pause;
                    if car_dt <= 0.0 {
                        let floor = jsmath::round(t.car_positions[i]) as i64;
                        // Still dwelling: the doors stay open all step, and
                        // whoever waits there sees which way the car leaves.
                        let mut leaving = Leaving::Either;
                        if rules.riders_go_their_way && hall_at(floor) >= 1.0 {
                            let cab = cabs
                                .and_then(|c| c.get(&(i as i64)))
                                .filter(|c| !c.is_empty())
                                .map(|c| fill_cab_stops(&stops, c, &mut self.cab_stops));
                            let demand = Demand {
                                stops: &stops,
                                calls: calls_now,
                                claimed,
                                cab,
                                ways: &self.ways,
                            };
                            let at = (t.car_positions[i], stop_index(floor));
                            let (way, shown) =
                                departure(&demand, &self.no_calls, at, dir, &covered);
                            (t.car_dir[i], leaving) = (way, shown);
                        }
                        if let Some(k) = stop_index(floor) {
                            claimed.claim(k, self.ways.claim_way(k, leaving.way()));
                        }
                        self.open_cars.push((id, i as i64, floor, leaving));
                        continue;
                    }
                }
                let v = car_dt * floors_per_minute;
                let mut pos = t.car_positions[i];
                let cab_stops = cabs
                    .and_then(|c| c.get(&(i as i64)))
                    .filter(|c| !c.is_empty())
                    .map(|c| fill_cab_stops(&stops, c, &mut self.cab_stops));
                let reach = match response {
                    Some(r) if was_parked && rules.parked_reach_gate => (span - r).max(0.0),
                    _ => f64::INFINITY,
                };
                let demand = Demand {
                    stops: &stops,
                    calls: calls_now,
                    claimed,
                    cab: cab_stops,
                    ways: &self.ways,
                };
                if at_stop {
                    dir = toward_riders(&demand, &self.no_calls, pos, dir).unwrap_or(dir);
                }
                let pick = |dir: i64| first_answering(&demand, pos, dir, reach, covered);
                // The sweep looks only ahead, so a car parked on a stop whose
                // call it owns boards the estimate there now, as on arrival.
                let own_stop =
                    (rules.parked_owner_boards && was_parked && !stood_down && !staff_only)
                        .then(|| stop_index(jsmath::round(pos) as i64))
                        .flatten()
                        .filter(|&k| {
                            let (fl, unclaimed) = (stops[k], !claimed.any(k));
                            let on_it = (fl as f64 - pos).abs() <= AT_STOP_FLOORS;
                            let estimate = self.waiting.get(&fl).copied().unwrap_or(0.0);
                            on_it && unclaimed && estimate >= 1.0 && !covered(k)
                        });
                let mut target = own_stop.or_else(|| pick(dir));
                if target.is_none() {
                    dir = -dir;
                    target = pick(dir);
                }
                // A car heading for a stop only to turn there claims nothing.
                let turn = target.filter(|&k| !demand.is_cab(k) && self.ways.against(k, dir));
                match (turn, target) {
                    (Some(k), _) => self.ways.turn_at(k),
                    (None, Some(k)) => claimed.claim(k, self.ways.claim_way(k, dir)),
                    (None, None) => {}
                }
                let target = match target {
                    Some(k) => stops[k] as f64,
                    None => {
                        let tg = car_home as f64;
                        if (pos - tg).abs() < 0.05 {
                            t.car_dir[i] = 0;
                            (car_load[i], est[i]) = (0.0, 0.0);
                            // Parked at home: it settles on the floor and
                            // opens for whoever waits there.
                            t.car_positions[i] = tg;
                            self.open_cars
                                .push((id, i as i64, car_home, Leaving::Either));
                            continue;
                        }
                        tg
                    }
                };
                // A car that would end this move within `AT_STOP_FLOORS` of
                // its target lands on it now: left short, the next search
                // would look past the stop and the car would glide by it.
                if (target - pos).abs() <= v + AT_STOP_FLOORS {
                    pos = target;
                    dwell[i] = shaft_dwell;
                    held[i] = 0.0;
                    let left = (car_load[i] - (car_load[i] * 0.45).ceil()).max(0.0);
                    (est[i], car_load[i]) = (car_state::share(est[i], car_load[i], left), left);
                    let tf = target as i64;
                    let w = if staff_only {
                        hall_at(tf)
                    } else {
                        self.waiting.get(&tf).copied().unwrap_or(0.0)
                    };
                    // A stood-down car lets nobody on.
                    let room = if stood_down { 0.0 } else { cap - car_load[i] };
                    let live = stop_index(tf).is_some_and(|k| has_bit(call_bits, k));
                    let mut b = Boarding {
                        waiting: &mut self.waiting,
                        tally: &mut self.board_tally,
                    };
                    let board = b.board(id, tf, w, room, staff_only, live);
                    if board > 0.0 {
                        car_load[i] += board;
                        // A staff car boards only the crowd's callers.
                        est[i] += if staff_only { 0.0 } else { board };
                        t.rides += 1;
                    }
                    if pos >= t.top as f64 {
                        dir = -1;
                    } else if pos <= t.bottom as f64 {
                        dir = 1;
                    }
                    // Arrived: the doors open for the rest of the step, and
                    // whoever waits there sees which way the car leaves.
                    let mut leaving = Leaving::Either;
                    if rules.riders_go_their_way && hall_at(tf) >= 1.0 {
                        let demand = Demand {
                            stops: &stops,
                            calls: calls_now,
                            claimed,
                            cab: cab_stops,
                            ways: &self.ways,
                        };
                        let at = (pos, stop_index(tf));
                        (dir, leaving) = departure(&demand, &self.no_calls, at, dir, &covered);
                    }
                    seen[i] = takes_at(tf, dir);
                    self.open_cars.push((id, i as i64, tf, leaving));
                } else {
                    dir = if target > pos { 1 } else { -1 };
                    pos += dir as f64 * v;
                }
                t.car_positions[i] = pos.max(t.bottom as f64).min(t.top as f64);
                t.car_dir[i] = dir;
            }
        }
        // The crowd searches the lists, and the shafts come in saved order.
        let (closed, open) = (&mut self.closed_cars, &mut self.open_cars);
        (self.door_runs).put_in_id_order(&floors.elevators_by_id, closed, open);
    }
}

#[path = "dispatch_demand.rs"]
mod demand;

#[path = "dispatch_waiting.rs"]
mod waiting;

#[cfg(test)]
#[path = "dispatch_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "closed_cars_tests.rs"]
mod closed_cars_tests;

#[cfg(test)]
#[path = "dispatch_staff_tally_tests.rs"]
mod staff_tally_tests;
