//! The inspector's caches. The TypeScript inspector reads the demand map
//! through `demandMemo` (`sim/demand.ts`, keyed on the tower revision and
//! the game hour) and the highest built floor through `floorBounds`
//! (`Tower.ts`, keyed on the revision); these are their ports, for the
//! diagnostics reads only. Nothing in the simulation reads either.
//!
//! Both live on the `Simulation`, beside `reach_memo` and `noise_memo`, so a
//! load (which builds a fresh `Simulation`) starts them empty. Their keys
//! carry the unit count as well as the TypeScript's inputs (the revision,
//! and the game hour for the demand map), as `tower_index.rs` does, so a
//! list cut behind the revision rebuilds rather than serving stale; no
//! production path does that, so the extra input only ever adds a rebuild.
//!
//! The demand memo lags within its hour exactly as the TypeScript one does:
//! occupancy, residents and unit state (a build finishing, a fire) change
//! without a revision bump, and the map is rebuilt at the next hour or edit.
//! Only the inspector sees that lag, which `hot-path-review.md` (HP-10)
//! records as the accepted bound. For the lag to match, the memo fills at the
//! reads where the TypeScript inspector calls `sim.demandMap()`: the main
//! gripe reads it lazily (`tenant.rs`), and nothing in the simulation reads
//! either memo in either engine.

use crate::demand::{compute_demand_map, unmet_coverage, DemandMap};
use crate::sim::Simulation;
use crate::tower::Unit;

/// `(revision, unit count, game hour)`.
type DemandKey = (i64, usize, i64);
/// `(revision, unit count)`.
type BoundsKey = (i64, usize);

#[derive(Default)]
pub struct DiagMemo {
    demand: Option<(DemandKey, DemandMap)>,
    highest: Option<(BoundsKey, i64)>,
}

impl Simulation {
    fn demand_key(&self) -> DemandKey {
        (
            self.tower.revision,
            self.tower.units.len(),
            (self.clock.minutes / 60.0).floor() as i64,
        )
    }

    /// `unmetCoverage(sim.demandMap(), u)`: the coverage the inspector reads,
    /// from the hour's memoized map.
    pub(crate) fn inspector_coverage(&mut self, u: &Unit) -> Option<f64> {
        let key = self.demand_key();
        if !matches!(&self.diag_memo.demand, Some((k, _)) if *k == key) {
            let map = compute_demand_map(self);
            self.diag_memo.demand = Some((key, map));
        }
        let (_, map) = self.diag_memo.demand.as_ref().expect("filled above");
        unmet_coverage(map, u)
    }

    /// `tower.highestFloor`: the top of the built floor bounds, which start
    /// at the ground floor, memoized on the revision and the unit count (the
    /// TypeScript keeps the bottom too; nothing here reads it).
    pub(crate) fn built_highest_floor(&mut self) -> i64 {
        let key = (self.tower.revision, self.tower.units.len());
        if let Some((k, max)) = self.diag_memo.highest {
            if k == key {
                return max;
            }
        }
        let max = self.tower.units.iter().fold(1, |m, u| m.max(u.floor));
        self.diag_memo.highest = Some((key, max));
        max
    }

    /// Whether the demand memo holds a map for the current key, for tests.
    #[cfg(test)]
    pub(crate) fn demand_memo_is_fresh(&self) -> bool {
        matches!(&self.diag_memo.demand, Some((k, _)) if *k == self.demand_key())
    }

    /// Whether the highest floor memo holds a value for the current key, for
    /// tests.
    #[cfg(test)]
    pub(crate) fn highest_memo_is_fresh(&self) -> bool {
        let key = (self.tower.revision, self.tower.units.len());
        matches!(self.diag_memo.highest, Some((k, _)) if k == key)
    }
}
