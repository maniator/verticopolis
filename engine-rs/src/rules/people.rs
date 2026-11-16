//! How people move through the tower and when they come and go.

use crate::clock::GameMode;
use crate::facilities::Kind;

pub const HOTEL_DAYTIME_PRESENCE: f64 = 0.2;

/// How fast a Modern escalator carries a rider, in floors per crowd second:
/// half a Modern standard car, so an escalator is slower than any car but
/// has no wait (owner, 2026-11-16).
const MODERN_ESCALATOR_SPEED: f64 = 0.4;
/// How fast a Modern rider climbs or walks down stairs, in floors per crowd
/// second: slower than an escalator.
const MODERN_STAIRS_SPEED: f64 = 0.25;
/// Game ticks one flight takes in SimTower v1.0, stairs and escalators
/// alike, up or down, however many people are on it (measured in the 1994
/// game, 2026-11-16).
const CLASSIC_FLIGHT_TICKS: f64 = 16.0;
/// In the same game a standard car runs from floor 1 to 10 and stops in
/// 15 ticks. A Classic car's speed matches that run, so a flight keeps the
/// same ratio to it.
const CLASSIC_CAR_RUN_FLOORS: f64 = 9.0;
const CLASSIC_CAR_RUN_TICKS: f64 = 15.0;
/// How fast a Classic rider climbs a flight, in floors per crowd second:
/// a Classic car's speed scaled by the 1994 game's flight against its car,
/// so a flight takes 24 crowd seconds (12 game minutes) where a car covers
/// about 10 floors.
const CLASSIC_CLIMB_SPEED: f64 = (1.0 / crate::crowd::RIDE_SECONDS_PER_FLOOR)
    * (1.0 / CLASSIC_FLIGHT_TICKS)
    / (CLASSIC_CAR_RUN_FLOORS / CLASSIC_CAR_RUN_TICKS);

#[doc(hidden)]
impl GameMode {
    pub fn walkway_willingness_applies(self) -> bool {
        self == GameMode::Classic
    }

    /// Whether a rider takes the route with the shortest expected trip, lines
    /// included (`crowd::expected_time`), rather than the fewest rides.
    pub fn routes_by_expected_time(self) -> bool {
        self == GameMode::Modern
    }

    /// Whether people walk the street between two ground lobbies that do not
    /// touch, out of one and along the sidewalk into the other, as part of a
    /// trip (`crowd::street`). Classic keeps to the 1994 game, where a trip
    /// goes only through the tower.
    pub fn walks_the_street(self) -> bool {
        self == GameMode::Modern
    }

    pub fn rain_crowd_factor(self) -> f64 {
        match self {
            GameMode::Classic => 0.5,
            GameMode::Modern => 0.7,
        }
    }

    /// `demographicRoutines()`: `(schoolRun, salesCall)`.
    pub fn demographic_routines(self) -> (f64, f64) {
        match self {
            GameMode::Classic => (0.0, 0.0),
            GameMode::Modern => (1.0, 0.35),
        }
    }

    /// How fast a rider on an escalator, or on stairs (any other walkway),
    /// moves, in floors per crowd second. Classic stairs and escalators move
    /// at one speed, as in the 1994 game.
    pub fn climb_speed(self, kind: Kind) -> f64 {
        let escalator = kind == Kind::Escalator;
        match (self, escalator) {
            (GameMode::Classic, _) => CLASSIC_CLIMB_SPEED,
            (GameMode::Modern, true) => MODERN_ESCALATOR_SPEED,
            (GameMode::Modern, false) => MODERN_STAIRS_SPEED,
        }
    }

    pub fn hotel_daytime_presence(self) -> f64 {
        match self {
            GameMode::Classic => 0.0,
            GameMode::Modern => HOTEL_DAYTIME_PRESENCE,
        }
    }
}

#[cfg(test)]
#[path = "people_climb_tests.rs"]
mod climb_tests;
