//! Mode rules about what the player is offered or told: the frontends read
//! them from the catalog's `rules` block, and the engine applies the ones it
//! enforces itself.

use crate::clock::GameMode;

#[doc(hidden)]
impl GameMode {
    /// Whether the tower can be exported for SimTower (1994) as a `.TDT`.
    /// Only a Classic tower can: the 1994 format has no place for Modern's
    /// mechanics, so `build_tdt` refuses a Modern save and a frontend
    /// disables the choice with the reason.
    pub fn exports_to_1994(self) -> bool {
        self == GameMode::Classic
    }

    /// Whether the lobby warning on a tenant card quotes how many floors the
    /// room is from the nearest lobby (Modern). Classic names the problem
    /// without the number, the way SimTower's own advice did.
    pub fn quotes_lobby_distance(self) -> bool {
        self == GameMode::Modern
    }
}
