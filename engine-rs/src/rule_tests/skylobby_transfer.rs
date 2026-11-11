//! Express transfers at any express stop, in both modes (#509), from the
//! retired `skylobbyTransfer.integration.test.ts`: the 1994 original changes
//! from an express to a local at a plain floor that ends the express, so
//! routing does too; transfers at a sky lobby, the ground lobby, a plain
//! shared local stop, between stairs and an express and between two
//! expresses all route; a tower with no express routes the same in both
//! modes; the reachability probe agrees with the route and draws nothing
//! from the crowd's generator; and turning the transfer floor into a sky
//! lobby keeps the route.
use crate::clock::{CalendarKind, GameMode};
use crate::crowd::Crowd;
use crate::facilities::Kind;
use crate::sim::Simulation;

use super::shaft;

const WIDTH: i64 = 40;
const MODES: [GameMode; 2] = [GameMode::Classic, GameMode::Modern];

/// A lobby and plain floors 2 to `top` over 40 columns, with a lobby
/// instead on each of `sky_lobbies`.
fn base_tower(mode: GameMode, top: i64, sky_lobbies: &[i64]) -> Simulation {
    let mut sim = Simulation::new(1, mode, CalendarKind::RealWorld, false);
    for floor in 1..=top {
        let lobby = floor == 1 || sky_lobbies.contains(&floor);
        let kind = if lobby { Kind::Lobby } else { Kind::Floor };
        for x in 0..WIDTH {
            assert!(sim.tower.place(kind, floor, x).ok, "{kind:?} {floor} {x}");
        }
    }
    sim
}

fn route(sim: &mut Simulation, from: i64, to: i64) -> Option<(Vec<i64>, Vec<i64>)> {
    let r = sim.crowd.route(&sim.tower, from, to, None, None)?;
    Some((r.floors, r.shafts))
}

/// An express from 1 to 20 (20 a plain floor) and a local from 20 to 25.
fn plain_hub_tower(mode: GameMode) -> (Simulation, i64, i64) {
    let mut sim = base_tower(mode, 25, &[]);
    let express = shaft(&mut sim, Kind::ElevatorExpress, 4, 1, 20);
    let local = shaft(&mut sim, Kind::ElevatorStandard, 10, 20, 25);
    (sim, express, local)
}

#[test]
fn an_express_to_local_transfer_at_a_plain_express_end_routes_in_both_modes() {
    for mode in MODES {
        let (mut sim, express, local) = plain_hub_tower(mode);
        let (floors, shafts) = route(&mut sim, 1, 25).expect("routes");
        assert_eq!(shafts, vec![express, local], "{mode:?}");
        assert!(floors.contains(&20), "{mode:?} changes at floor 20");
        assert_eq!(
            route(&mut sim, 1, 20).unwrap().1,
            vec![express],
            "a direct ride"
        );
        assert_eq!(
            route(&mut sim, 20, 25).unwrap().1,
            vec![local],
            "a local hop"
        );
    }
}

#[test]
fn classic_transfers_at_a_sky_lobby_and_at_the_ground_lobby() {
    let mut sim = base_tower(GameMode::Classic, 25, &[15]);
    let express = shaft(&mut sim, Kind::ElevatorExpress, 4, 1, 15);
    let local = shaft(&mut sim, Kind::ElevatorStandard, 10, 15, 25);
    let (floors, shafts) = route(&mut sim, 1, 25).unwrap();
    assert_eq!(shafts, vec![express, local]);
    assert!(floors.contains(&15));

    let mut sim = base_tower(GameMode::Classic, 15, &[]);
    let express = shaft(&mut sim, Kind::ElevatorExpress, 4, 1, 15);
    let local = shaft(&mut sim, Kind::ElevatorStandard, 10, 1, 8);
    let (floors, shafts) = route(&mut sim, 15, 5).unwrap();
    assert_eq!(shafts, vec![express, local]);
    assert!(
        floors.contains(&1),
        "down the spine, across at the ground lobby"
    );
}

#[test]
fn a_local_to_local_transfer_at_a_plain_floor_routes_in_both_modes() {
    for mode in MODES {
        let mut sim = base_tower(mode, 20, &[]);
        let lower = shaft(&mut sim, Kind::ElevatorStandard, 4, 1, 10);
        let upper = shaft(&mut sim, Kind::ElevatorStandard, 10, 10, 20);
        let (floors, shafts) = route(&mut sim, 1, 18).unwrap();
        assert_eq!(shafts, vec![lower, upper], "{mode:?}");
        assert!(floors.contains(&10));
    }
}

