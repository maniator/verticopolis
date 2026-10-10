//! Port of `src/engine/sim/charges.ts`: the editor's and the bulldozer's
//! priced commands (#914). Each checks its own limits and the balance,
//! moves the money and says why it refuses, so a frontend never writes the
//! balance for these actions. The raw tower edits (`set_cars`,
//! `resize_transport`, `remove_unit`, `remove_transport`) stay free for
//! loaders and tests.

use crate::econ::{car_resale_refund, ADD_CAR_COST, GUTTED_RESALE_REFUND, TRANSPORT_FLOOR_COST};
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

const NOT_ENOUGH_MONEY: &str = "Not enough money.";

/// Which end of a shaft an extend moves.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum End {
    Up,
    Down,
}

impl End {
    pub fn parse(s: &str) -> Option<End> {
        match s {
            "up" => Some(End::Up),
            "down" => Some(End::Down),
            _ => None,
        }
    }
}

/// `extendBill`: one step of budget-clamped billing for an extend. Returns
/// the new ends and the count of floors past the high-water mark to bill.
pub fn extend_bill(
    cur: (i64, i64),
    hwm: (i64, i64),
    end: End,
    target_floor: i64,
    money: f64,
    per_floor: f64,
) -> (i64, i64, i64) {
    let (mut nb, mut nt) = cur;
    match end {
        End::Up => nt = (cur.0 + 1).max(target_floor),
        End::Down => nb = (cur.1 - 1).min(target_floor),
    }
    // Clamped at zero: in debt the budget is no new floors, never a negative
    // count that would pull an end below the mark.
    // `as` saturates, so a huge balance reads as an unbounded budget.
    let budget = (money / per_floor).floor().max(0.0) as i64;
    if nt > hwm.1 {
        nt = hwm.1 + (nt - hwm.1).min(budget);
    }
    if nb < hwm.0 {
        nb = hwm.0 - (hwm.0 - nb).min(budget);
    }
    let added = (nt - hwm.1).max(0) + (hwm.0 - nb).max(0);
    (nb, nt, added)
}

/// What a priced command did: `delta` is the money it moved (negative for a
/// charge, positive for a refund, zero on a refusal); `added` is the floors
/// an extend billed (zero for the other commands).
#[derive(Clone, Debug, PartialEq)]
pub struct ChargeResult {
    pub ok: bool,
    pub reason: Option<String>,
    pub delta: f64,
    pub added: i64,
}

impl ChargeResult {
    fn refuse(reason: Option<&str>) -> ChargeResult {
        ChargeResult {
            ok: false,
            reason: reason.map(str::to_string),
            delta: 0.0,
            added: 0,
        }
    }

    fn done(delta: f64) -> ChargeResult {
        ChargeResult {
            ok: true,
            reason: None,
            delta,
            added: 0,
        }
    }
}

impl Simulation {
    /// `addCar(id)`: one car for `ADD_CAR_COST`.
    pub fn add_car(&mut self, id: i64) -> ChargeResult {
        let Some((kind, cars)) = self
            .tower
            .get_transport(id)
            .filter(|t| t.kind.is_elevator())
            .map(|t| (t.kind, t.cars))
        else {
            return ChargeResult::refuse(Some("No such elevator."));
        };
        let max = kind.max_cars();
        if cars >= max {
            return ChargeResult::refuse(Some(&format!("This elevator already runs {max} cars.")));
        }
        if self.money < ADD_CAR_COST {
            return ChargeResult::refuse(Some(NOT_ENOUGH_MONEY));
        }
        if !self.tower.set_cars(id, cars + 1) {
            return ChargeResult::refuse(Some("The car could not be added."));
        }
        self.money -= ADD_CAR_COST;
        ChargeResult::done(-ADD_CAR_COST)
    }

    /// `removeCar(id)`: one car less, paid back at half the add cost.
    pub fn remove_car(&mut self, id: i64) -> ChargeResult {
        let Some(cars) = self
            .tower
            .get_transport(id)
            .filter(|t| t.kind.is_elevator())
            .map(|t| t.cars)
        else {
            return ChargeResult::refuse(Some("No such elevator."));
        };
        if cars <= 1 {
            return ChargeResult::refuse(Some("An elevator keeps at least one car."));
        }
        if !self.tower.set_cars(id, cars - 1) {
            return ChargeResult::refuse(Some("The car could not be removed."));
        }
        let refund = car_resale_refund();
        self.money += refund;
        ChargeResult::done(refund)
    }

