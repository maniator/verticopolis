//! How each mode prices a leasable room: the one rule the rent setters, the
//! catalog, the unit card, placement, move-out and the save loader share.

use crate::clock::GameMode;
use crate::econ::{classic_ladder, rent_config, RentConfig};
use crate::facilities::Kind;

/// The prices a mode offers for a room.
#[derive(Clone, Copy, Debug)]
pub enum RentModel {
    /// SimTower's four rungs (Very Low, Low, Average, High).
    Ladder([f64; 4]),
    /// A tuned band the player can set in steps.
    Band(RentConfig),
}

#[doc(hidden)]
impl GameMode {
    /// Whether the mode prices rooms on SimTower's rent ladder: Classic does,
    /// for the kinds the 1994 game priced; Modern prices on a band.
    pub fn prices_on_ladder(self) -> bool {
        self == GameMode::Classic
    }

    /// How the mode prices `kind`, or `None` where it does not price the kind
    /// (Classic has no ladder for Modern's priced amenities).
    pub fn rent_model(self, kind: Kind) -> Option<RentModel> {
        if self.prices_on_ladder() {
            classic_ladder(kind).map(RentModel::Ladder)
        } else {
            rent_config(kind).map(RentModel::Band)
        }
    }
}
