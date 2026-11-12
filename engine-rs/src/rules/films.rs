//! The theater rule Modern adds for screens (#1950), kept beside the other
//! mode rules on [`GameMode`].
use crate::clock::GameMode;

impl GameMode {
    /// How many screens a movie theater runs, each with its own film
    /// (#1950). SimTower's theater shows one film; a Modern theater's two
    /// floors are two screens with half the seats each.
    pub fn cinema_screens(self) -> usize {
        match self {
            GameMode::Classic => 1,
            GameMode::Modern => 2,
        }
    }
}
