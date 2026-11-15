use super::{line_times, train_due, train_in, waits_for_train};
use crate::clock::GameMode;
use crate::crowd::motion::advance;
use crate::crowd::spawn::metro_arrival;
use crate::crowd::PState;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::Unit;

fn at(hour: i64, minute: i64) -> f64 {
    (hour * 60 + minute) as f64
}

#[test]
fn the_timetable_matches_the_one_the_renderer_draws() {
    // `metroLineTimes` in `src/render/metroTrainSchedule.ts`: a leg of 6
    // minutes, a dwell of 14 at most, the run inside 54 minutes.
    assert_eq!(line_times(1), (6.0, 14.0));
    assert_eq!(line_times(2), (6.0, 14.0));
    assert_eq!(line_times(3), (6.0, 10.0));
    // One station: in from 6 to 20 past each daytime hour.
    assert!(!train_in(at(9, 5), 0, 1));
    assert!(train_in(at(9, 6), 0, 1));
    assert!(train_in(at(9, 19), 0, 1));
    assert!(!train_in(at(9, 20), 0, 1));
    // Three stations: the middle one's call starts after the first call
    // and a leg, 6 + 10 + 6.
    assert!(!train_in(at(9, 21), 1, 3));
    assert!(train_in(at(9, 22), 1, 3));
    assert!(!train_in(at(9, 32), 1, 3));
    // No train overnight, on either side of the day's runs.
    assert!(!train_in(at(5, 10), 0, 1));
    assert!(train_in(at(6, 10), 0, 1));
    assert!(train_in(at(20, 10), 0, 1));
    assert!(!train_in(at(21, 10), 0, 1));
}

#[test]
fn a_train_is_due_until_the_day_s_last_call_ends() {
    assert!(!train_due(at(5, 59), 0, 1), "none before the first run");
    assert!(train_due(at(6, 0), 0, 1));
    assert!(train_due(at(19, 59), 0, 1));
    assert!(train_due(at(20, 19), 0, 1));
    assert!(!train_due(at(20, 20), 0, 1), "the last call has ended");
    assert!(
        train_due(at(20, 20), 2, 3),
        "the train is still on its way along the line"
    );
    assert!(!train_due(at(23, 0), 0, 1));
}

/// A Classic tower with a station under the ground lobby and a stair-free
/// elevator from the platform (-1) to the lobby.
fn metro_tower() -> (Simulation, Unit) {
    let mut sim = Simulation::new_game(1, GameMode::Classic);
    sim.money = 1e9;
    for x in 0..80 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        for floor in [0, -1, -2] {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    let id = sim.tower.place(Kind::Metro, -2, 0).unit_id.unwrap();
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorStandard, 70, -1, 1)
            .ok
    );
    let station = sim.tower.get_unit(id).unwrap().clone();
    (sim, station)
}

/// A rider back on the platform, at the end of their walk, about to leave
/// the tower by the Metro: someone who came by train and is going home.
fn leaver_on_platform(sim: &mut Simulation, station: &Unit) -> i64 {
    let i = metro_arrival(&mut sim.crowd, &sim.tower, station, 1).expect("a way up");
    let p = &mut sim.crowd.people[i];
    p.state = PState::ToDest;
    p.returning = true;
    p.dest_x = p.x;
    p.linger_for = Some(0.0);
    p.id
}

fn present(sim: &Simulation, id: i64) -> bool {
    sim.crowd.people.iter().any(|p| p.id == id)
}

#[test]
fn a_metro_leaver_waits_on_the_platform_for_the_train_and_boards_it() {
    let (mut sim, station) = metro_tower();
    let id = leaver_on_platform(&mut sim, &station);
    // Between trains the rider stays on the platform, however long the wait.
    for minute in [21, 30, 45, 59] {
        sim.crowd.minute = Some(at(9, minute));
        advance(&mut sim.crowd, 1.0, &mut sim.tower);
        assert!(present(&sim, id), "still waiting at 9:{minute}");
        let p = sim.crowd.people.iter().find(|p| p.id == id).unwrap();
        assert_eq!((p.floor, p.state), (station.floor + 1, PState::ToDest));
    }
    // The 10 o'clock train is in at 10:06; the rider boards and is gone.
    sim.crowd.minute = Some(at(10, 6));
    advance(&mut sim.crowd, 1.0, &mut sim.tower);
    assert!(!present(&sim, id), "boarded the train");
}

