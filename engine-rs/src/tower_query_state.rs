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
    pub rooms: Option<(crate::tower_index::IndexKey, std::sync::Arc<[usize]>)>,
    pub census: Option<(
        crate::tower_index::IndexKey,
        std::sync::Arc<crate::tower_index::Census>,
    )>,
    pub floors: crate::tower_index::FloorsMemo,
}

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

    /// `syncAttendanceOccupants`.
    pub fn sync_attendance_occupants(&mut self) {
        if self.kind.attendance_cap().is_none() {
            return;
        }
        self.occupants = if self.is_operational() {
            self.customers_in.unwrap_or(0)
        } else {
            0
        };
    }

    /// `visibleOccupants`.
    pub fn visible_occupants(&self) -> i64 {
        (self.occupants - self.out_for_meal.unwrap_or(0)).max(0)
    }
}
