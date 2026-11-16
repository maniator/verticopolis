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
    e.port_undo_capture("Build Sky Bridge");
    assert!(e.sim.build_skybridge(SKY, LEFT.end).ok);
    e.port_undo_commit();
    assert_eq!(e.port_undo()[STATUS], 1.0, "{:?}", e.last_reason_text());
    assert_eq!(bridge_tiles(&e), 0);
    assert_eq!(e.port_redo()[STATUS], 1.0, "{:?}", e.last_reason_text());
    assert_eq!(bridge_tiles(&e), 10);
    // Bulldozing the middle takes the whole bridge, and one undo puts it all
    // back; a redo takes it all again.
    let middle = e.sim.tower.unit_at(SKY, LEFT.end + 5).unwrap().id;
    e.port_undo_capture("Bulldoze");
    assert!(e.sim.remove_facility(middle, RemovalMethod::Bulldoze).ok);
    e.port_undo_commit();
    assert_eq!(bridge_tiles(&e), 0);
    assert_eq!(e.port_undo()[STATUS], 1.0, "{:?}", e.last_reason_text());
    assert_eq!(bridge_tiles(&e), 10);
    assert_eq!(e.port_redo()[STATUS], 1.0, "{:?}", e.last_reason_text());
    assert_eq!(bridge_tiles(&e), 0);
}

#[test]
fn the_port_quotes_and_lays_a_whole_bridge() {
    let mut e = wings();
    let quote = e.port_quote_skybridge(SKY as f64, (LEFT.end + 3) as f64);
    assert_eq!(quote[0], 1.0, "{:?}", e.last_reason_text());
    assert_eq!([quote[2], quote[3]], [LEFT.end as f64, RIGHT.start as f64]);
    let rec = e.port_build_skybridge(SKY as f64, (LEFT.end + 3) as f64);
    assert_eq!(rec[STATUS], 1.0, "{:?}", e.last_reason_text());
    assert_eq!(rec[2], 10.0, "the tiles slot counts the tiles laid");
    assert_eq!(rec[1], -quote[1], "the delta is the quoted price");
    assert_eq!(bridge_tiles(&e), 10);
    // A second click finds the bridge finished and says so.
    let again = e.port_build_skybridge(SKY as f64, (LEFT.end + 3) as f64);
    assert_eq!(again[STATUS], 0.0);
    assert!(e
        .last_reason_text()
        .is_some_and(|r| r.contains("already finished")));
    let refused = e.port_quote_skybridge(SKY as f64, 0.5);
    assert_eq!(refused, [0.0; 4]);
}
