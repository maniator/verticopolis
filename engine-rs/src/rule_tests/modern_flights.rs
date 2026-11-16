//! Stairs and escalators: Modern sets no limit on them (owner, 2026-11-16),
//! so a tower builds as many flights as its lot holds and a save keeps every
//! one. Classic keeps SimTower's 64, one pool for both kinds, and refuses the
//! next flight with the limit in its reason.

use crate::clock::GameMode;
use crate::facilities::{
    lot_flight_room, transport_cap, transport_pools, Kind, LOT_WIDTH, MAX_FLOOR, MIN_FLOOR,
};
use crate::load::deserialize;
use crate::sim::Simulation;

/// Classic's limit on stairs and escalators together, SimTower's 64.
const CLASSIC_FLIGHTS: i64 = 64;
/// More flights than Classic allows: what a Modern tower builds here.
const MANY_FLIGHTS: i64 = 150;

/// A tower in `mode` with a lobby and floors 2 to 12 across the whole lot.
fn tower(mode: GameMode) -> Simulation {
    let mut sim = Simulation::new_game(1, mode);
    sim.money = 1e12;
    sim.star = 5;
    for x in 0..LOT_WIDTH {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        for floor in 2..=12 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    sim
}

/// The `n`th flight of `kind`: eleven to a column, each on the last, from
/// the left edge of the lot.
fn flight_spot(kind: Kind, n: i64) -> (i64, i64) {
    let width = kind.facility().width;
    ((n / 11) * width, 1 + n % 11)
}

fn build_flights(sim: &mut Simulation, kind: Kind, count: i64) {
    for n in 0..count {
        let (x, bottom) = flight_spot(kind, n);
        let r = sim.build_transport(kind, x, bottom, bottom + 1);
        assert!(r.ok, "{kind:?} {n} at {x}, {bottom}: {:?}", r.reason);
    }
}

fn flight_count(sim: &Simulation) -> i64 {
    let flights = sim.tower.transports.iter();
    flights.filter(|t| t.kind.is_walkway()).count() as i64
}

#[test]
fn only_classic_keeps_a_pool_for_stairs_and_escalators() {
    let has_flight_pool = |mode| {
        transport_pools(mode)
            .iter()
            .any(|p| p.kinds.contains(&Kind::Stairs) || p.kinds.contains(&Kind::Escalator))
    };
    assert!(GameMode::Classic.limits_stairs_and_escalators());
    assert!(has_flight_pool(GameMode::Classic));
    assert!(!GameMode::Modern.limits_stairs_and_escalators());
    assert!(!has_flight_pool(GameMode::Modern));
}

#[test]
fn classic_refuses_the_flight_past_64_of_either_kind() {
    let mut sim = tower(GameMode::Classic);
    build_flights(&mut sim, Kind::Stairs, CLASSIC_FLIGHTS);
    assert_eq!(flight_count(&sim), CLASSIC_FLIGHTS);
    // Stairs and escalators share the one limit.
    for kind in [Kind::Stairs, Kind::Escalator] {
        let (x, bottom) = (300, 5);
        let r = sim.build_transport(kind, x, bottom, bottom + 1);
        assert!(!r.ok, "Classic built {kind:?} number 65");
        assert_eq!(
            r.reason.as_deref(),
            Some("Only 64 stairs/escalators allowed per tower."),
            "{kind:?}"
        );
    }
}

#[test]
fn modern_builds_stairs_and_escalators_past_64() {
    let mut sim = tower(GameMode::Modern);
    build_flights(&mut sim, Kind::Stairs, MANY_FLIGHTS);
    // An escalator after them, right of the stairs' columns.
    let r = sim.build_transport(Kind::Escalator, 300, 5, 6);
    assert!(r.ok, "{:?}", r.reason);
    assert_eq!(flight_count(&sim), MANY_FLIGHTS + 1);
}

#[test]
fn a_modern_save_keeps_every_flight() {
    let mut sim = tower(GameMode::Modern);
    build_flights(&mut sim, Kind::Stairs, MANY_FLIGHTS);
    let loaded = deserialize(&sim.serialize()).expect("the save loads");
    assert_eq!(flight_count(&loaded), MANY_FLIGHTS);
    let places = |s: &Simulation| -> Vec<_> {
        let flights = s.tower.transports.iter();
        flights.map(|t| (t.kind, t.x, t.bottom, t.top)).collect()
    };
    assert_eq!(places(&loaded), places(&sim));
}

/// The lot's room is a real bound: one story holds a row of stairs across the
/// lot and refuses one more anywhere on it, so the most a Modern save can
/// hold is that row on every story, which is the loader's bound.
#[test]
fn the_lot_bounds_modern_flights_and_the_loader_keeps_that_many() {
    let mut sim = tower(GameMode::Modern);
    let width = Kind::Stairs.facility().width;
    let mut row = 0;
    while (row + 1) * width <= LOT_WIDTH {
        let r = sim.build_transport(Kind::Stairs, row * width, 1, 2);
        assert!(r.ok, "stairs {row}: {:?}", r.reason);
        row += 1;
    }
    for x in 0..LOT_WIDTH {
        let r = sim.build_transport(Kind::Stairs, x, 1, 2);
        assert!(!r.ok, "a story held another flight at {x}");
    }
    assert_eq!(lot_flight_room(), row * (MAX_FLOOR - MIN_FLOOR));
    let shafts = transport_pools(GameMode::Modern)[0].cap;
    assert_eq!(transport_cap(GameMode::Modern), shafts + lot_flight_room());
    assert_eq!(transport_cap(GameMode::Classic), 24 + CLASSIC_FLIGHTS);
}
