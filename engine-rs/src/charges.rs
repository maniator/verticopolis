//! Commands that cost or refund money after a build: elevator cars
//! ([`Simulation::add_car`], [`Simulation::remove_car`]), stretching a shaft
//! ([`Simulation::extend_transport`]) and removing a room or a shaft
//! ([`Simulation::remove_facility`]).
//!
//! Each one checks, changes the tower and moves the money in one step and
//! reports the amount, so a frontend sends the command and never writes
//! money itself.

use crate::churn::household_price;
use crate::econ::rent_config;
use crate::facilities::Kind;
use crate::gameplay::{GameplayEvent, RemovalMethod};
use crate::services::with_thousands;
use crate::sim::{LogKind, Simulation};
use crate::tower::UnitState;

/// The price of one more elevator car.
pub const ADD_CAR_COST: f64 = 40_000.0;
/// The price of each floor an elevator is built or extended past its first.
pub const TRANSPORT_FLOOR_COST: f64 = 5_000.0;

#[doc(hidden)]
pub const NOT_ENOUGH_MONEY: &str = "Not enough money.";
#[doc(hidden)]
pub const ELEVATOR_GONE: &str = "That elevator is gone.";
#[doc(hidden)]
pub const ONLY_ELEVATOR_CARS: &str = "Only elevators have cars.";
#[doc(hidden)]
pub const ONLY_ELEVATOR_EXTEND: &str = "Only elevators can be extended.";
#[doc(hidden)]
pub const CAR_LIMIT: &str = "This elevator has all the cars it can hold.";
#[doc(hidden)]
pub const LAST_CAR: &str = "An elevator needs at least one car.";
#[doc(hidden)]
pub const FACILITY_GONE: &str = "That facility is gone.";
#[doc(hidden)]
pub const HOUSEKEEPING_PERMANENT: &str =
    "Housekeeping rooms are permanent. The 1994 game does not let you remove them.";
#[doc(hidden)]
/// Classic never lets the wedding hall be sold or bulldozed.
pub const CLASSIC_WEDDING_HALL_KEPT: &str = "The wedding hall can't be removed.";
#[doc(hidden)]
pub const SECURITY_PERMANENT: &str =
    "Security offices are permanent. The 1994 game does not let you remove them.";
#[doc(hidden)]
pub const RECYCLING_PERMANENT: &str =
    "Recycling centers are permanent. The 1994 game does not let you remove them.";
#[doc(hidden)]
pub const CINEMA_PERMANENT: &str =
    "Movie theaters are permanent. The 1994 game does not let you remove them.";

/// The refusal for a Classic room `GameMode::room_is_permanent` keeps.
fn permanent_room_refusal(kind: Kind) -> &'static str {
    match kind {
        Kind::Security => SECURITY_PERMANENT,
        Kind::Recycling => RECYCLING_PERMANENT,
        Kind::Cinema => CINEMA_PERMANENT,
        Kind::WeddingHall => CLASSIC_WEDDING_HALL_KEPT,
        _ => HOUSEKEEPING_PERMANENT,
    }
}
/// The refusal for a malformed command, such as a brush with too many tiles.
/// The JavaScript binding also gives it for an id or floor that is not a
/// whole number, or an unknown name; a Rust host passes typed values and
/// never sees those cases.
pub const INVALID_REQUEST: &str = "That request is not valid.";

#[doc(hidden)]
/// A whole number a command may take, as TypeScript's `Number.isSafeInteger`
/// reads it: finite, no fraction, within 2^53 - 1. NaN and infinities fail.
pub fn whole(x: f64) -> Option<i64> {
    (x.fract() == 0.0 && x.abs() <= 9_007_199_254_740_991.0).then_some(x as i64)
}

#[doc(hidden)]
/// `carResaleRefund()`: half the add-car cost.
pub fn car_resale_refund() -> f64 {
    (ADD_CAR_COST * 0.5).floor()
}

/// What a charged command did.
#[derive(Clone, Debug, PartialEq)]
pub struct ChargeResult {
    /// Whether it was carried out.
    pub ok: bool,
    /// Why it was refused, ready to show a player. `None` when carried out.
    pub reason: Option<String>,
    /// The change to the player's money: negative for a charge, positive for
    /// a refund, 0 when refused.
    pub delta: f64,
}

impl ChargeResult {
    pub(crate) fn refuse(reason: impl Into<String>) -> ChargeResult {
        ChargeResult {
            ok: false,
            reason: Some(reason.into()),
            delta: 0.0,
        }
    }

