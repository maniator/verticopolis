//! Party halls and theaters share one cap of 16 in Classic (#1932), as the
//! 1994 save keeps one table of 16 records for both. Modern keeps a cap of
//! 16 for each kind.
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;

use super::{lay_row, put};

const CINEMA_WIDTH: i64 = 31;
const HALL_WIDTH: i64 = 24;

/// A 3-star tower in `mode` holding 8 theaters and 8 party halls, with empty
/// floors 6 and 7 left for a 17th.
fn sixteen_venues(mode: GameMode) -> Simulation {
    let mut sim = Simulation::new_game(16, mode);
    sim.money = 1e12;
    sim.star = 3;
    lay_row(&mut sim, Kind::Lobby, 1);
    for floor in 2..=7 {
        lay_row(&mut sim, Kind::Floor, floor);
    }
    for i in 0..8 {
        put(&mut sim, Kind::Cinema, 2, i * CINEMA_WIDTH);
    }
    for i in 0..5 {
        put(
            &mut sim,
            Kind::PartyHall,
            2,
            8 * CINEMA_WIDTH + i * HALL_WIDTH,
        );
    }
    for i in 0..3 {
        put(&mut sim, Kind::PartyHall, 4, i * HALL_WIDTH);
    }
    assert_eq!(sim.tower.count_kind(Kind::Cinema), 8);
    assert_eq!(sim.tower.count_kind(Kind::PartyHall), 8);
    sim
}

#[test]
fn classic_refuses_a_seventeenth_hall_or_theater() {
    let sim = sixteen_venues(GameMode::Classic);
    for kind in [Kind::Cinema, Kind::PartyHall] {
        let quote = sim.can_build(kind, 6, 0);
        assert!(!quote.ok, "{kind:?} past 16 venues");
        assert_eq!(
            quote.reason.as_deref(),
            Some("Only 16 party halls and theaters allowed per tower."),
            "{kind:?}"
        );
    }
}

#[test]
fn classic_builds_the_sixteenth_venue() {
    let mut sim = sixteen_venues(GameMode::Classic);
    let hall = sim
        .tower
        .units
        .iter()
        .rev()
        .find(|u| u.kind == Kind::PartyHall);
    let (floor, x) = hall.map(|u| (u.floor, u.x)).unwrap();
    assert!(sim.sell_at(floor, x), "a hall comes out");
    assert!(sim.can_build(Kind::Cinema, 6, 0).ok, "15 venues leave room");
}

#[test]
fn modern_keeps_a_cap_of_sixteen_for_each_kind() {
    let sim = sixteen_venues(GameMode::Modern);
    for kind in [Kind::Cinema, Kind::PartyHall] {
        assert!(sim.can_build(kind, 6, 0).ok, "{kind:?} past 16 venues");
    }
}