#[test]
fn after_the_last_train_a_metro_leaver_goes_out_by_the_lobby() {
    let (mut sim, station) = metro_tower();
    let id = leaver_on_platform(&mut sim, &station);
    sim.crowd.minute = Some(at(20, 30));
    advance(&mut sim.crowd, 1.0, &mut sim.tower);
    let p = sim
        .crowd
        .people
        .iter()
        .find(|p| p.id == id)
        .expect("never vanishes on the platform");
    assert_eq!(p.state, PState::ToShaft, "heads for the elevator up");
    assert_eq!(p.floors.last(), Some(&1), "out by the ground lobby");
    assert!(p.returning, "the trip still ends where it is going");
}

#[test]
fn a_crowd_stepped_on_its_own_lets_a_leaver_go_at_once() {
    // A crowd stepped outside the sim loop reads no clock, so it keeps the
    // old ending: the rider leaves as soon as they reach the platform.
    let (mut sim, station) = metro_tower();
    let id = leaver_on_platform(&mut sim, &station);
    let i = sim.crowd.people.iter().position(|p| p.id == id).unwrap();
    assert!(!waits_for_train(&mut sim.crowd, i, &sim.tower));
}

#[test]
fn someone_leaving_elsewhere_never_waits_for_a_train() {
    // A rider who ends their walk off the station (the platform's far end)
    // leaves as before: only the station itself has a train.
    let (mut sim, station) = metro_tower();
    let id = leaver_on_platform(&mut sim, &station);
    let i = sim.crowd.people.iter().position(|p| p.id == id).unwrap();
    sim.crowd.people[i].x = (station.x + station.width + 5) as f64;
    sim.crowd.minute = Some(at(9, 30));
    assert!(!waits_for_train(&mut sim.crowd, i, &sim.tower));
}

#[test]
fn a_metro_visitor_out_after_the_last_train_heads_for_the_lobby() {
    // A visitor who came by train and leaves a venue at night routes to the
    // ground lobby rather than to a platform no train will call at.
    for (minute, out) in [(at(14, 0), -1), (at(22, 0), 1)] {
        let (mut sim, station) = metro_tower();
        let id = leaver_on_platform(&mut sim, &station);
        let i = sim.crowd.people.iter().position(|p| p.id == id).unwrap();
        // Up in the lobby, at the end of a stay.
        let p = &mut sim.crowd.people[i];
        p.floor = 1;
        p.fy = 1.0;
        p.x = 10.0;
        p.returning = false;
        p.state = PState::Dwelling;
        p.dwell_seconds_left = Some(0.0);
        sim.crowd.minute = Some(minute);
        advance(&mut sim.crowd, 1.0, &mut sim.tower);
        let p = sim.crowd.people.iter().find(|p| p.id == id).unwrap();
        assert_eq!(p.floors.last(), Some(&out), "at minute {minute}");
    }
}

/// `metro_tower` with an occupied office on floor 2 that the platform's
/// elevator reaches, so the morning sends Metro riders to it.
fn metro_tower_with_office() -> Simulation {
    let (mut sim, _) = metro_tower();
    for x in 0..80 {
        assert!(sim.tower.place(Kind::Floor, 2, x).ok);
    }
    let shaft = sim.tower.transports[0].id;
    assert!(sim.tower.resize_transport(shaft, -1, 2).ok);
    let id = sim.tower.place(Kind::Office, 2, 10).unit_id.unwrap();
    sim.tower.get_unit_mut(id).unwrap().state = crate::tower::UnitState::Occupied;
    sim
}

/// How many Metro riders the crowd's spawns send in at `hour:minute` over
/// many draws.
fn metro_arrivals_at(hour: i64, minute: i64) -> usize {
    let mut sim = metro_tower_with_office();
    sim.clock.minutes = 1440.0 + at(hour, minute);
    for _ in 0..400 {
        let population = sim.tower.total_population();
        crate::crowd::spawn::spawn_step(
            &mut sim.crowd,
            0.5,
            &mut sim.tower,
            &sim.clock,
            Some(crate::sim_loop::Weather::Clear),
            population,
        );
    }
    sim.crowd.people.iter().filter(|p| p.from_metro).count()
}

#[test]
fn a_metro_rider_arrives_only_off_a_train_standing_at_the_station() {
    // The 8 o'clock train stands at the station from 8:06 to 8:20. Between
    // trains nobody steps onto the platform from nowhere.
    assert!(metro_arrivals_at(8, 10) > 0, "riders step off the train");
    assert_eq!(metro_arrivals_at(8, 30), 0, "no train, no arrivals");
}
