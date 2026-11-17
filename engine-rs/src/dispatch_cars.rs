//! What the dispatch keeps per car beside its dwell timer: the crowd callers
//! it has seen at its stop, the time it has waited there, and its estimate
//! seats. One record per shaft, so a step looks a shaft up once for all
//! three.
//!
//! The estimate seats are the part of a car's notional load (`car_load`)
//! that the statistical waiting estimate boarded. `car_load` also holds some
//! of the crowd's callers (Standard Floor Departure's newcomers, a staff
//! car's hall callers), who ride as people and sit in `Crowd::car_riders`
//! too. The hourly demand ring and utilization (`telemetry.rs`) read the
//! seats plus the crowd's riders, so everyone aboard counts once (#2397).
//! The seats are counting only: nothing reads them back into how the cars
//! move.

use super::ElevatorDispatch;
use crate::crowd::Crowd;
use crate::tower::{Tower, Transport};

/// One shaft's cars, one slot per car in each list.
#[derive(Default)]
pub(super) struct Cars {
    /// The crowd callers each car has seen at its stop, so Standard Floor
    /// Departure counts only newcomers.
    pub(super) seen: Vec<f64>,
    /// The minutes each car has waited at its current stop, so Modern's
    /// Standard Floor Departure stops at its limit.
    pub(super) held: Vec<f64>,
    /// Each car's estimate seats; `None` until the cars first move, or after
    /// a save from before the seats were kept (`seats`).
    pub(super) seats: Option<Vec<f64>>,
}

impl Cars {
    /// The estimate seats, one per car of `load` (the shaft's `car_load`).
    /// Seats not yet known take a passenger car's whole load as the
    /// estimate's, which is how the load was read before the seats were
    /// kept, and a staff car's as nobody's: a staff car boards only the
    /// crowd. A car the shaft gains starts empty, as its `car_load` does.
    #[inline]
    pub(super) fn seats<'a>(
        seats: &'a mut Option<Vec<f64>>,
        load: &[f64],
        staff_only: bool,
    ) -> &'a mut [f64] {
        let seats = seats.get_or_insert_with(|| {
            if staff_only {
                vec![0.0; load.len()]
            } else {
                load.to_vec()
            }
        });
        if seats.len() != load.len() {
            seats.resize(load.len(), 0.0);
        }
        seats
    }

    /// A save's seats, each held to its car's load.
    pub(super) fn restored_seats(mut seats: Vec<f64>, load: Option<&[f64]>) -> Vec<f64> {
        for (i, s) in seats.iter_mut().enumerate() {
            let most = load.and_then(|l| l.get(i)).copied().unwrap_or(0.0);
            *s = s.min(most).max(0.0);
        }
        seats
    }
}

/// The estimate seats left aboard when a car's notional load goes from
/// `before` to `after` at a stop: they keep their share of it, so they never
/// outnumber the load and need no rounding rule of their own.
pub(super) fn share(seats: f64, before: f64, after: f64) -> f64 {
    if before > 0.0 {
        (seats * after / before).min(after).max(0.0)
    } else {
        0.0
    }
}

impl ElevatorDispatch {
    pub(super) fn prune_removed_shafts(&mut self, tower: &Tower) {
        // The shaft index answers "is this id live" without building a set.
        let live = |id: &i64| tower.transport_index(*id).is_some();
        self.car_dwell.retain(|id, _| live(id));
        self.cars.retain(|id, _| live(id));
    }

    /// Shaft `id`'s estimate seats, one per car, once its cars have moved
    /// (or a save gave them).
    pub(super) fn estimate_seats(&self, id: i64) -> Option<&[f64]> {
        self.cars.get(&id)?.seats.as_deref()
    }

    /// Everyone aboard shaft `t`'s cars, each counted once: the estimate's
    /// seats in each car and the crowd's own riders there
    /// (`Crowd::car_riders`), visitors, residents, guests, workers and staff
    /// alike. The car's notional load (`car_load`) is not read whole, as it
    /// also holds crowd callers who sit in `car_riders`. Before the cars
    /// first move (or after a save that kept no seats) a passenger car's
    /// seats are its whole load and a staff car's none, as `Cars::seats`
    /// takes them then.
    pub(crate) fn riders_aboard(&self, t: &Transport, crowd: &Crowd) -> f64 {
        let seats = self.estimate_seats(t.id);
        let (load, staff_only) = (t.car_load.as_deref(), t.kind.is_staff_only_transport());
        (0..t.cars.max(0) as usize)
            .map(|car| {
                let notional = load.and_then(|l| l.get(car)).copied().unwrap_or(0.0);
                // Never more than the car's load: a shaft an undo puts back
                // before the next step's prune starts with an empty load. A
                // car the seats do not list yet is one the shaft just gained,
                // which `Cars::seats` starts empty.
                let estimate = match seats {
                    Some(seats) => seats.get(car).copied().unwrap_or(0.0).min(notional),
                    None if staff_only => 0.0,
                    None => notional,
                };
                let riders = crowd.car_riders.get(&(t.id, car as i64)).copied();
                estimate + riders.unwrap_or(0) as f64
            })
            .sum()
    }
}

#[cfg(test)]
#[path = "dispatch_cars_tests.rs"]
mod tests;
