use super::*;
use crate::clock::GameMode;

#[test]
fn vacate_reason_text_matches_the_typescript_table() {
    for (key, want) in [
        ("access", "no route to the lobby"),
        ("noTransport", "no way to transportation from here"),
        ("congestion", "overcrowded vertical transport"),
        ("rent", "rent set too high"),
        ("noise", "a noisy neighbor nearby"),
        (
            "transportFar",
            "too far from a stairway, escalator, or passenger elevator",
        ),
        ("lobbyFar", "too far from a lobby or sky lobby"),
        ("unmetDemand", "too few shops or restaurants within reach"),
        ("relocation", "the household is relocating"),
    ] {
        assert_eq!(vacate_reason_text(key), want, "{key}");
    }
}

#[test]
fn notices_name_one_unit_or_tally_by_cause() {
    let mut sim = Simulation::new_game(1, GameMode::Classic);
    sim.emit_notices(&[(5, Kind::Office, "access")]);
    assert_eq!(
        sim.log.last().unwrap().text,
        "Office on floor 5 gave notice: no route to the lobby. Fix it before they leave."
    );
    sim.emit_notices(&[
        (5, Kind::Office, "access"),
        (6, Kind::Condo, "rent"),
        (7, Kind::Office, "access"),
    ]);
    assert_eq!(
        sim.log.last().unwrap().text,
        "3 tenants gave notice: 2 \u{d7} no route to the lobby, 1 \u{d7} rent set too high. Fix the flagged units before they leave."
    );
}
