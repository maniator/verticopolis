//! Port of `src/engine/sim/charges.ts`: the engine-owned charges for the
//! editor and the bulldozer (#914). Adding and removing elevator cars, the
//! billed shaft extension, and the one player removal command that pays the
//! resale refund each check, move the tower and move the money in one step,
//! so a frontend relays the command and never writes money for them. The raw
//! `Tower::set_cars`, `Tower::resize_transport`, `Tower::remove_unit` and
//! `Tower::remove_transport` stay free of charge for loaders and tests.

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
    // The budget is a whole count of floors, and a floor count never reaches
    // past the grid, so the clamp below stays exact in i64.
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
mod tests {
    use super::*;
    use crate::clock::GameMode;
    use crate::facilities::MAX_FLOOR as GRID_MAX_FLOOR;

    /// The `charges.test.ts` fixture: a lobby, floors 2..4, an office on 2,
    /// an elevator on 1..2 and stairs, every placement asserted.
    fn fixture() -> (Simulation, i64, i64, i64) {
        let mut sim = Simulation::new_game(1, GameMode::Classic);
        for x in 10..40 {
            assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        }
        for fl in 2..=4 {
            for x in 10..40 {
                assert!(sim.tower.place(Kind::Floor, fl, x).ok);
            }
        }
        let office = sim.tower.place(Kind::Office, 2, 20).unit_id.unwrap();
        assert!(sim.build_transport(Kind::ElevatorStandard, 10, 1, 2).ok);
        let lift = sim.tower.transport_at(1, 10).unwrap().id;
        assert!(sim.build_transport(Kind::Stairs, 30, 1, 2).ok);
        let stairs = sim.tower.transport_at(1, 30).unwrap().id;
        sim.money = 1_000_000.0;
        (sim, office, lift, stairs)
    }

    fn cars(sim: &Simulation, id: i64) -> i64 {
        sim.tower.get_transport(id).unwrap().cars
    }

    fn refused(reason: &str) -> ChargeResult {
        ChargeResult::refuse(reason)
    }

    #[test]
    fn add_car_charges_and_remove_car_refunds_half() {
        let (mut sim, _, lift, _) = fixture();
        assert_eq!(sim.add_car(lift), ChargeResult::paid(-ADD_CAR_COST));
        assert_eq!(cars(&sim, lift), 2);
        assert_eq!(sim.remove_car(lift), ChargeResult::paid(20_000.0));
        assert_eq!(cars(&sim, lift), 1);
        assert_eq!(sim.money, 1_000_000.0 - 40_000.0 + 20_000.0);
    }

    #[test]
    fn add_car_refuses_when_short_and_at_the_limit() {
        let (mut sim, _, lift, _) = fixture();
        sim.money = ADD_CAR_COST - 1.0;
        assert_eq!(sim.add_car(lift), refused(NOT_ENOUGH_MONEY));
        assert_eq!(cars(&sim, lift), 1);
        assert_eq!(sim.money, ADD_CAR_COST - 1.0);
        sim.money = ADD_CAR_COST;
        assert!(sim.add_car(lift).ok);
        assert_eq!(sim.money, 0.0);
        assert!(sim.tower.set_cars(lift, 8));
        assert_eq!(sim.add_car(lift), refused(CAR_LIMIT));
    }

    #[test]
    fn car_commands_refuse_the_last_car_a_missing_shaft_and_stairs() {
        let (mut sim, _, lift, stairs) = fixture();
        assert_eq!(sim.remove_car(lift), refused(LAST_CAR));
        assert_eq!(sim.add_car(99_999), refused(ELEVATOR_GONE));
        assert_eq!(sim.remove_car(99_999), refused(ELEVATOR_GONE));
        assert_eq!(sim.add_car(stairs), refused(ONLY_ELEVATOR_CARS));
        assert_eq!(sim.remove_car(stairs), refused(ONLY_ELEVATOR_CARS));
        assert_eq!(sim.money, 1_000_000.0);
    }

