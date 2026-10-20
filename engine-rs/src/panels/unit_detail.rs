//! What the unit inspector and editor cards read beyond the frame's fields:
//! the lifecycle and tenant fields, the price, and the derived flags
//! (`isFloorServed`, `floorReachable`, `isShowingBlockbuster`,
//! `floorHasLobby`). The card's wording and its static rules (`isOpenAt`,
//! `hasAccessDiagnostic`, `householdPrice`) stay in TypeScript.

use serde_json::{json, Value};

use crate::clock::GameMode;
use crate::econ::{classic_ladder, rent_config};
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::Unit;

/// The Average rung of a Classic price ladder (the ladder has four rungs).
const AVERAGE_RUNG: usize = 2;

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

impl Simulation {
    /// The detail card for unit `id`, or `None` for an id that is not a unit.
    /// `served` is the tower's lobby connection for the floor, `reachable`
    /// whether the walk to it is within what anyone will make (`floorReachable`),
    /// and `blockbuster` whether a cinema is booked for the blockbuster.
    /// Takes `&mut self` for the reachability memo, as `floor_reachable` does.
    pub fn unit_detail(&mut self, id: i64) -> Option<Value> {
        let floor = self.tower.get_unit(id)?.floor;
        let served = self.tower.is_floor_served(floor);
        let reachable = self.floor_reachable(floor);
        let has_lobby = self.tower.floor_has_lobby(floor);
        let u = self.tower.get_unit(id)?;
        let blockbuster =
            (u.kind == Kind::Cinema).then(|| self.blockbusters.contains(&(id as f64)));
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
            "vacateReason": u.vacate_reason,
            "filmPolicy": u.film_policy,
            "served": served,
            "reachable": reachable,
            "floorHasLobby": has_lobby,
            "blockbuster": blockbuster,
        }))
    }
}
