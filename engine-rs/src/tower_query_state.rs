//! The tower's memo slots and the unit state predicates (`types.ts`), moved
//! out of `tower_query.rs` to bring that file under the 500-line ceiling. The
//! queries that fill the slots live in `tower_query.rs` and `tower_index.rs`;
//! each slot is keyed on the revision (or the `IndexKey`) it was built at,
//! and `Tower::reindex` resets them all.

use std::collections::{HashMap, HashSet};

use crate::tower::{Unit, UnitState};

#[derive(Default)]
pub struct Memo {
    pub served: Option<(i64, HashSet<i64>)>,
    pub stops: HashMap<i64, (i64, Vec<i64>)>,
    pub segs: Option<(i64, HashMap<i64, Vec<(i64, i64)>>)>,
    pub staff: Option<(i64, HashMap<i64, i64>)>,
    pub cols: Option<(i64, HashMap<i64, Vec<(i64, i64)>>)>,
    pub tiles: Option<(crate::tower_index::IndexKey, crate::tower_index::FloorTiles)>,
    pub bounds: Option<(crate::tower_index::IndexKey, (i64, i64))>,
    /// Each floor's built extent for the overlays, per revision (#1237).
    pub floor_extents: Option<(
        crate::tower_index::IndexKey,
        std::sync::Arc<[(i64, i64, i64)]>,
    )>,
    pub metro_floor: Option<(crate::tower_index::IndexKey, Option<i64>)>,
    /// Whether a floor tile sits above the lobby, per revision (#1237).
    pub floor_above_lobby: Option<(crate::tower_index::IndexKey, bool)>,
    pub rooms: Option<(crate::tower_index::IndexKey, std::sync::Arc<[usize]>)>,
    pub census: Option<(
        crate::tower_index::IndexKey,
        std::sync::Arc<crate::tower_index::Census>,
    )>,
    pub floor_rooms: Option<(
        crate::tower_index::IndexKey,
        std::sync::Arc<crate::tower_index::FloorRooms>,
    )>,
    pub floors: crate::tower_index::FloorsMemo,
}

// ---- unit state predicates (types.ts) --------------------------------------

impl Unit {
    pub fn is_operational(&self) -> bool {
        !matches!(
            self.state,
            UnitState::Construction | UnitState::Fire | UnitState::Gutted
        )
    }

    pub fn is_present(&self) -> bool {
        matches!(
            self.state,
            UnitState::Occupied | UnitState::Asleep | UnitState::MovingIn | UnitState::Vacating
        )
    }

    pub fn is_tenanted(&self) -> bool {
        matches!(self.state, UnitState::Occupied | UnitState::Vacating)
    }

    pub fn is_dormant(&self) -> bool {
        matches!(
            self.state,
            UnitState::Empty
                | UnitState::Construction
                | UnitState::Fire
                | UnitState::Gutted
                | UnitState::Infested
        )
    }

    /// `residentCount`.
    pub fn resident_count(&self) -> i64 {
        if self.kind.has_household() {
            if let Some(r) = self.residents {
                return r;
            }
        }
        self.kind.facility().population
    }

    /// `censusCount`.
    pub fn census_count(&self) -> i64 {
        if self.kind.is_commercial() && self.kind.facility().population > 0 {
            return self.customers_in.unwrap_or(0);
        }
        self.resident_count()
    }

    /// `visibleOccupants`.
    pub fn visible_occupants(&self) -> i64 {
        (self.occupants - self.out_for_meal.unwrap_or(0)).max(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::facilities::Kind;

    /// Whole-number rows of the rule that `src/render/pixelSprites/roomOccupants.test.ts`
    /// holds the web's drawing copy to: (occupants, out for a meal, people shown).
    /// Keep the two tables identical.
    const VISIBLE_ROWS: [(i64, Option<i64>, i64); 8] = [
        (0, None, 0),
        (4, None, 4),
        (4, Some(0), 4),
        (4, Some(1), 3),
        (4, Some(4), 0),
        (4, Some(9), 0),
        (6, Some(2), 4),
        (1, Some(1), 0),
    ];

    fn unit(occupants: i64, out_for_meal: Option<i64>) -> Unit {
        Unit {
            id: 1,
            kind: Kind::Office,
            floor: 10,
            x: 0,
            width: 9,
            state: UnitState::Occupied,
            satisfaction: 1.0,
            occupants,
            customers_in: None,
            hotel_customers_in: None,
            out_for_meal,
            residents: None,
            ever_occupied: true,
            pending_income: 0.0,
            rent: None,
            no_rate: false,
            label: String::new(),
            subtype: None,
            extras: None,
        }
    }

    #[test]
    fn visible_occupants_is_occupants_minus_out_for_meal_floored_at_zero() {
        for (occupants, out, shown) in VISIBLE_ROWS {
            assert_eq!(
                unit(occupants, out).visible_occupants(),
                shown,
                "occupants {occupants}, out {out:?}"
            );
        }
    }
}
