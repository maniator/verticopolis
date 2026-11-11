//! The rolling income ledger: averages over completed days, a lump spread
//! across the window, days past the window dropped, income netted against
//! expense, a save hardened at the load, the kind-to-category map, and a
//! shop's traffic income landing on the retail line and surviving a reload.
//! The running-day estimate before a day ends is pinned by
//! `panels::tests::the_income_breakdown_averages_the_running_day_before_a_day_ends`,
//! and the saved ledger's text (past the window, odd numbers) by
//! `sim_save_tests::edited_games_write_the_trees_text`.
use serde_json::json;

use crate::clock::GameMode;
use crate::economy::ledger_cat_for;
use crate::facilities::{Kind, LOT_WIDTH};
use crate::ledger::{Ledger, LEDGER_CATS, WINDOW};
use crate::load::deserialize;
use crate::sim::Simulation;
use crate::tower::UnitState;

/// One category's average dollars per day.
fn avg(l: &Ledger, cat: &str) -> f64 {
    let i = LEDGER_CATS.iter().position(|c| *c == cat).unwrap();
    l.average_per_day()[i]
}

#[test]
fn a_per_day_amount_averages_over_completed_days() {
    let mut l = Ledger::new();
    for _ in 0..3 {
        l.record("retail", 300.0);
        l.end_day();
    }
    assert_eq!(avg(&l, "retail"), 300.0);
    assert_eq!(avg(&l, "offices"), 0.0, "a category that never moved");
}

#[test]
fn a_quarterly_lump_spreads_across_the_window_and_then_drops_off() {
    let mut l = Ledger::new();
    l.record("offices", 90_000.0);
    l.end_day();
    for _ in 0..WINDOW - 1 {
        l.end_day();
    }
    assert!((avg(&l, "offices") - 90_000.0 / WINDOW as f64).abs() < 1e-9);
    // One more day pushes the lump out of the trailing window.
    l.end_day();
    assert_eq!(l.history.len(), WINDOW);
    assert_eq!(avg(&l, "offices"), 0.0);
}

#[test]
fn income_and_expense_in_one_category_net_out() {
    let mut l = Ledger::new();
    l.record("hotels", 5000.0);
    l.record("hotels", -2000.0);
    l.end_day();
    assert_eq!(avg(&l, "hotels"), 3000.0);
}

#[test]
fn a_restore_round_trips_and_hardens_garbage() {
    let mut l = Ledger::new();
    l.record("offices", 1200.0);
    l.end_day();
    l.record("food", 300.0);
    let restored = Ledger::restore(Some(&l.serialize()));
    assert_eq!(avg(&restored, "offices"), 1200.0);
    assert_eq!(restored.today.get("food"), Some(&300.0));
    // A hand-edited save: a text amount is dropped, a bad history is empty.
    let dirty = Ledger::restore(Some(
        &json!({ "today": { "food": "lots", "offices": 5 }, "history": "nope" }),
    ));
    assert!(dirty.history.is_empty());
    assert_eq!(avg(&dirty, "offices"), 5.0);
    assert_eq!(avg(&dirty, "food"), 0.0);
}

#[test]
fn revenue_kinds_map_to_report_categories_and_the_rest_to_none() {
    assert_eq!(ledger_cat_for(Kind::Office), Some("offices"));
    assert_eq!(ledger_cat_for(Kind::HotelSuite), Some("hotels"));
    assert_eq!(ledger_cat_for(Kind::Shop), Some("retail"));
    assert_eq!(ledger_cat_for(Kind::Restaurant), Some("food"));
    assert_eq!(ledger_cat_for(Kind::Cinema), Some("entertainment"));
    for kind in [Kind::Lobby, Kind::ElevatorStandard, Kind::Security] {
        assert_eq!(ledger_cat_for(kind), None, "{kind:?}");
    }
}

/// A lit shop and three occupied offices on floor 2, served by an elevator:
/// the offices give the shop a demand pool, so the retail line takes money.
fn shop_tower(seed: u32) -> Simulation {
    let mut sim = Simulation::new_game(seed, GameMode::Classic);
    sim.money = 1e9;
    sim.star = 3;
    for (kind, floor) in [(Kind::Lobby, 1), (Kind::Floor, 2)] {
        for x in 0..LOT_WIDTH {
            sim.tower.place(kind, floor, x);
        }
    }
    let mid = LOT_WIDTH / 2;
    assert!(sim.build_transport(Kind::ElevatorStandard, mid, 1, 2).ok);
    for (kind, x) in [
        (Kind::Shop, 0),
        (Kind::Office, 20),
        (Kind::Office, 32),
        (Kind::Office, 44),
    ] {
        let id = sim.tower.place(kind, 2, x).unit_id.expect("placed");
        sim.tower.get_unit_mut(id).unwrap().state = UnitState::Occupied;
    }
    sim
}

#[test]
fn a_shops_traffic_income_lands_on_the_retail_line() {
    let mut sim = shop_tower(77);
    for _ in 0..3 {
        sim.tick(60.0 * 24.0);
    }
    let b = sim.income_breakdown();
    assert_eq!(b["hasData"], true);
    assert!(b["averages"]["retail"].as_f64().unwrap() > 0.0, "{b}");
}

#[test]
fn the_accrued_figures_survive_a_save_and_load() {
    let mut sim = shop_tower(78);
    for _ in 0..3 {
        sim.tick(60.0 * 24.0);
    }
    let before = sim.income_breakdown()["averages"]["retail"]
        .as_f64()
        .unwrap();
    assert!(before > 0.0);
    let reloaded = deserialize(&sim.serialize()).expect("the save loads");
    let after = reloaded.income_breakdown()["averages"]["retail"]
        .as_f64()
        .unwrap();
    assert!((after - before).abs() < 1e-5, "{before} then {after}");
}
