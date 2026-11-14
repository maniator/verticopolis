//! The landing lines: a rider walks straight to the back of the line and
//! never into the shaft and back out again (#2116).

use super::{landing_slots, line_at, slot_x, Landings};
use crate::clock::GameMode;
use crate::crowd::motion::advance;
use crate::crowd::spawn::make_person;
use crate::crowd::{PState, Route};
use crate::facilities::Kind;
use crate::sim::Simulation;

/// A lobby on floor 1, floor tiles on floors 2 to 4 (x 100 to 199), and one
/// standard elevator at x 150 from the lobby to floor 4. Its line on floor 2
/// runs right, since both sides have the same built run.
fn tower() -> (Simulation, i64) {
    let mut sim = Simulation::new_game(5, GameMode::Classic);
    sim.money = 1e12;
    for x in 100..200 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    for floor in 2..=4 {
        for x in 100..200 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    let placed = sim.tower.place_transport(Kind::ElevatorStandard, 150, 1, 4);
    assert!(placed.ok, "{:?}", placed.reason);
    let id = sim.tower.transports.last().unwrap().id;
    (sim, id)
}

/// A rider on floor 2 at `x`, headed up the shaft to floor 4.
fn rider(sim: &mut Simulation, shaft: i64, x: f64) -> usize {
    let route = Route {
        floors: vec![2, 4],
        shafts: vec![shaft],
    };
    let i = make_person(&mut sim.crowd, &sim.tower, route, 120.0, None);
    sim.crowd.people[i].x = x;
    assert_eq!(sim.crowd.people[i].state, PState::ToShaft);
    i
}

fn right_face(sim: &Simulation, shaft: i64) -> f64 {
    let t = sim.tower.get_transport(shaft).unwrap();
    (t.x + t.width) as f64
}

#[test]
fn the_back_of_an_empty_line_is_its_front_place() {
    let (sim, shaft) = tower();
    let t = sim.tower.get_transport(shaft).unwrap().clone();
    let line = line_at(&sim.tower, &t, 2);
    let mut landings = Landings::default();
    let front = landings.back_of_line(&sim.tower, &t, 2);
    assert_eq!(front, slot_x(line, 0, 1));
    assert_eq!(front, right_face(&sim, shaft) + 0.8);
    landings.join(shaft, 2);
    let second = landings.back_of_line(&sim.tower, &t, 2);
    assert_eq!(second, slot_x(line, 1, 2));
    assert!(second > front, "the next rider stands behind the first");
}

#[test]
fn a_rider_walks_straight_to_the_line_and_never_into_the_shaft() {
    let (mut sim, shaft) = tower();
    let face = right_face(&sim, shaft);
    let i = rider(&mut sim, shaft, 180.0);
    let id = sim.crowd.people[i].id;
    let mut lowest = f64::MAX;
    for _ in 0..400 {
        advance(&mut sim.crowd, 0.1, &mut sim.tower);
        let p = sim.crowd.people.iter().find(|p| p.id == id).unwrap();
        lowest = lowest.min(p.x);
        if p.state == PState::Waiting {
            break;
        }
    }
    let p = sim.crowd.people.iter().find(|p| p.id == id).unwrap();
    assert_eq!(p.state, PState::Waiting);
    assert_eq!(p.x, face + 0.8, "the rider stopped at the front place");
    assert!(lowest >= face, "the rider stepped into the shaft: {lowest}");
    // Waiting, the rider stays put in that place.
    for _ in 0..20 {
        advance(&mut sim.crowd, 0.1, &mut sim.tower);
    }
    let p = sim.crowd.people.iter().find(|p| p.id == id).unwrap();
    assert_eq!(p.x, face + 0.8);
}

#[test]
fn a_rider_joining_a_line_heads_for_the_place_behind_it() {
    let (mut sim, shaft) = tower();
    let face = right_face(&sim, shaft);
    let first = rider(&mut sim, shaft, face + 0.8);
    let id_first = sim.crowd.people[first].id;
    advance(&mut sim.crowd, 0.1, &mut sim.tower);
    assert_eq!(sim.crowd.people[first].state, PState::Waiting);
    let second = rider(&mut sim, shaft, 190.0);
    let id_second = sim.crowd.people[second].id;
    let mut lowest = f64::MAX;
    for _ in 0..400 {
        advance(&mut sim.crowd, 0.1, &mut sim.tower);
        let p = sim.crowd.people.iter().find(|p| p.id == id_second).unwrap();
        lowest = lowest.min(p.x);
        if p.state == PState::Waiting {
            break;
        }
    }
    let line = {
        let t = sim.tower.get_transport(shaft).unwrap();
        line_at(&sim.tower, t, 2)
    };
    let p = sim.crowd.people.iter().find(|p| p.id == id_second).unwrap();
    assert_eq!(p.state, PState::Waiting);
    assert_eq!(p.x, slot_x(line, 1, 2), "the second rider stopped behind");
    assert!(
        lowest >= slot_x(line, 1, 2),
        "the second rider walked past the back of the line: {lowest}"
    );
    let slots = landing_slots(&sim.crowd, &sim.tower).slots;
    assert_eq!(slots.get(&id_first).copied().unwrap(), slot_x(line, 0, 2));
    assert_eq!(
        slots.get(&id_second).copied().unwrap(),
        p.x,
        "the place it walked to is its slot"
    );
}

#[test]
fn two_riders_arriving_in_one_slice_take_two_places() {
    let (mut sim, shaft) = tower();
    let face = right_face(&sim, shaft);
    let a = rider(&mut sim, shaft, face + 0.8);
    let (id_a, id_b) = (sim.crowd.people[a].id, sim.crowd.next_id);
    rider(&mut sim, shaft, face + 0.8);
    advance(&mut sim.crowd, 0.1, &mut sim.tower);
    let get = |id: i64| sim.crowd.people.iter().find(|p| p.id == id).unwrap();
    assert_eq!(get(id_a).state, PState::Waiting);
    assert_eq!(
        get(id_b).state,
        PState::ToShaft,
        "the first took the front place, so the second walks on to the next"
    );
}
