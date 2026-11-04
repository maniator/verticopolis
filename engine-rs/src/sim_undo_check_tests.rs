//! A step against a tower it does not expect: an edit made with no gesture
//! open, a room used while its gesture was still open, and a sold condo's
//! price. Each refusal changes nothing, so no cash moves for an edit that is
//! not there to reverse. A unit or shaft time moved on while its gesture
//! was open goes back as it left.
use super::tests::{gesture, office, tower};
use super::StepRefused;
use crate::facilities::Kind;
use crate::gameplay::RemovalMethod;
use crate::sim::Simulation;
use crate::tower::UnitState;
use crate::undo::Step;

/// Apply `step` and check it was refused for `why` and changed nothing.
#[track_caller]
pub(super) fn refused(sim: &mut Simulation, step: &Step, why: StepRefused) {
    let before = (sim.save_text(), sim.money);
    assert_eq!(sim.apply_undo_step(step).unwrap_err(), why);
    assert_eq!((sim.save_text(), sim.money), before, "nothing changed");
}

pub(super) fn sell(sim: &mut Simulation, id: i64) {
    assert!(sim.remove_facility(id, RemovalMethod::Sell).ok);
}

/// What time does to a room while a gesture is open: the journal is off
/// the tower while the simulation advances.
pub(super) fn meanwhile(sim: &mut Simulation, f: impl FnOnce(&mut Simulation)) {
    let paused = sim.pause_undo_journal();
    f(sim);
    sim.resume_undo_journal(paused);
}

#[test]
fn undoing_a_build_whose_room_was_sold_outside_every_gesture_is_refused() {
    let mut sim = tower();
    let mut id = 0;
    let step = gesture(&mut sim, |s| id = office(s, 2, 12)).unwrap();
    sell(&mut sim, id);
    refused(&mut sim, &step, StepRefused::Stale);
}

#[test]
fn a_redo_after_the_room_was_bulldozed_again_is_refused() {
    let mut sim = tower();
    let id = office(&mut sim, 2, 12);
    let sale = gesture(&mut sim, |s| sell(s, id)).unwrap();
    let redo = sim.apply_undo_step(&sale).unwrap();
    // The drag goes on over the room after the undo closed its gesture.
    sell(&mut sim, id);
    refused(&mut sim, &redo, StepRefused::Stale);
}

#[test]
fn a_room_is_never_put_back_onto_one_built_in_its_place() {
    let mut sim = tower();
    let step = gesture(&mut sim, |s| {
        office(s, 2, 12);
    })
    .unwrap();
    let redo = sim.apply_undo_step(&step).unwrap();
    let other = office(&mut sim, 2, 12);
    refused(&mut sim, &redo, StepRefused::Blocked);
    assert_eq!(sim.tower.unit_at(2, 12).unwrap().id, other);
}

#[test]
fn restoring_a_price_on_a_room_sold_since_never_brings_the_room_back() {
    let mut sim = tower();
    let id = office(&mut sim, 2, 12);
    let step = gesture(&mut sim, |s| {
        assert!(s.price_unit(id, 20_000.0).is_some());
    })
    .unwrap();
    sell(&mut sim, id);
    refused(&mut sim, &step, StepRefused::Stale);
    assert!(sim.tower.get_unit(id).is_none());
}

/// A standard elevator from floor 1 to 3 at x 15, and its id.
pub(super) fn lift(sim: &mut Simulation) -> i64 {
    assert!(sim.build_transport(Kind::ElevatorStandard, 15, 1, 3).ok);
    sim.tower.transport_at(1, 15).unwrap().id
}

#[test]
fn a_shaft_changed_or_gone_since_its_step_refuses_the_step() {
    let mut sim = tower();
    let id = lift(&mut sim);
    let car = gesture(&mut sim, |s| assert!(s.add_car(id).ok)).unwrap();
    assert!(
        sim.remove_car(id).ok,
        "the car sold back outside the gesture"
    );
    refused(&mut sim, &car, StepRefused::Stale);

    let mut sim = tower();
    let mut id = 0;
    let built = gesture(&mut sim, |s| id = lift(s)).unwrap();
    assert!(sim.remove_facility(id, RemovalMethod::Sell).ok);
    refused(&mut sim, &built, StepRefused::Stale);
}

#[test]
fn a_shaft_is_never_put_back_into_a_column_taken_since() {
    let mut sim = tower();
    let id = lift(&mut sim);
    let sale = gesture(&mut sim, |s| {
        assert!(s.remove_facility(id, RemovalMethod::Sell).ok)
    })
    .unwrap();
    lift(&mut sim);
    refused(&mut sim, &sale, StepRefused::Blocked);
    assert_eq!(sim.tower.transports.len(), 1);
}

#[test]
fn a_room_used_while_its_gesture_was_open_is_not_undone() {
    let mut sim = tower();
    let mut id = 0;
    let step = gesture(&mut sim, |s| {
        id = office(s, 2, 12);
        meanwhile(s, |s| {
            let u = s.tower.get_unit_mut(id).unwrap();
            u.state = UnitState::Occupied;
            u.ever_occupied = true;
        });
    })
    .unwrap();
    refused(&mut sim, &step, StepRefused::InUse { sellable: true });
}

