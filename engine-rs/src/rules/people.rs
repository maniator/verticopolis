//! How people move through the tower and when they come and go.

use crate::clock::GameMode;

pub const HOTEL_DAYTIME_PRESENCE: f64 = 0.2;

#[doc(hidden)]
impl GameMode {
    pub fn walkway_willingness_applies(self) -> bool {
        self == GameMode::Classic
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

    pub fn hotel_daytime_presence(self) -> f64 {
        match self {
            GameMode::Classic => 0.0,
            GameMode::Modern => HOTEL_DAYTIME_PRESENCE,
        }
    }
}
