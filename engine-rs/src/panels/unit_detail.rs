//! What the unit inspector and editor cards read beyond the frame's fields:
//! the lifecycle and tenant fields, the price, and the derived flags
//! (`isFloorServed`, `floorReachable`, `isShowingBlockbuster`,
//! `floorHasLobby`). The card's wording and its static rules (`isOpenAt`,
//! `hasAccessDiagnostic`, `householdPrice`) stay in TypeScript.

use serde_json::{json, Value};

use crate::clock::GameMode;
use crate::econ::{classic_ladder, rent_config};
use crate::facilities::Kind;
use crate::rent::AVERAGE_RUNG;
use crate::sim::Simulation;
use crate::tower::Unit;

/// The default price in the tower's catalog (`catalogFacility(catalog, kind)
/// .rent.default`): the Average rung in Classic, the band's default in Modern.
/// Not the same number as `rent_of` for a Classic condo or hotel (the Average
/// rung differs from `ECON.rent`'s default), which is why the card reads the
/// catalog's.
pub(crate) fn catalog_rent_default(mode: GameMode, kind: Kind) -> Option<f64> {
    match mode {
        GameMode::Classic => classic_ladder(kind).map(|rungs| rungs[AVERAGE_RUNG]),
        GameMode::Modern => rent_config(kind).map(|c| c.default),
    }
}

/// `unitPrice(catalog, u)`: nothing when off the market, the stored price
/// when the player set one, the catalog default otherwise.
pub(crate) fn unit_price(mode: GameMode, u: &Unit) -> f64 {
    if u.no_rate {
        return 0.0;
    }
    u.rent
        .or_else(|| catalog_rent_default(mode, u.kind))
        .unwrap_or(0.0)
}

/// The card's derived flags for one unit, which the JSON card and the port's
/// `unitCard` record both read.
pub(crate) struct CardFlags {
    pub served: bool,
    pub reachable: bool,
    pub has_lobby: bool,
    /// Only for a cinema.
    pub blockbuster: Option<bool>,
}

#[doc(hidden)]
impl Simulation {
    /// The derived flags of unit `id`'s card, or `None` for an id that is not
    /// a unit. `served` is the tower's lobby connection for the floor,
    /// `reachable` whether the walk to it is within what anyone will make
    /// (`floorReachable`), and `blockbuster` whether a cinema is booked for
    /// the blockbuster. Takes `&mut self` for the reachability memo, as
    /// `floor_reachable` does.
    pub(crate) fn card_flags(&mut self, id: i64) -> Option<CardFlags> {
        let u = self.tower.get_unit(id)?;
        let (floor, cinema) = (u.floor, u.kind == Kind::Cinema);
        // A metro station is anchored on its bottom row, the row SimTower saves
        // it on, but riders board on the platform floor one above it, so that
        // is the floor whose elevator access the card reports.
        let access_floor = if u.kind == Kind::Metro {
            floor + 1
        } else {
            floor
        };
        Some(CardFlags {
            served: self.tower.is_floor_served(access_floor),
            reachable: self.floor_reachable(access_floor),
            has_lobby: self.tower.floor_has_lobby(floor),
            blockbuster: cinema.then(|| self.blockbusters.contains(&(id as f64))),
        })
    }

    /// The detail card for unit `id`, or `None` for an id that is not a unit,
    /// with the flags `card_flags` derives.
    pub fn unit_detail(&mut self, id: i64) -> Option<Value> {
        let CardFlags {
            served,
            reachable,
            has_lobby,
            blockbuster,
        } = self.card_flags(id)?;
        let u = self.tower.get_unit(id)?;
        // A theatre's film: the mornings it has shown, and whether it is a
        // classic (#1932); null on any other kind.
        let film = (u.kind == Kind::Cinema).then(|| u.extras());
        Some(json!({
            "id": u.id,
            "kind": u.kind.as_str(),
            "floor": u.floor,
            "x": u.x,
            "width": u.width,
            "state": u.state.as_str(),
            "satisfaction": u.satisfaction,
            "occupants": u.occupants,
            "customersIn": u.customers_in,
            "residents": u.residents,
            "everOccupied": u.ever_occupied,
            "noRate": u.no_rate,
            "rent": u.rent,
            "price": unit_price(self.mode, u),
            "label": u.label,
            "subtype": u.subtype,
            "vacateReason": u.extras().vacate_reason,
            "filmPolicy": u.extras().film_policy,
            "served": served,
            "reachable": reachable,
            "floorHasLobby": has_lobby,
            "blockbuster": blockbuster,
            "filmDays": film.as_ref().map(|e| e.film_days.unwrap_or(0)),
            "filmClassic": film.as_ref().map(|e| e.film_classic),
        }))
    }
}
