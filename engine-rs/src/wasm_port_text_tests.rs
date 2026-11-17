//! The text cap on `labelUnit`, `nameTower` and `logLine` (#1405): text up
//! to [`MAX_TEXT`] UTF-16 code units is taken, one unit more is refused with
//! the invalid-request reason and changes nothing.
use super::*;
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::wasm::port::STATUS;

fn engine_with_office() -> (Engine, f64) {
    let mut e = Engine::of(Simulation::new_game(7, GameMode::Modern));
    e.sim.money = 1e9;
    for x in 150..200 {
        assert!(e.sim.tower.place(Kind::Lobby, 1, x).ok);
        assert!(e.sim.tower.place(Kind::Floor, 2, x).ok);
    }
    assert!(e.sim.tower.place(Kind::Office, 2, 160).ok);
    let id = e.sim.tower.units.last().unwrap().id as f64;
    (e, id)
}

/// The longest text taken, and one UTF-16 unit more. "é" is one UTF-16 unit
/// but two UTF-8 bytes, so the cap counts what a JS string's length counts.
fn at_and_over() -> (String, String) {
    let at = "é".repeat(MAX_TEXT);
    let over = format!("{at}x");
    (at, over)
}

#[test]
fn a_unit_label_over_the_cap_is_refused_and_changes_nothing() {
    let (mut e, id) = engine_with_office();
    let (at, over) = at_and_over();
    assert_eq!(e.port_label_unit(id, "HQ")[STATUS], 1.0);
    let before = e.sim.serialize();
    let refused = e.port_label_unit(id, &over);
    assert_eq!(refused[STATUS], 0.0);
    assert_eq!(e.last_reason_text().as_deref(), Some(INVALID_REQUEST));
    assert_eq!(e.sim.serialize(), before, "a refusal writes nothing");
    assert_eq!(e.port_label_unit(id, &at)[STATUS], 1.0);
    assert_eq!(e.port_unit_label(id).as_deref(), Some(at.as_str()));
}

#[test]
fn a_tower_name_over_the_cap_is_refused_and_keeps_the_old_name() {
    let (mut e, _) = engine_with_office();
    let (at, over) = at_and_over();
    assert_eq!(e.port_name_tower(Some("Spire".into()))[STATUS], 1.0);
    assert_eq!(e.port_name_tower(Some(over))[STATUS], 0.0);
    assert_eq!(e.last_reason_text().as_deref(), Some(INVALID_REQUEST));
    assert_eq!(e.sim.tower.tower_name.as_deref(), Some("Spire"));
    assert_eq!(e.port_name_tower(Some(at.clone()))[STATUS], 1.0);
    assert_eq!(e.sim.tower.tower_name.as_deref(), Some(at.as_str()));
    assert_eq!(e.port_name_tower(None)[STATUS], 1.0, "no text still clears");
    assert_eq!(e.sim.tower.tower_name, None);
}

#[test]
fn a_bulletin_line_over_the_cap_is_refused_and_logs_nothing() {
    let (mut e, _) = engine_with_office();
    let (at, over) = at_and_over();
    let seq = e.sim.log_seq;
    assert_eq!(e.port_log_line(&over, 1.0)[STATUS], 0.0);
    assert_eq!(e.last_reason_text().as_deref(), Some(INVALID_REQUEST));
    assert_eq!(e.sim.log_seq, seq, "nothing was logged");
    assert_eq!(e.port_log_line(&at, 1.0)[STATUS], 1.0);
    assert_eq!(e.sim.log_seq, seq + 1);
    assert_eq!(
        e.port_log_text(e.sim.log_seq as f64).as_deref(),
        Some(at.as_str())
    );
}
