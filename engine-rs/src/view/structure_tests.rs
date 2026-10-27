//! The structure's tile runs on hand-built towers: tiles laid out of order,
//! a tile off the grid and two tiles on one cell; and the header's scene
//! seed. The seeded sessions' runs are checked in `oracle_tests.rs`.
use super::layout::{run, structure, ROOM_RECORD, RUN_RECORD, STRUCTURE_HEADER};
use super::oracle_tests::same;
use super::*;
use crate::clock::GameMode;
use crate::facilities::Kind;

#[test]
fn tiles_laid_out_of_order_join_one_run() {
    let mut sim = Simulation::new_game(1, GameMode::Classic);
    for x in 0..=2 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    for x in [0, 2, 1] {
        assert!(sim.tower.place(Kind::Floor, 2, x).ok);
    }
    let v = structure_view(&sim);
    let at = STRUCTURE_HEADER + v[structure::ROOMS] as usize * ROOM_RECORD;
    let runs = &v[at..at + v[structure::RUNS] as usize * RUN_RECORD];
    let floor2 = runs
        .chunks_exact(RUN_RECORD)
        .filter(|r| r[run::FLOOR] == 2.0)
        .collect::<Vec<_>>();
    assert_eq!(floor2.len(), 1, "the floor-2 tiles are one maximal run");
    assert_eq!(floor2[0][run::X], 0.0);
    assert_eq!(floor2[0][run::COUNT], 3.0);
    assert!(super::structure::grid_reads(&sim.tower));
}

/// The header carries the seed the tower was founded with, whole (a `u32`,
/// exact in an `f64`), beside the mode and the calendar.
#[test]
fn the_header_carries_the_scene_seed() {
    let sim = Simulation::new_game(4_000_000_007, GameMode::Modern);
    let v = structure_view(&sim);
    assert_eq!(v[structure::SCENE_SEED], 4_000_000_007.0);
    assert_eq!(v[structure::MODE], 1.0);
    let calendar = super::structure::calendar_code(sim.modern_calendar);
    assert_eq!(v[structure::CALENDAR], calendar);
}

#[test]
fn a_tile_off_the_grid_falls_back_to_the_walk() {
    // No save the loader accepts holds one, but a tile outside the grid
    // still gives the walk's runs.
    let mut sim = Simulation::new_game(1, GameMode::Classic);
    for (kind, floor) in [(Kind::Lobby, 1), (Kind::Floor, 2)] {
        for x in 0..=2 {
            assert!(sim.tower.place(kind, floor, x).ok);
        }
    }
    let at = |u: &crate::tower::Unit| u.floor == 2 && u.x == 2;
    let i = sim.tower.units.iter().position(at).unwrap();
    sim.tower.units[i].x = -1;
    sim.tower.revision += 1;
    assert!(!super::structure::grid_reads(&sim.tower));
    let walked = super::structure::run_records(&sim.tower, usize::MAX);
    let grid = super::structure::run_records(&sim.tower, 0);
    assert!(same(&grid, &walked), "the grid falls back to the walk");
    let floor2: Vec<_> = grid
        .chunks_exact(RUN_RECORD)
        .filter(|r| r[run::FLOOR] == 2.0)
        .collect();
    assert_eq!(floor2.len(), 1, "the floor-2 tiles are one run");
    assert_eq!((floor2[0][run::X], floor2[0][run::COUNT]), (-1.0, 3.0));
}

/// Two tiles on one cell (no save the loader accepts holds them) give the
/// grid no single tile for the cell, so the read falls back to the walk.
#[test]
fn stacked_tiles_fall_back_to_the_walk() {
    let mut sim = Simulation::new_game(1, GameMode::Classic);
    for (kind, floor) in [(Kind::Lobby, 1), (Kind::Floor, 2)] {
        for x in 0..=2 {
            assert!(sim.tower.place(kind, floor, x).ok);
        }
    }
    let at = |u: &crate::tower::Unit| u.floor == 2 && u.x == 2;
    let i = sim.tower.units.iter().position(at).unwrap();
    sim.tower.units[i].x = 1;
    sim.tower.revision += 1;
    assert!(!super::structure::grid_reads(&sim.tower));
    let walked = super::structure::run_records(&sim.tower, usize::MAX);
    let grid = super::structure::run_records(&sim.tower, 0);
    assert!(same(&grid, &walked), "a shared cell falls back to the walk");
}
