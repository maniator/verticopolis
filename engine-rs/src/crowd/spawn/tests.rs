use super::{metro_arrival, metro_departure, seed_for};
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;

#[test]
fn seed_matches_the_javascript_expression() {
    // Node: (id * 2654435761) | 0 for each id.
    assert_eq!(seed_for(1), -1640531535);
    assert_eq!(seed_for(2), 1013904226);
    assert_eq!(seed_for(3_400_000), -1911161536);
    assert_eq!(seed_for(10_000_000), -568160640);
}

#[test]
fn only_a_metro_arrival_is_marked_as_off_the_metro() {
    // An arriving rider's wait belongs to the floor it heads for (#1971);
    // a departing one leaves from its tenant's floor as anyone does.
    let mut sim = Simulation::new_game(1, GameMode::Classic);
    sim.money = 1e9;
    for x in 0..80 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        for floor in [0, -1, -2] {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    let id = sim.tower.place(Kind::Metro, -2, 0).unit_id.unwrap();
    // A shaft from the platform (-1) up to the lobby gives both trips a route.
    let shaft = sim.tower.place_transport(Kind::ElevatorStandard, 70, -1, 1);
    assert!(shaft.ok);
    let station = sim.tower.get_unit(id).unwrap().clone();
    metro_arrival(&mut sim.crowd, &sim.tower, &station, 1);
    metro_departure(&mut sim.crowd, &sim.tower, &station, 1);
    let marks: Vec<bool> = sim.crowd.people.iter().map(|p| p.from_metro).collect();
    assert_eq!(marks, [true, false]);
}

/// A platform floor split in two runs, the station under the left one, and
/// an elevator from each run up to the lobby. Returns the sim, the station
/// and the left and right elevators.
fn split_platform() -> (Simulation, crate::tower::Unit, i64, i64) {
    let mut sim = Simulation::new_game(1, GameMode::Classic);
    sim.money = 1e9;
    for x in 0..200 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    for x in (0..80).chain(120..200) {
        for floor in [0, -1] {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok, "{floor}/{x}");
        }
    }
    for x in 0..80 {
        assert!(sim.tower.place(Kind::Floor, -2, x).ok);
    }
    let id = sim.tower.place(Kind::Metro, -2, 0).unit_id.unwrap();
    assert_eq!(sim.tower.segments_of(-1).len(), 2, "two platform runs");
    let left = sim.tower.place_transport(Kind::ElevatorStandard, 70, -1, 1);
    let right = sim
        .tower
        .place_transport(Kind::ElevatorStandard, 150, -1, 1);
    assert!(left.ok && right.ok);
    let ids: Vec<i64> = sim.tower.transports.iter().map(|t| t.id).collect();
    let station = sim.tower.get_unit(id).unwrap().clone();
    (sim, station, ids[0], ids[1])
}

#[test]
fn a_metro_rider_routes_from_the_station_s_own_run_of_the_platform() {
    // The rider stands at the station, so the route starts there and
    // takes the elevator in the station's run, never one across a gap in
    // the platform (review of the r/tycoon fix, F2).
    let (mut sim, station, left, _) = split_platform();
    for _ in 0..12 {
        let i = metro_arrival(&mut sim.crowd, &sim.tower, &station, 1).expect("a way up");
        assert_eq!(
            sim.crowd.people[i].shafts,
            [left],
            "up from the station's run"
        );
        let i = metro_departure(&mut sim.crowd, &sim.tower, &station, 1).expect("a way down");
        assert_eq!(
            sim.crowd.people[i].shafts,
            [left],
            "down to the station's run"
        );
    }
}

#[test]
fn metro_riders_still_spread_over_every_run_of_their_other_floor() {
    // Fixing the station end must not pin the other end too: a rider bound
    // for a floor of several runs ends in any of them, as before, never only
    // the run nearest the station (review of the fast follow, F1).
    let (mut sim, station, _, _) = split_platform();
    let (mut up, mut down) = ([0; 2], [0; 2]);
    for _ in 0..40 {
        if let Some(i) = metro_arrival(&mut sim.crowd, &sim.tower, &station, 0) {
            up[usize::from(sim.crowd.people[i].dest_x >= 100.0)] += 1;
        }
        if let Some(i) = metro_departure(&mut sim.crowd, &sim.tower, &station, 0) {
            down[usize::from(sim.crowd.people[i].start_x >= 100.0)] += 1;
        }
    }
    assert!(
        up.iter().all(|&n| n > 0),
        "arrivals end in both runs: {up:?}"
    );
    assert!(
        down.iter().all(|&n| n > 0),
        "departures start in both runs: {down:?}"
    );
}
