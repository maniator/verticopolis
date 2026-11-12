//! What counts as use for an undo: a room the edit built is in use once it
//! opens, and a shaft once anyone rides it. A step that would take a used
//! build back at its full price is refused, whatever a move-out or a
//! collection reset since. A sale undone and done again does not mind any
//! of it, as a sale does not.
use super::check_tests::{lift, meanwhile, refused, sell};
use super::tests::{gesture, office, tower, tower_in};
use super::StepRefused;
use crate::charges::ExtendEnd;
use crate::clock::GameMode;
use crate::crowd::spawn::make_person;
use crate::crowd::{motion, ElevatorCalls, PState, Route};
use crate::facilities::Kind;
use crate::rule_tests::stocked_services::{lay_basement, stock_parking_within, stock_recycling};
use crate::sim::Simulation;
use crate::tower::UnitState;
use crate::undo::Step;

/// Build a room of `kind` on floor 2 at x 12 as one gesture: its id and
/// the step.
fn built(sim: &mut Simulation, kind: Kind) -> (i64, Step) {
    let mut id = 0;
    let step = gesture(sim, |s| {
        let r = s.build(kind, 2, 12);
        assert!(r.ok, "{:?}", r.reason);
        id = s.tower.unit_at(2, 12).unwrap().id;
    })
    .unwrap();
    (id, step)
}

/// Run the clock until `kind`, built just now, has opened. No shaft
/// reaches floor 2 of the test tower, so nobody moves in.
fn until_open(sim: &mut Simulation, kind: Kind) {
    sim.tick(kind.build_minutes() + 30.0);
}

#[test]
fn a_room_the_edit_built_can_be_undone_until_it_opens() {
    let mut sim = tower();
    let (id, step) = built(&mut sim, Kind::Office);
    sim.tick(Kind::Office.build_minutes() / 2.0);
    let u = sim.tower.get_unit(id).unwrap();
    assert_eq!(u.state, UnitState::Construction, "still being built");
    let before = sim.money;
    sim.apply_undo_step(&step).unwrap();
    assert!(sim.tower.get_unit(id).is_none());
    assert_eq!(sim.money, before + Kind::Office.facility().cost);

    let mut sim = tower();
    let (id, step) = built(&mut sim, Kind::Office);
    until_open(&mut sim, Kind::Office);
    let u = sim.tower.get_unit(id).unwrap();
    assert_eq!((u.state, u.occupants), (UnitState::Empty, 0), "open, empty");
    refused(&mut sim, &step, StepRefused::Opened { sellable: true });
}

#[test]
fn a_room_that_earned_and_emptied_again_is_still_not_undone() {
    let mut sim = tower();
    let (id, step) = built(&mut sim, Kind::Office);
    until_open(&mut sim, Kind::Office);
    {
        let u = sim.tower.get_unit_mut(id).unwrap();
        u.state = UnitState::Occupied;
        u.occupants = 6;
        u.ever_occupied = true;
        u.pending_income = 500.0;
    }
    refused(&mut sim, &step, StepRefused::InUse { sellable: true });
    // The tenant leaves and the rent is collected: the move-out puts the
    // state, the people and the flag back as they were built, and the
    // collection empties the income. The room has still been in use.
    {
        let u = sim.tower.get_unit_mut(id).unwrap();
        u.state = UnitState::Empty;
        u.occupants = 0;
        u.ever_occupied = false;
        u.pending_income = 0.0;
    }
    refused(&mut sim, &step, StepRefused::Opened { sellable: true });
}

#[test]
fn a_room_that_takes_no_tenants_is_in_use_once_it_opens() {
    assert_eq!(Kind::Security.facility().population, 0);
    let mut sim = tower();
    let (_, step) = built(&mut sim, Kind::Security);
    until_open(&mut sim, Kind::Security);
    refused(&mut sim, &step, StepRefused::Opened { sellable: true });
}

