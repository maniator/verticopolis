//! Modern's elevator pool: 48 shafts of every elevator kind together, where
//! Classic keeps SimTower's 24 (owner, 2026-11-15). A tower at the limit
//! refuses the next shaft with the limit in its reason, and a saved Modern
//! tower with every shaft built loads all of them back. Stairs and
//! escalators have their own rules (`modern_flights.rs`).

use crate::clock::GameMode;
use crate::facilities::{transport_pools, Kind, MODERN_ELEVATOR_SHAFT_CAP};
use crate::load::deserialize;
use crate::sim::Simulation;

/// A tower in `mode` with a lobby and floors 2 to 12 over columns 10 to 120.
fn tower(mode: GameMode) -> Simulation {
    let mut sim = Simulation::new_game(1, mode);
    sim.money = 1e12;
    sim.star = 5;
    for x in 10..120 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        for floor in 2..=12 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    sim
}

/// The `n`th standard shaft, six to a column, each two floors tall.
fn elevator_spot(n: i64) -> (i64, i64) {
    let bottom = 1 + (n % 6) * 2;
    (10 + (n / 6) * 4, bottom)
}

fn build_elevators(sim: &mut Simulation, count: i64) {
    for n in 0..count {
        let (x, bottom) = elevator_spot(n);
        let r = sim.build_transport(Kind::ElevatorStandard, x, bottom, bottom + 1);
        assert!(r.ok, "shaft {n} at {x}, {bottom}: {:?}", r.reason);
    }
}

fn elevator_count(sim: &Simulation) -> usize {
    sim.tower
        .transports
        .iter()
        .filter(|t| t.kind.is_elevator())
        .count()
}

#[test]
fn modern_holds_twice_classics_elevator_shafts_in_one_pool() {
    let classic = transport_pools(GameMode::Classic);
    let modern = transport_pools(GameMode::Modern);
    assert_eq!(classic[0].cap, 24);
    assert_eq!(modern[0].cap, MODERN_ELEVATOR_SHAFT_CAP);
    assert_eq!(MODERN_ELEVATOR_SHAFT_CAP, 48);
    // Still one pool for standard, service and express.
    assert_eq!(modern[0].kinds, classic[0].kinds);
    assert!(modern[0].kinds.contains(&Kind::ElevatorExpress));
    // Classic's second pool holds its 64 stairs and escalators; Modern
    // sets no limit on them, so it has no second pool.
    assert_eq!(classic[1].cap, 64);
    assert_eq!(modern.len(), 1);
}

#[test]
fn each_mode_refuses_the_shaft_past_its_limit() {
    for (mode, cap) in [(GameMode::Classic, 24), (GameMode::Modern, 48)] {
        let mut sim = tower(mode);
        build_elevators(&mut sim, cap);
        assert_eq!(elevator_count(&sim), cap as usize);
        let (x, bottom) = elevator_spot(cap);
        // An express counts against the same pool.
        for kind in [Kind::ElevatorStandard, Kind::ElevatorExpress] {
            let r = sim.build_transport(kind, x, bottom, bottom + 1);
            assert!(!r.ok, "{mode:?} built {kind:?} number {}", cap + 1);
            assert_eq!(
                r.reason.as_deref(),
                Some(format!("Only {cap} elevator shafts allowed per tower.").as_str()),
                "{mode:?}"
            );
        }
    }
}

#[test]
fn a_modern_tower_with_every_shaft_loads_every_transport_back() {
    let mut sim = tower(GameMode::Modern);
    build_elevators(&mut sim, MODERN_ELEVATOR_SHAFT_CAP);
    // 64 stairs too, eleven to a column end to end, right of the shafts.
    for n in 0..64 {
        let (x, bottom) = (60 + (n / 11) * 8, 1 + n % 11);
        let r = sim.build_transport(Kind::Stairs, x, bottom, bottom + 1);
        assert!(r.ok, "stairs {n} at {x}, {bottom}: {:?}", r.reason);
    }
    assert_eq!(sim.tower.transports.len(), 112);
    let loaded = deserialize(&sim.serialize()).expect("the save loads");
    assert_eq!(loaded.tower.transports.len(), 112);
    assert_eq!(elevator_count(&loaded), 48);
}
