//! The cars' in-flight timers in a save: how long each car has stood at its
//! stop with its doors open, the callers it has already seen there, and the
//! time it has waited, and its estimate seats (`dispatch_cars.rs`), plus the
//! statistical waiting estimate on each floor.
//! With them a reloaded tower's cars pick up mid-stop where they left off,
//! so the riders aboard and the people waiting at the doors carry on as they
//! would have (`crowd::save` carries the people).
//!
//! A save without the key (every save from before people were saved) loads
//! with every timer at zero, as all saves did. Entries that do not read, or
//! name a shaft the tower does not hold, are skipped; a car list whose length
//! is not the shaft's car count is reset by the next `move_cars`, as for a
//! shaft whose cars changed. The estimate seats are optional within an entry:
//! a save from before they were kept loads, and the next `move_cars` takes
//! them from the cars' load.

use serde_json::{json, Value};

use super::car_state::Cars;
use super::ElevatorDispatch;
use crate::charges::whole;
use crate::facilities::{MAX_FLOOR, MIN_FLOOR};
use crate::tower::Tower;

/// One car list as the save writes it.
fn car_list(v: Option<&Value>) -> Option<Vec<f64>> {
    v?.as_array()?
        .iter()
        .map(|n| n.as_f64().filter(|n| n.is_finite()))
        .collect()
}

impl ElevatorDispatch {
    /// The timers and the estimate as the save writes them, shafts and
    /// floors in ascending order.
    pub(crate) fn save_json(&self) -> Value {
        let cars: Vec<Value> = self
            .car_dwell
            .iter()
            .map(|(id, dwell)| {
                let none = Cars::default();
                let cars = self.cars.get(id).unwrap_or(&none);
                let mut car = json!({
                    "shaftId": id,
                    "dwell": dwell,
                    "seen": cars.seen,
                    "held": cars.held,
                });
                if let Some(seats) = &cars.seats {
                    car["estimateSeats"] = json!(seats);
                }
                car
            })
            .collect();
        let waiting: Vec<Value> = self
            .waiting
            .iter()
            .map(|(floor, estimate)| json!({ "floor": floor, "estimate": estimate }))
            .collect();
        json!({ "cars": cars, "waiting": waiting })
    }

    /// Takes the timers and the estimate a save's `dispatch` object carries,
    /// for the shafts `tower` holds.
    pub(crate) fn restore(&mut self, v: &Value, tower: &Tower) {
        if let Some(cars) = v.get("cars").and_then(Value::as_array) {
            for car in cars.iter().take(tower.transports.len()) {
                let Some(id) = car.get("shaftId").and_then(Value::as_f64).and_then(whole) else {
                    continue;
                };
                let lists = (
                    car_list(car.get("dwell")),
                    car_list(car.get("seen")),
                    car_list(car.get("held")),
                );
                let (Some(dwell), Some(seen), Some(held)) = lists else {
                    continue;
                };
                if tower.transport_index(id).is_none() || self.car_dwell.contains_key(&id) {
                    continue;
                }
                // A save from before the seats were kept has none: the next
                // `move_cars` takes them from the load (`Cars::seats`).
                let load = tower.get_transport(id).and_then(|t| t.car_load.as_deref());
                let seats = car_list(car.get("estimateSeats"))
                    .map(|seats| Cars::restored_seats(seats, load));
                self.car_dwell.insert(id, dwell);
                self.cars.insert(id, Cars { seen, held, seats });
            }
        }
        if let Some(rows) = v.get("waiting").and_then(Value::as_array) {
            for row in rows {
                let floor = row.get("floor").and_then(Value::as_f64).and_then(whole);
                let estimate = row
                    .get("estimate")
                    .and_then(Value::as_f64)
                    .filter(|n| n.is_finite() && *n >= 0.0);
                if let (Some(floor), Some(estimate)) = (floor, estimate) {
                    if (MIN_FLOOR..=MAX_FLOOR).contains(&floor) {
                        self.waiting.insert(floor, estimate);
                    }
                }
            }
        }
    }
}