#[test]
fn a_classic_room_that_stays_for_good_is_undone_only_before_it_opens() {
    assert!(GameMode::Classic.room_is_permanent(Kind::Security));
    let mut sim = tower_in(GameMode::Classic);
    let (id, step) = built(&mut sim, Kind::Security);
    sim.apply_undo_step(&step).unwrap();
    assert!(
        sim.tower.get_unit(id).is_none(),
        "a misplaced build, caught"
    );

    let mut sim = tower_in(GameMode::Classic);
    let (id, step) = built(&mut sim, Kind::Security);
    until_open(&mut sim, Kind::Security);
    refused(&mut sim, &step, StepRefused::Opened { sellable: false });
    assert!(sim.tower.get_unit(id).is_some(), "it stays for good");
    // Unless a fire guts it: the shell can be cleared.
    sim.tower.get_unit_mut(id).unwrap().state = UnitState::Gutted;
    refused(&mut sim, &step, StepRefused::InUse { sellable: true });
}

#[test]
fn a_sale_done_again_does_not_mind_that_the_room_opened() {
    let mut sim = tower();
    let id = office(&mut sim, 2, 12);
    let start = sim.money;
    let sale = gesture(&mut sim, |s| sell(s, id)).unwrap();
    let refund = sim.money - start;
    let redo = sim.apply_undo_step(&sale).unwrap();
    until_open(&mut sim, Kind::Office);
    assert_eq!(sim.tower.get_unit(id).unwrap().state, UnitState::Empty);
    let before = sim.money;
    sim.apply_undo_step(&redo).unwrap();
    assert!(sim.tower.get_unit(id).is_none());
    assert_eq!(sim.money, before + refund, "half back, as a sale pays");
}

#[test]
fn a_shaft_ridden_since_its_build_is_not_undone() {
    let mut sim = tower();
    let mut id = 0;
    let step = gesture(&mut sim, |s| id = lift(s)).unwrap();
    sim.tower.note_ride(id);
    refused(&mut sim, &step, StepRefused::ShaftUsed);

    // A ride while the gesture is still open is use too.
    let mut sim = tower();
    let step = gesture(&mut sim, |s| {
        id = lift(s);
        meanwhile(s, |s| s.tower.note_ride(id));
    })
    .unwrap();
    refused(&mut sim, &step, StepRefused::ShaftUsed);

    // Nobody has gotten on: the price comes back.
    let mut sim = tower();
    let before = sim.money;
    let step = gesture(&mut sim, |s| id = lift(s)).unwrap();
    sim.apply_undo_step(&step).unwrap();
    assert_eq!(sim.money, before);
}

#[test]
fn cars_and_floors_bought_for_a_shaft_stay_once_it_is_ridden() {
    let mut sim = tower();
    let id = lift(&mut sim);
    let car = gesture(&mut sim, |s| assert!(s.add_car(id).ok)).unwrap();
    sim.tower.note_ride(id);
    refused(&mut sim, &car, StepRefused::ShaftUsed);

    // A ride while the car's gesture is still open is use too.
    let mut sim = tower();
    let id = lift(&mut sim);
    let car = gesture(&mut sim, |s| {
        assert!(s.add_car(id).ok);
        meanwhile(s, |s| s.tower.note_ride(id));
    })
    .unwrap();
    refused(&mut sim, &car, StepRefused::ShaftUsed);

    let mut sim = tower();
    let id = lift(&mut sim);
    assert!(sim.begin_extend(id));
    let floors = gesture(&mut sim, |s| {
        assert_eq!(s.extend_transport(id, ExtendEnd::Up, 4).added, 1)
    })
    .unwrap();
    sim.tower.note_ride(id);
    refused(&mut sim, &floors, StepRefused::ShaftUsed);

    let mut sim = tower();
    let id = lift(&mut sim);
    let before = sim.money;
    let car = gesture(&mut sim, |s| assert!(s.add_car(id).ok)).unwrap();
    let redo = sim.apply_undo_step(&car).unwrap();
    assert_eq!(sim.money, before, "unridden, the car's price comes back");
    // Bought again by a redo, and unridden since, it goes back again.
    let undo = sim.apply_undo_step(&redo).unwrap();
    sim.apply_undo_step(&undo).unwrap();
    assert_eq!(sim.money, before, "and again");
}

#[test]
fn undoing_a_later_edit_of_the_shaft_keeps_the_rides_a_car_had() {
    let mut sim = tower();
    let id = lift(&mut sim);
    let car = gesture(&mut sim, |s| assert!(s.add_car(id).ok)).unwrap();
    let stop = gesture(&mut sim, |s| assert!(s.tower.set_stop(id, 2, false))).unwrap();
    sim.tower.note_ride(id);
    sim.apply_undo_step(&stop)
        .expect("a stop takes nothing back");
    assert_eq!(sim.tower.get_transport(id).unwrap().rides, 1);
    refused(&mut sim, &car, StepRefused::ShaftUsed);
}

