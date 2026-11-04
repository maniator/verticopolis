//! Undo against what time and the rest of the game do: cash that is not an
//! edit's stays out of a step, a room used since its step is not taken out,
//! a dig's luck is never undone, and a step leaves no gesture, counter or id
//! behind that a later edit could reuse.
use super::tests::{gesture, office, tower};
use super::StepRefused;
use crate::charges::{ExtendEnd, TRANSPORT_FLOOR_COST};
use crate::facilities::Kind;
use crate::gameplay::RemovalMethod;
use crate::sim::Simulation;
use crate::tower::UnitState;

#[test]
fn a_payment_that_is_not_an_edit_is_no_part_of_the_step() {
    let mut sim = tower();
    assert!(sim.build(Kind::HotelSingle, 3, 40).ok);
    let room = sim.tower.unit_at(3, 40).unwrap().id;
    sim.tower.get_unit_mut(room).unwrap().state = UnitState::Infested;
    let start = sim.money;
    let step = gesture(&mut sim, |s| {
        let _ = office(s, 2, 12);
        let (fee, rooms) = s.call_exterminator().expect("the exterminator comes");
        assert!(fee > 0.0 && rooms == 1);
        // A ransom paid while the drag is open, outside every edit command.
        s.money -= 300_000.0;
    })
    .unwrap();
    let price = Kind::Office.facility().cost;
    assert_eq!(step.money, price, "only the office's price");
    let before_undo = sim.money;
    sim.apply_undo_step(&step).unwrap();
    assert_eq!(sim.money, before_undo + price);
    assert!(sim.money < start, "the fee and the ransom stay paid");
}

/// Build fast food on floor 0 at `x` as one gesture: the step, and whether
/// the dig found treasure.
fn dig(sim: &mut Simulation, x: i64) -> (crate::undo::Step, bool) {
    let found = sim.treasures_found;
    let step = gesture(sim, |s| assert!(s.build(Kind::FastFood, 0, x).ok)).unwrap();
    (step, sim.treasures_found > found)
}

#[test]
fn a_build_whose_dig_searched_for_treasure_is_never_undone() {
    // The dig stays dug and its luck stays drawn, so an undo would make
    // every search free: kept the room when it hit, handed back the price
    // when it missed. Hit or miss, the build stays.
    let (mut hit, mut miss) = (false, false);
    for seed in 0..400 {
        let mut sim = tower();
        sim.rng = crate::rng::Rng::new(seed);
        let (step, found) = dig(&mut sim, 30);
        assert!(step.searched_for_treasure);
        let before = (sim.save_text(), sim.money);
        let why = sim.apply_undo_step(&step).unwrap_err();
        assert_eq!(why, StepRefused::SearchedForTreasure { sellable: true });
        assert_eq!((sim.save_text(), sim.money), before, "nothing changed");
        hit |= found;
        miss |= !found;
        if hit && miss {
            break;
        }
    }
    assert!(hit && miss, "the seeds hit and missed");

    // Ground dug before, or a tower whose three treasures are all found,
    // holds no luck: the build undoes.
    let mut sim = tower();
    sim.treasures_found = 3.0;
    let (step, _) = dig(&mut sim, 30);
    sim.apply_undo_step(&step).unwrap();
    let mut sim = tower();
    let (_, _) = dig(&mut sim, 30);
    let id = sim.tower.unit_at(0, 30).unwrap().id;
    assert!(sim.remove_facility(id, RemovalMethod::Sell).ok);
    let (step, found) = dig(&mut sim, 30);
    assert!(!found && !step.searched_for_treasure, "the same dug ground");
    sim.apply_undo_step(&step).unwrap();
}

/// A room a gesture built, and that gesture's step.
fn built_office(sim: &mut Simulation) -> (i64, crate::undo::Step) {
    let mut id = 0;
    let step = gesture(sim, |s| id = office(s, 2, 12)).unwrap();
    (id, step)
}

#[test]
fn a_room_used_since_its_build_is_not_taken_out_by_an_undo() {
    for (state, why) in [
        (UnitState::Occupied, StepRefused::InUse { sellable: true }),
        (UnitState::Gutted, StepRefused::InUse { sellable: true }),
        (UnitState::Fire, StepRefused::OnFire),
    ] {
        let mut sim = tower();
        let (id, step) = built_office(&mut sim);
        sim.tower.get_unit_mut(id).unwrap().state = state;
        let before = (sim.save_text(), sim.money);
        assert_eq!(sim.apply_undo_step(&step).unwrap_err(), why, "{state:?}");
        assert_eq!((sim.save_text(), sim.money), before, "nothing changed");
    }
    // A tenant who moved in and out again still used it, and so did income.
    let mut sim = tower();
    let (id, step) = built_office(&mut sim);
    sim.tower.get_unit_mut(id).unwrap().ever_occupied = true;
    assert_eq!(
        sim.apply_undo_step(&step).unwrap_err(),
        StepRefused::InUse { sellable: true }
    );
    let mut sim = tower();
    let (id, step) = built_office(&mut sim);
    sim.tower.get_unit_mut(id).unwrap().pending_income = 1.0;
    assert_eq!(
        sim.apply_undo_step(&step).unwrap_err(),
        StepRefused::InUse { sellable: true }
    );
}

