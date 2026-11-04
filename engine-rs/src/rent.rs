//! Port of `sim/rent.ts` and the ladder helpers of `pricing.ts`.

use crate::clock::GameMode;
use crate::econ::{classic_ladder, rent_config, rent_of};
use crate::facilities::Kind;
use crate::gameplay::GameplayEvent;
use crate::sim::Simulation;
use crate::tower::Unit;

/// The Average rung of a Classic price ladder (four rungs: Very Low, Low,
/// Average, High): the Classic catalog's default price (`catalog_rent_default`),
/// the mode's neutral price, and where the editor's picker puts a price that
/// is not a finite number.
pub(crate) const AVERAGE_RUNG: usize = 2;

/// `snapToLadder`: ties go to the later rung.
pub fn snap_to_ladder(rungs: &[f64; 4], value: f64) -> f64 {
    if !value.is_finite() {
        return rungs[AVERAGE_RUNG];
    }
    let mut best = rungs[0];
    let mut best_dist = f64::INFINITY;
    for &r in rungs {
        let d = (value - r).abs();
        if d <= best_dist {
            best_dist = d;
            best = r;
        }
    }
    best
}

/// `ladderRungFor(...).level`.
pub(crate) fn ladder_level(rungs: &[f64; 4], value: f64) -> usize {
    let snapped = snap_to_ladder(rungs, value);
    rungs
        .iter()
        .position(|&r| r == snapped)
        .unwrap_or(AVERAGE_RUNG)
}

/// `priceOptions(kind)`: `Some(Some(ladder))` in Classic for the canon kinds,
/// `Some(None)` for a Modern band, `None` for an unpriced kind.
pub(crate) fn price_options(mode: GameMode, kind: Kind) -> Option<Option<[f64; 4]>> {
    match mode {
        GameMode::Classic => classic_ladder(kind).map(Some),
        GameMode::Modern => rent_config(kind).map(|_| None),
    }
}

fn price_neutral(mode: GameMode, kind: Kind) -> Option<f64> {
    match price_options(mode, kind)? {
        Some(l) => Some(l[AVERAGE_RUNG]),
        None => Some(rent_config(kind)?.default),
    }
}

/// Whether an effective price is the neutral price: an exact match, the test
/// the batch reprice's "on the default" makes and the Map's Average band tier
/// shares. A price off the neutral price by any amount is not neutral.
pub(crate) fn is_neutral_price(price: f64, neutral: f64) -> bool {
    price == neutral
}

/// `BatchTarget`: a price, the mode's neutral anchor, or off the market.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum BatchTarget {
    Default,
    NoRate,
    Price(f64),
}

/// `BatchRentResult`, the counters a batch reprice reports.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BatchRentResult {
    pub matched: i64,
    pub eligible: i64,
    pub changed: i64,
    pub skipped_sold: i64,
    pub skipped_custom: i64,
    pub custom_overwritten: i64,
    pub clamped_low: i64,
    pub clamped_high: i64,
}

impl Simulation {
    /// `applyRentBatch(kind, target, { onlyDefaultPriced })`.
    pub fn apply_rent_batch(
        &mut self,
        kind: Kind,
        target: BatchTarget,
        only_default_priced: bool,
    ) -> Option<BatchRentResult> {
        let r = self.compute_batch(kind, target, only_default_priced, true);
        if r.as_ref().is_some_and(|r| r.changed > 0) {
            self.gameplay.push(GameplayEvent::PricingChanged { kind });
        }
        r
    }