    fn paid(delta: f64) -> ChargeResult {
        ChargeResult {
            ok: true,
            reason: None,
            delta,
        }
    }
}

/// What an extension did: the charge, and the shaft's span afterwards.
#[derive(Clone, Debug, PartialEq)]
pub struct ExtendResult {
    /// The money moved, or the refusal.
    pub charge: ChargeResult,
    /// The shaft's lowest floor afterwards.
    pub bottom: i64,
    /// The shaft's highest floor afterwards.
    pub top: i64,
    /// How many floors this call billed.
    pub added: i64,
}

/// Which end of a shaft an extension moves.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExtendEnd {
    /// Move the top floor.
    Up,
    /// Move the bottom floor.
    Down,
}

impl ExtendEnd {
    /// `up` or `down`.
    pub fn parse(s: &str) -> Option<ExtendEnd> {
        match s {
            "up" => Some(ExtendEnd::Up),
            "down" => Some(ExtendEnd::Down),
            _ => None,
        }
    }
}

#[doc(hidden)]
/// `extendBill`: one step of budget-clamped billing for an elevator extend.
/// Returns the new ends and the count of floors past the high-water mark.
pub fn extend_bill(
    cur: (i64, i64),
    hwm: (i64, i64),
    end: ExtendEnd,
    target_floor: i64,
    money: f64,
    per_floor: f64,
) -> (i64, i64, i64) {
    let (mut nb, mut nt) = cur;
    match end {
        ExtendEnd::Up => nt = (cur.0 + 1).max(target_floor),
        ExtendEnd::Down => nb = (cur.1 - 1).min(target_floor),
    }
    let budget = (money / per_floor).floor().max(0.0);
    // The budget is a whole count of floors; a balance too large for i64
    // saturates, which still pays for any span the tower can hold.
    let budget = if budget > i64::MAX as f64 {
        i64::MAX
    } else {
        budget as i64
    };
    if nt > hwm.1 {
        nt = hwm.1 + (nt - hwm.1).min(budget);
    }
    if nb < hwm.0 {
        nb = hwm.0 - (hwm.0 - nb).min(budget);
    }
    let added = (nt - hwm.1).max(0) + (hwm.0 - nb).max(0);
    (nb, nt, added)
}

impl Simulation {
    /// The shaft behind an elevator command: `(kind, cars, bottom, top)`, or
    /// the refusal to return.
    fn elevator(&self, id: i64, not_elevator: &str) -> Result<(Kind, i64, i64, i64), ChargeResult> {
        let Some(t) = self.tower.get_transport(id) else {
            return Err(ChargeResult::refuse(ELEVATOR_GONE));
        };
        if !t.kind.is_elevator() {
            return Err(ChargeResult::refuse(not_elevator));
        }
        Ok((t.kind, t.cars, t.bottom, t.top))
    }

    /// Buys one more car for elevator `id` at [`ADD_CAR_COST`]. Refused at the
    /// elevator's car limit and when the money is short.
    pub fn add_car(&mut self, id: i64) -> ChargeResult {
        let (kind, cars, _, _) = match self.elevator(id, ONLY_ELEVATOR_CARS) {
            Ok(t) => t,
            Err(r) => return r,
        };
        if cars >= kind.max_cars() {
            return ChargeResult::refuse(CAR_LIMIT);
        }
        if self.money < ADD_CAR_COST {
            return ChargeResult::refuse(NOT_ENOUGH_MONEY);
        }
        if !self.set_cars(id, cars + 1) {
            return ChargeResult::refuse(CAR_LIMIT);
        }
        self.money -= ADD_CAR_COST;
        self.note_edit_cash(-ADD_CAR_COST);
        ChargeResult::paid(-ADD_CAR_COST)
    }

    /// Sells one car of elevator `id` back for half of [`ADD_CAR_COST`].
    /// Refused on the last car.
    pub fn remove_car(&mut self, id: i64) -> ChargeResult {
        let (_, cars, _, _) = match self.elevator(id, ONLY_ELEVATOR_CARS) {
            Ok(t) => t,
            Err(r) => return r,
        };
        if cars <= 1 || !self.set_cars(id, cars - 1) {
            return ChargeResult::refuse(LAST_CAR);
        }
        let refund = car_resale_refund();
        self.money += refund;
        self.note_edit_cash(refund);
        ChargeResult::paid(refund)
    }

