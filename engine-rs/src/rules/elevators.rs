//! Mode rules for elevator dispatch: how the two per-shaft settings of the
//! 1994 Elevator window, Waiting Car Response and Standard Floor Departure,
//! act on the cars.

use crate::clock::GameMode;

#[doc(hidden)]
impl GameMode {
    /// Whether Waiting Car Response watches the moving cars, as in the 1994
    /// game: a waiting car stays parked while a car of its shaft, already
    /// heading toward the call, is within that many floors of it. Modern
    /// keeps its own reading, a parked car that answers only calls within
    /// the span less that many floors.
    pub fn waiting_car_response_watches_moving_cars(self) -> bool {
        self == GameMode::Classic
    }

    /// Whether Standard Floor Departure restarts when another rider arrives,
    /// as in the 1994 game: a car loading at a floor boards whoever arrives
    /// while it waits, and leaves only once a whole wait passes with nobody
    /// new (or it is full). Modern cars wait one fixed dwell.
    pub fn departure_wait_restarts_on_arrival(self) -> bool {
        self == GameMode::Classic
    }
}