#[test]
fn a_room_built_used_and_sold_in_one_gesture_hands_back_nothing() {
    let mut sim = tower();
    let step = gesture(&mut sim, |s| {
        let id = office(s, 2, 12);
        meanwhile(s, |s| {
            s.tower.get_unit_mut(id).unwrap().pending_income = 1.0
        });
        sell(s, id);
    })
    .expect("the gesture leaves a step");
    refused(&mut sim, &step, StepRefused::Stale);

    // Unused, the same gesture is undone to the cash it had.
    let mut sim = tower();
    let start = sim.money;
    let step = gesture(&mut sim, |s| {
        let id = office(s, 2, 12);
        sell(s, id);
    })
    .unwrap();
    assert!(sim.money < start, "the sale paid back part of the price");
    sim.apply_undo_step(&step).unwrap();
    assert_eq!(sim.money, start);
}

/// A condo on floor 2 at x 12, and its id.
fn condo(sim: &mut Simulation) -> i64 {
    let r = sim.build(Kind::Condo, 2, 12);
    assert!(r.ok, "{:?}", r.reason);
    sim.tower.unit_at(2, 12).unwrap().id
}

#[test]
fn a_sold_condo_keeps_its_price_and_its_name_can_still_go_back() {
    let mut sim = tower();
    let id = condo(&mut sim);
    let price = gesture(&mut sim, |s| {
        assert!(s.price_unit(id, 200_000.0).is_some());
    })
    .unwrap();
    let rename = gesture(&mut sim, |s| assert!(s.tower.set_label(id, "Penthouse"))).unwrap();
    sim.tower.get_unit_mut(id).unwrap().ever_occupied = true;
    let rent = sim.tower.get_unit(id).unwrap().rent;
    sim.apply_undo_step(&rename)
        .expect("the name is not the price");
    refused(&mut sim, &price, StepRefused::PriceFixed);
    assert_eq!(sim.tower.get_unit(id).unwrap().rent, rent);
}

#[test]
fn a_unit_time_moved_on_in_its_gesture_goes_back_as_it_left() {
    // Touched early in a drag, gutted while the drag is held, then cleared:
    // the undo puts back the shell with the old price, never the room as it
    // stood before the fire.
    let mut sim = tower();
    let id = office(&mut sim, 2, 12);
    let rent = sim.tower.get_unit(id).unwrap().rent;
    let step = gesture(&mut sim, |s| {
        assert!(s.price_unit(id, 20_000.0).is_some());
        meanwhile(s, |s| {
            s.tower.get_unit_mut(id).unwrap().state = UnitState::Gutted
        });
        sell(s, id);
    })
    .unwrap();
    assert_eq!(step.money, 0.0, "a gutted shell pays nothing back");
    sim.apply_undo_step(&step).unwrap();
    let u = sim.tower.get_unit(id).unwrap();
    assert_eq!((u.state, u.rent), (UnitState::Gutted, rent));

    // A condo that sold while the drag was held comes back sold, so it
    // never sells to a second household.
    let mut sim = tower();
    let id = condo(&mut sim);
    let step = gesture(&mut sim, |s| {
        assert!(s.tower.set_label(id, "Penthouse"));
        meanwhile(s, |s| {
            s.tower.get_unit_mut(id).unwrap().ever_occupied = true
        });
        sell(s, id);
    })
    .unwrap();
    sim.apply_undo_step(&step).unwrap();
    let u = sim.tower.get_unit(id).unwrap();
    assert!(u.ever_occupied, "still sold");
    assert_eq!(u.label, Kind::Condo.facility().name, "the old name");

    // Income collected while the drag was held is not paid again.
    let mut sim = tower();
    let id = office(&mut sim, 3, 12);
    sim.tower.get_unit_mut(id).unwrap().pending_income = 900.0;
    let step = gesture(&mut sim, |s| {
        assert!(s.tower.set_label(id, "Annex"));
        meanwhile(s, |s| {
            s.tower.get_unit_mut(id).unwrap().pending_income = 0.0
        });
        sell(s, id);
    })
    .unwrap();
    sim.apply_undo_step(&step).unwrap();
    assert_eq!(sim.tower.get_unit(id).unwrap().pending_income, 0.0);
}

#[test]
fn a_shaft_time_moved_on_in_its_gesture_goes_back_as_it_left() {
    let mut sim = tower();
    let id = lift(&mut sim);
    let stops = sim.tower.get_transport(id).unwrap().skip_floors.clone();
    let step = gesture(&mut sim, |s| {
        assert!(s.tower.set_stop(id, 2, false));
        meanwhile(s, |s| {
            for _ in 0..3 {
                s.tower.note_ride(id);
            }
        });
        sell(s, id);
    })
    .unwrap();
    sim.apply_undo_step(&step).unwrap();
    let t = sim.tower.get_transport(id).unwrap();
    assert_eq!(
        t.skip_floors, stops,
        "the stop the gesture changed goes back"
    );
    assert_eq!(t.rides, 3, "and the rides stay as they were when it left");
}

