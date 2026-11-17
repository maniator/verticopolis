//! Fresh commute waits (#2021): a floor's average commute wait (#1971) is
//! the waits of the people who live or work there, so it goes when they do.

use crate::facilities::MIN_FLOOR;
use crate::sim::Simulation;
use crate::tower::{Unit, UnitState};

/// The floors where someone settled lives, works or stays, gathered by the
/// hourly satisfaction pass's own room loop so no second walk over the
/// rooms is needed. One flag per floor of the lot, from `MIN_FLOOR` up, so
/// noting a story is an array write. Gathers nothing while no floor has an
/// average to forget.
pub(super) struct SettledFloors(Option<Vec<bool>>);

/// The slot of `floor` in a `SettledFloors` list, or `None` below the lot.
fn slot(floor: i64) -> Option<usize> {
    usize::try_from(floor - MIN_FLOOR).ok()
}

impl SettledFloors {
    /// Whether someone settled lives, works or stays in this room: a tenant,
    /// a working business or a hotel guest, asleep or about to leave. A room
    /// a TDT import left moving in is not one: its newcomers should not
    /// inherit the waits of the people before them.
    fn holds_settled_occupant(u: &Unit) -> bool {
        matches!(
            u.state,
            UnitState::Occupied | UnitState::Asleep | UnitState::Vacating
        )
    }

    /// Notes every story of the room `i` as settled when its occupant is,
    /// read before the pass changes the room.
    pub(super) fn note(&mut self, sim: &Simulation, i: usize) {
        let Some(settled) = self.0.as_mut() else {
            return;
        };
        let u = &sim.tower.units[i];
        if !Self::holds_settled_occupant(u) {
            return;
        }
        let stories = sim.tower.lot().slab_stories(u.kind, u.floor);
        for floor in u.floor..u.floor + stories {
            if let Some(flag) = slot(floor).and_then(|k| settled.get_mut(k)) {
                *flag = true;
            }
        }
    }
}

impl Simulation {
    /// Starts gathering the settled floors for this hour's pass.
    pub(super) fn settled_floors(&self) -> SettledFloors {
        let floors = slot(self.tower.lot().top_floor()).map_or(0, |k| k + 1);
        SettledFloors((!self.crowd.commute_wait_by_floor.is_empty()).then(|| vec![false; floors]))
    }

    /// Forgets the average commute wait of every floor where nobody settled
    /// lived, worked or stayed when the hourly satisfaction pass began, so
    /// the next tenants there start from no wait (the neutral value a floor
    /// with no finished trip has) instead of their predecessors' jam. The
    /// pass runs it last: a floor with no settled occupant has no rated room
    /// reading its average this hour. It reads only the rooms and the
    /// averages, which a save carries, so a loaded tower forgets the same
    /// floors.
    pub(super) fn forget_waits_of_emptied_floors(&mut self, settled: SettledFloors) {
        let Some(settled) = settled.0 else {
            return;
        };
        let emptied: Vec<i64> = self
            .crowd
            .commute_wait_by_floor
            .sorted()
            .into_iter()
            .map(|(&floor, _)| floor)
            .filter(|&floor| slot(floor).and_then(|k| settled.get(k)) != Some(&true))
            .collect();
        if emptied.is_empty() {
            return;
        }
        for floor in &emptied {
            self.crowd.commute_wait_by_floor.remove(floor);
        }
        self.crowd.commute_revision = self.crowd.commute_revision.wrapping_add(1);
    }
}
