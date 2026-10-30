//! Port of `src/engine/sim/charges.ts`: the engine-owned charges for the
//! editor and the bulldozer (#914). Adding and removing elevator cars, the
//! billed shaft extension, and the one player removal command that pays the
//! resale refund each check, move the tower and move the money in one step,
//! so a frontend relays the command and never writes money for them. The raw
//! `Tower::set_cars`, `Tower::resize_transport`, `Tower::remove_unit` and
//! `Tower::remove_transport` stay free of charge for loaders and tests.
//!
//! The car and span edits go through `Simulation::set_cars` and
//! `Simulation::resize_transport`, so a charged edit reports
//! `capacity_changed` like the raw one, and `remove_facility` reports
//! `facility_removed` with its method.

use crate::facilities::Kind;
use crate::gameplay::{GameplayEvent, RemovalMethod};
use crate::sim::Simulation;
use crate::tower::UnitState;

/// `ECON.addCarCost`.
pub const ADD_CAR_COST: f64 = 40_000.0;
/// `ECON.transportFloorCost`: one floor of a shaft extension.
pub const TRANSPORT_FLOOR_COST: f64 = 5_000.0;

pub const NOT_ENOUGH_MONEY: &str = "Not enough money.";
pub const ELEVATOR_GONE: &str = "That elevator is gone.";
pub const ONLY_ELEVATOR_CARS: &str = "Only elevators have cars.";
pub const ONLY_ELEVATOR_EXTEND: &str = "Only elevators can be extended.";
pub const CAR_LIMIT: &str = "This elevator has all the cars it can hold.";
pub const LAST_CAR: &str = "An elevator needs at least one car.";
pub const FACILITY_GONE: &str = "That facility is gone.";
pub const HOUSEKEEPING_PERMANENT: &str =
    "Housekeeping rooms are permanent. The 1994 game does not let you remove them.";
/// Classic never lets the wedding hall be sold or bulldozed.
pub const CLASSIC_WEDDING_HALL_KEPT: &str = "The wedding hall can't be removed.";
pub const SECURITY_PERMANENT: &str =
    "Security offices are permanent. The 1994 game does not let you remove them.";
pub const RECYCLING_PERMANENT: &str =
    "Recycling centers are permanent. The 1994 game does not let you remove them.";
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
/// `INVALID_REQUEST`: the one refusal for a malformed command (#923), an id or
/// floor that is not a whole number, or an unknown `end` or `method`.
/// The typed engine API takes `i64` ids and floors and parsed enums, so it
/// cannot see a fraction or an unknown string; the WASM binding checks its raw
/// arguments (ids and floors with [`whole`], enums with their `parse`) and
/// refuses with this before calling the engine.
/// A native Rust host gets no such check and must pass values in range.
pub const INVALID_REQUEST: &str = "That request is not valid.";

/// A whole number a command may take, as TypeScript's `Number.isSafeInteger`
/// reads it: finite, no fraction, within 2^53 - 1. NaN and infinities fail.
pub fn whole(x: f64) -> Option<i64> {
    (x.fract() == 0.0 && x.abs() <= 9_007_199_254_740_991.0).then_some(x as i64)
}

/// `carResaleRefund()`: half the add-car cost.
pub fn car_resale_refund() -> f64 {
    (ADD_CAR_COST * 0.5).floor()
}

/// `ChargeResult`: whether the command landed, the refusal copy, and the
/// signed change it made to the balance (negative for a charge, positive for
/// a refund, 0 on a refusal).
#[derive(Clone, Debug, PartialEq)]
pub struct ChargeResult {
    pub ok: bool,
    pub reason: Option<String>,
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

/// `ExtendResult`: a charge plus the shaft's ends afterwards and the floors
/// billed.
#[derive(Clone, Debug, PartialEq)]
pub struct ExtendResult {
    pub charge: ChargeResult,
    pub bottom: i64,
    pub top: i64,
    pub added: i64,
}

/// Which end of a shaft an extension moves.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExtendEnd {
    Up,
    Down,
}

impl ExtendEnd {
    pub fn parse(s: &str) -> Option<ExtendEnd> {
        match s {
            "up" => Some(ExtendEnd::Up),
            "down" => Some(ExtendEnd::Down),
            _ => None,
        }
    }
}

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

    /// `addCar(id)`: buy one more car at the add-car cost. Refused at the
    /// kind's car limit (checked first) and when the balance is short.
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
        ChargeResult::paid(-ADD_CAR_COST)
    }

    /// `removeCar(id)`: sell one car back for half the add-car cost. Refused
    /// on the last car.
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
        ChargeResult::paid(refund)
    }

    /// `beginExtend(id)`: open an extend gesture on an elevator, its
    /// high-water mark starting at the shaft's current span. Any gesture
    /// already open is dropped first. False, with no gesture open, when `id`
    /// names no elevator.
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

    /// `endExtend()`: close the open extend gesture, if any.
    pub fn end_extend(&mut self) {
        self.extend_gesture = None;
    }

    /// `extendTransport(id, end, targetFloor)`: move one end of an elevator,
    /// billing each floor past the high-water mark and growing only as far as
    /// the balance pays. The mark is the open gesture's when `begin_extend`
    /// opened one on this shaft, the current span otherwise, and never
    /// reaches inside the current span.
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

    /// `removeFacility(id, method)`: the player's removal of a unit or a
    /// shaft, paying half the build cost back (nothing for a gutted unit).
    /// Refused for a burning unit and for structure the tower keeps; the last
    /// Wedding Hall gone before the VIP's inspection cancels the visit. Units
    /// and shafts take ids from the tower's one `next_id`, so `id` names
    /// exactly one of them.
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
            // A burned-out shell can still be cleared, so the tile is not lost.
            if state != UnitState::Gutted && self.mode.room_is_permanent(kind) {
                return ChargeResult::refuse(permanent_room_refusal(kind));
            }
            self.tower.remove_unit(id);
            let refund = if state == UnitState::Gutted {
                0.0
            } else {
                kind.resale_refund()
            };
            self.money += refund;
            if kind == Kind::WeddingHall
                && self.tower.built_wedding_hall != Some(true)
                && self.evaluated_tower != Some(true)
            {
                self.vip_visit_day = -1.0;
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
        self.gameplay
            .push(GameplayEvent::FacilityRemoved { kind, method });
        ChargeResult::paid(refund)
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