/// Take away the floor tiles under `floor` from `x` for `width` tiles, as an
/// edit made outside every gesture would.
fn take_floor(sim: &mut Simulation, floor: i64, x: i64, width: i64) {
    for x in x..x + width {
        let tile = sim.tower.unit_at(floor, x).unwrap();
        assert!(tile.kind.is_structural(), "only floor is left at {x}");
        let id = tile.id;
        assert!(sim.tower.remove_unit(id).is_some());
    }
}

#[test]
fn a_room_is_never_put_back_where_its_floor_was_taken_away() {
    let mut sim = tower();
    let step = gesture(&mut sim, |s| {
        office(s, 2, 12);
    })
    .unwrap();
    let redo = sim.apply_undo_step(&step).unwrap();
    take_floor(&mut sim, 2, 14, 1);
    refused(&mut sim, &redo, StepRefused::Blocked);
    assert!(sim
        .tower
        .unit_at(2, 12)
        .is_some_and(|u| u.kind.is_structural()));
}

#[test]
fn a_shaft_is_never_put_back_or_stretched_over_missing_floor() {
    let mut sim = tower();
    let id = lift(&mut sim);
    let width = sim.tower.get_transport(id).unwrap().width;
    let sale = gesture(&mut sim, |s| {
        assert!(s.remove_facility(id, RemovalMethod::Sell).ok)
    })
    .unwrap();
    take_floor(&mut sim, 2, 15, width);
    refused(&mut sim, &sale, StepRefused::Blocked);

    // A shorter shaft whose undo would stretch it back over the gap.
    let mut sim = tower();
    let id = lift(&mut sim);
    let shrink = gesture(&mut sim, |s| assert!(s.resize_transport(id, 1, 2).ok)).unwrap();
    take_floor(&mut sim, 3, 15, width);
    refused(&mut sim, &shrink, StepRefused::Blocked);
}

#[test]
fn a_shaft_is_never_stretched_back_into_one_built_above_it() {
    let mut sim = tower();
    let id = lift(&mut sim);
    let shrink = gesture(&mut sim, |s| assert!(s.resize_transport(id, 1, 2).ok)).unwrap();
    assert!(sim.build_transport(Kind::ElevatorStandard, 15, 3, 4).ok);
    refused(&mut sim, &shrink, StepRefused::Blocked);
}

/// Floor for more security offices than the cap allows, the spots for one
/// past the cap, and the ids of the cap's worth built on the first of them.
fn securities_at_the_cap(sim: &mut Simulation) -> (Vec<i64>, Vec<(i64, i64)>) {
    let width = Kind::Security.facility().width;
    let cap = crate::facilities::build_cap(Kind::Security).unwrap();
    let per_floor = 60 / width;
    let floors = (cap + per_floor) / per_floor;
    for floor in 5..=floors + 1 {
        for x in 10..70 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    let spots: Vec<(i64, i64)> = (2..=floors + 1)
        .flat_map(|floor| (0..per_floor).map(move |i| (floor, 10 + i * width)))
        .take(cap as usize + 1)
        .collect();
    let mut ids = Vec::new();
    for &(floor, x) in &spots[..cap as usize] {
        assert!(sim.build(Kind::Security, floor, x).ok);
        ids.push(sim.tower.unit_at(floor, x).unwrap().id);
    }
    (ids, spots)
}

#[test]
fn a_room_is_never_put_back_past_its_kind_cap() {
    let mut sim = tower();
    let (ids, spots) = securities_at_the_cap(&mut sim);
    let sale = gesture(&mut sim, |s| sell(s, ids[0])).unwrap();
    let (floor, x) = *spots.last().unwrap();
    assert!(
        sim.build(Kind::Security, floor, x).ok,
        "the cap has room again"
    );
    refused(&mut sim, &sale, StepRefused::Blocked);
}

#[test]
fn a_tower_already_over_a_cap_may_be_left_as_far_over_as_the_edit_found_it() {
    let mut sim = tower();
    let (ids, spots) = securities_at_the_cap(&mut sim);
    // An older save holds one more than the cap.
    let (floor, x) = *spots.last().unwrap();
    let mut extra = sim.tower.get_unit(ids[0]).unwrap().clone();
    (extra.id, extra.floor, extra.x) = (sim.tower.next_id, floor, x);
    sim.tower.next_id += 1;
    sim.tower
        .insert_units_at(vec![(sim.tower.units.len(), extra)]);
    let over = sim.tower.count_kind(Kind::Security);
    let sale = gesture(&mut sim, |s| sell(s, ids[0])).unwrap();
    let redo = sim.apply_undo_step(&sale).expect("the undo applies");
    assert_eq!(sim.tower.count_kind(Kind::Security), over);
    sim.apply_undo_step(&redo).expect("and so does the redo");
    assert_eq!(sim.tower.count_kind(Kind::Security), over - 1);
}
