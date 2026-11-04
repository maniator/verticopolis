//! Whether a step meets the tower it expects (`undo.rs`), checked before it
//! changes anything. The steps apply one after another, so the tower a step
//! meets is the one its edit left, moved on only by time; a step that finds
//! anything else (an edit made outside every gesture) is refused, so its
//! cash never moves for an edit that is not there to reverse, and nothing it
//! puts back lands on a room or a shaft that took its place, hangs where its
//! floor was taken away, sits on a lobby or below the metro, or goes past a
//! cap its build kept to (`sim_undo_ground.rs`). Nor does a
//! floor or lobby tile it takes out leave a room, a shaft or the story above
//! hanging, as a sale never does (`Tower::removal_reason`).
//!
//! Time moves a build on without any edit, and the owner's rule for that is
//! that a step takes a build back at its full price only while nobody has
//! used it since the step was made. A room the edit built is in use once it
//! opens; one that was already open is in use once a tenant moved in, it
//! earned or it burned ([`UnitUse`]). A floor or lobby tile, or a shaft, is
//! in use once an hourly pass has run with it standing (`Step::hour_passes`),
//! and a shaft also once anyone rode it (`Transport::rides`), which also
//! keeps an undo from taking away the cars or floors an edit added to it. A
//! used build is sold instead, at the sale price. A build whose dig searched
//! for treasure is never undone: the dig and its luck stay, so the search
//! would cost nothing.
#![cfg_attr(not(feature = "wasm"), allow(dead_code))]
use std::collections::HashSet;

use crate::facilities::{build_cap, Kind, FACILITIES, POOLED_CAPS};
use crate::sim::Simulation;
use crate::sim_undo_ground::Ground;
use crate::tower::{Tower, Transport, Unit, UnitState};
use crate::undo::{Step, TransportChange, UnitChange, UnitUse};

/// Why a step was not applied. Nothing changed. `sellable` says the player
/// can sell the build instead, which a Classic permanent room and a lobby
/// tile never allow.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum StepRefused {
    /// The step needs more cash than the tower has.
    NotEnoughMoney,
    /// A room the step would take out at its full price has been used
    /// since the step was made.
    InUse { sellable: bool },
    /// A floor or lobby tile the step would take out at its full price has
    /// stood through an hourly pass since the step was made, which moves
    /// tenants in over the floors the tower reaches. Floor a room's build
    /// laid under it is held to this too, while the room is still being
    /// built. `sellable` is false while something stands on the tile.
    GroundUsed { sellable: bool },
    /// A room the step would take out was being built when the step was made
    /// and has opened since.
    Opened { sellable: bool },
    /// A shaft the step would take out, or take cars or floors from, at the
    /// price paid has been used since the step was made.
    ShaftUsed,
    /// A build the edit took out again inside its own gesture had been used
    /// by then (`Step::used_in_gesture`).
    UsedThenSold,
    /// The edit dug new ground that could hold treasure.
    SearchedForTreasure { sellable: bool },
    /// A room the step would take out is burning.
    OnFire,
    /// The step would reprice a condo that has been sold since: a sold
    /// condo's price is fixed, as repricing it is refused.
    PriceFixed,
    /// A sale the step would make again meets a room in another use than
    /// the one it was sold in: a tenant moved in or out since.
    UseChanged,
    /// Something stands in the way: a room or shaft the step would put back
    /// has no room, no floor under it, a lobby or the metro where building
    /// it is refused, or no place under its cap, or a floor or lobby tile it
    /// would take out holds up a room, a shaft, the story above or, on the
    /// ground floor, a basement that hangs from it. Only an edit clears it, and undoing that edit puts the block back, so the
    /// step never applies.
    Blocked,
    /// The tower is not the one the step expects: something it would take
    /// out or restore is gone or has changed, or something it would put back
    /// is there already.
    Stale,
}

impl StepRefused {
    /// Whether the step can never apply again. Only time can make a step
    /// apply, and time does not run back: a build in use stays in use, a
    /// sold condo seldom empties, a room's tenants and income do not go back
    /// to what a sale found, and a tower an edit changed under the step
    /// changes back only by another edit, whose own step sits above this
    /// one. Time does bring in money and put a fire out.
    pub(crate) fn is_lasting(self) -> bool {
        !matches!(self, StepRefused::NotEnoughMoney | StepRefused::OnFire)
    }
}

/// The refusals a check has found. A lasting one is reported before any
/// other, so a refusal that time can clear never keeps a step that can
/// never apply.
#[derive(Default)]
struct Found {
    lasting: Option<StepRefused>,
    passing: Option<StepRefused>,
}

impl Found {
    fn add(&mut self, why: StepRefused) {
        let slot = if why.is_lasting() {
            &mut self.lasting
        } else {
            &mut self.passing
        };
        slot.get_or_insert(why);
    }

    fn verdict(self) -> Result<(), StepRefused> {
        match self.lasting.or(self.passing) {
            Some(why) => Err(why),
            None => Ok(()),
        }
    }
}