    /// `extendTransport(id, end, targetFloor, hwm)`: move one end of an
    /// elevator, paying `TRANSPORT_FLOOR_COST` per floor past the mark (the
    /// shaft's extent when absent), clamped to the balance.
    pub fn extend_transport(
        &mut self,
        id: i64,
        end: End,
        target_floor: i64,
        hwm: Option<(i64, i64)>,
    ) -> ChargeResult {
        let Some((bottom, top)) = self
            .tower
            .get_transport(id)
            .filter(|t| t.kind.is_elevator())
            .map(|t| (t.bottom, t.top))
        else {
            return ChargeResult::refuse(Some("No such elevator."));
        };
        let mark = hwm.unwrap_or((bottom, top));
        let (nb, nt, added) = extend_bill(
            (bottom, top),
            mark,
            end,
            target_floor,
            self.money,
            TRANSPORT_FLOOR_COST,
        );
        if nb == bottom && nt == top {
            let wants_more = match end {
                End::Up => (bottom + 1).max(target_floor) > mark.1,
                End::Down => (top - 1).min(target_floor) < mark.0,
            };
            return ChargeResult::refuse(wants_more.then_some(NOT_ENOUGH_MONEY));
        }
        let res = self.tower.resize_transport(id, nb, nt);
        if !res.ok {
            return ChargeResult::refuse(res.reason.as_deref());
        }
        let cost = added as f64 * TRANSPORT_FLOOR_COST;
        self.money -= cost;
        ChargeResult {
            ok: true,
            reason: None,
            // `0.0 - cost`, as the TypeScript spells it: a free shrink is +0.
            delta: 0.0 - cost,
            added,
        }
    }

    /// `sellUnit`: remove a unit with its refund, refused while it burns or
    /// holds up the story above; a gutted shell pays nothing. Selling the
    /// last Wedding Hall before the VIP came cancels the inspection.
    pub fn sell_unit(&mut self, id: i64) -> ChargeResult {
        let Some((kind, state)) = self.tower.get_unit(id).map(|u| (u.kind, u.state)) else {
            return ChargeResult::refuse(Some("Nothing to sell."));
        };
        if state == UnitState::Fire {
            return ChargeResult::refuse(Some(
                "You can't remove a burning unit. Call fire rescue or let it burn out.",
            ));
        }
        if let Some(reason) = self.tower.removal_reason(id) {
            return ChargeResult::refuse(Some(reason));
        }
        self.tower.remove_unit(id);
        let refund = if state == UnitState::Gutted {
            GUTTED_RESALE_REFUND
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
        ChargeResult::done(refund)
    }

    /// `sell(id)`: sell or bulldoze a unit or a shaft by id (one id counter
    /// covers both), paying the resale.
    pub fn sell(&mut self, id: i64) -> ChargeResult {
        if self.tower.get_unit(id).is_some() {
            return self.sell_unit(id);
        }
        let Some(kind) = self.tower.get_transport(id).map(|t| t.kind) else {
            return ChargeResult::refuse(Some("Nothing to sell."));
        };
        self.tower.remove_transport(id);
        let refund = kind.resale_refund();
        self.money += refund;
        ChargeResult::done(refund)
    }
}

#[cfg(test)]
mod tests {
    //! The same cases as `src/engine/sim/charges.test.ts`.
    use super::*;
    use crate::clock::GameMode;
    use crate::facilities::{Kind, MAX_FLOOR};

    const C: i64 = 180;

    /// A lobby on floor 1 and plain floor on 2..=top across [C - 10, C + 10),
    /// laid with the raw tower edits so the money starts where the test sets it.
    fn tower(top: i64, money: f64) -> Simulation {
        let mut sim = Simulation::new_game(7, GameMode::Classic);
        for x in C - 10..C + 10 {
            assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        }
        for f in 2..=top {
            for x in C - 10..C + 10 {
                assert!(sim.tower.place(Kind::Floor, f, x).ok, "floor {f} @ {x}");
            }
        }
        sim.money = money;
        sim
    }

    fn elevator(sim: &mut Simulation, bottom: i64, top: i64) -> i64 {
        let r = sim
            .tower
            .place_transport(Kind::ElevatorStandard, C - 8, bottom, top);
        assert!(r.ok, "{:?}", r.reason);
        sim.tower.transport_at(bottom, C - 8).unwrap().id
    }

    fn office(sim: &mut Simulation, floor: i64) -> i64 {
        let r = sim.tower.place(Kind::Office, floor, C);
        assert!(r.ok, "{:?}", r.reason);
        sim.tower.unit_at(floor, C).unwrap().id
    }