    fn extended(charge: ChargeResult, bottom: i64, top: i64, added: i64) -> ExtendResult {
        ExtendResult {
            charge,
            bottom,
            top,
            added,
        }
    }

    #[test]
    fn extend_bills_per_floor_past_the_mark_and_shrinks_free() {
        let (mut sim, _, lift, _) = fixture();
        let per = TRANSPORT_FLOOR_COST;
        assert_eq!(
            sim.extend_transport(lift, ExtendEnd::Up, 3, None),
            extended(ChargeResult::paid(-per), 1, 3, 1)
        );
        assert_eq!(
            sim.extend_transport(lift, ExtendEnd::Up, 2, None),
            extended(ChargeResult::paid(0.0), 1, 2, 0)
        );
        // A drag: two floors past the mark, back down free, regrow free.
        assert_eq!(
            sim.extend_transport(lift, ExtendEnd::Up, 4, Some((1, 2)))
                .added,
            2
        );
        assert_eq!(
            sim.extend_transport(lift, ExtendEnd::Up, 3, Some((1, 4))),
            extended(ChargeResult::paid(0.0), 1, 3, 0)
        );
        assert_eq!(
            sim.extend_transport(lift, ExtendEnd::Up, 4, Some((1, 4))),
            extended(ChargeResult::paid(0.0), 1, 4, 0)
        );
        assert_eq!(sim.money, 1_000_000.0 - 3.0 * per);
    }

    #[test]
    fn extend_never_rebills_a_standing_floor() {
        let (mut sim, _, lift, _) = fixture();
        assert_eq!(
            sim.extend_transport(lift, ExtendEnd::Up, 3, Some((1, 1))),
            extended(ChargeResult::paid(-TRANSPORT_FLOOR_COST), 1, 3, 1)
        );
    }

    #[test]
    fn extend_grows_as_far_as_the_budget_pays_then_refuses() {
        let (mut sim, _, lift, _) = fixture();
        let per = TRANSPORT_FLOOR_COST;
        sim.money = per * 1.5;
        assert_eq!(
            sim.extend_transport(lift, ExtendEnd::Up, 4, None),
            extended(ChargeResult::paid(-per), 1, 3, 1)
        );
        assert_eq!(
            sim.extend_transport(lift, ExtendEnd::Up, 4, None),
            extended(refused(NOT_ENOUGH_MONEY), 1, 3, 0)
        );
        sim.money = -10_000.0;
        assert_eq!(
            sim.extend_transport(lift, ExtendEnd::Up, 4, None),
            extended(refused(NOT_ENOUGH_MONEY), 1, 3, 0)
        );
        assert_eq!(sim.tower.get_transport(lift).unwrap().top, 3);
    }

    #[test]
    fn extend_refuses_with_the_towers_reason_and_charges_nothing() {
        let (mut sim, _, lift, stairs) = fixture();
        assert!(sim.build_transport(Kind::ElevatorStandard, 10, 3, 4).ok);
        let money = sim.money;
        let r = sim.extend_transport(lift, ExtendEnd::Up, 3, None);
        assert!(!r.charge.ok);
        assert!(r.charge.reason.is_some());
        assert_eq!((r.charge.delta, r.bottom, r.top, r.added), (0.0, 1, 2, 0));
        assert_eq!(sim.money, money);
        assert_eq!(
            sim.extend_transport(stairs, ExtendEnd::Up, 3, None),
            extended(refused(ONLY_ELEVATOR_EXTEND), 1, 2, 0)
        );
        assert_eq!(
            sim.extend_transport(99_999, ExtendEnd::Down, 0, None),
            extended(refused(ELEVATOR_GONE), 0, 0, 0)
        );
    }

    #[test]
    fn remove_facility_refunds_half_and_nothing_for_a_gutted_unit() {
        let (mut sim, office, lift, _) = fixture();
        assert_eq!(
            sim.remove_facility(lift, RemovalMethod::Bulldoze),
            ChargeResult::paid(Kind::ElevatorStandard.resale_refund())
        );
        assert!(sim.tower.get_transport(lift).is_none());
        sim.tower.get_unit_mut(office).unwrap().state = UnitState::Gutted;
        assert_eq!(
            sim.remove_facility(office, RemovalMethod::Sell),
            ChargeResult::paid(0.0)
        );
        assert!(sim.tower.get_unit(office).is_none());
        assert_eq!(
            sim.money,
            1_000_000.0 + Kind::ElevatorStandard.resale_refund()
        );
    }