impl Simulation {
    /// Refuse `step` unless the tower is the one it expects and the balance
    /// can pay for it.
    pub(crate) fn check_undo_step(&self, step: &Step) -> Result<(), StepRefused> {
        let mut found = Found::default();
        if step.searched_for_treasure {
            let sellable = self.sells_what_it_takes(step);
            found.add(StepRefused::SearchedForTreasure { sellable });
        }
        let leaving_units: HashSet<i64> = step
            .units
            .iter()
            .filter(|img| matches!(img.change, UnitChange::TakeOut(_)))
            .map(|img| img.id)
            .collect();
        let ground = Ground::of(&self.tower, step, &leaving_units);
        let hour_passed = self.on_hour_runs != step.hour_passes;
        for img in &step.units {
            match (&img.change, self.tower.get_unit(img.id)) {
                (UnitChange::TakeOut(held), Some(now)) => {
                    let hangs =
                        now.kind.is_structural() && !ground.leaves_nothing_hanging_from(now);
                    self.check_take_out(&mut found, img.built, held, now, hour_passed, !hangs);
                    if hangs {
                        found.add(StepRefused::Blocked);
                    }
                }
                (UnitChange::PutBack(want), None) => {
                    if !self
                        .tower
                        .tiles_free_for(want, |id| leaving_units.contains(&id))
                        || !ground.under_room(want)
                    {
                        found.add(StepRefused::Blocked);
                    }
                }
                (UnitChange::Restore(want), Some(now)) => {
                    if reprices_a_sold_condo(now, want) {
                        found.add(StepRefused::PriceFixed);
                    }
                }
                _ => found.add(StepRefused::Stale),
            }
        }
        self.check_shafts(&mut found, step, &ground, hour_passed);
        if !ground.leaves_no_basement_hanging() {
            found.add(StepRefused::Blocked);
        }
        if !within_caps(&self.tower, step) {
            found.add(StepRefused::Blocked);
        }
        // After the builds' own reasons, which say more.
        if step.used_in_gesture {
            found.add(StepRefused::UsedThenSold);
        }
        if step.money < 0.0 && self.money + step.money < 0.0 {
            found.add(StepRefused::NotEnoughMoney);
        }
        found.verdict()
    }

    /// Check a unit `now` that a step would take out, which the step found
    /// in use `held`; `built` as [`crate::undo::UnitImage`] has it, and
    /// `free` when nothing the step leaves stands on it.
    fn check_take_out(
        &self,
        found: &mut Found,
        built: bool,
        held: &UnitUse,
        now: &Unit,
        hour_passed: bool,
        free: bool,
    ) {
        if now.state == UnitState::Fire {
            // Its use shows once the fire is out.
            found.add(StepRefused::OnFire);
            return;
        }
        let sellable = self.can_sell(now.kind) && free;
        let use_now = UnitUse::of(now);
        if !built {
            // A sale made again prices the room by its use as sold.
            if use_now.as_sold() != held.as_sold() {
                found.add(StepRefused::UseChanged);
            }
        } else if now.kind.is_structural() {
            // A tile's use shows only in the hours it stood.
            if hour_passed {
                found.add(StepRefused::GroundUsed { sellable });
            }
        } else if held.only_opened(use_now) {
            found.add(StepRefused::Opened { sellable });
        } else if use_now != *held {
            found.add(StepRefused::InUse { sellable });
        }
    }

    /// Check the shafts a step names, and the shafts it leaves standing on
    /// the floor and lobby tiles it takes out.
    fn check_shafts(&self, found: &mut Found, step: &Step, ground: &Ground, hour_passed: bool) {
        let named: HashSet<i64> = step.transports.iter().map(|img| img.id).collect();
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
            let (as_left, room, takes_back) = match (&img.change, now) {
                (TransportChange::TakeOut { left }, Some(now)) => (now.config_eq(left), true, true),
                (TransportChange::Restore { want, left }, Some(now)) => (
                    now.config_eq(left),
                    fits(want),
                    takes_cars_or_floors(left, want),
                ),
                (TransportChange::PutBack(want), None) => (true, fits(want), false),
                _ => (false, true, false),
            };
            if !as_left {
                found.add(StepRefused::Stale);
                continue;
            }
            if !room {
                found.add(StepRefused::Blocked);
            }
            if img.built && takes_back && (hour_passed || ridden_since(now, &img.change)) {
                found.add(StepRefused::ShaftUsed);
            }
        }
        // A shaft the step leaves alone keeps its floor.
        let stands = self
            .tower
            .transports
            .iter()
            .filter(|t| !named.contains(&t.id))
            .all(|t| ground.still_under_shaft(t));
        if !stands {
            found.add(StepRefused::Blocked);
        }
    }

    /// Whether the player could sell a room of `kind` instead of undoing its
    /// build: a lobby tile and a Classic permanent room stay for good.
    fn can_sell(&self, kind: Kind) -> bool {
        kind != Kind::Lobby && !self.mode.room_is_permanent(kind)
    }

    /// Whether the player could sell every unit `step` would take out.
    fn sells_what_it_takes(&self, step: &Step) -> bool {
        step.units.iter().all(|img| {
            !matches!(img.change, UnitChange::TakeOut(_))
                || self
                    .tower
                    .get_unit(img.id)
                    .is_none_or(|u| self.can_sell(u.kind))
        })
    }
}

/// Whether putting `want`'s span and cars on a shaft that is `left` takes
/// cars or floors away from it.
pub(crate) fn takes_cars_or_floors(left: &Transport, want: &Transport) -> bool {
    want.cars < left.cars || want.bottom > left.bottom || want.top < left.top
}

/// Whether the shaft `now` has been ridden since the step that expects it
/// as `change` leaves it was made.
fn ridden_since(now: Option<&Transport>, change: &TransportChange) -> bool {
    let left = match change {
        TransportChange::TakeOut { left } | TransportChange::Restore { left, .. } => left,
        TransportChange::PutBack(_) => return false,
    };
    now.is_some_and(|now| now.rides != left.rides)
}

/// Whether restoring `want` onto `now` would change the price of a condo
/// that has sold, which `price_unit` and `set_no_rate` (`rent.rs`) refuse.
fn reprices_a_sold_condo(now: &Unit, want: &Unit) -> bool {
    now.kind == Kind::Condo
        && now.ever_occupied
        && (now.rent != want.rent || now.no_rate != want.no_rate)
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
