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
