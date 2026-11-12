//! What the player may build, where, and what stays for good.

use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::lot::Lot;

#[doc(hidden)]
impl GameMode {
    /// `bridgingToggleable()`: Modern can switch automatic bridging off;
    /// Classic always bridges.
    pub fn bridging_toggleable(self) -> bool {
        self == GameMode::Modern
    }

    /// Whether the mode builds the kinds marked Modern-only (the Food Hall
    /// and the other `modern_only` facilities): Modern does; Classic offers
    /// the 1994 kinds alone. Read through `Facility::available_in`.
    pub fn builds_modern_only_kinds(self) -> bool {
        self == GameMode::Modern
    }

    /// Whether a frontend lets the player place new construction while the
    /// clock is stopped. Classic refuses it, the 1994 game's way, so the
    /// pressure of building against the clock stays; Modern allows it, a
    /// deliberate divergence. The engine has no paused state and applies a
    /// build between steps either way, so only the catalog states this one
    /// and the host, which owns pause, gates its build tools on it.
    pub fn builds_while_paused(self) -> bool {
        self == GameMode::Modern
    }

    /// Whether the top floor is kept for the wedding hall: in Classic only
    /// the wedding hall (the 1994 cathedral) may reach the top floor (floor
    /// 100 on the standard lot), so any other room that would touch it is
    /// refused. Modern builds there freely.
    pub fn reserves_top_floor_for_wedding_hall(self) -> bool {
        self == GameMode::Classic
    }

    /// Whether this mode refuses a `kind` unit on `floor` of `lot` because it
    /// would reach the top floor kept for the wedding hall
    /// ([`GameMode::reserves_top_floor_for_wedding_hall`]).
    pub(crate) fn refuses_room_on_reserved_top_floor(
        self,
        lot: Lot,
        kind: Kind,
        floor: i64,
    ) -> bool {
        self.reserves_top_floor_for_wedding_hall()
            && kind != Kind::WeddingHall
            && lot.touches_top_floor(kind, floor)
    }

    /// Whether an escalator may serve office floors. Modern allows it;
    /// Classic refuses an escalator that would reach an office floor.
    pub fn escalators_on_office_floors(self) -> bool {
        self == GameMode::Modern
    }

    /// Whether an express elevator keeps the below-lobby stops a loaded
    /// tower asked it to keep (`preserveBasementStops`, set by a PC TDT
    /// import). Classic honors it; Modern ignores the flag.
    pub fn keeps_preserved_basement_stops(self) -> bool {
        self == GameMode::Classic
    }

    /// Whether a placed room of `kind` stays for good: SimTower gives the
    /// player no way to delete housekeeping, security, recycling, the movie
    /// theater or the cathedral (our wedding hall). Modern lets them be sold
    /// like other rooms.
    pub fn room_is_permanent(self, kind: Kind) -> bool {
        self == GameMode::Classic
            && matches!(
                kind,
                Kind::Housekeeping
                    | Kind::Security
                    | Kind::Recycling
                    | Kind::Cinema
                    | Kind::WeddingHall
            )
    }
}