#[test]
fn a_sale_undone_and_redone_at_once_works_on_an_occupied_room() {
    let mut sim = tower();
    let id = office(&mut sim, 2, 12);
    {
        let u = sim.tower.get_unit_mut(id).unwrap();
        u.state = UnitState::Occupied;
        u.occupants = 6;
        u.ever_occupied = true;
    }
    let sale = gesture(&mut sim, |s| {
        assert!(s.remove_facility(id, RemovalMethod::Sell).ok)
    })
    .unwrap();
    let redo = sim.apply_undo_step(&sale).unwrap();
    assert_eq!(sim.tower.get_unit(id).unwrap().occupants, 6);
    let undo = sim.apply_undo_step(&redo).expect("nothing moved since");
    let redo = sim.apply_undo_step(&undo).unwrap();
    // Time moves the tenants on: the redo would sell a room that changed.
    sim.tower.get_unit_mut(id).unwrap().occupants = 5;
    assert_eq!(
        sim.apply_undo_step(&redo).unwrap_err(),
        StepRefused::UseChanged
    );
    assert!(sim.tower.get_unit(id).is_some());
}

#[test]
fn an_undo_ends_the_extend_gesture_so_floors_are_billed_again() {
    let mut sim = tower();
    assert!(sim.build_transport(Kind::ElevatorStandard, 15, 1, 2).ok);
    let lift = sim.tower.transport_at(1, 15).unwrap().id;
    assert!(sim.begin_extend(lift));
    let step = gesture(&mut sim, |s| {
        let r = s.extend_transport(lift, ExtendEnd::Up, 4);
        assert_eq!(r.added, 2);
    })
    .unwrap();
    assert_eq!(step.money, 2.0 * TRANSPORT_FLOOR_COST);
    sim.apply_undo_step(&step).unwrap();
    let before = sim.money;
    let r = sim.extend_transport(lift, ExtendEnd::Up, 4);
    assert_eq!(r.added, 2);
    assert_eq!(
        sim.money,
        before - 2.0 * TRANSPORT_FLOOR_COST,
        "the floors cost again"
    );
}

#[test]
fn a_redone_sky_lobby_keeps_its_express_stop() {
    let mut sim = tower();
    for x in 70..120 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        for floor in 2..=20 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    let r = sim.build_transport(Kind::ElevatorExpress, 75, 1, 20);
    assert!(r.ok, "{:?}", r.reason);
    let express = sim.tower.transport_at(1, 75).unwrap().id;
    let stops_at_15 = |sim: &Simulation| {
        let t = sim.tower.get_transport(express).unwrap();
        !t.skip_floors.as_ref().is_some_and(|s| s.contains(&15.0))
    };
    assert!(!stops_at_15(&sim), "no lobby on 15 yet");
    let step = gesture(&mut sim, |s| {
        let r = s.build(Kind::Lobby, 15, 90);
        assert!(r.ok, "{:?}", r.reason);
    })
    .unwrap();
    assert!(stops_at_15(&sim), "the sky lobby is a stop");
    let redo = sim.apply_undo_step(&step).unwrap();
    assert!(!stops_at_15(&sim));
    sim.apply_undo_step(&redo).unwrap();
    assert!(stops_at_15(&sim), "the redo brings the stop back with it");
}

#[test]
fn a_returned_room_starts_with_nobody_inside_it() {
    let mut sim = tower();
    let r = sim.build(Kind::Cinema, 3, 12);
    assert!(r.ok, "{:?}", r.reason);
    let cinema = sim.tower.unit_at(3, 12).unwrap().id;
    {
        let u = sim.tower.get_unit_mut(cinema).unwrap();
        u.customers_in = Some(7);
        u.hotel_customers_in = Some(3);
        u.out_for_meal = Some(2);
        u.occupants = 7;
    }
    let sale = gesture(&mut sim, |s| {
        assert!(s.remove_facility(cinema, RemovalMethod::Sell).ok)
    })
    .unwrap();
    sim.apply_undo_step(&sale).unwrap();
    let u = sim.tower.get_unit(cinema).unwrap();
    assert_eq!(
        (u.customers_in, u.hotel_customers_in, u.out_for_meal),
        (None, None, None),
        "the people inside left with the sale"
    );
    if Kind::Cinema.attendance_cap().is_some() {
        assert_eq!(u.occupants, 0, "attendance is read again from them");
    }
}

#[test]
fn an_id_is_never_handed_out_twice() {
    let mut sim = tower();
    let (first, step) = built_office(&mut sim);
    sim.apply_undo_step(&step).unwrap();
    let second = office(&mut sim, 3, 30);
    assert_ne!(first, second, "the undone room's id stays its own");
}

#[test]
fn a_whole_row_comes_back_in_place_in_one_step() {
    let mut sim = tower();
    let ids: Vec<i64> = (10..70)
        .step_by(2)
        .map(|x| sim.tower.unit_at(4, x).unwrap().id)
        .collect();
    let order = |sim: &Simulation| sim.tower.units.iter().map(|u| u.id).collect::<Vec<_>>();
    let before = order(&sim);
    let step = gesture(&mut sim, |s| {
        for &id in &ids {
            assert!(s.remove_facility(id, RemovalMethod::Sell).ok);
        }
    })
    .unwrap();
    sim.apply_undo_step(&step).unwrap();
    assert_eq!(order(&sim), before, "every tile back at its own index");
    for (i, u) in sim.tower.units.iter().enumerate() {
        assert_eq!(sim.tower.by_id[&u.id], i, "and indexed there");
    }
}
