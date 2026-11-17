//! The port's row of rooms: the quote's record, the build's, and one undo
//! step taking the whole row back.

use super::*;
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::wasm::port::{DELTA, STATUS};

fn engine(mode: GameMode) -> Engine {
    let mut sim = Simulation::new_game(1, mode);
    sim.money = 1e9;
    sim.star = 5;
    for x in 100..300 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        assert!(sim.tower.place(Kind::Floor, 2, x).ok);
    }
    Engine::of(sim)
}

fn office() -> f64 {
    Kind::Office as usize as f64
}

fn offices(e: &Engine) -> usize {
    e.sim
        .tower
        .units
        .iter()
        .filter(|u| u.kind == Kind::Office)
        .count()
}

#[test]
fn the_quote_lists_each_room_after_its_header() {
    let mut e = engine(GameMode::Modern);
    let w = Kind::Office.facility().width as f64;
    let q = e.port_quote_room_row(office(), 2.0, 120.0, 120.0 + 2.0 * w);
    let price = Kind::Office.facility().cost;
    assert_eq!(
        q,
        vec![1.0, 3.0 * price, 3.0, 120.0, 120.0 + w, 120.0 + 2.0 * w]
    );
    assert_eq!(e.last_reason_text(), None);
}

#[test]
fn a_refused_quote_says_why_and_lists_no_room_it_cannot_place() {
    let mut e = engine(GameMode::Classic);
    assert_eq!(
        e.port_quote_room_row(office(), 2.0, 120.0, 160.0),
        vec![0.0; 3]
    );
    assert!(e.last_reason_text().is_some());
    let mut e = engine(GameMode::Modern);
    assert_eq!(
        e.port_quote_room_row(office(), 2.5, 120.0, 160.0),
        vec![0.0; 3]
    );
    assert_eq!(e.port_quote_room_row(-1.0, 2.0, 120.0, 160.0), vec![0.0; 3]);
}

#[test]
fn the_build_charges_the_row_and_one_undo_takes_it_back() {
    let mut e = engine(GameMode::Modern);
    let w = Kind::Office.facility().width as f64;
    let before = e.sim.money;
    e.port_undo_capture("Build Office");
    let r = e.port_build_room_row(office(), 2.0, 120.0, 120.0 + 3.0 * w);
    e.port_undo_commit();
    assert_eq!(r[STATUS], 1.0, "{:?}", e.last_reason_text());
    assert_eq!(r[DELTA], -4.0 * Kind::Office.facility().cost);
    assert_eq!(r[DELTA + 1], 4.0, "placed");
    assert_eq!(offices(&e), 4);
    assert_eq!(e.port_undo()[STATUS], 1.0, "{:?}", e.last_reason_text());
    assert_eq!(offices(&e), 0);
    assert_eq!(e.sim.money, before);
}

#[test]
fn a_refused_build_places_nothing() {
    let mut e = engine(GameMode::Classic);
    let r = e.port_build_room_row(office(), 2.0, 120.0, 160.0);
    assert_eq!(r[STATUS], 0.0);
    assert_eq!(r[DELTA + 1], 0.0);
    assert_eq!(offices(&e), 0);
}
