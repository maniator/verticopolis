//! Port of `sim/rent.ts` and the ladder helpers of `pricing.ts`.

use crate::clock::GameMode;
use crate::econ::{classic_ladder, rent_config, rent_of};
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::Unit;

/// `snapToLadder`: ties go to the later rung.
pub fn snap_to_ladder(rungs: &[f64; 4], value: f64) -> f64 {
    if !value.is_finite() {
        return rungs[2];
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
fn ladder_level(rungs: &[f64; 4], value: f64) -> usize {
    let snapped = snap_to_ladder(rungs, value);
    rungs.iter().position(|&r| r == snapped).unwrap_or(2)
}

/// `priceOptions(kind)`: `Some(Some(ladder))` in Classic for the canon kinds,
/// `Some(None)` for a Modern band, `None` for an unpriced kind.
fn price_options(mode: GameMode, kind: Kind) -> Option<Option<[f64; 4]>> {
    match mode {
        GameMode::Classic => classic_ladder(kind).map(Some),
        GameMode::Modern => rent_config(kind).map(|_| None),
    }
}

fn price_neutral(mode: GameMode, kind: Kind) -> Option<f64> {
    match price_options(mode, kind)? {
        Some(l) => Some(l[2]),
        None => Some(rent_config(kind)?.default),
    }
}

impl Simulation {
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
        u.rent = if applied == cfg.default {
            None
        } else {
            Some(applied)
        };
        u.no_rate = false;
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
        u.no_rate = true;
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
