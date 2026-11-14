//! Routing on a split floor whose runs both reach the lobby (#647, #662),
//! from the retired `segmentRoutingReachable.integration.test.ts`: a maid
//! sent to a room on the far run rides round to it and never stands in the
//! gap, a stranded venue on a half-reachable floor draws no demand share and
//! no patrons, shaft balancing never moves a rider onto a shaft their run
//! cannot reach, and a shaft straddling a gap serves both runs and sets its
//! riders down on the one they asked for. The meal and return legs on the
//! same kind of floor are the Rust-run
//! `segmentRoutingMealRush.integration.test.ts`.
use crate::clock::GameMode;
use crate::crowd::motion::advance;
use crate::crowd::CROWD_SECONDS_PER_MINUTE;
use crate::demand::compute_demand_map;
use crate::facilities::Kind;
use crate::housekeeping_shift::MaidSent;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{at_time, place_seated, shaft, strip_tower};

/// A lobby `width` wide and floor 2 laid over `runs` only.
fn split_floor(seed: u32, width: i64, runs: &[std::ops::Range<i64>]) -> Simulation {
    let mut sim = strip_tower(seed, GameMode::Modern, width, 1);
    for run in runs {
        for x in run.clone() {
            assert!(sim.tower.place(Kind::Floor, 2, x).ok, "floor 2 at {x}");
        }
    }
    sim
}

fn center(sim: &Simulation, id: i64) -> f64 {
    let u = sim.tower.get_unit(id).unwrap();
    u.x as f64 + u.width as f64 / 2.0
}

/// Sends a maid seated at `crew` to clean `room` (one game-minute of work) and
/// steps the crowd until the job reports. Returns whether it completed and
/// every column a maid stood on upstairs.
fn send_maid(sim: &mut Simulation, crew: i64, room: i64, steps: usize) -> (bool, Vec<i64>) {
    sim.seat_crews();
    let mut free = sim.free_maids();
    let sent = sim.assign_maid(&mut free, crew, (room, 2, center(sim, room)));
    assert_eq!(sent, MaidSent::Sent, "a route to the room's run exists");
    // One game-minute of work keeps the walk the test.
    for p in sim
        .crowd
        .people
        .iter_mut()
        .filter(|p| p.clean_unit_id == Some(room))
    {
        p.linger_for = Some(CROWD_SECONDS_PER_MINUTE);
    }
    let mut columns = Vec::new();
    for _ in 0..steps {
        advance(&mut sim.crowd, 3.0, &mut sim.tower);
        for p in sim.crowd.people.iter().filter(|p| p.staff && p.floor >= 2) {
            columns.push(p.x.round() as i64);
        }
        if let Some(done) = sim
            .crowd
            .take_staff_results()
            .iter()
            .find(|r| r.unit_id == room)
        {
            return (done.ok, columns);
        }
    }
    panic!("the cleaning job never reported");
}

#[test]
fn a_maid_rides_round_to_a_room_on_the_far_run() {
    const GAP: std::ops::RangeInclusive<i64> = 25..=34;
    let mut sim = split_floor(77, 60, &[0..25, 35..60]);
    shaft(&mut sim, Kind::Stairs, 0, 1, 2);
    shaft(&mut sim, Kind::Stairs, 52, 1, 2);
    let crew = place_seated(&mut sim, Kind::Housekeeping, 2, 10, UnitState::Empty, 0);
    let room = place_seated(&mut sim, Kind::HotelSingle, 2, 40, UnitState::Empty, 0);
    let (ok, columns) = send_maid(&mut sim, crew, room, 400);
    assert!(ok, "the maid reached the room");
    assert!(!columns.iter().any(|c| GAP.contains(c)), "never in the gap");
    assert!(
        columns.iter().any(|&c| c >= 35),
        "she stood on the room's run"
    );
}

/// Floor 2's left run (0 to 29) has the only elevator; its right run (40 to
/// 59) has no transport. An office and a shop on the left, a shop on the
/// right. Returns the sim, the reachable shop and the stranded one.
fn stranded_venue() -> (Simulation, i64, i64) {
    let mut sim = split_floor(9, 60, &[0..30, 40..60]);
    shaft(&mut sim, Kind::ElevatorStandard, 0, 1, 2);
    let staff = Kind::Office.facility().population;
    place_seated(&mut sim, Kind::Office, 2, 5, UnitState::Occupied, staff);
    let near = place_seated(&mut sim, Kind::Shop, 2, 15, UnitState::Occupied, 0);
    let far = place_seated(&mut sim, Kind::Shop, 2, 44, UnitState::Occupied, 0);
    (sim, near, far)
}

