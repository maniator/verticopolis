//! The two 1994 dispatch settings as the SimTower wiki's Elevators page
//! describes them, which Classic follows (the rules in `rules::elevators`):
//!
//! - Waiting Car Response: when a call comes in, a waiting car stays put if
//!   a car already moving in that direction is within that many floors.
//!   Our calls carry no direction, so "in that direction" reads as "heading
//!   toward the call's floor" (or dwelling on it).
//! - Standard Floor Departure: a car that has loaded waits that long, boards
//!   anyone who arrives meanwhile, and leaves once a whole wait passes with
//!   nobody new. A full car leaves, so the wait cannot run forever.

use std::collections::{BTreeMap, HashMap};

use indexmap::IndexMap;

/// How close to a stop a car must stand to count as on it, in floors.
const ON_FLOOR: f64 = 0.05;

/// Whether a car of the shaft other than `me` already covers a call at
/// `floor` under Waiting Car Response `response`: it is on shift (its index
/// is below `active`), moving (`dirs` is 0 only for a parked car), heading
/// toward the floor or standing on it, and at most `response` floors away.
/// At most eight cars a shaft, so the walk is short.
pub(super) fn moving_car_covers(
    positions: &[f64],
    dirs: &[i64],
    me: usize,
    active: usize,
    floor: f64,
    response: f64,
) -> bool {
    positions
        .iter()
        .zip(dirs)
        .take(active)
        .enumerate()
        .any(|(j, (&pos, &dir))| {
            let ahead = (floor - pos) * dir as f64;
            j != me && dir != 0 && ahead >= -ON_FLOOR && (floor - pos).abs() <= response
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
    /// alone. A stop with a live call (`live_call`) adds the riders to the
    /// shaft's origin tally (#465).
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
        if live_call {
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
    /// `room` to spare: the statistical estimate there (for a staff car, the
    /// crowd's calls, as its arrival boarding reads them) and, for a
    /// passenger car, the crowd's callers too. Nothing boards until a whole
    /// rider is waiting. The riders count against the car's load, so a car
    /// that keeps taking arrivals fills and leaves. Returns how many boarded.
    pub fn arrivals(
        &mut self,
        id: i64,
        floor: i64,
        hall: f64,
        room: f64,
        staff_only: bool,
        live_call: bool,
    ) -> f64 {
        let (estimate, crowd) = if staff_only {
            (hall, 0.0)
        } else {
            (self.waiting.get(&floor).copied().unwrap_or(0.0), hall)
        };
        if estimate + crowd < 1.0 {
            return 0.0;
        }
        let took = self.board(id, floor, estimate, room, staff_only, live_call);
        took + (room - took).min(crowd).max(0.0)
    }
}
