//! The noise check shared by satisfaction's noise erosion and its cause
//! attribution (`noiseAfflicted` in `sim/satisfaction.ts`), with the
//! per-revision memo the TypeScript keeps in front of it (#1051).

use crate::facilities::Kind;
use crate::satisfaction::{HOTEL_NOISE_TILES, OFFICE_NOISE_TILES};
use crate::sim::Simulation;
use crate::tower::Unit;

impl Simulation {
    /// `nearestKindWithin`.
    fn nearest_kind_within(
        &self,
        u: &Unit,
        is_source: impl Fn(Kind) -> bool,
        max_tiles: i64,
    ) -> bool {
        for dir in [-1i64, 1] {
            let start = if dir < 0 { u.x - 1 } else { u.x + u.width };
            for d in 0..=max_tiles {
                let x = start + dir * d;
                if self.tower.structure_kind_at(u.floor, x) == Some(Kind::Lobby) {
                    break;
                }
                let room = self.tower.room_at(u.floor, x);
                if let Some(r) = room {
                    if is_source(r.kind) {
                        return true;
                    }
                } else if !self.tower.has_structure(u.floor, x) {
                    break;
                }
            }
        }
        false
    }

    /// `noiseAfflicted`: memoized per unit for one tower revision, as the
    /// TypeScript is. The scan reads only the layout, which no path changes
    /// without bumping the revision. Unit state is deliberately not an input
    /// (a gutted or empty room still radiates by kind): anyone adding a state
    /// gate to the scan must also drop this memo.
    pub fn noise_afflicted(&mut self, u: &Unit) -> bool {
        if self.noise_memo.0 != self.tower.revision {
            self.noise_memo.0 = self.tower.revision;
            self.noise_memo.1.clear();
        }
        if let Some(&hit) = self.noise_memo.1.get(&u.id) {
            return hit;
        }
        let fresh = self.noise_afflicted_fresh(u);
        self.noise_memo.1.insert(u.id, fresh);
        fresh
    }

    /// `noiseAfflictedFresh`: the scan behind the memo.
    pub(crate) fn noise_afflicted_fresh(&self, u: &Unit) -> bool {
        if u.kind == Kind::Office {
            return self.nearest_kind_within(u, |k| k.is_commercial(), OFFICE_NOISE_TILES);
        }
        if u.kind.is_hotel() || u.kind == Kind::Condo || u.kind.is_rental() {
            return self.nearest_kind_within(
                u,
                |k| k == Kind::Office || k.is_commercial(),
                HOTEL_NOISE_TILES,
            );
        }
        false
    }
}
