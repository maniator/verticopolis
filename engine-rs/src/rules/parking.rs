//! The parking rules Modern adds for homes and the Metro (#1973), kept beside
//! the other mode rules on [`GameMode`].
use crate::clock::GameMode;

impl GameMode {
    /// Whether homes (condos and rentals) need parking for a share of their
    /// households (#1973): Modern only, since Classic condos never asked for
    /// a space in the original game.
    pub fn homes_need_parking(self) -> bool {
        match self {
            GameMode::Classic => false,
            GameMode::Modern => true,
        }
    }

    /// Whether a working Metro station halves what offices and homes need in
    /// parking (#1973): Modern only. Hotel suites still need a space each.
    pub fn metro_eases_parking(self) -> bool {
        match self {
            GameMode::Classic => false,
            GameMode::Modern => true,
        }
    }
}
