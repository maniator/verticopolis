//! Undo against what time and the rest of the game do: cash that is not an
//! edit's stays out of a step, a room used since its step is not taken out,
//! and a step leaves no gesture, counter or id behind that a later edit
//! could reuse.
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

#[test]
fn a_treasure_found_by_a_build_stays_found_and_out_of_the_step() {
    for seed in 0..400 {
        let mut sim = tower();
        sim.rng = crate::rng::Rng::new(seed);
        let quote = sim.can_build(Kind::FastFood, 0, 30);
        assert!(quote.ok, "{:?}", quote.reason);
        let found = sim.treasures_found;
        let step = gesture(&mut sim, |s| assert!(s.build(Kind::FastFood, 0, 30).ok)).unwrap();
        if sim.treasures_found == found {
            continue;
        }
        assert_eq!(step.money, quote.cost, "the step carries the price alone");
        let rich = sim.money;
        sim.apply_undo_step(&step).unwrap();
        assert_eq!(
            sim.money,
            rich + quote.cost,
            "the gold stays with the player"
        );
        assert_eq!(
            sim.treasures_found,
            found + 1.0,
            "and the treasure stays found"
        );
        return;
    }
    panic!("no seed found a treasure");
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
        (UnitState::Occupied, StepRefused::InUse),
        (UnitState::Gutted, StepRefused::InUse),
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
    assert_eq!(sim.apply_undo_step(&step).unwrap_err(), StepRefused::InUse);
    let mut sim = tower();
    let (id, step) = built_office(&mut sim);
    sim.tower.get_unit_mut(id).unwrap().pending_income = 1.0;
    assert_eq!(sim.apply_undo_step(&step).unwrap_err(), StepRefused::InUse);
}

#[test]
fn a_room_that_only_finished_building_can_still_be_undone() {
    let mut sim = tower();
    let start = sim.money;
    let (id, step) = built_office(&mut sim);
    // No shaft reaches floor 2, so nobody moves in while it is built.
    sim.tick(60.0 * 24.0 * 2.0);
    assert_eq!(sim.tower.get_unit(id).unwrap().state, UnitState::Empty);
    let earned = sim.money - (start - Kind::Office.facility().cost);
    sim.apply_undo_step(&step).unwrap();
    assert!(sim.tower.get_unit(id).is_none());
    assert_eq!(sim.money, start + earned);
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
    assert_eq!(sim.apply_undo_step(&redo).unwrap_err(), StepRefused::InUse);
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
