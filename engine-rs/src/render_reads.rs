//! The renderer's reads that the port answers (facade slice 7, PR 5b): the garage and
//! waste fills (`parkingUsage` and `recyclingFill` in the retired TypeScript
//! `src/engine/sim/services.ts`) and the elevator queue projection
//! (`elevatorQueueView` in `src/engine/crowd/routing.ts`). The renderer reads the
//! fills once per scene sync and the queue once per frame.

use crate::crowd::fasthash::FastIndexMap;

use crate::crowd::{Crowd, PState, STRESS_WAIT};
use crate::facilities::Kind;
use crate::services::GARBAGE_COLLECT_HOUR;
use crate::sim::Simulation;
use crate::tower::{Tower, UnitState};

/// One elevator landing's waiting line: the riders and the worst wait tier.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct QueueLanding {
    pub count: i64,
    pub tier: i64,
}

/// `ElevatorQueueView`: the waiting lines by shaft then floor, in the order
/// the crowd first lists them, and the riders aboard each elevator car by
/// shaft then car index, in tower order.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct QueueView {
    pub landings: FastIndexMap<i64, FastIndexMap<i64, QueueLanding>>,
    pub boarded: Vec<(i64, Vec<i64>)>,
}

/// `waitTier`: 2 once the wait reaches `STRESS_WAIT`, 1 at half of it.
fn wait_tier(wait: f64) -> i64 {
    if wait >= STRESS_WAIT {
        2
    } else if wait >= STRESS_WAIT / 2.0 {
        1
    } else {
        0
    }
}

#[doc(hidden)]
impl Simulation {
    /// `recyclingFill`: how full the bins are, 0 to 1, from the population
    /// against the capacity and the time since the morning collection.
    pub fn recycling_fill(&self) -> f64 {
        let cap = self.recycling_capacity();
        if cap == 0.0 {
            return 0.0;
        }
        self.recycling_fill_of(self.recycling_population(), cap)
    }

    /// The fill for `population` against `capacity` at this minute of the
    /// day; empty bins when there is no capacity, as `recycling_fill` says.
    pub(crate) fn recycling_fill_of(&self, population: i64, capacity: f64) -> f64 {
        if capacity == 0.0 {
            return 0.0;
        }
        let since = (self.clock.minute_of_day() - GARBAGE_COLLECT_HOUR * 60.0 + 1440.0) % 1440.0;
        (population as f64 / capacity * (since / 1440.0)).min(1.0)
    }

    /// `parkingUsage(spots)`: the share of `spots` working spaces taken, 0
    /// to 1: office cars on weekday working hours, suite guests' cars at
    /// night. Nothing parks below parking's unlock star.
    pub fn parking_usage(&self, spots: f64) -> f64 {
        if spots == 0.0 || self.star < Kind::Parking.facility().min_star {
            return 0.0;
        }
        let h = self.clock.hour();
        let office_cars = if !self.clock.is_weekend() && (8..18).contains(&h) {
            self.parking_demand().offices
        } else {
            0.0
        };
        let mut suite_cars = 0.0;
        if !(8..19).contains(&h) {
            for u in self.tower.room_units() {
                if u.kind == Kind::HotelSuite && u.state == UnitState::Asleep {
                    suite_cars += 1.0;
                }
            }
        }
        ((office_cars + suite_cars) / spots).min(1.0)
    }

    /// The crowd's queue projection, as the step left it.
    pub fn elevator_queue_view(&mut self) -> &QueueView {
        self.crowd.queue_view(&self.tower)
    }
}

impl Crowd {
    /// `Crowd.queueView`: the queue projection, kept per step and tower
    /// revision. The step loop builds it right after `begin_step`, before
    /// the step spawns or moves anyone, as the TypeScript loop does, so a
    /// frame between steps reads the step's start. An edit while paused
    /// moves the revision, and the next read builds it again.
    pub fn queue_view(&mut self, tower: &Tower) -> &QueueView {
        let key = (self.step, tower.revision);
        if self.queue_cache.as_ref().is_none_or(|(k, _)| *k != key) {
            let old = self.queue_cache.take().map(|(_, view)| view);
            let view = self.build_queue_view(tower, old.unwrap_or_default());
            self.queue_cache = Some((key, view));
        }
        &self.queue_cache.as_ref().expect("built above").1
    }

    /// `elevatorQueueView`: one walk of the crowd for the landings and one of
    /// the transports for the cars. A landing counts only an elevator's
    /// waiters on a floor it stops at, and on a staff-only shaft only staff.
    /// It is built into the last step's view, its maps and lists emptied in
    /// place (`Crowd::queue_spare`), so a step allocates nothing once they
    /// have grown (hot-path HP-3).
    fn build_queue_view(&mut self, tower: &Tower, mut view: QueueView) -> QueueView {
        for (_, mut floors) in view.landings.drain(..) {
            floors.clear();
            self.queue_spare.push(floors);
        }
        let (landings, spare) = (&mut view.landings, &mut self.queue_spare);
        let stops = tower.stop_bits();
        for p in &self.people {
            let Some(shaft_id) = p.shaft_id else { continue };
            if p.state != PState::Waiting {
                continue;
            }
            let Some(index) = tower.transport_index(shaft_id) else {
                continue;
            };
            let shaft = &tower.transports[index];
            if !shaft.kind.is_elevator()
                || (shaft.kind.is_staff_only_transport() && !p.staff)
                || !tower.stops_at_index(&stops, index, p.floor)
            {
                continue;
            }
            let landing = landings
                .entry(shaft_id)
                .or_insert_with(|| spare.pop().unwrap_or_default())
                .entry(p.floor)
                .or_default();
            landing.count += 1;
            landing.tier = landing.tier.max(wait_tier(p.wait));
        }
        // The elevators alone, in list order, from the per-revision index:
        // Modern sets no limit on stairs and escalators, so a walk over
        // every transport would grow with the flights (section 3 of
        // `docs/performance/hot-path-review.md`).
        let floors = tower.dispatch_floors();
        let mut n = 0;
        for &k in &floors.elevators {
            let t = &tower.transports[k];
            if n == view.boarded.len() {
                view.boarded.push((t.id, Vec::new()));
            }
            let (id, cars) = &mut view.boarded[n];
            *id = t.id;
            cars.clear();
            cars.extend((0..t.cars).map(|i| self.car_riders.get(&(t.id, i)).copied().unwrap_or(0)));
            n += 1;
        }
        view.boarded.truncate(n);
        view
    }
}
