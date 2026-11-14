//! Nobody vanishes on the way (owner, 2026-11-14): someone who runs out of
//! patience before their first ride walks back to where they started and
//! leaves the way they came, and anyone past their first ride, or on the
//! way home, keeps going.

use crate::clock::GameMode;
use crate::crowd::motion::advance;
use crate::crowd::spawn::make_person;
use crate::crowd::{PState, Route};
use crate::facilities::Kind;
use crate::sim::Simulation;

/// A lobby on floor 1, floor tiles on floors 2 to 4 (x 100 to 199), and one
/// standard elevator at x 150 from the lobby to floor 4. Nothing moves its
/// cars here, so a rider who waits for one waits for good.
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

/// A person on `floors[leg]` of a trip up `shaft`, waiting for a car, who
/// has been on their way far longer than anyone's patience.
fn impatient(sim: &mut Simulation, shaft: i64, floors: Vec<i64>, leg: usize) -> i64 {
    let shafts = vec![shaft; floors.len() - 1];
    let route = Route { floors, shafts };
    let i = make_person(&mut sim.crowd, &sim.tower, route, 120.0, None);
    let p = &mut sim.crowd.people[i];
    p.leg = leg;
    p.floor = p.floors[leg];
    p.fy = p.floor as f64;
    p.state = PState::Waiting;
    p.age = 1e6;
    p.id
}

fn find(sim: &Simulation, id: i64) -> Option<&crate::crowd::Person> {
    sim.crowd.people.iter().find(|p| p.id == id)
}

#[test]
fn someone_who_waits_too_long_to_set_out_walks_back_out() {
    let (mut sim, shaft) = tower();
    let id = impatient(&mut sim, shaft, vec![1, 4], 0);
    let start = find(&sim, id).unwrap().start_x;
    // They had walked over to the shaft before giving up.
    sim.crowd.people[0].x = 150.0;
    advance(&mut sim.crowd, 0.5, &mut sim.tower);
    let p = find(&sim, id).expect("they turn back instead of vanishing");
    assert_eq!(p.state, PState::ToDest);
    assert!(p.returning);
    assert_eq!(p.dest_x, start);
    // They walk back along the lobby and leave only once they reach the
    // spot they came in at.
    let mut last = None;
    for _ in 0..2_000 {
        advance(&mut sim.crowd, 0.5, &mut sim.tower);
        match find(&sim, id) {
            Some(p) => {
                assert_eq!(p.floor, 1, "they never leave the lobby");
                last = Some(p.x);
            }
            None => break,
        }
    }
    assert!(find(&sim, id).is_none(), "they leave once they get back");
    assert_eq!(last, Some(start), "they leave from where they came in");
}

#[test]
fn someone_past_their_first_ride_keeps_going() {
    let (mut sim, shaft) = tower();
    let id = impatient(&mut sim, shaft, vec![1, 2, 4], 1);
    for _ in 0..500 {
        advance(&mut sim.crowd, 0.5, &mut sim.tower);
    }
    let p = find(&sim, id).expect("nobody vanishes partway up");
    assert_eq!(p.floor, 2);
    assert!(!p.returning);
    assert_eq!(p.state, PState::Waiting, "they still wait for their car");
}

#[test]
fn someone_on_the_way_home_keeps_going() {
    let (mut sim, shaft) = tower();
    let id = impatient(&mut sim, shaft, vec![4, 1], 0);
    sim.crowd.people[0].returning = true;
    for _ in 0..500 {
        advance(&mut sim.crowd, 0.5, &mut sim.tower);
    }
    let p = find(&sim, id).expect("nobody vanishes on the way home");
    assert_eq!((p.floor, p.state), (4, PState::Waiting));
}

#[test]
fn someone_whose_first_shaft_goes_turns_back() {
    let (mut sim, shaft) = tower();
    let id = impatient(&mut sim, shaft, vec![1, 4], 0);
    sim.crowd.people[0].age = 0.0;
    assert!(sim.tower.remove_transport(shaft).is_some());
    advance(&mut sim.crowd, 0.5, &mut sim.tower);
    let p = find(&sim, id).expect("they turn back instead of vanishing");
    assert_eq!((p.state, p.returning, p.floor), (PState::ToDest, true, 1));
}

#[test]
fn someone_partway_up_whose_shaft_goes_finds_another_way() {
    let (mut sim, shaft) = tower();
    let placed = sim.tower.place_transport(Kind::ElevatorStandard, 110, 1, 4);
    assert!(placed.ok, "{:?}", placed.reason);
    let other = sim.tower.transports.last().unwrap().id;
    let id = impatient(&mut sim, shaft, vec![1, 2, 4], 1);
    sim.crowd.people[0].age = 0.0;
    assert!(sim.tower.remove_transport(shaft).is_some());
    advance(&mut sim.crowd, 0.5, &mut sim.tower);
    let p = find(&sim, id).expect("nobody vanishes partway up");
    assert_eq!(p.floor, 2);
    assert_eq!(p.shaft_id, Some(other), "they head for the other elevator");
    assert_eq!(p.floors.last(), Some(&4), "still bound for their floor");
    assert!(!p.returning);
}
