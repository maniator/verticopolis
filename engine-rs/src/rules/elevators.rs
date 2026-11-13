//! Mode rules for elevator dispatch: how the two per-shaft settings of the
//! 1994 Elevator window, Waiting Car Response and Standard Floor Departure,
//! act on the cars, and where a car with no home idles.
//!
//! Classic follows the 1994 game as the SimTower wiki describes it. Modern
//! is the smart-dispatch package the owner picked after the 2026-11-12 party
//! round (`dispatch_modern.rs`).

use crate::clock::GameMode;

/// How many times Standard Floor Departure a Modern car may wait at one stop
/// while riders keep arriving.
const MODERN_DEPARTURE_WAIT_LIMIT: f64 = 2.0;

#[doc(hidden)]
impl GameMode {
    /// Whether Waiting Car Response watches the moving cars, as in the 1994
    /// game: a waiting car stays parked while a car of its shaft, already
    /// heading toward the call, is within that many floors of it. Modern
    /// folds the same rule into its best-car choice instead.
    pub fn waiting_car_response_watches_moving_cars(self) -> bool {
        self == GameMode::Classic
    }

    /// Whether each hall call goes to the one car best placed to answer it
    /// (Modern): the nearest by travel, counting the stops it already owes
    /// and a car moving the wrong way, with a car already heading there
    /// within Waiting Car Response winning outright. Classic cars each run
    /// their own sweep.
    pub fn elevators_send_the_best_car(self) -> bool {
        self == GameMode::Modern
    }

    /// How long a car may wait at one stop while riders keep arriving, as a
    /// multiple of Standard Floor Departure. Both modes start the wait over
    /// when a rider arrives. Classic has no limit: the car waits as long as
    /// riders keep coming, and a full car leaves. Modern stops at twice the
    /// setting.
    pub fn departure_wait_limit(self) -> Option<f64> {
        match self {
            GameMode::Classic => None,
            GameMode::Modern => Some(MODERN_DEPARTURE_WAIT_LIMIT),
        }
    }

    /// Whether a car with no home of its own idles at an evenly spread stop
    /// (Modern: the first car at the lobby, the rest up the shaft) instead of
    /// the lobby (Classic). The spread is where the car waits, never a home
    /// written to the schedule or a save. A save keeps where the car stands,
    /// though, and a .TDT export takes an unhomed car's home from there, so
    /// a save exported with the car parked at its spread stop (as Classic:
    /// a Modern tower is refused) records that stop as its home.
    pub fn spreads_unset_car_homes(self) -> bool {
        self == GameMode::Modern
    }

    /// Whether a car parked on a stop whose call it owns boards the riders
    /// the statistical estimate puts there, opening and dwelling as a car
    /// that arrives does (Modern: the best-car choice gives a parked car the
    /// call on its own floor, so no other car comes for it). A Classic car's
    /// sweep looks only ahead, so it leaves that call to another car of its
    /// shaft, and a lone Classic car leaves it unanswered, as it always has.
    pub fn parked_owner_boards_its_floor(self) -> bool {
        self == GameMode::Modern
    }
}