    #[test]
    fn remove_facility_pays_an_intact_unit() {
        let (mut sim, office, _, _) = fixture();
        assert_eq!(
            sim.remove_facility(office, RemovalMethod::Sell),
            ChargeResult::paid(Kind::Office.resale_refund())
        );
    }

    #[test]
    fn remove_facility_refusals() {
        let (mut sim, office, _, _) = fixture();
        sim.tower.get_unit_mut(office).unwrap().state = UnitState::Fire;
        assert_eq!(
            sim.remove_facility(office, RemovalMethod::Bulldoze),
            refused("You can't bulldoze a burning unit. Call fire rescue or let it burn out.")
        );
        assert_eq!(
            sim.remove_facility(office, RemovalMethod::Sell)
                .reason
                .as_deref(),
            Some("You can't sell a burning unit. Call fire rescue or let it burn out.")
        );
        let lobby = sim.tower.unit_at(1, 20).unwrap().id;
        assert_eq!(
            sim.remove_facility(lobby, RemovalMethod::Bulldoze),
            refused("Lobby tiles are permanent. The 1994 game does not let you remove them.")
        );
        let floor3 = sim
            .tower
            .units
            .iter()
            .find(|u| u.kind == Kind::Floor && u.floor == 3 && u.x == 15)
            .unwrap()
            .id;
        assert_eq!(
            sim.remove_facility(floor3, RemovalMethod::Sell),
            refused("Remove the story above first. Floors can't hang in midair.")
        );
        assert_eq!(
            sim.remove_facility(99_999, RemovalMethod::Sell),
            refused(FACILITY_GONE)
        );
        assert_eq!(sim.money, 1_000_000.0);
    }

    #[test]
    fn remove_facility_cancels_the_vip_with_the_last_wedding_hall() {
        let (mut sim, _, _, _) = fixture();
        sim.star = 5;
        sim.money = 10_000_000.0;
        for fl in 5..=GRID_MAX_FLOOR {
            for x in 10..26 {
                assert!(sim.tower.place(Kind::Floor, fl, x).ok);
            }
        }
        assert!(sim.build(Kind::WeddingHall, GRID_MAX_FLOOR, 10).ok);
        assert!(sim.vip_visit_day > 0.0);
        let hall = sim.tower.unit_at(GRID_MAX_FLOOR, 10).unwrap().id;
        assert!(sim.remove_facility(hall, RemovalMethod::Sell).ok);
        assert_eq!(sim.vip_visit_day, -1.0);
    }

    #[test]
    fn sell_at_pays_through_remove_facility() {
        let (mut sim, office, _, stairs) = fixture();
        sim.tower.get_unit_mut(office).unwrap().state = UnitState::Gutted;
        assert!(sim.sell_at(2, 20));
        assert_eq!(sim.money, 1_000_000.0);
        assert!(sim.sell_at(1, 30));
        assert!(sim.tower.get_transport(stairs).is_none());
        assert_eq!(sim.money, 1_000_000.0 + Kind::Stairs.resale_refund());
        assert!(!sim.sell_at(1, 20));
    }

    #[test]
    fn parsers_round_trip() {
        assert_eq!(ExtendEnd::parse("up"), Some(ExtendEnd::Up));
        assert_eq!(ExtendEnd::parse("down"), Some(ExtendEnd::Down));
        assert_eq!(ExtendEnd::parse("left"), None);
        for m in [RemovalMethod::Sell, RemovalMethod::Bulldoze] {
            assert_eq!(RemovalMethod::parse(m.as_str()), Some(m));
        }
        assert_eq!(RemovalMethod::parse("burn"), None);
    }
}