    /// Starts a drag that stretches elevator `id`. Until
    /// [`end_extend`](Simulation::end_extend), the
    /// [`extend_transport`](Simulation::extend_transport) calls bill each floor
    /// once, however far the player drags back and forth. Returns `false`
    /// when `id` is not an elevator.
    pub fn begin_extend(&mut self, id: i64) -> bool {
        self.extend_gesture = None;
        match self.elevator(id, ONLY_ELEVATOR_EXTEND) {
            Ok((_, _, bottom, top)) => {
                self.extend_gesture = Some((id, bottom, top));
                true
            }
            Err(_) => false,
        }
    }

    /// A host handing over its open gesture with a load (#990): kept as given
    /// when `id` names an elevator (the shafts `beginExtend` accepts), and
    /// widened to the span at use like any gesture. Not a binding command:
    /// a caller that can hand over a mark here can hand over a whole save.
    #[cfg_attr(not(feature = "wasm"), allow(dead_code))]
    pub(crate) fn restore_extend(&mut self, id: i64, bottom: i64, top: i64) {
        self.extend_gesture = self
            .elevator(id, ONLY_ELEVATOR_EXTEND)
            .ok()
            .map(|_| (id, bottom, top));
    }

    /// Ends the drag [`begin_extend`](Simulation::begin_extend) started.
    pub fn end_extend(&mut self) {
        self.extend_gesture = None;
    }

    /// Moves one end of elevator `id` toward `target_floor`, charging
    /// [`TRANSPORT_FLOOR_COST`] for each new floor. It grows only as far as
    /// the money pays for. During a drag, a floor already paid for is not
    /// billed again.
    ///
    /// ```
    /// use verticopolis_engine::charges::ExtendEnd;
    /// use verticopolis_engine::clock::GameMode;
    /// use verticopolis_engine::facilities::Kind;
    /// use verticopolis_engine::sim::Simulation;
    ///
    /// let mut sim = Simulation::new_game(1, GameMode::Classic);
    /// for floor in 1..=6 {
    ///     let kind = if floor == 1 { Kind::Lobby } else { Kind::Floor };
    ///     for x in 100..124 {
    ///         sim.build(kind, floor, x);
    ///     }
    /// }
    /// sim.build_transport(Kind::ElevatorStandard, 110, 1, 3);
    /// let id = sim.tower.transports[0].id;
    ///
    /// sim.begin_extend(id);
    /// let grown = sim.extend_transport(id, ExtendEnd::Up, 6);
    /// sim.end_extend();
    /// assert_eq!((grown.bottom, grown.top, grown.added), (1, 6, 3));
    /// ```
    pub fn extend_transport(&mut self, id: i64, end: ExtendEnd, target_floor: i64) -> ExtendResult {
        let (_, _, bottom, top) = match self.elevator(id, ONLY_ELEVATOR_EXTEND) {
            Ok(t) => t,
            Err(charge) => {
                let (bottom, top) = self
                    .tower
                    .get_transport(id)
                    .map_or((0, 0), |t| (t.bottom, t.top));
                return ExtendResult {
                    charge,
                    bottom,
                    top,
                    added: 0,
                };
            }
        };
        let gesture = self
            .extend_gesture
            .filter(|&(gid, _, _)| gid == id)
            .map(|(_, b, t)| (b, t));
        let (hb, ht) = gesture.unwrap_or((bottom, top));
        let mark = (hb.min(bottom), ht.max(top));
        let (nb, nt, added) = extend_bill(
            (bottom, top),
            mark,
            end,
            target_floor,
            self.money,
            TRANSPORT_FLOOR_COST,
        );
        let unchanged = |charge: ChargeResult| ExtendResult {
            charge,
            bottom,
            top,
            added: 0,
        };
        if nb == bottom && nt == top {
            let wanted = match end {
                ExtendEnd::Up => target_floor > mark.1,
                ExtendEnd::Down => target_floor < mark.0,
            };
            return unchanged(if wanted {
                ChargeResult::refuse(NOT_ENOUGH_MONEY)
            } else {
                ChargeResult::paid(0.0)
            });
        }
        let r = self.resize_transport(id, nb, nt);
        if !r.ok {
            return unchanged(ChargeResult {
                ok: false,
                reason: r.reason,
                delta: 0.0,
            });
        }
        let cost = added as f64 * TRANSPORT_FLOOR_COST;
        self.money -= cost;
        self.note_edit_cash(-cost);
        if gesture.is_some() {
            self.extend_gesture = Some((id, mark.0.min(nb), mark.1.max(nt)));
        }
        ExtendResult {
            charge: ChargeResult::paid(if cost == 0.0 { 0.0 } else { -cost }),
            bottom: nb,
            top: nt,
            added,
        }
    }

