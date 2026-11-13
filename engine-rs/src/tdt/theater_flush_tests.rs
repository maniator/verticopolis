//! Theaters built flush side by side survive a trip through a `.TDT` file as
//! separate theaters. Each theater floor is written as a 7-tile screen piece
//! with its auditorium on the right (#2044), so one theater's auditorium ends
//! where its right-hand neighbor's screen starts. The import joins a screen
//! only to the auditorium on its right, so the neighbors stay apart.

use serde_json::{json, Value};

use super::export::build_tdt;
use super::parse::parse_tdt;
use crate::clock::GameMode;
use crate::facilities::{Kind, LOT_WIDTH};
use crate::sim::Simulation;
use crate::tower::UnitState;

const THEATER_WIDTH: i64 = 31;
/// A bound on the hours a new theater takes to open, so a theater that never
/// opens fails the test instead of looping.
const HOURS_TO_OPEN: usize = 24;

/// A Classic tower with a lobby on floor 1 under x `from..to`, rich and
/// rated three stars so it may build theaters.
fn lobby_site(from: i64, to: i64) -> Simulation {
    let mut sim = Simulation::new_game(7, GameMode::Classic);
    sim.money = 1e9;
    sim.star = 3;
    let lobby = Kind::Lobby.facility().width;
    let mut x = from;
    while x < to {
        let built = sim.build(Kind::Lobby, 1, x);
        assert!(built.ok, "lobby at {x}: {:?}", built.reason);
        x += lobby;
    }
    sim
}

/// Builds a theater at each `(floor, x)`, checks every build went through,
/// so a refused build cannot pass as a merge, and runs the clock until each
/// theater has opened, since only a finished theater takes a table row.
fn build_theaters(sim: &mut Simulation, at: &[(i64, i64)]) {
    for &(floor, x) in at {
        let built = sim.build(Kind::Cinema, floor, x);
        assert!(built.ok, "theater at ({floor}, {x}): {:?}", built.reason);
    }
    let opened = |sim: &Simulation| {
        at.iter().all(|&(floor, x)| {
            let theater = sim.tower.unit_at(floor, x).expect("the theater stands");
            theater.kind == Kind::Cinema && theater.state != UnitState::Construction
        })
    };
    for _ in 0..HOURS_TO_OPEN {
        if opened(sim) {
            break;
        }
        sim.tick(60.0);
    }
    assert!(
        opened(sim),
        "every theater opens within {HOURS_TO_OPEN} hours"
    );
}

/// The save with each theater given its own film age, keyed by its x and
/// floor, so the round trip can show every theater kept its own table row.
fn with_film_days(sim: &Simulation, days: &[((i64, i64), i64)]) -> Value {
    let mut save = sim.serialize();
    for unit in save["units"].as_array_mut().unwrap() {
        let at = (unit["floor"].as_i64().unwrap(), unit["x"].as_i64().unwrap());
        if let Some(&(_, d)) = days.iter().find(|(where_, _)| *where_ == at) {
            unit["filmDays"] = json!(d);
        }
    }
    save
}

/// Every theater the exported file imports back as, as
/// `(floor, x, width, filmDays)`, sorted.
fn round_trip(save: &Value) -> Vec<(i64, i64, i64, i64)> {
    let built = build_tdt(save).expect("exports");
    let back = parse_tdt(&built.bytes, "TOWER.TDT").expect("imports");
    let mut theaters: Vec<_> = back.save["units"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|u| u["kind"] == "cinema")
        .map(|u| {
            (
                u["floor"].as_i64().unwrap(),
                u["x"].as_i64().unwrap(),
                u["width"].as_i64().unwrap(),
                u["filmDays"].as_i64().unwrap_or(-1),
            )
        })
        .collect();
    theaters.sort();
    theaters
}

#[test]
fn two_flush_theaters_come_back_as_two() {
    let mut sim = lobby_site(90, 180);
    build_theaters(&mut sim, &[(2, 100), (2, 131)]);
    let save = with_film_days(&sim, &[((2, 100), 2), ((2, 131), 5)]);
    assert_eq!(
        round_trip(&save),
        vec![(2, 100, THEATER_WIDTH, 2), (2, 131, THEATER_WIDTH, 5)]
    );
}

#[test]
fn three_flush_theaters_in_a_row_come_back_as_three() {
    let mut sim = lobby_site(90, 200);
    build_theaters(&mut sim, &[(2, 100), (2, 131), (2, 162)]);
    let save = with_film_days(&sim, &[((2, 100), 1), ((2, 131), 4), ((2, 162), 7)]);
    assert_eq!(
        round_trip(&save),
        vec![
            (2, 100, THEATER_WIDTH, 1),
            (2, 131, THEATER_WIDTH, 4),
            (2, 162, THEATER_WIDTH, 7)
        ]
    );
}

/// Two flush pairs, one stacked on the other: the pieces touch sideways and
/// overlap vertically, and each theater still comes back on its own.
#[test]
fn flush_theaters_stacked_on_two_floors_come_back_as_four() {
    let mut sim = lobby_site(90, 180);
    build_theaters(&mut sim, &[(2, 100), (2, 131), (4, 100), (4, 131)]);
    let save = with_film_days(
        &sim,
        &[((2, 100), 1), ((2, 131), 2), ((4, 100), 3), ((4, 131), 4)],
    );
    assert_eq!(
        round_trip(&save),
        vec![
            (2, 100, THEATER_WIDTH, 1),
            (2, 131, THEATER_WIDTH, 2),
            (4, 100, THEATER_WIDTH, 3),
            (4, 131, THEATER_WIDTH, 4)
        ]
    );
}

/// A theater whose auditorium ends on the lot's last tile, with a flush
/// neighbor on its left.
#[test]
fn a_theater_against_the_right_lot_edge_comes_back_whole() {
    let edge_x = LOT_WIDTH - THEATER_WIDTH;
    let neighbor_x = edge_x - THEATER_WIDTH;
    let mut sim = lobby_site(neighbor_x - 10, LOT_WIDTH);
    build_theaters(&mut sim, &[(2, neighbor_x), (2, edge_x)]);
    let save = with_film_days(&sim, &[((2, neighbor_x), 3), ((2, edge_x), 6)]);
    assert_eq!(
        round_trip(&save),
        vec![
            (2, neighbor_x, THEATER_WIDTH, 3),
            (2, edge_x, THEATER_WIDTH, 6)
        ]
    );
}

/// A lone theater still merges its screen and auditorium into one.
#[test]
fn a_lone_built_theater_still_comes_back_as_one() {
    let mut sim = lobby_site(90, 180);
    build_theaters(&mut sim, &[(2, 100)]);
    let save = with_film_days(&sim, &[((2, 100), 3)]);
    assert_eq!(round_trip(&save), vec![(2, 100, THEATER_WIDTH, 3)]);
}
