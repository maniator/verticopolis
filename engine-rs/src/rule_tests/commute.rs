//! The commute-stress accumulator (#514): each finished tenant trip folds
//! its whole wait onto its origin floor. The averages' listing and seeding
//! are `crowd::tests::commute_stress_lists_each_floor_in_order` and its
//! neighbors.
use crate::clock::GameMode;
use crate::crowd::motion::finish;
use crate::crowd::spawn::add;
use crate::facilities::Kind;
use crate::load::deserialize;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::MID;

const C: i64 = MID - 15;

/// Lobby and floors 2 to 6, an occupied office on 5, one elevator.
fn commuter_tower(seed: u32) -> Simulation {
    let mut sim = Simulation::new_game(seed, GameMode::Classic);
    sim.money = 1e9;
    for x in C..C + 30 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        for floor in 2..=6 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    let id = sim.tower.place(Kind::Office, 5, C).unit_id.unwrap();
    let office = sim.tower.get_unit_mut(id).unwrap();
    office.state = UnitState::Occupied;
    office.ever_occupied = true;
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorStandard, C + 20, 1, 6)
            .ok
    );
    sim
}

fn stress(sim: &Simulation, floor: i64) -> f64 {
    sim.crowd
        .commute_wait_by_floor
        .get(&floor)
        .copied()
        .unwrap_or(0.0)
}

/// Finishes a rider whose trip began on `origin` with these waits.
fn finished(sim: &mut Simulation, origin: i64, trip_wait: f64, wait: f64, staff: bool) {
    let i = add(&mut sim.crowd, &sim.tower, 3, 6, None, None).unwrap();
    let p = &mut sim.crowd.people[i];
    (p.origin_floor, p.trip_wait, p.wait, p.staff) = (origin, trip_wait, wait, staff);
    if staff {
        sim.crowd.staff_count += 1;
    }
    finish(&mut sim.crowd, i, &mut sim.tower);
}

#[test]
fn a_finished_trip_folds_its_whole_wait_onto_its_origin_floor_only() {
    let mut sim = commuter_tower(1);
    assert_eq!(stress(&sim, 4), 0.0);
    sim.crowd.record_commute(4, 40.0);
    assert_eq!(stress(&sim, 4), 40.0, "the first sample seeds the average");
    // A return leg starts on the venue floor (3) but its home is 50.
    finished(&mut sim, 50, 80.0, 0.0, false);
    assert_eq!(
        (stress(&sim, 50), stress(&sim, 3), stress(&sim, 6)),
        (80.0, 0.0, 0.0)
    );
    // A give-up while queued counts the trailing wait too.
    finished(&mut sim, 2, 10.0, 50.0, false);
    assert_eq!(stress(&sim, 2), 60.0);
}

#[test]
fn staff_never_count_toward_tenant_stress() {
    let mut sim = commuter_tower(1);
    finished(&mut sim, 5, 99.0, 0.0, true);
    assert!(sim.crowd.commute_wait_by_floor.is_empty());
}

#[test]
fn the_same_seed_builds_the_same_averages_and_a_save_keeps_none() {
    let snap = |sim: &Simulation| {
        let mut rows: Vec<_> = sim
            .crowd
            .commute_wait_by_floor
            .iter()
            .map(|(f, w)| (*f, *w))
            .collect();
        rows.sort_by_key(|row| row.0);
        rows
    };
    let (mut a, mut b) = (commuter_tower(1), commuter_tower(1));
    for _ in 0..200 {
        a.tick(1.0);
        b.tick(1.0);
    }
    assert!(!snap(&a).is_empty());
    assert_eq!(snap(&a), snap(&b));
    assert!(deserialize(&a.serialize())
        .unwrap()
        .crowd
        .commute_wait_by_floor
        .is_empty());
}

#[test]
fn seeded_stress_leaves_satisfaction_alone() {
    let (mut control, mut seeded) = (commuter_tower(2), commuter_tower(2));
    let floors: Vec<i64> = seeded
        .tower
        .units
        .iter()
        .filter(|u| u.state == UnitState::Occupied)
        .map(|u| u.floor)
        .collect();
    for floor in floors {
        seeded.crowd.record_commute(floor, 10_000.0);
    }
    control.update_satisfaction();
    seeded.update_satisfaction();
    let sat = |sim: &Simulation| -> Vec<(i64, f64)> {
        sim.tower
            .units
            .iter()
            .filter(|u| u.state == UnitState::Occupied)
            .map(|u| (u.id, u.satisfaction))
            .collect()
    };
    assert_eq!(sat(&seeded), sat(&control));
}