    fn cars(sim: &Simulation, id: i64) -> i64 {
        sim.tower.get_transport(id).unwrap().cars
    }

    fn refused(reason: Option<&str>) -> ChargeResult {
        ChargeResult::refuse(reason)
    }

    #[test]
    fn add_car_charges_and_remove_car_refunds_half() {
        let mut sim = tower(4, 10_000_000.0);
        let t = elevator(&mut sim, 1, 2);
        assert_eq!(ADD_CAR_COST, 40_000.0);
        assert_eq!(car_resale_refund(), 20_000.0);
        assert_eq!(sim.add_car(t), ChargeResult::done(-40_000.0));
        assert_eq!(cars(&sim, t), 2);
        assert_eq!(sim.money, 9_960_000.0);
        assert_eq!(sim.remove_car(t), ChargeResult::done(20_000.0));
        assert_eq!(cars(&sim, t), 1);
        assert_eq!(sim.money, 9_980_000.0);
    }

    #[test]
    fn add_car_refuses_when_short_of_money() {
        let mut sim = tower(4, ADD_CAR_COST - 1.0);
        let t = elevator(&mut sim, 1, 2);
        assert_eq!(sim.add_car(t), refused(Some("Not enough money.")));
        assert_eq!(cars(&sim, t), 1);
        assert_eq!(sim.money, ADD_CAR_COST - 1.0);
        sim.money = ADD_CAR_COST;
        assert!(sim.add_car(t).ok);
        assert_eq!(sim.money, 0.0);
    }

    #[test]
    fn car_commands_refuse_at_the_limits() {
        let mut sim = tower(4, 10_000_000.0);
        let t = elevator(&mut sim, 1, 2);
        let max = Kind::ElevatorStandard.max_cars();
        sim.tower.set_cars(t, max);
        assert_eq!(
            sim.add_car(t),
            refused(Some(&format!("This elevator already runs {max} cars.")))
        );
        sim.tower.set_cars(t, 1);
        assert_eq!(
            sim.remove_car(t),
            refused(Some("An elevator keeps at least one car."))
        );
        assert_eq!(sim.add_car(9999), refused(Some("No such elevator.")));
        assert_eq!(sim.remove_car(9999), refused(Some("No such elevator.")));
        assert_eq!(sim.money, 10_000_000.0);
    }

    #[test]
    fn extend_charges_per_floor_and_shrinks_free() {
        let mut sim = tower(6, 10_000_000.0);
        let t = elevator(&mut sim, 1, 2);
        let r = sim.extend_transport(t, End::Up, 3, None);
        assert_eq!((r.ok, r.delta, r.added), (true, -TRANSPORT_FLOOR_COST, 1));
        assert_eq!(sim.tower.get_transport(t).unwrap().top, 3);
        let r = sim.extend_transport(t, End::Up, 2, None);
        assert_eq!((r.ok, r.added), (true, 0));
        assert!(r.delta == 0.0 && r.delta.is_sign_positive());
        assert_eq!(sim.money, 10_000_000.0 - TRANSPORT_FLOOR_COST);
    }

    #[test]
    fn extend_bills_a_drag_past_its_mark_only() {
        let mut sim = tower(6, 10_000_000.0);
        let t = elevator(&mut sim, 1, 2);
        assert_eq!(sim.extend_transport(t, End::Up, 5, Some((1, 2))).added, 3);
        assert_eq!(sim.extend_transport(t, End::Up, 3, Some((1, 5))).added, 0);
        assert_eq!(sim.extend_transport(t, End::Up, 5, Some((1, 5))).added, 0);
        assert_eq!(sim.extend_transport(t, End::Up, 6, Some((1, 5))).added, 1);
        assert_eq!(sim.money, 10_000_000.0 - 4.0 * TRANSPORT_FLOOR_COST);
    }

    #[test]
    fn extend_is_clamped_to_the_balance() {
        let mut sim = tower(6, 2.0 * TRANSPORT_FLOOR_COST + 1.0);
        let t = elevator(&mut sim, 1, 2);
        let r = sim.extend_transport(t, End::Up, 6, None);
        assert_eq!((r.ok, r.added), (true, 2));
        assert_eq!(sim.tower.get_transport(t).unwrap().top, 4);
        assert_eq!(sim.money, 1.0);
        assert_eq!(
            sim.extend_transport(t, End::Up, 5, None),
            refused(Some("Not enough money."))
        );
        sim.money = -50_000.0;
        assert_eq!(
            sim.extend_transport(t, End::Down, 0, Some((1, 4))),
            refused(Some("Not enough money."))
        );
        assert_eq!(sim.tower.get_transport(t).unwrap().bottom, 1);
    }

