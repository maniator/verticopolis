//! The inspector's demand and congestion map caches. The TypeScript inspector reads the
//! demand map through `demandMemo` (`sim/demand.ts`, keyed on the tower
//! revision and the game hour); this is its port, for the diagnostics reads
//! only. Nothing in the Rust simulation reads it. (The highest built floor,
//! which the TypeScript reads through `floorBounds`, comes from the tower's
//! own `floor_bounds` since #1237.)
//!
//! It lives on the `Simulation`, beside `reach_memo` and `noise_memo`, so a
//! load (which builds a fresh `Simulation`) starts it empty. Its key carries
//! the unit count as well as the TypeScript's inputs (the revision and the
//! game hour), as `tower_index.rs` does, so a list cut behind the revision
//! also rebuilds. No production path cuts the list that way, so the extra
//! input only ever adds a rebuild.
//!
//! The demand memo lags within its hour exactly as the TypeScript one does:
//! occupancy, residents and unit state (a build finishing, a fire) change
//! without a revision bump, and the map is rebuilt at the next hour or edit.
//! Unlike demand, the congestion attribution memo does not accept an in-hour
//! lag: the frame mark log catches nonstructural room state/census writes,
//! while the crowd step, exact clock minute, revision and unit count cover
//! movement, rush, transport and structural changes. Hovering a second room
//! can reuse the same map at the same simulation state. Only the inspector
//! uses this memo; it never changes gameplay.
//!
//! Only the inspector sees that lag, which `hot-path-review.md` (HP-10)
//! records as the accepted bound. For the lag to match, the memo fills at the
//! reads where the TypeScript inspector calls `sim.demandMap()`: the main
//! gripe reads it lazily (`tenant.rs`), and no simulation step in either
//! engine reads the demand memo.

use indexmap::IndexMap;

use crate::demand::{compute_demand_map, unmet_coverage, DemandMap};
use crate::presence::CongestionAttribution;
use crate::sim::Simulation;
use crate::tower::Unit;

/// `(revision, unit count, game hour)`.
type DemandKey = (i64, usize, i64);

/// Exact inputs for the UI-only congestion attribution memo. These follow the
/// frame's congestion memo, minus generation (a load creates a new Simulation).
/// The frame mark-log position covers nonstructural room/census changes.
type CongestionKey = (i64, usize, u64, i64, (u64, u64));

#[derive(Default)]
pub struct DiagMemo {
    demand: Option<(DemandKey, DemandMap)>,
    congestion: Option<(
        CongestionKey,
        IndexMap<i64, f64>,
        IndexMap<i64, CongestionAttribution>,
    )>,
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

    fn inspector_congestion_key(&self) -> CongestionKey {
        (
            self.tower.revision,
            self.tower.units.len(),
            self.clock.minutes.to_bits(),
            self.crowd.step,
            self.tower.view.marks.position(),
        )
    }

    /// Return one floor's congestion and binding attribution from one
    /// engine-owned map. Hovering several unhappy rooms in the same state
    /// must not reconstruct the entire tower's congestion map for each room.
    /// No simulation step reads this memo; a load starts with it empty.
    pub(crate) fn inspector_congestion_at(
        &mut self,
        floor: i64,
    ) -> (f64, Option<CongestionAttribution>) {
        let key = self.inspector_congestion_key();
        if !matches!(&self.diag_memo.congestion, Some((k, _, _)) if *k == key) {
            let (ratios, attribution) = self.spatial_congestion_with_attribution();
            self.diag_memo.congestion = Some((key, ratios, attribution));
        }
        let (_, ratios, attribution) = self.diag_memo.congestion.as_ref().expect("filled above");
        (
            ratios.get(&floor).copied().unwrap_or(0.0),
            attribution.get(&floor).copied(),
        )
    }

    #[cfg(test)]
    pub(crate) fn inspector_congestion_memo_is_fresh(&self) -> bool {
        matches!(&self.diag_memo.congestion, Some((k, _, _)) if *k == self.inspector_congestion_key())
    }

    /// Whether the demand memo holds a map for the current key, for tests.
    #[cfg(test)]
    pub(crate) fn demand_memo_is_fresh(&self) -> bool {
        matches!(&self.diag_memo.demand, Some((k, _)) if *k == self.demand_key())
    }

    /// Whether the demand memo holds any map at all, for tests.
    #[cfg(test)]
    pub(crate) fn demand_memo_is_filled(&self) -> bool {
        self.diag_memo.demand.is_some()
    }
}
