//! The dispatch rules a tower runs, read from its mode (`rules::elevators`),
//! and Modern's smart dispatch, the package the owner picked after the
//! 2026-11-12 party round:
//!
//! - Best car: each hall call belongs to the one on-shift car best placed to
//!   answer it, scored once per shaft per step by travel (a car moving the
//!   wrong way goes out to its farthest promised stop and back, plus the
//!   span), the dwell it has left and one dwell per stop it already owes. A
//!   car already heading to the call within Waiting Car Response floors wins
//!   outright, so the setting means what it means in Classic.
//! - Spread homes: a car with no home of its own idles at the lobby (the
//!   first car) or an evenly spread stop (the rest). Runtime only: nothing
//!   is written to the schedule, a save or a .TDT.
//! - Standard Floor Departure restarts when a rider arrives, up to twice the
//!   setting (`ElevatorDispatch::car_held` keeps the time waited).

use std::collections::BTreeSet;

use super::classic::ON_FLOOR;
use super::WORD;
use super::CAR_FLOORS_PER_MINUTE;
use crate::clock::GameMode;

/// The owner of a called stop no on-shift car can answer.
pub(super) const NO_CAR: usize = usize::MAX;

/// The dispatch rules one tower runs this step.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DispatchRules {
    /// Classic's Waiting Car Response: a parked car leaves a call to a car
    /// already heading there within that many floors.
    pub parked_car_yields: bool,
    /// Modern: each hall call goes to the best-placed car.
    pub best_car: bool,
    /// Standard Floor Departure starts over when a rider arrives.
    pub departure_restarts: bool,
    /// The longest wait at one stop, as a multiple of Standard Floor
    /// Departure, when it restarts. `None` waits as long as riders come.
    pub departure_limit: Option<f64>,
    /// A car with no home idles at a spread stop instead of the lobby.
    pub spread_homes: bool,
    /// The provisional reading of Waiting Car Response that both modes have
    /// retired: a parked car answers only calls within the span less that
    /// many floors. Only the test-only plain SCAN profile sets it.
    pub parked_reach_gate: bool,
}

impl DispatchRules {
    /// The rules a tower of `mode` runs.
    pub fn for_mode(mode: GameMode) -> DispatchRules {
        DispatchRules {
            parked_car_yields: mode.waiting_car_response_watches_moving_cars(),
            best_car: mode.elevators_send_the_best_car(),
            departure_restarts: true,
            departure_limit: mode.departure_wait_limit(),
            spread_homes: mode.spreads_unset_car_homes(),
            parked_reach_gate: false,
        }
    }

    /// The plain SCAN controller the hashed reference dispatcher pins
    /// (`dispatch_reference_tests.rs`): every car sweeps on its own, a parked
    /// car answers calls within the span less Waiting Car Response, a car
    /// waits one fixed dwell and idles at the lobby. No mode runs it; it keeps
    /// the bit-set search honest against the reference step for step.
    #[cfg(test)]
    pub fn plain_scan() -> DispatchRules {
        DispatchRules {
            parked_car_yields: false,
            best_car: false,
            departure_restarts: false,
            departure_limit: None,
            spread_homes: false,
            parked_reach_gate: true,
        }
    }
}

/// Where car `car` of `cars` idles when the schedule names no home for it:
/// the `lobby`, or with `spread` the first car at the lobby and car `i` at
/// stop `i * stops / cars` of the ascending `stops`.
pub(crate) fn idle_home(spread: bool, stops: &[i64], lobby: i64, car: usize, cars: usize) -> i64 {
    if !spread || car == 0 || car >= cars {
        return lobby;
    }
    stops
        .get(car * stops.len() / cars)
        .copied()
        .unwrap_or(lobby)
}

