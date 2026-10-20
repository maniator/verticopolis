//! `housekeepingCoverage` (`src/engine/sim/services.ts`): what the housekeeping
//! crews can reach, for the stats screen and the exterminator modal (and the
//! housekeeping diagnostics, which read it from here).

use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

use crate::facilities::Kind;
use crate::housekeeping::HK_MAIDS_PER_UNIT;
use crate::sim::Simulation;
use crate::tower::UnitState;

/// `HK_NOMINAL_ROOMS_PER_MAID` (`src/engine/economy/housekeeping.ts`): the
/// rooms one maid cleans in a shift, nominally.
pub const HK_NOMINAL_ROOMS_PER_MAID: i64 = 19;

/// `HousekeepingCoverage`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HousekeepingCoverage {
    pub rooms: i64,
    pub crews: i64,
    pub maids: i64,
    pub daily_capacity: i64,
    pub out_of_reach: i64,
    pub dirty: i64,
    pub infested: i64,
}

impl HousekeepingCoverage {
    pub fn to_json(&self) -> Value {
        json!({
            "rooms": self.rooms,
            "crews": self.crews,
            "maids": self.maids,
            "dailyCapacity": self.daily_capacity,
            "outOfReach": self.out_of_reach,
            "dirty": self.dirty,
            "infested": self.infested,
        })
    }
}

/// Where the operational housekeeping crews can work: their own floors and
/// every floor in a staff component that holds a crew. Shared by the coverage
/// count and the cleanliness overlay so the two cannot drift apart.
pub(super) struct CrewReach {
    comps: HashMap<i64, i64>,
    floors: HashSet<i64>,
    crew_comps: HashSet<i64>,
    pub crews: i64,
}

impl CrewReach {
    /// A crew reaches a room on its own floor or in its staff component.
    pub fn reaches(&self, floor: i64) -> bool {
        self.floors.contains(&floor)
            || self
                .comps
                .get(&floor)
                .is_some_and(|c| self.crew_comps.contains(c))
    }
}

impl Simulation {
    /// The reach of the operational housekeeping crews.
    pub(super) fn crew_reach(&self) -> CrewReach {
        let comps = self.tower.staff_components();
        let mut floors: HashSet<i64> = HashSet::new();
        let mut crew_comps: HashSet<i64> = HashSet::new();
        let mut crews = 0;
        for u in self.tower.room_units() {
            if u.kind != Kind::Housekeeping || !u.is_operational() {
                continue;
            }
            crews += 1;
            floors.insert(u.floor);
            if let Some(c) = comps.get(&u.floor) {
                crew_comps.insert(*c);
            }
        }
        CrewReach {
            comps,
            floors,
            crew_comps,
            crews,
        }
    }

    /// `housekeepingCoverage`: operational crews, the operational hotel rooms,
    /// and how many of those no crew can reach over the staff network.
    pub fn housekeeping_coverage(&self) -> HousekeepingCoverage {
        let reach = self.crew_reach();
        let mut rooms = 0;
        let mut out_of_reach = 0;
        let mut dirty = 0;
        let mut infested = 0;
        for u in self.tower.room_units() {
            if !u.kind.is_hotel() || !u.is_operational() {
                continue;
            }
            rooms += 1;
            match u.state {
                UnitState::Dirty => dirty += 1,
                UnitState::Infested => infested += 1,
                _ => {}
            }
            if !reach.reaches(u.floor) {
                out_of_reach += 1;
            }
        }
        let maids = reach.crews * HK_MAIDS_PER_UNIT;
        HousekeepingCoverage {
            rooms,
            crews: reach.crews,
            maids,
            daily_capacity: maids * HK_NOMINAL_ROOMS_PER_MAID,
            out_of_reach,
            dirty,
            infested,
        }
    }

    /// `economy.housekeepingReport()`: yesterday's `{ cleaned, leftover }`, or
    /// `null` before the first morning checkout.
    pub fn housekeeping_report_json(&self) -> Value {
        match self.housekeeping.yesterday {
            Some((cleaned, leftover)) => json!({ "cleaned": cleaned, "leftover": leftover }),
            None => Value::Null,
        }
    }
}