#[test]
fn a_shaft_sale_done_again_does_not_mind_the_rides() {
    let mut sim = tower();
    let id = lift(&mut sim);
    let sale = gesture(&mut sim, |s| sell(s, id)).unwrap();
    let redo = sim.apply_undo_step(&sale).unwrap();
    sim.tower.note_ride(id);
    sim.apply_undo_step(&redo).unwrap();
    assert!(sim.tower.get_transport(id).is_none());

    let mut sim = tower();
    let id = lift(&mut sim);
    assert!(sim.add_car(id).ok);
    let sold_car = gesture(&mut sim, |s| assert!(s.remove_car(id).ok)).unwrap();
    let redo = sim.apply_undo_step(&sold_car).unwrap();
    sim.tower.note_ride(id);
    sim.apply_undo_step(&redo).unwrap();
}

/// A new tower with a lobby row on floor 1, floors 2 to 4 over it, a
/// shaft of `kind` from floor 1 to `top` at x 12, and offices on `top` it
/// alone reaches. Answers the shaft's rides after three days.
fn rides_after_three_days(kind: Kind, top: i64) -> u64 {
    let mut sim = Simulation::new_game(3, GameMode::Modern);
    sim.money = 1e9;
    sim.star = 5;
    for x in 10..60 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        for floor in 2..=4 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    assert!(sim.build_transport(kind, 12, 1, top).ok);
    let id = sim.tower.transport_at(1, 12).unwrap().id;
    // The offices need their parking and recycling at five stars.
    lay_basement(&mut sim, -3);
    stock_parking_within(&mut sim, 30, 0, 10, 60);
    stock_recycling(&mut sim, -3, 10, 1);
    for x in [20, 30, 40] {
        assert!(sim.build(Kind::Office, top, x).ok);
    }
    sim.tick(60.0 * 24.0 * 3.0);
    sim.tower.get_transport(id).unwrap().rides
}

#[test]
fn riders_and_walkers_count_on_the_shaft_they_use() {
    assert!(
        rides_after_three_days(Kind::ElevatorStandard, 4) > 0,
        "riders"
    );
    assert!(rides_after_three_days(Kind::Stairs, 2) > 0, "walkers");
    assert!(rides_after_three_days(Kind::Escalator, 2) > 0, "walkers");
}

/// The dispatch's riders, with nobody in the crowd: the people in an office
/// the shaft serves fill its halls, and the car that takes them on is
/// ridden.
#[test]
fn the_dispatch_counts_the_riders_it_takes_on() {
    let mut sim = tower();
    let id = lift(&mut sim);
    assert!(sim.build(Kind::Office, 3, 30).ok);
    let office = sim.tower.unit_at(3, 30).unwrap().id;
    sim.tower.get_unit_mut(office).unwrap().occupants = 6;
    let calls = ElevatorCalls::default();
    for _ in 0..100 {
        sim.elevators.accumulate(&sim.tower, 2.5, 1.0);
        sim.elevators
            .move_cars(&mut sim.tower, 2.5, &calls, 9, false);
    }
    assert!(sim.crowd.people.is_empty());
    assert!(sim.tower.get_transport(id).unwrap().rides > 0);
}

/// A rider in the crowd, with the dispatch standing still: a person waiting
/// on floor 1, where the car stands, gets on and rides it.
#[test]
fn the_crowd_counts_the_riders_who_get_on() {
    let mut sim = tower();
    let id = lift(&mut sim);
    let route = Route {
        floors: vec![1, 3],
        shafts: vec![id],
    };
    let i = make_person(&mut sim.crowd, &sim.tower, route, 30.0, None);
    let p = &mut sim.crowd.people[i];
    (p.state, p.x) = (PState::Waiting, 16.0);
    motion::advance(&mut sim.crowd, 0.1, &mut sim.tower);
    assert_eq!(sim.crowd.people[i].state, PState::Riding);
    assert_eq!(sim.tower.get_transport(id).unwrap().rides, 1);
}
