//! What the player may build, where, and what stays for good.

use crate::clock::GameMode;
use crate::facilities::{is_sky_lobby_floor, Kind};
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

    /// Whether a tower may hold more than one metro station
    /// (`facilities::MODERN_METRO_STATION_CAP`): Modern does, all on one
    /// line; Classic keeps SimTower's single station. Read through
    /// `facilities::build_cap_in`.
    pub fn builds_several_metro_stations(self) -> bool {
        self == GameMode::Modern
    }

    /// Whether party halls and theaters share one cap of 16
    /// (`facilities::CLASSIC_VENUE_POOL`, #1932): Classic does, as the 1994
    /// save keeps one table of 16 records for both; Modern caps each kind at
    /// 16 on its own. Read through `facilities::pools_for`.
    pub fn shares_venue_cap(self) -> bool {
        self == GameMode::Classic
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

    /// Whether a lobby on `floor` may rise more than one story (#308). The
    /// PC original raises only the ground lobby, to two stories with Ctrl
    /// or three with Ctrl+Shift held at its first placement (the Read Me
    /// and the fan guides), and the `.TDT` header keeps one lobby height,
    /// the ground lobby's. Modern lets a sky lobby rise as well. Either way
    /// a floor's first lobby placement sets its height for good. Read
    /// through `Tower::placement_lobby_height`.
    pub fn raises_lobby_on(self, floor: i64) -> bool {
        floor == 1 || (self.raises_sky_lobbies() && is_sky_lobby_floor(floor))
    }

    /// Whether a sky lobby may rise more than one story as well as the
    /// ground lobby (#308): Modern only. See [`Self::raises_lobby_on`].
    pub fn raises_sky_lobbies(self) -> bool {
        self == GameMode::Modern
    }

    /// Whether each lobby hall on a floor keeps its own height (#2068). A
    /// hall is a row of lobby tiles of one height; a tall hall claims only
    /// the stories over its own tiles, and halls of different heights sit
    /// side by side with a wall and a revolving door between them. Modern
    /// does, since its towers can split. Classic keeps one height per floor,
    /// set by the floor's first lobby, which claims the stories it rises
    /// through across the whole lot, as the `.TDT` header's single ground
    /// lobby height describes.
    pub fn lobby_height_per_hall(self) -> bool {
        self == GameMode::Modern
    }

    /// Whether the bulldozer may take out a floor tile that has floor on
    /// both sides, opening a gap in the middle of a story. Classic refuses
    /// it (owner ruling, 2026-11-12): a story above a gap can't be built
    /// across it, so the tower above looks cut. Classic floors come out from
    /// either end inward. Modern allows the gap. Read through
    /// `Tower::removal_reason`.
    pub fn removes_mid_floor_tiles(self) -> bool {
        self == GameMode::Modern
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
