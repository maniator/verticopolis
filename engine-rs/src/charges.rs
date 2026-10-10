//! Port of `src/engine/sim/charges.ts`: the engine-owned charges for the
//! editor and the bulldozer (#914). Adding and removing elevator cars, the
//! billed shaft extension, and the one player removal command that pays the
//! resale refund each check, move the tower and move the money in one step,
//! so a frontend relays the command and never writes money for them. The raw
//! `Tower::set_cars`, `Tower::resize_transport`, `Tower::remove_unit` and
//! `Tower::remove_transport` stay free of charge for loaders and tests.
//!
//! The car and span edits below call the tower directly. Once PR #903's
//! `Simulation::set_cars` and `Simulation::resize_transport` land, they call
//! those wrappers instead, so a charged edit reports `capacity_changed` like
//! the raw one, and `remove_facility` reports `facility_removed` with its
//! method.

use crate::facilities::Kind;
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
    fn refuse(reason: impl Into<String>) -> ChargeResult {
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

/// The two ways a player removes a facility; the verb is in the refusal copy.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RemovalMethod {
    Sell,
    Bulldoze,
}

impl RemovalMethod {
    pub fn parse(s: &str) -> Option<RemovalMethod> {
        match s {
            "sell" => Some(RemovalMethod::Sell),
            "bulldoze" => Some(RemovalMethod::Bulldoze),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            RemovalMethod::Sell => "sell",
            RemovalMethod::Bulldoze => "bulldoze",
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
        if !self.tower.set_cars(id, cars + 1) {
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
        if cars <= 1 || !self.tower.set_cars(id, cars - 1) {
            return ChargeResult::refuse(LAST_CAR);
        }
        let refund = car_resale_refund();
        self.money += refund;
        ChargeResult::paid(refund)
    }

    /// `extendTransport(id, end, targetFloor, hwm?)`: move one end of an
    /// elevator, billing each floor past the gesture's high-water mark and
    /// growing only as far as the balance pays. `hwm` is `(bottom, top)`,
    /// widened to the current span; `None` is the current span.
    pub fn extend_transport(
        &mut self,
        id: i64,
        end: ExtendEnd,
        target_floor: i64,
        hwm: Option<(i64, i64)>,
    ) -> ExtendResult {
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
        let (hb, ht) = hwm.unwrap_or((bottom, top));
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
        let r = self.tower.resize_transport(id, nb, nt);
        if !r.ok {
            return unchanged(ChargeResult {
                ok: false,
                reason: r.reason,
                delta: 0.0,
            });
        }
        let cost = added as f64 * TRANSPORT_FLOOR_COST;
        self.money -= cost;
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
    /// Wedding Hall gone before the VIP's inspection cancels the visit.
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
            return ChargeResult::paid(refund);
        }
        let Some(kind) = self.tower.get_transport(id).map(|t| t.kind) else {
            return ChargeResult::refuse(FACILITY_GONE);
        };
        self.tower.remove_transport(id);
        let refund = kind.resale_refund();
        self.money += refund;
        ChargeResult::paid(refund)
    }
}

#[cfg(test)]
#[path = "charges_tests.rs"]
mod tests;
