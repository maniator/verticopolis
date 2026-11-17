//! The two 1994 dispatch settings as the SimTower wiki's Elevators page
//! describes them, which Classic follows (the rules in `rules::elevators`):
//!
//! - Waiting Car Response: when a call comes in, a waiting car stays put if
//!   a car already moving in that direction is within that many floors.
//!   A call's direction is its callers' way when the crowd alone calls and
//!   they all agree (`Ways`); otherwise "in that direction" reads as
//!   "heading toward the call's floor" (or dwelling on it).
//! - Standard Floor Departure: a car that has loaded waits that long, boards
//!   anyone who arrives meanwhile, and leaves once a whole wait passes with
//!   nobody new. A full car leaves, so the wait cannot run forever.

use std::collections::{BTreeMap, HashMap};

use super::demand::Demand;

use indexmap::IndexMap;

/// How close to a stop a car must stand to count as on it, in floors.
pub(super) const ON_FLOOR: f64 = 0.05;

/// Whether a car of the shaft other than `me` already covers a call at
/// `floor` under Waiting Car Response `response`: it is on shift (its index
/// is below `active`), moving (`dirs` is 0 only for a parked car), heading
/// toward the floor or standing on it, moving the way its callers are bound
/// when they all agree (`bound`), and at most `response` floors away. At most
/// eight cars a shaft, so the walk is short.
pub(super) fn moving_car_covers(
    positions: &[f64],
    dirs: &[i64],
    me: usize,
    active: usize,
    (floor, bound): (f64, Option<i64>),
    response: f64,
) -> bool {
    positions
        .iter()
        .zip(dirs)
        .take(active)
        .enumerate()
        .any(|(j, (&pos, &dir))| {
            let ahead = (floor - pos) * dir as f64;
            let their_way = bound.is_none_or(|b| b == dir);
            j != me
                && dir != 0
                && their_way
                && ahead >= -ON_FLOOR
                && (floor - pos).abs() <= response
        })
}

/// What a car boarding at one stop changes outside the car itself.
pub(super) struct Boarding<'a> {
    pub waiting: &'a mut BTreeMap<i64, f64>,
    pub tally: &'a mut HashMap<i64, IndexMap<i64, f64>>,
}

impl Boarding<'_> {
    /// Boards up to `room` of the `waiting` riders at `floor` onto a car of
    /// shaft `id` and returns how many got on. A passenger car takes them
    /// off the statistical estimate; a staff car leaves the crowd's calls
    /// alone. A passenger stop with a live call (`live_call`) adds the
    /// estimate's riders to the shaft's origin tally (#465). A staff car's
    /// riders are the crowd's own callers, who count once each as they step
    /// aboard (`Crowd::elevator_boardings`, #477): tallied here as well, a
    /// car coming back to a call nobody answered would count them again.
    #[inline]
    pub fn board(
        &mut self,
        id: i64,
        floor: i64,
        waiting: f64,
        room: f64,
        staff_only: bool,
        live_call: bool,
    ) -> f64 {
        let board = room.min(waiting).max(0.0);
        if board <= 0.0 {
            return 0.0;
        }
        if !staff_only {
            self.waiting.insert(floor, (waiting - board).max(0.0));
        }
        if live_call && !staff_only {
            let n = self
                .tally
                .entry(id)
                .or_default()
                .entry(floor)
                .or_insert(0.0);
            *n = (*n + board).min(5000.0);
        }
        board
    }

    /// Standard Floor Departure's arrivals at a car waiting on `floor` with
    /// `room` to spare: the statistical estimate there (boarding consumes
    /// it, so what is left is new) and the crowd's newcomers, the callers
    /// above the count the car last saw (`hall` is the count now and the
    /// count seen, which this updates). A staff car reads only the crowd, as
    /// its arrival boarding does. Nothing boards until a whole rider is
    /// waiting. The riders count against the car's load, so a car that keeps
    /// taking arrivals fills and leaves. Returns how many boarded and how
    /// many of them the estimate gave (none on a staff car), whose seats the
    /// busy meter counts beside the crowd's own riders (#2397).
    pub fn arrivals(
        &mut self,
        id: i64,
        floor: i64,
        hall: (f64, &mut f64),
        room: f64,
        staff_only: bool,
        live_call: bool,
    ) -> (f64, f64) {
        let (now, seen) = hall;
        let newcomers = (now - *seen).max(0.0);
        *seen = now;
        let (estimate, crowd) = if staff_only {
            (newcomers, 0.0)
        } else {
            (self.waiting.get(&floor).copied().unwrap_or(0.0), newcomers)
        };
        if estimate + crowd < 1.0 {
            return (0.0, 0.0);
        }
        let took = self.board(id, floor, estimate, room, staff_only, live_call);
        let total = took + (room - took).min(crowd).max(0.0);
        (total, if staff_only { 0.0 } else { took })
    }
}

/// The nearest stop ahead of `pos` going `dir` that the car answers: a stop
/// in its own cab, or one within `reach` that no moving car covers
/// (`covered`). A covered stop is passed over and the search goes on past
/// it; a stop beyond `reach` ends it, as every later stop is farther. The
/// search only returns a stop at a finite distance and `reach` is never
/// NaN, so `<=` is the TypeScript's `!(dist > reach)`. A call whose callers
/// are all bound against `dir` (`Ways`) is passed too, unless nothing the car
/// answers lies beyond it: then it is the car's turn, if no other car turns
/// there already. With nothing covered or
/// bound one way, this is one `next_stop`.
pub(super) fn first_answering(
    demand: &Demand,
    pos: f64,
    dir: i64,
    reach: f64,
    covered: impl Fn(usize) -> bool,
) -> Option<usize> {
    let mut from = pos;
    // The farthest call so far whose callers are all bound against `dir`:
    // passed while anything lies beyond it, the car's turn when nothing does.
    let mut turn = None;
    loop {
        let Some(k) = demand.next_stop(from, dir) else {
            return turn;
        };
        if demand.is_cab(k) {
            return Some(k);
        }
        if (demand.stops[k] as f64 - pos).abs() > reach {
            return turn;
        }
        // The bit tests come before `covered`, which may weigh every car.
        if !demand.ways.against(k, dir) {
            if !covered(k) {
                return Some(k);
            }
        } else if !demand.ways.turned_at(k) && !covered(k) {
            turn = Some(k);
        }
        from = demand.stops[k] as f64;
    }
}
