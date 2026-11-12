//! The tower's memo slots and the unit state predicates (`types.ts`), moved
//! out of `tower_query.rs` to bring that file under the 500-line ceiling. The
//! queries that fill the slots live in `tower_query.rs` and `tower_index.rs`;
//! each slot is keyed on the revision (or the `IndexKey`) it was built at,
//! and `Tower::reindex` resets them all.

use std::collections::{HashMap, HashSet};

use crate::economy::visitors::census_follows_the_day;
use crate::tower::{Unit, UnitState};

#[derive(Default)]
pub struct Memo {
    pub served: Option<(i64, HashSet<i64>)>,
    pub stops: HashMap<i64, (i64, Vec<i64>)>,
    /// Each floor's runs, keyed like the tile index they are built from.
    pub segs: Option<(crate::tower_index::IndexKey, HashMap<i64, Vec<(i64, i64)>>)>,
    pub staff: Option<(i64, HashMap<i64, i64>)>,
    pub cols: Option<(i64, HashMap<i64, Vec<(i64, i64)>>)>,
    pub tiles: Option<(crate::tower_index::IndexKey, crate::tower_index::FloorTiles)>,
    pub bounds: Option<(crate::tower_index::IndexKey, (i64, i64))>,
    /// Each floor's built extent for the overlays, per revision (#1237).
    pub floor_extents: Option<(
        crate::tower_index::IndexKey,
        std::sync::Arc<[(i64, i64, i64)]>,
    )>,
    /// The metro station's floor, keyed on `metro_changes` when it was found.
    pub metro_floor: Option<(u64, Option<i64>)>,
    /// Raised each time a station registers or unregisters, so placing any
    /// other unit leaves `metro_floor` standing.
    pub metro_changes: u64,
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

#[doc(hidden)]
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

    /// `censusCount`: the head count the population shows. Shops, fast food
    /// and restaurants count yesterday's served visitors, and party halls and
    /// theatres their set audience (#1500); every other room counts its
    /// `live_load`.
    pub fn census_count(&self) -> i64 {
        if census_follows_the_day(self.kind) {
            return i64::from(self.visitors_yest.unwrap_or(0));
        }
        self.live_load()
    }

    /// `liveLoad`: the people a room puts on its floor right now, which floor
    /// congestion reads. A commercial venue counts its live customers, never
    /// yesterday's visitors or its catalog value.
    pub fn live_load(&self) -> i64 {
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

    /// One row per unit state and what each predicate says of it. The web keeps
    /// a copy of the rule (`src/shared/unitState.ts`) and holds it to the same
    /// table in `src/shared/unitState.test.ts`. Keep the two tables identical.
    struct StateRow {
        state: UnitState,
        operational: bool,
        present: bool,
        tenanted: bool,
        dormant: bool,
    }

    const fn row(
        state: UnitState,
        operational: bool,
        present: bool,
        tenanted: bool,
        dormant: bool,
    ) -> StateRow {
        StateRow {
            state,
            operational,
            present,
            tenanted,
            dormant,
        }
    }

    const UNIT_STATE_ROWS: [StateRow; 10] = [
        row(UnitState::Construction, false, false, false, true),
        row(UnitState::Empty, true, false, false, true),
        row(UnitState::Occupied, true, true, true, false),
        row(UnitState::MovingIn, true, true, false, false),
        row(UnitState::Vacating, true, true, true, false),
        row(UnitState::Asleep, true, true, false, false),
        row(UnitState::Dirty, true, false, false, false),
        row(UnitState::Infested, true, false, false, true),
        row(UnitState::Fire, false, false, false, true),
        row(UnitState::Gutted, false, false, false, true),
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
            visitors_yest: None,
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

    /// Position of each state in `UNIT_STATE_ROWS`. The match has no wildcard, so
    /// a new `UnitState` variant fails to compile here until it has a row.
    fn row_index(state: UnitState) -> usize {
        match state {
            UnitState::Construction => 0,
            UnitState::Empty => 1,
            UnitState::Occupied => 2,
            UnitState::MovingIn => 3,
            UnitState::Vacating => 4,
            UnitState::Asleep => 5,
            UnitState::Dirty => 6,
            UnitState::Infested => 7,
            UnitState::Fire => 8,
            UnitState::Gutted => 9,
        }
    }

    #[test]
    fn state_predicates_match_the_shared_table() {
        for (i, r) in UNIT_STATE_ROWS.iter().enumerate() {
            assert_eq!(row_index(r.state), i, "{} row position", r.state.as_str());
            let mut u = unit(0, None);
            u.state = r.state;
            let name = r.state.as_str();
            assert_eq!(u.is_operational(), r.operational, "{name} operational");
            assert_eq!(u.is_present(), r.present, "{name} present");
            assert_eq!(u.is_tenanted(), r.tenanted, "{name} tenanted");
            assert_eq!(u.is_dormant(), r.dormant, "{name} dormant");
        }
    }
}
