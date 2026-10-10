//! Tests for `charges.rs`, mirroring `src/engine/sim/charges.test.ts`.
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
    assert_eq!(
        r.charge.reason.as_deref(),
        Some("Transport shafts cannot overlap.")
    );
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
fn sell_at_refuses_a_burning_room() {
    let (mut sim, office, _, _) = fixture();
    sim.tower.get_unit_mut(office).unwrap().state = UnitState::Fire;
    assert!(!sim.sell_at(2, 20));
    assert!(sim.tower.get_unit(office).is_some());
    assert_eq!(sim.money, 1_000_000.0);
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

#[test]
fn extend_bills_the_down_end_the_same_way() {
    let (mut sim, _, _, _) = fixture();
    let per = TRANSPORT_FLOOR_COST;
    assert!(sim.build_transport(Kind::ElevatorStandard, 14, 3, 4).ok);
    let shaft = sim.tower.transport_at(3, 14).unwrap().id;
    let start = sim.money;
    assert_eq!(
        sim.extend_transport(shaft, ExtendEnd::Down, 1, Some((3, 4))),
        extended(ChargeResult::paid(-2.0 * per), 1, 4, 2)
    );
    assert_eq!(
        sim.extend_transport(shaft, ExtendEnd::Down, 2, Some((1, 4))),
        extended(ChargeResult::paid(0.0), 2, 4, 0)
    );
    assert_eq!(
        sim.extend_transport(shaft, ExtendEnd::Down, 1, Some((1, 4))),
        extended(ChargeResult::paid(0.0), 1, 4, 0)
    );
    // A down target above the shaft shrinks it to one floor tall.
    assert_eq!(
        sim.extend_transport(shaft, ExtendEnd::Down, 6, None),
        extended(ChargeResult::paid(0.0), 3, 4, 0)
    );
    assert_eq!(sim.money, start - 2.0 * per);
    sim.money = per * 1.5;
    assert_eq!(
        sim.extend_transport(shaft, ExtendEnd::Down, 1, None),
        extended(ChargeResult::paid(-per), 2, 4, 1)
    );
    assert_eq!(
        sim.extend_transport(shaft, ExtendEnd::Down, 1, None),
        extended(refused(NOT_ENOUGH_MONEY), 2, 4, 0)
    );
}

/// `extendBill` vectors, the same answers `econConfig.ts` gives.
#[test]
fn extend_bill_matches_the_typescript_vectors() {
    let per = 5_000.0;
    // Up two floors past the mark with money for both.
    assert_eq!(
        extend_bill((1, 2), (1, 2), ExtendEnd::Up, 4, 1e6, per),
        (1, 4, 2)
    );
    // Up, budget for one: clamped to one past the mark.
    assert_eq!(
        extend_bill((1, 2), (1, 2), ExtendEnd::Up, 9, 7_500.0, per),
        (1, 3, 1)
    );
    // Up within the mark: free.
    assert_eq!(
        extend_bill((1, 3), (1, 5), ExtendEnd::Up, 5, 0.0, per),
        (1, 5, 0)
    );
    // A shrink target below the bottom stops one floor above it.
    assert_eq!(
        extend_bill((3, 6), (3, 6), ExtendEnd::Up, 1, 0.0, per),
        (3, 4, 0)
    );
    // Down, in debt: no new floor, and never a pull past the mark.
    assert_eq!(
        extend_bill((3, 6), (3, 6), ExtendEnd::Down, 1, -50_000.0, per),
        (3, 6, 0)
    );
    // Down past a mark that sits below the current bottom.
    assert_eq!(
        extend_bill((4, 6), (3, 6), ExtendEnd::Down, 1, 5_000.0, per),
        (2, 6, 1)
    );
    // A vast balance clamps to the request.
    assert_eq!(
        extend_bill((1, 2), (1, 2), ExtendEnd::Up, 50, 1e300, per),
        (1, 50, 48)
    );
}
