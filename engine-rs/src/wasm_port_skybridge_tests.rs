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
    let rec = e.port_build_skybridge(SKY as f64, (LEFT.end + 3) as f64, f64::NAN);
    assert_eq!(rec[STATUS], 1.0, "{:?}", e.last_reason_text());
    assert_eq!(rec[2], 10.0, "the tiles slot counts the tiles laid");
    assert_eq!(rec[1], -quote[1], "the delta is the quoted price");
    assert_eq!(bridge_tiles(&e), 10);
    // A second click finds the bridge finished and says so.
    let again = e.port_build_skybridge(SKY as f64, (LEFT.end + 3) as f64, f64::NAN);
    assert_eq!(again[STATUS], 0.0);
    assert!(e
        .last_reason_text()
        .is_some_and(|r| r.contains("already finished")));
    let refused = e.port_quote_skybridge(SKY as f64, 0.5);
    assert_eq!(refused, [0.0; 4]);
}

/// The looks of every bridge in the tower, as the port lists them.
fn looks(e: &Engine) -> Vec<f64> {
    e.port_skybridge_looks()
}

const GAP: [f64; 2] = [LEFT.end as f64, RIGHT.start as f64];

#[test]
fn a_bridge_is_built_in_the_picked_look_and_the_new_look_by_default() {
    let mut e = wings();
    let rec = e.port_build_skybridge(SKY as f64, (LEFT.end + 3) as f64, 2.0);
    assert_eq!(rec[STATUS], 1.0, "{:?}", e.last_reason_text());
    assert_eq!(looks(&e), vec![SKY as f64, GAP[0], GAP[1], 2.0]);
    // Every tile carries the look's name, so a save keeps it.
    for x in LEFT.end..RIGHT.start {
        assert_eq!(
            e.sim.tower.unit_at(SKY, x).unwrap().subtype,
            Some(crate::tower::SKYBRIDGE_LOOKS[2])
        );
    }
    let mut e = wings();
    e.port_build_skybridge(SKY as f64, (LEFT.end + 3) as f64, f64::NAN);
    let new_look = crate::tower::NEW_SKYBRIDGE_LOOK as f64;
    assert_eq!(looks(&e), vec![SKY as f64, GAP[0], GAP[1], new_look]);
}

#[test]
fn a_click_restyles_the_whole_bridge_free_and_undo_puts_the_old_look_back() {
    let mut e = wings();
    e.port_build_skybridge(SKY as f64, (LEFT.end + 3) as f64, 1.0);
    let (money, revision) = (e.sim.money, e.sim.tower.revision);
    e.port_undo_capture("Change Bridge Look");
    let rec = e.port_restyle_skybridge(SKY as f64, (LEFT.end + 7) as f64, 4.0);
    e.port_undo_commit();
    assert_eq!(rec[STATUS], 1.0, "{:?}", e.last_reason_text());
    assert_eq!(rec[1], 0.0, "a look is free");
    assert_eq!(e.sim.money, money);
    assert!(
        e.sim.tower.revision > revision,
        "the renderer redraws the bridge"
    );
    assert_eq!(looks(&e), vec![SKY as f64, GAP[0], GAP[1], 4.0]);
    assert_eq!(e.port_undo()[STATUS], 1.0, "{:?}", e.last_reason_text());
    assert_eq!(looks(&e), vec![SKY as f64, GAP[0], GAP[1], 1.0]);
    // The plain lobby look is stored as no subtype, as before the looks.
    e.port_restyle_skybridge(SKY as f64, LEFT.end as f64, 0.0);
    assert_eq!(e.sim.tower.unit_at(SKY, LEFT.end).unwrap().subtype, None);
}

#[test]
fn restyling_is_refused_off_a_bridge_for_an_unknown_look_and_in_classic() {
    let mut e = wings();
    e.port_build_skybridge(SKY as f64, (LEFT.end + 3) as f64, 1.0);
    for (floor, x, look) in [
        (SKY, LEFT.start + 2, 2.0),
        (SKY, LEFT.end, 9.0),
        (SKY, LEFT.end, -1.0),
        (SKY, LEFT.end, 1.5),
    ] {
        let rec = e.port_restyle_skybridge(floor as f64, x as f64, look);
        assert_eq!(rec[STATUS], 0.0, "{floor} {x} {look}");
    }
    assert_eq!(looks(&e), vec![SKY as f64, GAP[0], GAP[1], 1.0]);
    let mut classic = Simulation::new_game(1, GameMode::Classic);
    assert!(!classic.restyle_skybridge(SKY, LEFT.end, 1).ok);
}

#[test]
fn finishing_a_half_bridge_dresses_the_whole_bridge() {
    let mut e = wings();
    // A half bridge from a save made before the tool: plain lobby tiles laid
    // one by one, with no look.
    for x in LEFT.end..LEFT.end + 4 {
        assert!(
            e.sim
                .tower
                .place_as(Kind::Lobby, SKY, x, crate::tower::OverAir::Bridge)
                .ok
        );
    }
    assert_eq!(
        looks(&e),
        vec![SKY as f64, GAP[0], (LEFT.end + 4) as f64, 0.0]
    );
    let half = vec![SKY as f64, GAP[0], (LEFT.end + 4) as f64, 0.0];
    // The engine restyles only a finished bridge: a click on a half bridge
    // finishes it instead.
    let rec = e.port_restyle_skybridge(SKY as f64, LEFT.end as f64, 3.0);
    assert_eq!(rec[STATUS], 0.0);
    assert_eq!(
        e.last_reason_text().as_deref(),
        Some(crate::tower::FINISH_THE_BRIDGE)
    );
    assert_eq!(looks(&e), half);
    e.port_undo_capture("Build Sky Bridge");
    let rec = e.port_build_skybridge(SKY as f64, (RIGHT.start - 1) as f64, 3.0);
    e.port_undo_commit();
    assert_eq!(rec[STATUS], 1.0, "{:?}", e.last_reason_text());
    assert_eq!(looks(&e), vec![SKY as f64, GAP[0], GAP[1], 3.0]);
    // One undo takes the new tiles down and puts the old ones back plain.
    assert_eq!(e.port_undo()[STATUS], 1.0, "{:?}", e.last_reason_text());
    assert_eq!(looks(&e), half);
}

#[test]
fn a_look_survives_a_save_and_a_save_without_looks_loads_plain() {
    let mut e = wings();
    e.port_build_skybridge(SKY as f64, (LEFT.end + 3) as f64, 2.0);
    let save = e.sim.serialize();
    let back = crate::load::deserialize(&save).unwrap();
    assert_eq!(back.tower.skybridge_looks(), e.sim.tower.skybridge_looks());
    // A save from before the looks has no subtype on a bridge tile, and a
    // lobby subtype that names no look is dropped: both load plain.
    let mut old = save.clone();
    for (i, u) in old["units"].as_array_mut().unwrap().iter_mut().enumerate() {
        if u.get("subtype").is_some() {
            if i % 2 == 0 {
                u.as_object_mut().unwrap().remove("subtype");
            } else {
                u["subtype"] = serde_json::json!("Rope Bridge");
            }
        }
    }
    let plain = crate::load::deserialize(&old).unwrap();
    let listed = plain.tower.skybridge_looks();
    assert_eq!(listed.len(), 1);
    assert_eq!(
        (listed[0].cols.clone(), listed[0].look),
        (LEFT.end..RIGHT.start, 0)
    );
    assert_eq!(
        save["version"], old["version"],
        "a look moves no save version"
    );
}