    /// `computeBatch(kind, target, opts, mutate)`: `None` for an unpriced
    /// kind, a No Rate target off the ladder, or a non-finite price.
    pub fn compute_batch(
        &mut self,
        kind: Kind,
        target: BatchTarget,
        only_default_priced: bool,
        mutate: bool,
    ) -> Option<BatchRentResult> {
        let cfg = rent_config(kind)?;
        let ladder = price_options(self.mode, kind)?;
        if target == BatchTarget::NoRate && ladder.is_none() {
            return None;
        }
        if let BatchTarget::Price(p) = target {
            if !p.is_finite() {
                return None;
            }
        }
        let neutral = price_neutral(self.mode, kind)?;
        let mut r = BatchRentResult::default();
        // A priced kind is never structural, so the room list holds every
        // unit of it, in list order: R units visited, not all of them.
        let rooms = self.tower.room_index();
        for &i in rooms.iter() {
            let u = &mut self.tower.units[i];
            if u.kind != kind {
                continue;
            }
            r.matched += 1;
            if u.kind == Kind::Condo && u.ever_occupied {
                r.skipped_sold += 1;
                continue;
            }
            // On the default means the effective price is the neutral anchor,
            // read through the same fallback `rentOf` applies, and never off
            // the market.
            let neutral_priced =
                !u.no_rate && is_neutral_price(u.rent.unwrap_or(cfg.default), neutral);
            if only_default_priced && !neutral_priced {
                r.skipped_custom += 1;
                continue;
            }
            r.eligible += 1;
            if target == BatchTarget::NoRate {
                if !u.no_rate {
                    r.changed += 1;
                }
                if mutate {
                    if let Some(j) = self.tower.journal.as_mut() {
                        j.unit_edit(i, u);
                    }
                    u.no_rate = true;
                }
                continue;
            }
            if !neutral_priced && !u.no_rate {
                r.custom_overwritten += 1;
            }
            let before = rent_of(u.kind, u.rent, u.no_rate);
            let value = match (target, ladder) {
                (BatchTarget::Default, _) => neutral,
                (BatchTarget::Price(p), Some(l)) => snap_to_ladder(&l, p),
                (BatchTarget::Price(p), None) => {
                    if p < cfg.min {
                        r.clamped_low += 1;
                    } else if p > cfg.max {
                        r.clamped_high += 1;
                    }
                    p.min(cfg.max).max(cfg.min)
                }
                (BatchTarget::NoRate, _) => unreachable!("handled above"),
            };
            if before != value {
                r.changed += 1;
            }
            if mutate {
                if let Some(j) = self.tower.journal.as_mut() {
                    j.unit_edit(i, u);
                }
                // `storeRent`: the default is stored as no override; an
                // explicit reprice returns a No Rate unit to the market.
                u.rent = if value == cfg.default {
                    None
                } else {
                    Some(value)
                };
                u.no_rate = false;
            }
        }
        Some(r)
    }

    /// `demandFactor(u)`.
    pub fn demand_factor(&self, u: &Unit) -> f64 {
        let Some(neutral) = price_neutral(self.mode, u.kind) else {
            return 1.0;
        };
        if u.no_rate {
            return 0.0;
        }
        let ratio = rent_of(u.kind, u.rent, u.no_rate) / neutral;
        (2.0 - ratio).min(1.6).max(0.15)
    }

    /// `priceUnit(u, target)`: the new price, or `None` when not repriceable.
    pub fn price_unit(&mut self, id: i64, target: f64) -> Option<f64> {
        let mode = self.mode;
        let u = self.tower.get_unit_mut(id)?;
        let cfg = rent_config(u.kind)?;
        let opts = price_options(mode, u.kind)?;
        if !target.is_finite() {
            return None;
        }
        if u.kind == Kind::Condo && u.ever_occupied {
            return None;
        }
        let applied = match opts {
            Some(l) => snap_to_ladder(&l, target),
            None => target.min(cfg.max).max(cfg.min),
        };
        let before = (!u.no_rate).then(|| rent_of(u.kind, u.rent, u.no_rate));
        u.rent = if applied == cfg.default {
            None
        } else {
            Some(applied)
        };
        u.no_rate = false;
        // A write that leaves the price where it was is not a change.
        let changed = Some(rent_of(u.kind, u.rent, false)) != before;
        let kind = u.kind;
        if changed {
            self.gameplay.push(GameplayEvent::PricingChanged { kind });
        }
        Some(applied)
    }

    /// `setNoRate(id)`.
    pub fn set_no_rate(&mut self, id: i64) -> bool {
        let mode = self.mode;
        let Some(u) = self.tower.get_unit_mut(id) else {
            return false;
        };
        if !matches!(price_options(mode, u.kind), Some(Some(_))) {
            return false;
        }
        if u.kind == Kind::Condo && u.ever_occupied {
            return false;
        }
        let was_off = u.no_rate;
        u.no_rate = true;
        let kind = u.kind;
        if !was_off {
            self.gameplay.push(GameplayEvent::PricingChanged { kind });
        }
        true
    }

    /// `adjustRent(id, dir)`.
    pub fn adjust_rent(&mut self, id: i64, dir: i64) -> Option<f64> {
        let mode = self.mode;
        let (kind, rent, no_rate) = {
            let u = self.tower.get_unit(id)?;
            (u.kind, u.rent, u.no_rate)
        };
        let cfg = rent_config(kind)?;
        let opts = price_options(mode, kind)?;
        let current = rent_of(kind, rent, no_rate);
        match opts {
            Some(l) => {
                let idx = ladder_level(&l, current) as i64;
                let next = l[(idx + dir).clamp(0, 3) as usize];
                self.price_unit(id, next)
            }
            None => self.price_unit(id, current + dir as f64 * cfg.step),
        }
    }
}
