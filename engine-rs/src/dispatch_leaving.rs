//! Which way a car standing at a stop leaves: the arrow lit over its doors.
//!
//! A person waiting at a stop boards only a car that leaves their way, or
//! one with nowhere else to go, as the SimTower wiki's riders do (Classic)
//! and as real elevators do (Modern). Before this, a rider on 45 bound for 47
//! boarded a car sweeping down, rode it to the bottom and back up (4.7.0).
//!
//! The calls carry no direction, so the car decides its way when it opens
//! for someone: on along its sweep while it still has a stop ahead, back the
//! other way when every stop it has left is behind it, and either way when it
//! has none. The first rider aboard a car leaving either way sets its way.
//! A car leaving a stop with riders aboard heads for their floors before it
//! looks at any call, so the arrow holds.

use std::cell::RefCell;

use super::classic::first_answering;
use super::demand::{has_bit, set_bit, Demand};
use crate::crowd::HallCall;

/// The way a car with its doors open leaves.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Leaving {
    Down,
    Up,
    /// The car owes no stop and answers no call elsewhere, so whoever gets
    /// on first sends it their way.
    Either,
}

impl Leaving {
    /// The way a car moving `dir` (1 up, -1 down) leaves.
    fn along(dir: i64) -> Leaving {
        if dir > 0 {
            Leaving::Up
        } else {
            Leaving::Down
        }
    }

    /// The way as a direction: 1 up, -1 down, 0 either.
    pub(super) fn way(self) -> i64 {
        match self {
            Leaving::Up => 1,
            Leaving::Down => -1,
            Leaving::Either => 0,
        }
    }

    /// Whether a rider at `from` bound for `to` gets on a car leaving this way.
    pub fn takes(self, from: i64, to: i64) -> bool {
        match self {
            Leaving::Up => to > from,
            Leaving::Down => to < from,
            Leaving::Either => true,
        }
    }
}

/// The stops of the shaft in hand whose callers are all bound one way, as
/// bit sets over its stops. A car sweeping the other way passes such a stop
/// unless it is the last one it answers ahead (where it turns), so nobody
/// waits out a stop by a car that will not take them. Only stops the crowd
/// alone calls count: the statistical estimate has no way.
///
/// A car heading for such a stop to turn there marks it `turning`, so no
/// other car turns there too, but it claims nothing: a car already sweeping
/// the callers' way still stops for them on its way past.
///
/// `some_up` and `some_down` hold the stops where anyone waits bound up or
/// down, the estimate or not, so a car claims a stop only for its own way
/// when someone there is bound the other.
#[derive(Default)]
pub(super) struct Ways {
    up_only: Vec<u64>,
    down_only: Vec<u64>,
    some_up: Vec<u64>,
    some_down: Vec<u64>,
    /// In a cell, as the cars' search holds the sets while one marks.
    turning: RefCell<Vec<u64>>,
}

impl Ways {
    /// Clears the sets for a shaft of `words` words of stops.
    pub(super) fn reset(&mut self, words: usize) {
        let sets = [
            &mut self.up_only,
            &mut self.down_only,
            &mut self.some_up,
            &mut self.some_down,
        ];
        for bits in sets {
            bits.clear();
            bits.resize(words, 0);
        }
        let turning = self.turning.get_mut();
        turning.clear();
        turning.resize(words, 0);
    }

    /// Marks stop `k`, where `call` waits: the ways anyone there is bound,
    /// and, when the crowd's callers are the stop's alone (`crowd_alone`),
    /// whether every one of them is bound the same way.
    pub(super) fn mark(&mut self, k: usize, call: HallCall, crowd_alone: bool) {
        if call.up > 0 {
            set_bit(&mut self.some_up, k);
        }
        if call.down > 0 {
            set_bit(&mut self.some_down, k);
        }
        if !crowd_alone || f64::from(call.up + call.down) != call.callers {
            return;
        }
        if call.down == 0 {
            set_bit(&mut self.up_only, k);
        } else if call.up == 0 {
            set_bit(&mut self.down_only, k);
        }
    }

    /// Whether every caller at stop `k` is bound against `dir` (1 up, -1 down).
    pub(super) fn against(&self, k: usize, dir: i64) -> bool {
        let bits = if dir > 0 {
            &self.down_only
        } else {
            &self.up_only
        };
        !bits.is_empty() && has_bit(bits, k)
    }

    /// The ways a car leaving stop `k` (or heading there) `dir` (1 up, -1
    /// down, 0 either) claims it: only its own when anyone there is bound
    /// against it, both (`None`) otherwise.
    pub(super) fn claim_way(&self, k: usize, dir: i64) -> Option<i64> {
        let others = match dir {
            1 => &self.some_down,
            -1 => &self.some_up,
            _ => return None,
        };
        (!others.is_empty() && has_bit(others, k)).then_some(dir)
    }

