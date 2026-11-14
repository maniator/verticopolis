//! Undo and redo of a sky bridge (Modern): a bridge's tiles stand over open
//! air, so putting one back asks the bridge's rules, not the story below.

use super::*;
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::gameplay::RemovalMethod;
use crate::sim::Simulation;
use crate::wasm::port::STATUS;

const SKY: i64 = 15;
const LEFT: std::ops::Range<i64> = 100..110;
const RIGHT: std::ops::Range<i64> = 120..130;

/// Two wings ten tiles apart on one ground lobby, each with a sky lobby on
/// floor 15, laid tile by tile so the automatic fill leaves the gap open.
fn wings() -> Engine {
    let mut sim = Simulation::new_game(1, GameMode::Modern);
    sim.money = 1e9;
    sim.star = 5;
    for x in LEFT.start..RIGHT.end {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    for floor in 2..=SKY {
        let kind = if floor == SKY {
            Kind::Lobby
        } else {
            Kind::Floor
        };
        for x in LEFT.chain(RIGHT) {
            assert!(sim.tower.place(kind, floor, x).ok, "{floor} {x}");
        }
    }
    Engine::of(sim)
}

fn bridge_tiles(e: &Engine) -> usize {
    (LEFT.end..RIGHT.start)
        .filter(|&x| e.sim.tower.is_skybridge_tile(SKY, x))
        .count()
}

#[test]
fn undo_and_redo_take_a_bridge_down_and_put_it_back() {
    let mut e = wings();
    let gap: Vec<i64> = (LEFT.end..RIGHT.start).collect();
    e.port_undo_capture("Build Lobby");
    assert_eq!(e.sim.paint_brush(Kind::Lobby, SKY, &gap).placed, 10);
    e.port_undo_commit();
    assert_eq!(e.port_undo()[STATUS], 1.0, "{:?}", e.last_reason_text());
    assert_eq!(bridge_tiles(&e), 0);
    assert_eq!(e.port_redo()[STATUS], 1.0, "{:?}", e.last_reason_text());
    assert_eq!(bridge_tiles(&e), 10);
    // Selling the middle of it, then undoing the sale, puts the tile back.
    let middle = e.sim.tower.unit_at(SKY, LEFT.end + 5).unwrap().id;
    e.port_undo_capture("Bulldoze");
    assert!(e.sim.remove_facility(middle, RemovalMethod::Bulldoze).ok);
    e.port_undo_commit();
    assert_eq!(bridge_tiles(&e), 9);
    assert_eq!(e.port_undo()[STATUS], 1.0, "{:?}", e.last_reason_text());
    assert_eq!(bridge_tiles(&e), 10);
}