/// With a local beside the express to floor 20, the fewest-ride search takes
/// the first-listed shaft off floor 1 (the express) and then the upper local.
#[test]
fn classic_finds_the_two_ride_route_through_a_plain_express_end() {
    let mut sim = base_tower(GameMode::Classic, 25, &[]);
    let express = shaft(&mut sim, Kind::ElevatorExpress, 4, 1, 20);
    shaft(&mut sim, Kind::ElevatorStandard, 10, 1, 20);
    let high = shaft(&mut sim, Kind::ElevatorStandard, 16, 20, 25);
    let (floors, shafts) = route(&mut sim, 1, 25).unwrap();
    assert_eq!(shafts, vec![express, high]);
    assert!(floors.contains(&20));
}

#[test]
fn stairs_after_an_express_and_two_expresses_end_to_end_route_in_both_modes() {
    for mode in MODES {
        let mut sim = base_tower(mode, 25, &[]);
        shaft(&mut sim, Kind::ElevatorExpress, 4, 1, 20);
        shaft(&mut sim, Kind::Stairs, 10, 20, 21);
        assert!(
            route(&mut sim, 1, 21).is_some(),
            "{mode:?} express then stairs"
        );

        let mut sim = base_tower(mode, 35, &[]);
        shaft(&mut sim, Kind::ElevatorExpress, 4, 1, 20);
        shaft(&mut sim, Kind::ElevatorExpress, 10, 20, 35);
        assert!(
            route(&mut sim, 1, 35).is_some(),
            "{mode:?} express to express"
        );
    }
}

#[test]
fn a_tower_with_no_express_routes_the_same_in_both_modes() {
    let locals = |mode| {
        let mut sim = base_tower(mode, 20, &[]);
        shaft(&mut sim, Kind::ElevatorStandard, 4, 1, 10);
        shaft(&mut sim, Kind::ElevatorStandard, 10, 10, 20);
        shaft(&mut sim, Kind::Escalator, 16, 1, 2);
        sim
    };
    let (mut classic, mut modern) = (locals(GameMode::Classic), locals(GameMode::Modern));
    for (from, to) in [(1, 2), (1, 10), (1, 18), (2, 20), (18, 1), (20, 2)] {
        let gated = route(&mut classic, from, to);
        assert!(gated.is_some(), "{from} to {to}");
        assert_eq!(gated, route(&mut modern, from, to), "{from} to {to}");
    }
}

#[test]
fn the_reachability_probe_agrees_with_the_route_and_draws_nothing() {
    for mode in MODES {
        let (mut sim, _, _) = plain_hub_tower(mode);
        assert!(route(&mut sim, 1, 25).is_some(), "{mode:?}");
        assert!(
            sim.crowd.reachable(&sim.tower, 1, 25, None, None),
            "{mode:?}"
        );
    }
    let (sim, _, _) = plain_hub_tower(GameMode::Classic);
    let (mut probe, mut untouched) = (Crowd::new(4242), Crowd::new(4242));
    assert!(probe.reachable(&sim.tower, 1, 20, None, None));
    assert_eq!(probe.rng.int(0, 1_000_000), untouched.rng.int(0, 1_000_000));
}

#[test]
fn making_the_transfer_floor_a_sky_lobby_keeps_the_route() {
    let mut sim = base_tower(GameMode::Classic, 30, &[]);
    shaft(&mut sim, Kind::ElevatorExpress, 4, 1, 15);
    shaft(&mut sim, Kind::ElevatorStandard, 10, 15, 25);
    assert!(route(&mut sim, 1, 25).is_some(), "floor 15 plain");
    for x in 0..WIDTH {
        let tile = sim
            .tower
            .unit_at(15, x)
            .filter(|u| u.kind == Kind::Floor)
            .map(|u| u.id);
        if let Some(id) = tile {
            sim.tower.remove_unit(id);
        }
    }
    for x in 0..WIDTH {
        assert!(sim.tower.place(Kind::Lobby, 15, x).ok, "sky lobby at {x}");
    }
    assert!(route(&mut sim, 1, 25).is_some(), "floor 15 a sky lobby");
}
