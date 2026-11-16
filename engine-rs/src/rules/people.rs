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
/// Classic's climbing speeds, carried over from the TypeScript engine and
/// not yet checked against the 1994 game.
const CLASSIC_ESCALATOR_SPEED: f64 = 1.3;
const CLASSIC_STAIRS_SPEED: f64 = 0.85;

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
    /// moves, in floors per crowd second.
    pub fn climb_speed(self, kind: Kind) -> f64 {
        let escalator = kind == Kind::Escalator;
        match (self, escalator) {
            (GameMode::Classic, true) => CLASSIC_ESCALATOR_SPEED,
            (GameMode::Classic, false) => CLASSIC_STAIRS_SPEED,
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
