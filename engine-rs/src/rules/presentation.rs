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

    /// `showsPreviewReason`: Modern's build preview names the refusal before
    /// the click; Classic refuses on the click, the 1994 game's way. The
    /// engine refuses the same builds in both modes, so only the catalog
    /// states this one.
    pub fn preview_names_refusal(self) -> bool {
        self == GameMode::Modern
    }

    /// `elevatorScheduleUX().presets`: whether the elevator schedule's
    /// assisted tools answer, the intent presets, auto-tune and the staffing
    /// advice (Modern). Classic offers the manual grid only, and each assisted
    /// query answers that the mode has none.
    pub fn schedule_assist(self) -> bool {
        self == GameMode::Modern
    }

    /// Whether the shop inspector turns the local demand share into advice
    /// (under-served or over-built). Modern does; Classic shows the figures
    /// and leaves the reading to the player.
    pub fn advises_on_retail_demand(self) -> bool {
        self == GameMode::Modern
    }

    /// Whether a frontend shows how far a room's same-floor noise carries
    /// while it is placed (Modern). Classic keeps the 1994 game's silence
    /// about it, though the rule holds in both.
    pub fn shows_noise_reach(self) -> bool {
        self == GameMode::Modern
    }

    /// Whether a frontend may draw decorative passers-by: figures that pace
    /// the corridors for life but are not people the engine knows about
    /// (Modern, behind a player setting). SimTower had none, so Classic
    /// draws only the engine's own people (#2091).
    pub fn shows_passers_by(self) -> bool {
        self == GameMode::Modern
    }

    /// Whether a frontend draws the lit look: people lit from the upper
    /// left with a four-frame walk, and rooms shaded to match (Modern,
    /// #2097). Classic keeps SimTower's flat look.
    pub fn shaded_look(self) -> bool {
        self == GameMode::Modern
    }
}
