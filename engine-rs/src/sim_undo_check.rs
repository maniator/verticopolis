//! Whether a step meets the tower it expects (`undo.rs`), checked before it
//! changes anything. The steps apply one after another, so the tower a step
//! meets is the one its edit left, moved on only by time; a step that finds
//! anything else (an edit made outside every gesture) is refused, so its
//! cash never moves for an edit that is not there to reverse, and nothing it
//! puts back lands on a room or a shaft that took its place, hangs where its
//! floor was taken away, or goes past a cap its build kept to.
//!
//! Time moves a room on without any edit, and the owner's rule for that is
//! that a step takes a room out only while nobody has used it since the step
//! was made ([`UnitUse`]): no tenant moved in, it earned nothing and it is
//! not burning. A used room is sold instead, at the sale price.
#![cfg_attr(not(feature = "wasm"), allow(dead_code))]
use std::collections::HashSet;

use crate::facilities::{build_cap, Kind, FACILITIES, MAX_FLOOR, POOLED_CAPS};
use crate::sim::Simulation;
use crate::tower::{Tower, Transport, Unit, UnitState};
use crate::undo::{Step, TransportChange, UnitChange, UnitUse};

/// Why a step was not applied. Nothing changed, and the step stays.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum StepRefused {
    /// The step needs more cash than the tower has.
    NotEnoughMoney,
    /// A room the step would take out has been used since the step was made.
    InUse,
    /// A room the step would take out is burning.
    OnFire,
    /// The step would reprice a condo that has been sold since: a sold
    /// condo's price is fixed, as repricing it is refused.
    PriceFixed,
    /// The tower is not the one the step expects: something it would take
    /// out or restore is gone or changed, or something it would put back is
    /// there already, has lost its place or the floor under it, or would go
    /// past the tower's cap for its kind.
    Stale,
}

impl Simulation {
    /// Refuse `step` unless the tower is the one it expects and the balance
    /// can pay for it.
    pub(crate) fn check_undo_step(&self, step: &Step) -> Result<(), StepRefused> {
        let leaving_units: HashSet<i64> = step
            .units
            .iter()
            .filter(|img| matches!(img.change, UnitChange::TakeOut(_)))
            .map(|img| img.id)
            .collect();
        let ground = Ground::of(&self.tower, step, &leaving_units);
        for img in &step.units {
            let now = self.tower.get_unit(img.id);
            match (&img.change, now) {
                (UnitChange::TakeOut(held), Some(now)) => {
                    if now.state == UnitState::Fire {
                        return Err(StepRefused::OnFire);
                    }
                    if UnitUse::of(now) != *held {
                        return Err(StepRefused::InUse);
                    }
                }
                (UnitChange::PutBack(want), None) => {
                    if !self
                        .tower
                        .tiles_free_for(want, |id| leaving_units.contains(&id))
                        || !ground.under_room(want)
                    {
                        return Err(StepRefused::Stale);
                    }
                }
                (UnitChange::Restore(want), Some(now)) => {
                    if reprices_a_sold_condo(now, want) {
                        return Err(StepRefused::PriceFixed);
                    }
                }
                _ => return Err(StepRefused::Stale),
            }
        }
        let leaving_shafts: HashSet<i64> = step
            .transports
            .iter()
            .filter(|img| matches!(img.change, TransportChange::TakeOut { .. }))
            .map(|img| img.id)
            .collect();
        // A shaft the step puts back or gives its old span needs floor in
        // its column on each story of that span and no other shaft there,
        // as building it did.
        let fits = |want: &Transport| {
            ground.under_shaft(want)
                && self
                    .tower
                    .transports
                    .iter()
                    .filter(|t| t.id != want.id && !leaving_shafts.contains(&t.id))
                    .all(|t| !t.clashes_with(want))
        };
        for img in &step.transports {
            let now = self.tower.get_transport(img.id);
            let as_left = match (&img.change, now) {
                (TransportChange::TakeOut { left }, Some(now)) => now.config_eq(left),
                (TransportChange::Restore { want, left }, Some(now)) => {
                    now.config_eq(left) && fits(want)
                }
                (TransportChange::PutBack(want), None) => fits(want),
                _ => false,
            };
            if !as_left {
                return Err(StepRefused::Stale);
            }
        }
        if !within_caps(&self.tower, step) {
            return Err(StepRefused::Stale);
        }
        if step.money < 0.0 && self.money + step.money < 0.0 {
            return Err(StepRefused::NotEnoughMoney);
        }
        Ok(())
    }
}

/// Whether restoring `want` onto `now` would change the price of a condo
/// that has sold, which `price_unit` and `set_no_rate` (`rent.rs`) refuse.
fn reprices_a_sold_condo(now: &Unit, want: &Unit) -> bool {
    now.kind == Kind::Condo
        && now.ever_occupied
        && (now.rent != want.rent || now.no_rate != want.no_rate)
}

/// The floor and lobby tiles a step leaves: the tower's, less those of the
/// units it takes out, with those of the units it puts back. A room or a
/// shaft the step puts back must stand on these, as building it needed.
struct Ground<'a> {
    tower: &'a Tower,
    leaving: &'a HashSet<i64>,
    laid: HashSet<(i64, i64)>,
}