    /// Removes room or shaft `id` and refunds half its build price (nothing
    /// for a room a fire gutted). `method` says whether the player sold it or
    /// bulldozed it, for the gameplay event. Refused for a burning room and
    /// for a room the mode keeps for good. Rooms and shafts share one id
    /// sequence, so `id` names exactly one thing.
    pub fn remove_facility(&mut self, id: i64, method: RemovalMethod) -> ChargeResult {
        if let Some(u) = self.tower.get_unit(id) {
            let (kind, state) = (u.kind, u.state);
            if state == UnitState::Fire {
                return ChargeResult::refuse(format!(
                    "You can't {} a burning unit. Call fire rescue or let it burn out.",
                    method.as_str()
                ));
            }
            if let Some(reason) = self.tower.removal_reason(id) {
                return ChargeResult::refuse(reason);
            }
            if self.stays_for_good(kind, state) {
                return ChargeResult::refuse(permanent_room_refusal(kind));
            }
            let refund = if state == UnitState::Gutted {
                0.0
            } else {
                kind.resale_refund()
            };
            // A sold condo belongs to its household: removing it buys the
            // unit back at the price it sold for, as an owner leaving does
            // (`vacate`), before the shell's resale refund (#713).
            let buyback = self.sold_condo_buyback(id, state);
            if buyback > 0.0 && self.money + refund < buyback {
                return ChargeResult::refuse(format!(
                    "You can't {} this condo without buying it back for ${}.",
                    method.as_str(),
                    with_thousands(buyback)
                ));
            }
            let floor = self.tower.get_unit(id).map(|u| u.floor).unwrap_or(0);
            self.tower.remove_unit(id);
            if buyback > 0.0 {
                let msg = format!(
                    "You bought back Condominium on {} for ${} to remove it.",
                    self.floor_label(floor),
                    with_thousands(buyback)
                );
                self.emit(&msg, LogKind::Money);
            }
            let refund = refund - buyback;
            self.money += refund;
            self.note_edit_cash(refund);
            if kind == Kind::WeddingHall
                && self.tower.built_wedding_hall != Some(true)
                && self.evaluated_tower != Some(true)
            {
                self.edit_vip_visit_day(-1.0);
            }
            self.gameplay
                .push(GameplayEvent::FacilityRemoved { kind, method });
            return ChargeResult::paid(refund);
        }
        let Some(kind) = self.tower.get_transport(id).map(|t| t.kind) else {
            return ChargeResult::refuse(FACILITY_GONE);
        };
        self.tower.remove_transport(id);
        let refund = kind.resale_refund();
        self.money += refund;
        self.note_edit_cash(refund);
        self.gameplay
            .push(GameplayEvent::FacilityRemoved { kind, method });
        ChargeResult::paid(refund)
    }

    /// What removing unit `id` costs to buy back: the price a sold condo's
    /// household paid (scaled by its size, as `vacate` buys it back), or
    /// nothing for any other room, an unsold condo or a gutted shell.
    fn sold_condo_buyback(&self, id: i64, state: UnitState) -> f64 {
        match self.tower.get_unit(id) {
            Some(u) if u.kind == Kind::Condo && u.ever_occupied && state != UnitState::Gutted => {
                let sale_price = u
                    .rent
                    .unwrap_or_else(|| rent_config(Kind::Condo).map(|c| c.default).unwrap_or(0.0));
                household_price(sale_price, u.residents)
            }
            _ => 0.0,
        }
    }

    /// Whether the tower keeps a room of `kind` in `state` for good, so no
    /// removal takes it: a Classic permanent room stays unless a fire gutted
    /// it, as a burned-out shell can still be cleared and the tile is not
    /// lost.
    pub(crate) fn stays_for_good(&self, kind: Kind, state: UnitState) -> bool {
        state != UnitState::Gutted && self.mode.room_is_permanent(kind)
    }
}

#[cfg(test)]
#[path = "charges_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "charges_removal_tests.rs"]
mod removal_tests;

#[cfg(test)]
#[path = "charges_schedule_tests.rs"]
mod schedule_tests;
