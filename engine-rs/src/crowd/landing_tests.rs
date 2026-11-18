//! The landing lines: a rider walks straight to the back of the line and
//! never into the shaft and back out again (#2116).

use super::{landing_slots, line_at, measure_line, queue_line, slot_x, Landings};
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
    let slots = landing_slots(&sim.crowd, &sim.tower);
    let at = |id: i64| sim.crowd.people.iter().position(|p| p.id == id).unwrap();
    assert_eq!(slots.slot(at(id_first)).unwrap(), slot_x(line, 0, 2));
    assert_eq!(
        slots.slot(at(id_second)).unwrap(),
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

#[test]
fn a_landing_line_follows_the_floor_built_beside_it() {
    // Floor 2 runs from x 100 to 159: the shaft at 150 has more built floor
    // on its left, so its line runs left.
    let mut sim = Simulation::new_game(5, GameMode::Classic);
    sim.money = 1e12;
    for x in 100..200 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    for x in 100..160 {
        assert!(sim.tower.place(Kind::Floor, 2, x).ok);
    }
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorStandard, 150, 1, 2)
            .ok
    );
    let t = sim.tower.transports.last().unwrap().clone();
    assert_eq!(
        line_at(&sim.tower, &t, 2).side,
        -1.0,
        "the longer run is on the left"
    );
    // The line is kept per edit, so laying floor to the right is seen: both
    // runs now reach the full 30 tiles and the tie goes right.
    for x in 160..200 {
        assert!(sim.tower.place(Kind::Floor, 2, x).ok);
    }
    let line = line_at(&sim.tower, &t, 2);
    assert_eq!(
        (line.side, line.run),
        (1.0, 30.0),
        "the edit moved the line"
    );
    assert_eq!(
        line,
        measure_line(&sim.tower, &t, 2),
        "kept equals measured"
    );
}

/// A line that fills the built floor beside the shaft sets its back place
/// past the floor's last tile. A rider bound there walks to the end of the
/// floor at walking speed, and so does everyone already in the line: nobody
/// jumps along the floor to it (it once moved them up to 46 tiles in one
/// step on a big tower).
#[test]
fn a_rider_bound_past_the_end_of_the_floor_walks_there() {
    let mut sim = Simulation::new_game(5, GameMode::Classic);
    sim.money = 1e12;
    for x in 100..200 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    // Floors 2 to 4 are built from x 140 to 169 only.
    for floor in 2..=4 {
        for x in 140..170 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorStandard, 150, 1, 4)
            .ok
    );
    let shaft = sim.tower.transports.last().unwrap().id;
    let face = right_face(&sim, shaft);
    let end = 169.0;
    // Twenty riders already wait, so the line is squeezed to the floor's
    // end and its back place lies past the last tile.
    for k in 0..20 {
        let i = rider(&mut sim, shaft, face + 1.0);
        let p = &mut sim.crowd.people[i];
        p.state = PState::Waiting;
        p.wait = 100.0 - k as f64;
    }
    let t = sim.tower.get_transport(shaft).unwrap().clone();
    assert!(landing_slots(&sim.crowd, &sim.tower).back_of_line(&sim.tower, &t, 2) > end);
    let new = rider(&mut sim, shaft, 141.0);
    let new_id = sim.crowd.people[new].id;
    let dt = 0.1;
    let stride = crate::crowd::WALK_SPEED * dt + 1e-9;
    let mut arrived = false;
    for _ in 0..200 {
        let before: Vec<(i64, f64)> = sim.crowd.people.iter().map(|p| (p.id, p.x)).collect();
        advance(&mut sim.crowd, dt, &mut sim.tower);
        for (id, x) in before {
            let p = sim.crowd.people.iter().find(|p| p.id == id).unwrap();
            assert!(
                p.state == PState::Riding || (p.x - x).abs() <= stride,
                "person {id} moved from {x} to {} in one step",
                p.x
            );
        }
        let p = sim.crowd.people.iter().find(|p| p.id == new_id).unwrap();
        if p.state == PState::Waiting {
            arrived = true;
            assert!(p.x <= end, "stands on the floor, at {}", p.x);
            break;
        }
    }
    assert!(arrived, "the rider reached the back of the line");
}

/// Riders on floor 2 waiting for `shaft`, `n` of them, each standing in the
/// place `landing_slots` gives them.
fn waiting(sim: &mut Simulation, shaft: i64, n: usize) -> Vec<i64> {
    let ids: Vec<i64> = (0..n)
        .map(|_| {
            let i = rider(sim, shaft, 120.0);
            sim.crowd.people[i].state = PState::Waiting;
            sim.crowd.people[i].id
        })
        .collect();
    stand_in_place(sim);
    ids
}

/// Moves every waiting rider to their place in line.
fn stand_in_place(sim: &mut Simulation) {
    let slots = landing_slots(&sim.crowd, &sim.tower);
    for i in 0..sim.crowd.people.len() {
        if let Some(x) = slots.slot(i) {
            sim.crowd.people[i].x = x;
        }
    }
}

