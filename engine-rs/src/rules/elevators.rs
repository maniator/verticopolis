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

/// How many times faster than a Classic car a Modern standard or service car
/// moves. The owner picked it on 2026-11-14 so office workers who ride in for
/// real reach their desks: with it and the line-counting router, the owner's
/// own tower of about 4,950 office workers keeps all its tenants.
const MODERN_CAR_SPEED: f64 = 2.0;

/// How many times faster than a Classic car a Modern express car moves:
/// twice a Modern standard car, so a 75-floor trip takes about 23 game
/// minutes (owner, 2026-11-14).
const MODERN_EXPRESS_SPEED: f64 = 4.0;

#[doc(hidden)]
impl GameMode {
    /// Whether an express elevator keeps the 1994 game's stops (Classic,
    /// #1527): the ground floor, every 15th floor whether or not a lobby is
    /// built there, and every basement, each of which can be turned off and
    /// no other floor turned on; an end off those floors is passed, and the
    /// shaft has to reach the ground floor or a 15th floor. Modern stops at
    /// its lobbies, every basement and both ends, and places anywhere.
    pub fn express_stops_on_15th_floors(self) -> bool {
        self == GameMode::Classic
    }

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

    /// Whether a car its riders fill passes the hall calls on its way and
    /// stops only where someone aboard gets off (Modern), so another car
    /// takes those calls. A Classic car stops for every call it answers,
    /// full or not, as it always has here: no source we have says what the
    /// 1994 game's full cars did, and a Classic crowd is too small to fill
    /// a car today.
    pub fn full_cars_pass_hall_calls(self) -> bool {
        self == GameMode::Modern
    }

    /// How many times faster than the base speed a standard or service car
    /// moves. Classic cars move at the base speed. Modern cars move twice as
    /// fast while real office commutes are on (`REAL_OFFICE_COMMUTES_ON`):
    /// the speed came with them and goes with them.
    pub fn car_speed_factor(self) -> f64 {
        match self {
            GameMode::Modern if super::commute::real_office_commutes_on() => MODERN_CAR_SPEED,
            _ => 1.0,
        }
    }

    /// How many times faster than the base speed an express car moves.
    /// Classic express cars move at the standard speed, as no measured
    /// figure for the original says otherwise. Modern express cars move four
    /// times as fast (twice a Modern standard car) while real office
    /// commutes are on.
    pub fn express_speed_factor(self) -> f64 {
        match self {
            GameMode::Modern if super::commute::real_office_commutes_on() => MODERN_EXPRESS_SPEED,
            _ => 1.0,
        }
    }

    /// How many times faster than the base speed a car of `kind` moves: the
    /// express factor for an express, the standard one for any other car.
    pub fn speed_of(self, kind: crate::facilities::Kind) -> f64 {
        match kind {
            crate::facilities::Kind::ElevatorExpress => self.express_speed_factor(),
            _ => self.car_speed_factor(),
        }
    }
}
