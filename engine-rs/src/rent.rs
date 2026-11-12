//! Setting what rooms charge: one room at a time
//! ([`Simulation::adjust_rent`], [`Simulation::price_unit`],
//! [`Simulation::set_no_rate`]) or every room of a kind at once
//! ([`Simulation::apply_rent_batch`]).
//!
//! In Classic a priced room picks one of four rungs (very low, low, average,
//! high), as in the original. In Modern it takes any price inside its kind's
//! band, in steps. [`crate::catalog::catalog`] publishes the rungs, bands and
//! defaults for each kind. A condo that has been sold keeps its price.

use crate::clock::GameMode;
use crate::econ::{rent_config, rent_of};
use crate::facilities::Kind;
use crate::gameplay::GameplayEvent;
use crate::rules::RentModel;
use crate::sim::Simulation;
use crate::tower::Unit;

/// The Average rung of a Classic price ladder (four rungs: Very Low, Low,
/// Average, High): the Classic catalog's default price (`catalog_rent_default`),
/// the mode's neutral price, and where the editor's picker puts a price that
/// is not a finite number.
pub(crate) const AVERAGE_RUNG: usize = 2;

#[doc(hidden)]
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
    mode.rent_model(kind).map(|model| match model {
        RentModel::Ladder(rungs) => Some(rungs),
        RentModel::Band(_) => None,
    })
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

/// The price [`Simulation::apply_rent_batch`] sets.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum BatchTarget {
    /// The kind's default price: the average rung in Classic.
    Default,
    /// Off the market: the rooms take no new tenants (Classic only).
    NoRate,
    /// This price, snapped to a rung in Classic or kept inside the band in
    /// Modern.
    Price(f64),
}

/// What a batch reprice did, counted in rooms.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BatchRentResult {
    /// Rooms of the kind.
    pub matched: i64,
    /// Rooms the batch applied to (`matched` less the two skips).
    pub eligible: i64,
    /// Rooms whose price actually moved.
    pub changed: i64,
    /// Sold condos, which keep their price.
    pub skipped_sold: i64,
    /// Rooms skipped for having a price of their own, when the batch asked
    /// for default-priced rooms only.
    pub skipped_custom: i64,
    /// Rooms that had a price of their own and now have the batch's.
    pub custom_overwritten: i64,
    /// Rooms whose price was raised to the bottom of the band (Modern).
    pub clamped_low: i64,
    /// Rooms whose price was lowered to the top of the band (Modern).
    pub clamped_high: i64,
}

impl Simulation {
    /// Sets the price of every room of `kind` to `target`. With
    /// `only_default_priced`, rooms the player priced themselves keep their
    /// price. Returns `None`, changing nothing, for a kind that has no price,
    /// for [`BatchTarget::NoRate`] in Modern, or for a price that is not a
    /// finite number.
    ///
    /// ```
    /// use verticopolis_engine::clock::GameMode;
    /// use verticopolis_engine::facilities::Kind;
    /// use verticopolis_engine::rent::BatchTarget;
    /// use verticopolis_engine::sim::Simulation;
    ///
    /// let mut sim = Simulation::new_game(1, GameMode::Modern);
    /// let none = sim.apply_rent_batch(Kind::Office, BatchTarget::Default, false).unwrap();
    /// assert_eq!(none.matched, 0);
    /// assert!(sim.apply_rent_batch(Kind::Lobby, BatchTarget::Default, false).is_none());
    /// ```
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

    #[doc(hidden)]
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

    #[doc(hidden)]
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

    /// Sets room `id`'s price to `target` (snapped to a rung in Classic, kept
    /// inside the band in Modern) and puts it back on the market. Returns the
    /// price it set, or `None` for a room with no price, a sold condo or a
    /// `target` that is not a finite number.
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

    /// Takes room `id` off the market, so it takes no new tenants. Classic
    /// only, as in the original. Returns `false` for a room that cannot be,
    /// such as a sold condo or any room in Modern.
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

    /// Moves room `id`'s price up (`dir` 1) or down (`dir` -1) by one rung in
    /// Classic or one step in Modern. Returns the new price, or `None` as
    /// [`price_unit`](Simulation::price_unit) does.
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
