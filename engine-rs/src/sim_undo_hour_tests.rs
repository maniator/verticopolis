//! Floor and lobby tiles once an hourly pass has run with them standing,
//! floor a room's build laid under it included, and the basement that hangs
//! from the ground floor.
use super::check_tests::{lift, meanwhile, refused, sell};
use super::ground_tests::an_hour_passes;
use super::tests::{gesture, office, tower};
use super::StepRefused;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;
use crate::undo::Step;

#[test]
fn floor_a_room_laid_under_itself_is_in_use_once_the_hour_passes() {
    let mut sim = tower();
    // Floor 5 has no floor: the office's build lays its own.
    let step = gesture(&mut sim, |s| {
        office(s, 5, 20);
    })
    .unwrap();
    an_hour_passes(&mut sim);
    let id = sim.tower.unit_at(5, 20).unwrap().id;
    assert_eq!(
        sim.tower.get_unit(id).unwrap().state,
        UnitState::Construction,
        "the room is still being built"
    );
    refused(&mut sim, &step, StepRefused::GroundUsed { sellable: true });
}

#[test]
fn a_tile_something_stands_on_is_never_offered_for_sale() {
    let mut sim = tower();
    let floor = gesture(&mut sim, |s| {
        for x in 20..30 {
            assert!(s.build(Kind::Floor, 5, x).ok);
        }
    })
    .unwrap();
    an_hour_passes(&mut sim);
    refused(&mut sim, &floor, StepRefused::GroundUsed { sellable: true });
    office(&mut sim, 5, 20);
    refused(
        &mut sim,
        &floor,
        StepRefused::GroundUsed { sellable: false },
    );
}

#[test]
fn an_hour_that_passes_while_the_gesture_is_open_counts() {
    let mut sim = tower();
    let step = gesture(&mut sim, |s| {
        assert!(s.build(Kind::Floor, 5, 20).ok);
        meanwhile(s, an_hour_passes);
    })
    .unwrap();
    refused(&mut sim, &step, StepRefused::GroundUsed { sellable: true });
}

#[test]
fn a_car_bought_ridden_and_sold_with_its_shaft_keeps_its_use() {
    let mut sim = tower();
    let id = lift(&mut sim);
    let step = gesture(&mut sim, |s| {
        assert!(s.add_car(id).ok);
        meanwhile(s, |s| s.tower.note_ride(id));
        sell(s, id);
    })
    .unwrap();
    refused(&mut sim, &step, StepRefused::UsedThenSold);
}

/// A lobby laid beyond the old one, and a basement under it alone, built
/// outside every gesture.
fn lobby_over_a_basement(sim: &mut Simulation) -> Step {
    let lobby = gesture(sim, |s| {
        for x in 70..90 {
            assert!(s.build(Kind::Lobby, 1, x).ok);
        }
    })
    .unwrap();
    for x in 72..88 {
        assert!(sim.tower.place(Kind::Floor, 0, x).ok);
    }
    lobby
}

#[test]
fn a_ground_floor_tile_never_leaves_a_basement_hanging() {
    let mut sim = tower();
    let lobby = lobby_over_a_basement(&mut sim);
    refused(&mut sim, &lobby, StepRefused::Blocked);
    // Once it reaches under the old lobby, it still hangs from that.
    for x in (60..72).rev() {
        assert!(sim.tower.place(Kind::Floor, 0, x).ok);
    }
    sim.apply_undo_step(&lobby)
        .expect("the basement still hangs from the old lobby");
    assert!(sim.tower.unit_at(1, 80).is_none());

    // A story below holds it up too.
    let mut sim = tower();
    let lobby = lobby_over_a_basement(&mut sim);
    assert!(sim.tower.place(Kind::Floor, -1, 80).ok);
    sim.apply_undo_step(&lobby)
        .expect("the basement stands on the story below");
}