    #[test]
    fn extend_refuses_a_no_op_and_a_blocked_resize() {
        let mut sim = tower(3, 10_000_000.0);
        let t = elevator(&mut sim, 1, 2);
        assert_eq!(sim.extend_transport(t, End::Up, 2, None), refused(None));
        assert_eq!(
            sim.extend_transport(t, End::Up, MAX_FLOOR + 1, None),
            refused(Some("Outside the buildable range."))
        );
        assert_eq!(
            sim.extend_transport(9999, End::Up, 3, None),
            refused(Some("No such elevator."))
        );
        assert_eq!(sim.money, 10_000_000.0);
    }

    #[test]
    fn sell_refunds_half_a_unit_and_half_a_shaft() {
        let mut sim = tower(4, 10_000_000.0);
        let u = office(&mut sim, 2);
        let t = elevator(&mut sim, 1, 2);
        let office_refund = Kind::Office.resale_refund();
        let shaft_refund = Kind::ElevatorStandard.resale_refund();
        assert_eq!(sim.sell(u), ChargeResult::done(office_refund));
        assert!(sim.tower.get_unit(u).is_none());
        assert_eq!(sim.sell(t), ChargeResult::done(shaft_refund));
        assert!(sim.tower.get_transport(t).is_none());
        assert_eq!(sim.money, 10_000_000.0 + office_refund + shaft_refund);
    }

    #[test]
    fn sell_pays_nothing_for_a_gutted_shell() {
        let mut sim = tower(4, 10_000_000.0);
        let u = office(&mut sim, 2);
        sim.tower.get_unit_mut(u).unwrap().state = UnitState::Gutted;
        assert_eq!(sim.sell(u), ChargeResult::done(0.0));
        assert!(sim.tower.get_unit(u).is_none());
        assert_eq!(sim.money, 10_000_000.0);
    }

    #[test]
    fn sell_refuses_a_burning_unit_and_a_load_bearing_floor() {
        let mut sim = tower(3, 10_000_000.0);
        let u = office(&mut sim, 2);
        sim.tower.get_unit_mut(u).unwrap().state = UnitState::Fire;
        assert_eq!(
            sim.sell(u),
            refused(Some(
                "You can't remove a burning unit. Call fire rescue or let it burn out."
            ))
        );
        let floor2 = sim
            .tower
            .units
            .iter()
            .find(|x| x.kind == Kind::Floor && x.floor == 2 && x.x == C + 9)
            .unwrap()
            .id;
        let reason = sim.tower.removal_reason(floor2);
        assert!(reason.is_some());
        assert_eq!(sim.sell(floor2), refused(reason));
        assert!(sim.tower.get_unit(floor2).is_some());
        assert_eq!(sim.sell(9999), refused(Some("Nothing to sell.")));
        assert_eq!(sim.money, 10_000_000.0);
    }

    #[test]
    fn selling_the_last_wedding_hall_cancels_the_inspection() {
        let mut sim = Simulation::new_game(8, GameMode::Classic);
        let w = Kind::WeddingHall.facility().width;
        for x in C..C + w {
            assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        }
        for f in 2..=MAX_FLOOR {
            for x in C..C + w {
                assert!(sim.tower.place(Kind::Floor, f, x).ok);
            }
        }
        sim.money = 1e9;
        sim.star = 5;
        assert!(sim.build(Kind::WeddingHall, MAX_FLOOR, C).ok);
        assert!(sim.vip_visit_day >= 0.0);
        let hall = sim.tower.unit_at(MAX_FLOOR, C).unwrap().id;
        assert!(sim.sell(hall).ok);
        assert_eq!(sim.tower.built_wedding_hall, Some(false));
        assert_eq!(sim.vip_visit_day, -1.0);
    }

    #[test]
    fn sell_at_takes_the_same_path_for_a_room() {
        let mut a = tower(4, 10_000_000.0);
        let mut b = tower(4, 10_000_000.0);
        let ua = office(&mut a, 2);
        let ub = office(&mut b, 2);
        a.tower.get_unit_mut(ua).unwrap().state = UnitState::Gutted;
        b.tower.get_unit_mut(ub).unwrap().state = UnitState::Gutted;
        assert!(a.sell_at(2, C));
        assert!(b.sell(ub).ok);
        assert_eq!(a.serialize(), b.serialize());
    }
}
