// The raw shaft edits with their `capacity_changed` event. The charged
// commands in `charges.rs`, the binding and the TDT referee call them; the
// tower's own setters stay silent.

use crate::crowd::{motion, PState};
use crate::gameplay::GameplayEvent;
use crate::sim::Simulation;
use crate::tower::ResizeResult;

#[doc(hidden)]
impl Simulation {
    #[doc(hidden)]
    /// `tower.setCars(id, cars)` with its `capacity_changed`. Both engines
    /// emit from this layer (TypeScript `Simulation.setCars`, #906); the
    /// binding, the referee and the charges call it, and the tower stays silent.
    pub fn set_cars(&mut self, id: i64, cars: i64) -> bool {
        let before = self.fleet_size(id);
        let ok = self.tower.set_cars(id, cars);
        if ok {
            // Only a fleet that shrank has riders past its end to let off.
            if self.fleet_size(id) < before {
                self.let_off_riders_past_fleet(id);
            }
            self.note_capacity(id);
        }
        ok
    }

    /// How many cars shaft `id` runs now (none for a shaft that is gone).
    fn fleet_size(&self, id: i64) -> usize {
        self.tower
            .get_transport(id)
            .map_or(0, |t| t.car_positions.len())
    }

    /// Ends the trip of anyone riding a car that shaft `id` no longer has,
    /// as the next motion step would (a rider whose car index is past the
    /// fleet finishes there). Done at once, so a fleet sold down and bought
    /// back before any step (while paused) cannot hand the rider the fresh
    /// car parked at the bottom (#855). A shaft that is gone, or that kept
    /// every car, lets nobody off.
    pub(crate) fn let_off_riders_past_fleet(&mut self, id: i64) {
        let Some(cars) = self
            .tower
            .get_transport(id)
            .map(|t| t.car_positions.len() as i64)
        else {
            return;
        };
        for i in 0..self.crowd.people.len() {
            let p = &self.crowd.people[i];
            let past_fleet = p.car_index.is_some_and(|ci| ci >= cars);
            if p.state == PState::Riding && p.shaft_id == Some(id) && past_fleet {
                motion::finish(&mut self.crowd, i, &mut self.tower);
            }
        }
    }

    #[doc(hidden)]
    /// `tower.resizeTransport(id, bottom, top)` with its `capacity_changed`,
    /// when the span actually moved.
    pub fn resize_transport(&mut self, id: i64, bottom: i64, top: i64) -> ResizeResult {
        let span = |sim: &Simulation| sim.tower.get_transport(id).map(|t| (t.bottom, t.top));
        let before = span(self);
        let r = self.tower.resize_transport(id, bottom, top);
        if r.ok && span(self) != before {
            self.note_capacity(id);
        }
        r
    }

    fn note_capacity(&mut self, id: i64) {
        if let Some(kind) = self.tower.get_transport(id).map(|t| t.kind) {
            self.gameplay.push(GameplayEvent::CapacityChanged { kind });
        }
    }
}
