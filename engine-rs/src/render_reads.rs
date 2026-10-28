//! The renderer's reads that the port answers (facade slice 7, PR 5b): the
//! garage and waste fills (`parkingUsage` and `recyclingFill` in
//! `sim/services.ts`) and the elevator queue projection (`elevatorQueueView`
//! in `crowd/routing.ts`). The renderer reads the fills once per scene sync
//! and the queue once per frame.

use indexmap::IndexMap;

use crate::crowd::{PState, STRESS_WAIT};
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

/// `GARBAGE_COLLECT_HOUR` (census.ts): the hour the recycling bins empty.
const GARBAGE_COLLECT_HOUR: f64 = 5.0;

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
    pub landings: IndexMap<i64, IndexMap<i64, QueueLanding>>,
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

impl Simulation {
    /// `recyclingFill`: how full the bins are, 0 to 1, from the population
    /// against the capacity and the time since the morning collection.
    pub fn recycling_fill(&self) -> f64 {
        let cap = self.recycling_capacity();
        if cap == 0.0 {
            return 0.0;
        }
        let since = (self.clock.minute_of_day() - GARBAGE_COLLECT_HOUR * 60.0 + 1440.0) % 1440.0;
        (self.tower.total_population() as f64 / cap * (since / 1440.0)).min(1.0)
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

    /// `elevatorQueueView`: one walk of the crowd for the landings and one of
    /// the transports for the cars. A landing counts only an elevator's
    /// waiters on a floor it stops at, and on a staff-only shaft only staff.
    pub fn elevator_queue_view(&self) -> QueueView {
        let mut landings: IndexMap<i64, IndexMap<i64, QueueLanding>> = IndexMap::new();
        for p in &self.crowd.people {
            let Some(shaft_id) = p.shaft_id else { continue };
            if p.state != PState::Waiting {
                continue;
            }
            let Some(shaft) = self.tower.get_transport(shaft_id) else {
                continue;
            };
            if !shaft.kind.is_elevator()
                || (shaft.kind.is_staff_only_transport() && !p.staff)
                || !shaft.stops_at(p.floor)
            {
                continue;
            }
            let landing = landings
                .entry(shaft_id)
                .or_default()
                .entry(p.floor)
                .or_default();
            landing.count += 1;
            landing.tier = landing.tier.max(wait_tier(p.wait));
        }
        let boarded = self
            .tower
            .transports
            .iter()
            .filter(|t| t.kind.is_elevator())
            .map(|t| {
                let cars = (0..t.cars)
                    .map(|i| self.crowd.car_riders.get(&(t.id, i)).copied().unwrap_or(0))
                    .collect();
                (t.id, cars)
            })
            .collect();
        QueueView { landings, boarded }
    }
}