/// One on-shift car as the best-car choice sees it.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(super) struct CarView {
    pub pos: f64,
    /// 1 up, -1 down, 0 parked.
    pub dir: i64,
    /// Where a car moving away from a call turns: its farthest promised stop
    /// ahead, or where it stands when it owes none ahead.
    pub turn: f64,
    /// The floors' worth of time the car already owes: its dwell left and a
    /// dwell for each stop it has promised a rider.
    pub owed: f64,
}

impl CarView {
    /// A car at `pos` moving `dir` with `dwell_left` minutes of its stop to
    /// go and the riders' floors `cab`, where each stop takes `stop_minutes`.
    pub fn of(
        pos: f64,
        dir: i64,
        dwell_left: f64,
        cab: Option<&BTreeSet<i64>>,
        stop_minutes: f64,
    ) -> CarView {
        let farthest = cab.and_then(|c| if dir > 0 { c.last() } else { c.first() });
        let turn = farthest
            .map(|&f| f as f64)
            .filter(|&f| (f - pos) * dir as f64 > 0.0)
            .unwrap_or(pos);
        let promised = cab.map_or(0, BTreeSet::len) as f64;
        CarView {
            pos,
            dir,
            turn,
            owed: (dwell_left + promised * stop_minutes) * CAR_FLOORS_PER_MINUTE,
        }
    }

    /// Whether the car is moving toward `floor` or standing on it.
    fn heading_to(&self, floor: f64) -> bool {
        self.dir != 0 && (floor - self.pos) * self.dir as f64 >= -ON_FLOOR
    }

    /// The car's cost to answer a call at `floor`, in floors: the travel
    /// there, plus `wrong_way` and the trip out to its turn when it is moving
    /// away, plus what it already owes.
    fn cost(&self, floor: f64, wrong_way: f64) -> f64 {
        let travel = if self.dir == 0 || self.heading_to(floor) {
            (floor - self.pos).abs()
        } else {
            (self.turn - self.pos).abs() + (self.turn - floor).abs() + wrong_way
        };
        travel + self.owed
    }
}

/// The best car for each called stop of a shaft, into `owner` (one slot per
/// stop, `NO_CAR` where nobody is on shift or no call is up). `cars` are the
/// on-shift cars in index order; `calls` the called stops as bits over
/// `stops`. A car heading to the call within `response` floors wins outright,
/// the nearest such first; otherwise the cheapest `CarView::cost`, a car
/// moving away paying `wrong_way` floors on top. Ties go to the lower index.
/// One pass over at most eight cars per call, no allocation once `owner` has
/// grown to the shaft.
pub(super) fn assign_best_cars(
    cars: &[CarView],
    stops: &[i64],
    calls: &[u64],
    response: Option<f64>,
    wrong_way: f64,
    owner: &mut Vec<usize>,
) {
    owner.clear();
    owner.resize(stops.len(), NO_CAR);
    for (w, &word) in calls.iter().enumerate() {
        let mut bits = word;
        while bits != 0 {
            let k = w * WORD + bits.trailing_zeros() as usize;
            bits &= bits - 1;
            owner[k] = best_car(cars, stops[k] as f64, response, wrong_way);
        }
    }
}

fn best_car(cars: &[CarView], floor: f64, response: Option<f64>, wrong_way: f64) -> usize {
    let mut coming: Option<(f64, usize)> = None;
    let mut cheapest: Option<(f64, usize)> = None;
    for (j, car) in cars.iter().enumerate() {
        let dist = (floor - car.pos).abs();
        if response.is_some_and(|r| car.heading_to(floor) && dist <= r)
            && coming.is_none_or(|(d, _)| dist < d)
        {
            coming = Some((dist, j));
        }
        let cost = car.cost(floor, wrong_way);
        if cheapest.is_none_or(|(c, _)| cost < c) {
            cheapest = Some((cost, j));
        }
    }
    coming.or(cheapest).map_or(NO_CAR, |(_, j)| j)
}

#[cfg(test)]
#[path = "dispatch_modern_tests.rs"]
mod tests;
