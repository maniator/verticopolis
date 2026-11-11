// The raw shaft edits with their `capacity_changed` event. The charged
// commands in `charges.rs`, the binding and the TDT referee call them; the
// tower's own setters stay silent.

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
        let ok = self.tower.set_cars(id, cars);
        if ok {
            self.note_capacity(id);
        }
        ok
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