impl<'a> Ground<'a> {
    fn of(tower: &'a Tower, step: &Step, leaving: &'a HashSet<i64>) -> Self {
        let laid = step
            .units
            .iter()
            .filter_map(|img| match &img.change {
                UnitChange::PutBack(u) if u.kind.is_structural() => Some(u),
                _ => None,
            })
            .flat_map(|u| (u.x..u.x + u.width).map(move |x| (u.floor, x)))
            .collect();
        Ground {
            tower,
            leaving,
            laid,
        }
    }

    fn holds(&self, floor: i64, x: i64) -> bool {
        self.laid.contains(&(floor, x))
            || self
                .tower
                .structure
                .get(&(floor, x))
                .is_some_and(|id| !self.leaving.contains(id))
    }

    /// Whether every tile of room `u` has floor or lobby under it, as its
    /// build laid (`Tower::ensure_floor_under`); a wedding hall's upper
    /// story stands above the top slab.
    fn under_room(&self, u: &Unit) -> bool {
        if u.kind.is_structural() {
            return true;
        }
        let stories = u.kind.floors().min(MAX_FLOOR + 1 - u.floor);
        (u.floor..u.floor + stories).all(|f| (u.x..u.x + u.width).all(|x| self.holds(f, x)))
    }

    /// Whether shaft `t` has floor or lobby in its column on every story it
    /// spans, as `Tower::validate_transport` asks.
    fn under_shaft(&self, t: &Transport) -> bool {
        (t.bottom..=t.top).all(|f| (t.x..t.x + t.width).any(|x| self.holds(f, x)))
    }
}

/// A cap a step can take the tower up against: one kind's own (`build_cap`)
/// or a shared pool's (`POOLED_CAPS`, by its place in that list).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CapKey {
    Kind(Kind),
    Pool(usize),
}

/// How many units and shafts under one cap the tower held when a step was
/// made (`Step::caps_held`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct CapHeld {
    pub(crate) cap: CapKey,
    pub(crate) count: i64,
}

/// A cap applying a step adds units or shafts under: its limit, how many
/// the tower holds under it now and how many the step adds.
struct Raised {
    cap: CapKey,
    limit: i64,
    now: i64,
    added: i64,
}

/// How many units and shafts of each kind applying `step` adds to `tower`,
/// by `Kind`: one it takes out counts against its kind.
fn kinds_added(tower: &Tower, step: &Step) -> Vec<i64> {
    let mut added = vec![0; FACILITIES.len()];
    for img in &step.units {
        match &img.change {
            UnitChange::PutBack(u) => added[u.kind as usize] += 1,
            UnitChange::TakeOut(_) => {
                if let Some(u) = tower.get_unit(img.id) {
                    added[u.kind as usize] -= 1;
                }
            }
            UnitChange::Restore(_) => {}
        }
    }
    for img in &step.transports {
        match &img.change {
            TransportChange::PutBack(t) => added[t.kind as usize] += 1,
            TransportChange::TakeOut { left } => added[left.kind as usize] -= 1,
            TransportChange::Restore { .. } => {}
        }
    }
    added
}

/// The caps applying `step` to `tower` adds under (`Tower::cap_reason`).
fn caps_raised(tower: &Tower, step: &Step) -> Vec<Raised> {
    let added = kinds_added(tower, step);
    let own = FACILITIES.iter().filter_map(|f| {
        let n = added[f.kind as usize];
        let limit = build_cap(f.kind).filter(|_| n > 0)?;
        Some(Raised {
            cap: CapKey::Kind(f.kind),
            limit,
            now: tower.count_kind(f.kind),
            added: n,
        })
    });
    let pooled = POOLED_CAPS.iter().enumerate().filter_map(|(i, pool)| {
        let n: i64 = pool.kinds.iter().map(|&k| added[k as usize]).sum();
        (n > 0).then(|| Raised {
            cap: CapKey::Pool(i),
            limit: pool.cap,
            now: pool.kinds.iter().map(|&k| tower.count_kind(k)).sum(),
            added: n,
        })
    });
    own.chain(pooled).collect()
}

/// What `step`, made on `tower` as it is now, records of the caps it adds
/// under.
pub(crate) fn caps_held(tower: &Tower, step: &Step) -> Vec<CapHeld> {
    caps_raised(tower, step)
        .into_iter()
        .map(|r| CapHeld {
            cap: r.cap,
            count: r.now,
        })
        .collect()
}

/// Whether the units and shafts `step` puts back keep the tower within its
/// caps, as building them again would. A tower can hold more than a cap
/// (an older save): a step may then leave it as far over as the edit found
/// it, and is refused only when the tower has gained under that cap since
/// the step was made.
fn within_caps(tower: &Tower, step: &Step) -> bool {
    caps_raised(tower, step).iter().all(|r| {
        let held = step.caps_held.iter().find(|h| h.cap == r.cap);
        r.now + r.added <= r.limit || held.is_some_and(|h| r.now <= h.count)
    })
}
