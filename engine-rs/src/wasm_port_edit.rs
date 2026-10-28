//! The port's editing commands (facade slice 7, the contract is
//! `architecture-rust-facade-2026-10-20/engine-port-contract.md`): stops,
//! rent, labels, the pending choice, auto-bridge and the extend gesture.
//! They follow `wasm_port.rs`: numbers in, a result record out, a refusal's
//! text in `lastReason()`. Their port names differ from the legacy exports
//! the conformance suites still call (`setStop`, `adjustRent` and the rest),
//! which keep their old answers until the callers move (contract PR 4).
use crate::charges::{whole, INVALID_REQUEST};
use crate::rent::{BatchRentResult, BatchTarget};

use super::facade_commands::UNKNOWN_FACILITY;
use super::port::{kind_of, record};
use super::Engine;

/// `rentBatch`'s own slots, in `BatchRentResult` order.
pub(crate) const BATCH_SLOTS: [&str; 8] = [
    "matched",
    "eligible",
    "changed",
    "skippedSold",
    "skippedCustom",
    "customOverwritten",
    "clampedLow",
    "clampedHigh",
];

fn batch_slots(r: &BatchRentResult) -> [f64; 8] {
    [
        r.matched,
        r.eligible,
        r.changed,
        r.skipped_sold,
        r.skipped_custom,
        r.custom_overwritten,
        r.clamped_low,
        r.clamped_high,
    ]
    .map(|n| n as f64)
}

/// A price target: a finite number of 0 or more. NaN means "default" and -1
/// "No Rate" only where `sentinels` allows them (`rentBatch`).
fn price_target(target: f64, sentinels: bool) -> Option<BatchTarget> {
    if sentinels && target.is_nan() {
        return Some(BatchTarget::Default);
    }
    if sentinels && target == -1.0 {
        return Some(BatchTarget::NoRate);
    }
    (target.is_finite() && target >= 0.0).then_some(BatchTarget::Price(target))
}

impl Engine {
    /// A done-or-refused command with no own slots and no money moved
    /// outside the engine's own measure.
    fn plain(&mut self, before: f64, done: bool) -> Vec<f64> {
        self.finish(before, done, None, &[])
    }

    /// Stop an elevator at `floor` or not.
    pub(crate) fn port_mark_stop(&mut self, id: f64, floor: f64, stop: bool) -> Vec<f64> {
        self.reason = None;
        let before = self.sim.money;
        let done = match (whole(id), whole(floor)) {
            (Some(id), Some(floor)) => self.sim.tower.set_stop(id, floor, stop),
            _ => false,
        };
        self.plain(before, done)
    }

    /// An express elevator's canonical stops.
    pub(crate) fn port_express_stops(&mut self, id: f64) -> Vec<f64> {
        self.reason = None;
        let before = self.sim.money;
        let id = whole(id).filter(|&id| self.sim.tower.get_transport(id).is_some());
        if let Some(id) = id {
            self.sim.tower.set_express_stops(id);
        }
        self.plain(before, id.is_some())
    }

    pub(crate) fn port_drop_stops(&mut self, id: f64) -> Vec<f64> {
        self.reason = None;
        let before = self.sim.money;
        let done = whole(id).is_some_and(|id| self.sim.tower.clear_stops(id));
        self.plain(before, done)
    }

    /// One rung up (`dir` 1) or down (-1), with the rent after.
    pub(crate) fn port_step_rent(&mut self, id: f64, dir: f64) -> Vec<f64> {
        self.reason = None;
        let dir = Some(dir).filter(|d| *d == 1.0 || *d == -1.0);
        let (Some(id), Some(dir)) = (whole(id), dir) else {
            return self.refuse(INVALID_REQUEST, &[f64::NAN]);
        };
        let before = self.sim.money;
        match self.sim.adjust_rent(id, dir as i64) {
            Some(rent) => self.finish(before, true, None, &[rent]),
            None => self.finish(before, false, None, &[f64::NAN]),
        }
    }

    pub(crate) fn port_no_rate(&mut self, id: f64) -> Vec<f64> {
        self.reason = None;
        let before = self.sim.money;
        let done = whole(id).is_some_and(|id| self.sim.set_no_rate(id));
        self.plain(before, done)
    }

