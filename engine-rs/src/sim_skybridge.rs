//! The bulldozer and a sky bridge (Modern, `tower/skybridge.rs`): it takes
//! the bridge whole, every tile from wing to wing (or to a half bridge's open
//! end), so a bridge is never cut in two, and only while nobody is crossing
//! it, so nobody is left over open air. Each tile pays back its sale price,
//! as selling it alone would.

use crate::charges::ChargeResult;
use crate::crowd::PState;
use crate::facilities::Kind;
use crate::gameplay::{GameplayEvent, RemovalMethod};
use crate::jsmath;
use crate::sim::Simulation;
use crate::tower::PEOPLE_CROSSING;
use std::ops::Range;

impl Simulation {
    /// Bulldoze or sell the bridge on `cols` of `floor` whole, paying back
    /// each tile's sale price, or refuse while anyone walks on it.
    pub(crate) fn remove_skybridge(
        &mut self,
        floor: i64,
        cols: Range<i64>,
        method: RemovalMethod,
    ) -> ChargeResult {
        if self.walkers_on(floor, cols.clone()) {
            return ChargeResult::refuse(PEOPLE_CROSSING);
        }
        let ids = self.tower.units_on(floor, cols);
        let refund: f64 = ids
            .iter()
            .filter_map(|&id| self.tower.get_unit(id))
            .map(|u| self.tower.sale_refund(u))
            .sum();
        // One batch removal reindexes the tower once for the whole bridge.
        for _ in self.tower.remove_units(&ids) {
            self.gameplay.push(GameplayEvent::FacilityRemoved {
                kind: Kind::Lobby,
                method,
            });
        }
        self.money += refund;
        self.note_edit_cash(refund);
        ChargeResult::paid(refund)
    }

    /// Whether anyone is walking on `cols` of `floor`: a person stands on
    /// the tile their x rounds to, as a walk reads it (`crowd::walk`).
    pub(crate) fn walkers_on(&self, floor: i64, cols: Range<i64>) -> bool {
        self.crowd.people.iter().any(|p| {
            p.floor == floor
                && matches!(p.state, PState::ToShaft | PState::ToDest)
                && cols.contains(&(jsmath::round(p.x) as i64))
        })
    }
}