    /// Marks stop `k` as one a car heads for to turn there.
    pub(super) fn turn_at(&self, k: usize) {
        set_bit(&mut self.turning.borrow_mut(), k);
    }

    /// Whether a car already heads for stop `k` to turn there.
    pub(super) fn turned_at(&self, k: usize) -> bool {
        has_bit(&self.turning.borrow(), k)
    }

    /// The way every caller at stop `k` is bound, if they agree.
    pub(super) fn bound(&self, k: usize) -> Option<i64> {
        [(1, &self.up_only), (-1, &self.down_only)]
            .into_iter()
            .find(|(_, bits)| !bits.is_empty() && has_bit(bits, k))
            .map(|(way, _)| way)
    }
}

/// Of the callers at a stop (`call`), how many a car leaving `dir` (1 up,
/// -1 down, 0 either) takes: all but those bound against it, when their
/// ways are `known` (riders go their way).
pub(super) fn their_way(call: HallCall, known: bool, dir: i64) -> f64 {
    let against = match (known, dir.signum()) {
        (true, 1) => call.down,
        (true, -1) => call.up,
        _ => 0,
    };
    (call.callers - f64::from(against)).max(0.0)
}

/// A car with its doors open this step: (shaft id, car index, floor, the way
/// it leaves). Ascending, so a binary search on the first three finds a car.
pub type OpenCar = (i64, i64, i64, Leaving);

/// Finds car `car` of shaft `shaft` open at `floor` in `open` (ascending), and
/// the way it leaves.
pub fn leaving_at(open: &[OpenCar], shaft: i64, car: i64, floor: i64) -> Option<Leaving> {
    open.binary_search_by(|&(s, c, f, _)| (s, c, f).cmp(&(shaft, car, floor)))
        .ok()
        .map(|k| open[k].3)
}

/// Rider at `from` bound for `to` has boarded car `car` of shaft `shaft`
/// open at `from`: a car that would leave either way now leaves theirs, so
/// nobody bound the other way follows them on this step. Their stop is then
/// the car's only rider stop, which it heads for first (`toward_riders`).
pub fn first_aboard(open: &mut [OpenCar], shaft: i64, car: i64, from: i64, to: i64) {
    let key = (shaft, car, from);
    if let Ok(k) = open.binary_search_by(|&(s, c, f, _)| (s, c, f).cmp(&key)) {
        if open[k].3 == Leaving::Either {
            open[k].3 = Leaving::along(to - from);
        }
    }
}

/// The way a car standing at `pos` with riders aboard heads: on while one of
/// their stops lies ahead of `dir` (never 0), back when they all lie behind.
/// `None` with nobody aboard. `no_calls` is the shaft's zero call words, so
/// the search sees the riders' stops alone. A car leaving a stop asks this
/// before it looks at the calls, so it never carries its riders away from
/// every floor they are bound for.
pub(super) fn toward_riders(demand: &Demand, no_calls: &[u64], pos: f64, dir: i64) -> Option<i64> {
    demand.cab?;
    let riders = Demand {
        calls: no_calls,
        ..*demand
    };
    if riders.next_stop(pos, dir).is_some() {
        Some(dir)
    } else {
        riders.next_stop(pos, -dir).map(|_| -dir)
    }
}

/// The way a car standing at `pos` (stop `here`) and last moving `dir`
/// (never 0) leaves, and the direction it sweeps next: toward its riders'
/// stops when it has riders (`toward_riders`); back when every caller at
/// `here` is bound against `dir`, as the car came to turn there; else on
/// while a call it answers lies ahead (the same search, `covered` included,
/// that picks its next target), back when one lies only behind, and `dir`
/// with [`Leaving::Either`] when none does. At most four stop searches.
pub(super) fn departure(
    demand: &Demand,
    no_calls: &[u64],
    (pos, here): (f64, Option<usize>),
    dir: i64,
    covered: &impl Fn(usize) -> bool,
) -> (i64, Leaving) {
    if let Some(way) = toward_riders(demand, no_calls, pos, dir) {
        (way, Leaving::along(way))
    } else if here.is_some_and(|k| demand.ways.against(k, dir)) {
        (-dir, Leaving::along(-dir))
    } else if first_answering(demand, pos, dir, f64::INFINITY, covered).is_some() {
        (dir, Leaving::along(dir))
    } else if first_answering(demand, pos, -dir, f64::INFINITY, covered).is_some() {
        (-dir, Leaving::along(-dir))
    } else {
        (dir, Leaving::Either)
    }
}