#[test]
fn a_lines_stretch_runs_past_the_elevator_beside_it() {
    // The lone shaft at 150 plus a second one right beside it: the first
    // shaft's line runs right, across the second, as lines in a bank do.
    let (mut sim, first) = tower();
    let width = Kind::ElevatorStandard.facility().width;
    let placed = sim
        .tower
        .place_transport(Kind::ElevatorStandard, 150 + width, 1, 4);
    assert!(placed.ok, "{:?}", placed.reason);
    let second = sim.tower.transports.last().unwrap().id;
    assert_eq!(
        queue_line(&sim.crowd, &sim.tower, first, 2),
        None,
        "nobody waits yet"
    );

    let ours = waiting(&mut sim, first, 12);
    let theirs = waiting(&mut sim, second, 3);
    let (from, to) = queue_line(&sim.crowd, &sim.tower, first, 2).expect("a line");
    let face = right_face(&sim, first);
    assert_eq!(from, face, "the line starts at the shaft face");
    assert!(
        to > right_face(&sim, second),
        "twelve riders reach past the shaft beside it: {to}"
    );
    let slots = landing_slots(&sim.crowd, &sim.tower);
    let at = |id: i64| sim.crowd.people.iter().position(|p| p.id == id).unwrap();
    let places: Vec<f64> = ours.iter().map(|&id| slots.slot(at(id)).unwrap()).collect();
    assert!(
        places.iter().all(|&x| (from..=to).contains(&x)),
        "every rider of the line stands in its stretch: {places:?} in {from}..{to}"
    );
    assert_eq!(
        places.iter().copied().fold(f64::MIN, f64::max),
        to,
        "it ends at the back rider"
    );

    // The other shaft's line is its own: it starts at that shaft's face and
    // counts only its three riders.
    let (from2, to2) = queue_line(&sim.crowd, &sim.tower, second, 2).expect("a line");
    assert_eq!(from2, right_face(&sim, second));
    let back = theirs
        .iter()
        .map(|&id| slots.slot(at(id)).unwrap())
        .fold(f64::MIN, f64::max);
    assert_eq!(to2, back);
    assert_eq!(
        queue_line(&sim.crowd, &sim.tower, first, 3),
        None,
        "no line on floor 3"
    );

    // The front rider boards: the rest shuffle up, and one still at the old
    // back place is in the stretch until they move.
    let front = sim
        .crowd
        .people
        .iter()
        .position(|p| p.id == ours[0])
        .unwrap();
    sim.crowd.people[front].state = PState::Riding;
    let (_, still) = queue_line(&sim.crowd, &sim.tower, first, 2).expect("a line");
    assert_eq!(still, to, "the back rider has not moved yet");
    stand_in_place(&mut sim);
    let (_, shorter) = queue_line(&sim.crowd, &sim.tower, first, 2).expect("a line");
    assert!(
        shorter < to,
        "the line shortened once they shuffled up: {shorter}"
    );
}

#[test]
fn a_line_running_left_reads_from_its_back_to_the_face() {
    // Floor 2 runs from x 100 to 159, so the shaft at 150 lines its riders
    // up to the left, from its left face.
    let mut sim = Simulation::new_game(5, GameMode::Classic);
    sim.money = 1e12;
    for x in 100..200 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    for x in 100..160 {
        assert!(sim.tower.place(Kind::Floor, 2, x).ok);
    }
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorStandard, 150, 1, 2)
            .ok
    );
    let t = sim.tower.transports.last().unwrap().clone();
    for _ in 0..4 {
        let route = Route {
            floors: vec![2, 1],
            shafts: vec![t.id],
        };
        let i = make_person(&mut sim.crowd, &sim.tower, route, 120.0, None);
        sim.crowd.people[i].state = PState::Waiting;
    }
    stand_in_place(&mut sim);
    let line = line_at(&sim.tower, &t, 2);
    assert_eq!(line.side, -1.0);
    let (from, to) = queue_line(&sim.crowd, &sim.tower, t.id, 2).expect("a line");
    assert_eq!((from, to), (slot_x(line, 3, 4), t.x as f64));
    assert!(from < to);
}

/// The landing lists the motion pass keeps between slices answer as a fresh
/// build does once the lines change: nobody left over from the last slice
/// keeps a place, and a landing nobody waits at any more has no line.
#[test]
fn landings_filled_again_answer_as_a_fresh_build() {
    let (mut sim, shaft) = tower();
    waiting(&mut sim, shaft, 3);
    let mut kept = Landings::default();
    kept.fill(&sim.crowd, &sim.tower);
    assert!(kept.lines.get(&(shaft, 2)).is_some());
    // The line on floor 2 goes, and one rider waits on floor 3 instead, so
    // the kept lists' first landing is a different one.
    for p in sim.crowd.people.iter_mut() {
        p.state = PState::Riding;
    }
    let i = rider(&mut sim, shaft, 120.0);
    sim.crowd.people[i].state = PState::Waiting;
    sim.crowd.people[i].floor = 3;
    kept.fill(&sim.crowd, &sim.tower);
    let fresh = landing_slots(&sim.crowd, &sim.tower);
    for i in 0..sim.crowd.people.len() + 1 {
        assert_eq!(kept.slot(i), fresh.slot(i), "rider {i}");
    }
    assert!(kept.slot(i).is_some(), "the floor 3 rider has a place");
    for floor in [2, 3] {
        assert_eq!(
            kept.lines.get(&(shaft, floor)),
            fresh.lines.get(&(shaft, floor)),
            "the line on floor {floor}"
        );
    }
    assert!(
        kept.lines.get(&(shaft, 2)).is_none(),
        "nobody waits on floor 2"
    );
}
