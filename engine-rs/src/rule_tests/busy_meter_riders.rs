//! The elevator busy meter (the hourly demand ring, the utilization behind
//! "Avg load", the schedule advice and Auto-tune) counts everyone aboard,
//! each once (#2397): the waiting estimate's seats in each car and the
//! crowd's own riders. Before, it read each car's notional load plus the
//! commuters riding, so visitors, residents, guests and staff riding as
//! people were missing and a shaft busy with a cinema's crowd read empty.
use crate::clock::GameMode;
use crate::crowd::motion::advance;
use crate::crowd::spawn::make_person;
use crate::crowd::{PState, Route};
use crate::dispatch::Leaving;
use crate::facilities::Kind;
use crate::load::{decode_vctower_bytes, deserialize};
use crate::sim::Simulation;

use super::{shaft, strip_tower};

const VENUE_FLOOR: i64 = 3;
const LOBBY: i64 = 1;
const EVENING: usize = 18;

#[test]
fn a_venue_crowd_that_fills_a_car_reads_as_a_full_shaft() {
    let mut sim = strip_tower(7, GameMode::Modern, 40, 6);
    let id = shaft(&mut sim, Kind::ElevatorStandard, 4, 1, 6);
    let t = sim
        .tower
        .transports
        .iter_mut()
        .find(|t| t.id == id)
        .unwrap();
    assert_eq!(t.cars, 1);
    (t.car_positions[0], t.car_dir[0]) = (VENUE_FLOOR as f64, 0);
    let seats = t.kind.car_capacity() as usize;
    sim.crowd.open_cars = vec![(id, 0, VENUE_FLOOR, Leaving::Either)];
    // The film lets out: a carload of visitors, none of them commuters,
    // waits at the open car to ride down to the lobby.
    let route = Route {
        floors: vec![VENUE_FLOOR, LOBBY],
        shafts: vec![id],
    };
    for _ in 0..seats {
        let i = make_person(&mut sim.crowd, &sim.tower, route.clone(), 30.0, None);
        let p = &mut sim.crowd.people[i];
        (p.state, p.floor, p.fy, p.x) = (PState::Waiting, VENUE_FLOOR, VENUE_FLOOR as f64, 6.0);
        assert!(!p.commuter);
    }
    for _ in 0..100 {
        advance(&mut sim.crowd, 0.1, &mut sim.tower);
    }
    let riding = sim
        .crowd
        .people
        .iter()
        .filter(|p| p.state == PState::Riding);
    assert_eq!(riding.count(), seats, "the car took the whole crowd");
    // The top of the next hour closes the evening hour the car filled in.
    sim.clock.minutes = (EVENING + 1) as f64 * 60.0;
    sim.sample_elevator_util();
    assert_eq!(sim.telemetry.hourly[&id].weekday[EVENING], 1.0);
    assert_eq!(sim.telemetry.util[&id], 1.0);
}

/// The owner's Modern split tower (`split-tower-26`, saved at 9 AM), played
/// `minutes` in one-minute steps.
fn split_tower_after(minutes: usize) -> Simulation {
    let bytes = include_bytes!("../../../conformance/fixtures/regression/split-tower-26.vctower");
    let save = decode_vctower_bytes(bytes).expect("the fixture decodes");
    let mut sim = deserialize(&save).expect("the fixture loads");
    assert_eq!(sim.tower.mode, GameMode::Modern);
    for _ in 0..minutes {
        sim.tick(1.0);
    }
    sim
}

/// Everyone aboard each elevator as the meter counts them, in shaft order.
fn aboard(sim: &Simulation) -> Vec<(i64, f64)> {
    let floors = sim.tower.dispatch_floors();
    let elevators = floors.elevators.iter().map(|&ti| &sim.tower.transports[ti]);
    let count = |t| sim.elevators.riders_aboard(t, &sim.crowd);
    elevators.map(|t| (t.id, count(t))).collect()
}

#[test]
fn the_owners_split_tower_counts_its_crowd_riders_and_a_save_keeps_the_count() {
    let mut sim = split_tower_after(20);
    let crowd_riders: i64 = sim.crowd.car_riders.sorted().iter().map(|(_, n)| **n).sum();
    assert!(crowd_riders > 0, "the morning crowd is riding");
    let before = aboard(&sim);
    let counted: f64 = before.iter().map(|(_, n)| n).sum();
    assert!(
        counted >= crowd_riders as f64,
        "{counted} against {crowd_riders} riders"
    );
    // A save made mid-ride reloads to the same count, and both games go on
    // to sample the same busy hour.
    let mut back = deserialize(&sim.serialize()).expect("the save reloads");
    assert_eq!(aboard(&back), before);
    while sim.clock.hour() < 10 {
        sim.tick(1.0);
        back.tick(1.0);
    }
    assert_eq!(aboard(&back), aboard(&sim));
    sim.sample_elevator_util();
    back.sample_elevator_util();
    assert_eq!(back.telemetry.hourly, sim.telemetry.hourly);
    assert_eq!(back.telemetry.util, sim.telemetry.util);
}

#[test]
fn a_save_from_before_the_seats_were_kept_reads_its_cars_load_as_the_estimates() {
    let sim = split_tower_after(20);
    let mut save = sim.serialize();
    let cars = save["dispatch"]["cars"].as_array_mut().unwrap();
    for car in cars.iter_mut() {
        car.as_object_mut().unwrap().remove("estimateSeats");
    }
    let old = deserialize(&save).expect("an older save loads");
    let floors = old.tower.dispatch_floors();
    for &ti in &floors.elevators {
        let t = &old.tower.transports[ti];
        let riders: i64 = (0..t.cars)
            .map(|car| old.crowd.car_riders.get(&(t.id, car)).copied().unwrap_or(0))
            .sum();
        let load: f64 = if t.kind.is_staff_only_transport() {
            0.0
        } else {
            t.car_load.iter().flatten().sum()
        };
        let counted = old.elevators.riders_aboard(t, &old.crowd);
        assert_eq!(counted, load + riders as f64, "shaft {}", t.id);
    }
}