#[test]
fn a_stranded_run_reads_unreachable_beside_a_reachable_one() {
    let (mut sim, near, far) = stranded_venue();
    let (near_x, far_x) = (
        sim.tower.get_unit(near).unwrap().x,
        sim.tower.get_unit(far).unwrap().x,
    );
    assert!(sim.tower.is_floor_served(2));
    assert!(sim.position_reachable(2, near_x));
    assert!(!sim.position_reachable(2, far_x));
}

#[test]
fn only_the_reachable_venue_shares_the_demand_pool() {
    let (mut sim, near, far) = stranded_venue();
    let map = compute_demand_map(&mut sim);
    assert_eq!(map.retail_venue_count, 2);
    assert!(map.fraction_by_unit.get(&near).is_some_and(|&f| f > 0.0));
    assert!(!map.fraction_by_unit.contains_key(&far));
}

/// Nobody is sent to a retail shop yet, so an open, reachable one still draws
/// its full head count (`Kind::is_meal_venue` keeps it on that rule), and the
/// stranded one, which nobody can reach, stays empty.
#[test]
fn traffic_fills_the_reachable_venue_and_leaves_the_stranded_one_empty() {
    let (mut sim, near, far) = stranded_venue();
    at_time(&mut sim, 0, 12);
    sim.collect_traffic_income();
    let full = Kind::Shop.facility().population;
    assert!(full > 0);
    assert_eq!(sim.tower.get_unit(near).unwrap().occupants, full);
    assert_eq!(sim.tower.get_unit(far).unwrap().occupants, 0);
}

/// A rider's shafts from the lobby to floor 2 at column `to_x`, asked 60
/// times so shaft balancing has its chances to re-pick.
fn shafts_to(sim: &mut Simulation, to_x: f64) -> Vec<Vec<i64>> {
    (0..60)
        .map(|_| {
            let r = sim.crowd.route(&sim.tower, 1, 2, Some(25.0), Some(to_x));
            r.expect("the run is reachable").shafts
        })
        .collect()
}

#[test]
fn balancing_never_moves_a_rider_to_the_other_wings_shaft() {
    let mut sim = split_floor(1, 50, &[0..20, 30..50]);
    let left = shaft(&mut sim, Kind::ElevatorStandard, 2, 1, 2);
    let right = shaft(&mut sim, Kind::ElevatorStandard, 42, 1, 2);
    assert!(shafts_to(&mut sim, 4.0).iter().all(|s| *s == vec![left]));
    assert!(shafts_to(&mut sim, 44.0).iter().all(|s| *s == vec![right]));
}

#[test]
fn an_elevator_straddling_a_gap_serves_both_runs() {
    let mut sim = split_floor(1, 60, &[0..11, 13..26]);
    let ev = shaft(&mut sim, Kind::ElevatorStandard, 10, 1, 2);
    assert!(!sim.tower.has_structure(2, 11) && !sim.tower.has_structure(2, 12));
    assert!(sim.position_reachable(2, 2), "run A");
    assert!(sim.position_reachable(2, 18), "run B, past the gap");
    for to_x in [2.0, 18.0] {
        let r = sim
            .crowd
            .route(&sim.tower, 1, 2, Some(25.0), Some(to_x))
            .unwrap();
        assert_eq!(r.shafts, vec![ev], "to column {to_x}");
    }
}

/// Floor 2 split at column 15 under an 8-wide stair at x 10 (center 14, on
/// run A), lobby to floor 2.
fn straddled_stair() -> (Simulation, i64) {
    let mut sim = split_floor(31, 41, &[0..15, 16..31]);
    let stairs = shaft(&mut sim, Kind::Stairs, 10, 1, 2);
    assert!(!sim.tower.has_structure(2, 15));
    (sim, stairs)
}

#[test]
fn a_rider_steps_off_a_straddling_stair_onto_the_run_they_asked_for() {
    let (mut sim, _) = straddled_stair();
    let crew = place_seated(&mut sim, Kind::Housekeeping, 2, 0, UnitState::Empty, 0);
    let room = place_seated(&mut sim, Kind::HotelSingle, 2, 20, UnitState::Empty, 0);
    let (ok, columns) = send_maid(&mut sim, crew, room, 600);
    assert!(columns.iter().any(|&c| c >= 16), "she reached run B");
    assert!(ok, "the cleaning job completed");
}

#[test]
fn a_straddling_shaft_never_banks_with_a_one_run_shaft() {
    let (mut sim, stairs) = straddled_stair();
    shaft(&mut sim, Kind::ElevatorStandard, 2, 1, 2);
    assert!(shafts_to(&mut sim, 20.0).iter().all(|s| *s == vec![stairs]));
}