    /// Price a unit at `target` (snapped to its ladder or clamped), with the
    /// rent applied.
    pub(crate) fn port_set_rent(&mut self, id: f64, target: f64) -> Vec<f64> {
        self.reason = None;
        let (Some(id), Some(BatchTarget::Price(target))) = (whole(id), price_target(target, false))
        else {
            return self.refuse(INVALID_REQUEST, &[f64::NAN]);
        };
        let before = self.sim.money;
        match self.sim.price_unit(id, target) {
            Some(rent) => self.finish(before, true, None, &[rent]),
            None => self.finish(before, false, None, &[f64::NAN]),
        }
    }

    /// Reprice every unit of a kind, with the batch's counters ([`BATCH_SLOTS`]).
    pub(crate) fn port_rent_batch(
        &mut self,
        kind: f64,
        target: f64,
        only_default: bool,
    ) -> Vec<f64> {
        self.reason = None;
        let none = [0.0; 8];
        let Some(kind) = kind_of(kind) else {
            return self.refuse(UNKNOWN_FACILITY, &none);
        };
        let Some(target) = price_target(target, true) else {
            return self.refuse(INVALID_REQUEST, &none);
        };
        let before = self.sim.money;
        match self.sim.apply_rent_batch(kind, target, only_default) {
            Some(r) => self.finish(before, true, None, &batch_slots(&r)),
            None => self.finish(before, false, None, &none),
        }
    }

    /// A new subtype for a unit, with its index in the kind's subtype list
    /// (the text is the legacy `rerollSubtype` answer until `unitSubtype`
    /// lands, contract PR 1b).
    pub(crate) fn port_reroll_unit(&mut self, id: f64) -> Vec<f64> {
        self.reason = None;
        let Some(id) = whole(id) else {
            return self.refuse(INVALID_REQUEST, &[f64::NAN]);
        };
        let before = self.sim.money;
        let Some(subtype) = self.sim.reroll_subtype(id) else {
            return self.finish(before, false, None, &[f64::NAN]);
        };
        let code = self
            .sim
            .tower
            .get_unit(id)
            .and_then(|u| u.kind.subtype_list())
            .and_then(|list| list.iter().position(|&s| s == subtype))
            .map_or(f64::NAN, |i| i as f64);
        self.finish(before, true, None, &[code])
    }

    /// Answer the pending emergency: pay (`accept`) or take the default.
    pub(crate) fn port_answer_choice(&mut self, accept: bool) -> Vec<f64> {
        self.reason = None;
        let before = self.sim.money;
        let pending = self.sim.events.pending.is_some();
        if pending {
            self.sim.resolve_choice(accept);
        }
        self.plain(before, pending)
    }

    /// Set the auto-bridge preference, with the value after; refused when
    /// the mode does not let the player change it.
    pub(crate) fn port_choose_auto_bridge(&mut self, value: bool) -> Vec<f64> {
        self.reason = None;
        let done = value == self.sim.auto_bridge || self.sim.mode.bridging_toggleable();
        if done {
            self.sim.auto_bridge = value;
        }
        let after = f64::from(u8::from(self.sim.auto_bridge));
        self.finish(self.sim.money, done, None, &[after])
    }

    /// Flip the preference, with the value after; refused (nothing
    /// changed) where the mode fixes it, as `TsSim` answers `ok: false`.
    pub(crate) fn port_flip_auto_bridge(&mut self) -> Vec<f64> {
        self.reason = None;
        let before = self.sim.auto_bridge;
        let after = self.sim.toggle_auto_bridge();
        self.finish(
            self.sim.money,
            after != before,
            None,
            &[f64::from(u8::from(after))],
        )
    }

    /// Open an extend gesture on an elevator; a malformed id drops any open one.
    pub(crate) fn port_start_extend(&mut self, id: f64) -> Vec<f64> {
        self.reason = None;
        let before = self.sim.money;
        let done = self.begin_extend_checked(Some(id));
        self.plain(before, done)
    }

    pub(crate) fn port_stop_extend(&mut self) -> Vec<f64> {
        self.reason = None;
        self.sim.end_extend();
        record(true, 0.0, &[])
    }

    pub(crate) fn port_label_unit(&mut self, id: f64, text: &str) -> Vec<f64> {
        self.reason = None;
        let before = self.sim.money;
        let done = whole(id).is_some_and(|id| self.sim.tower.set_label(id, text));
        self.plain(before, done)
    }

    /// Name the tower; no text clears the name.
    pub(crate) fn port_name_tower(&mut self, text: Option<String>) -> Vec<f64> {
        self.reason = None;
        self.sim.tower.tower_name = text;
        record(true, 0.0, &[])
    }
}
