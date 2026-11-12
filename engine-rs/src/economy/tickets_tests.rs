//! A Modern theater's ticket price (#1950): four steps that trade ticket
//! income per seat against the crowd's visits, stored per theater, saved
//! only when not Normal, and absent from Classic.

use super::{
    charged, shown_ticket_price, ticket_income_mult, ticket_pick_mult, MODERN_TICKET_PRICES,
};
use crate::catalog::catalog;
use crate::clock::GameMode;
use crate::crowd::spawn::weighted_index;
use crate::economy::films::films_tests::theater;
use crate::load::deserialize;
use crate::rng::Rng;
use crate::sim::Simulation;
use crate::tower::Unit;

fn unit(sim: &Simulation, id: i64) -> &Unit {
    sim.tower.get_unit(id).unwrap()
}

fn stored(sim: &Simulation, id: i64) -> Option<&'static str> {
    unit(sim, id).extras().ticket_price
}

#[test]
fn modern_lists_four_steps_and_classic_none() {
    let modern = GameMode::Modern;
    let steps: Vec<(&str, f64, f64)> = modern
        .ticket_prices()
        .iter()
        .map(|p| (p.key, p.income_mult, p.pick_mult))
        .collect();
    assert_eq!(
        steps,
        [
            ("low", 0.75, 1.25),
            ("normal", 1.0, 1.0),
            ("high", 1.3, 0.75),
            ("premium", 1.6, 0.55),
        ]
    );
    assert_eq!(modern.ticket_price_default(), Some("normal"));
    assert_eq!(catalog(modern).economy.ticket_prices, &MODERN_TICKET_PRICES);
    assert_eq!(catalog(modern).economy.ticket_price_default, Some("normal"));
    let classic = GameMode::Classic;
    assert!(classic.ticket_prices().is_empty());
    assert_eq!(classic.ticket_price_default(), None);
    assert!(catalog(classic).economy.ticket_prices.is_empty());
    assert_eq!(catalog(classic).economy.ticket_price_default, None);
}

#[test]
fn a_ticket_price_is_set_on_a_modern_theater_only() {
    let (mut sim, cinema, office) = theater(GameMode::Modern);
    assert_eq!(sim.set_ticket_price(cinema, "premium"), Some("premium"));
    assert_eq!(stored(&sim, cinema), Some("premium"));
    assert_eq!(
        shown_ticket_price(sim.tower.mode, unit(&sim, cinema)),
        Some("premium")
    );
    // Normal is the price with no step stored, so the theater carries no
    // extras for it.
    assert_eq!(sim.set_ticket_price(cinema, "normal"), Some("normal"));
    assert_eq!(stored(&sim, cinema), None);
    assert_eq!(
        shown_ticket_price(sim.tower.mode, unit(&sim, cinema)),
        Some("normal")
    );
    assert_eq!(sim.set_ticket_price(cinema, "garbage"), None);
    assert_eq!(sim.set_ticket_price(office, "high"), None);
    assert_eq!(stored(&sim, office), None);
    assert_eq!(shown_ticket_price(sim.tower.mode, unit(&sim, office)), None);

    let (mut classic, cinema, _) = theater(GameMode::Classic);
    let before = classic.save_text();
    assert_eq!(classic.set_ticket_price(cinema, "low"), None);
    assert_eq!(classic.save_text(), before);
    assert_eq!(
        shown_ticket_price(classic.tower.mode, unit(&classic, cinema)),
        None
    );
}

#[test]
fn each_step_moves_ticket_income_and_visits_and_classic_reads_normal() {
    let (mut sim, cinema, _) = theater(GameMode::Modern);
    for step in &MODERN_TICKET_PRICES {
        sim.set_ticket_price(cinema, step.key);
        let u = unit(&sim, cinema);
        assert_eq!(ticket_income_mult(GameMode::Modern, u), step.income_mult);
        assert_eq!(ticket_pick_mult(GameMode::Modern, u), step.pick_mult);
    }
    // A step forced onto a Classic theater (no path sets one) charges
    // nothing: Classic lists no step.
    let (mut classic, cinema, _) = theater(GameMode::Classic);
    classic
        .tower
        .get_unit_mut(cinema)
        .unwrap()
        .extras_mut()
        .ticket_price = Some("premium");
    let u = unit(&classic, cinema);
    assert_eq!(charged(GameMode::Classic, u), None);
    assert_eq!(ticket_income_mult(GameMode::Classic, u), 1.0);
    assert_eq!(ticket_pick_mult(GameMode::Classic, u), 1.0);
}

#[test]
fn a_ticket_price_survives_a_save_and_normal_saves_nothing() {
    let (mut sim, cinema, office) = theater(GameMode::Modern);
    let theater_record = |sim: &Simulation| {
        sim.serialize()["units"]
            .as_array()
            .unwrap()
            .iter()
            .find(|u| u["id"] == cinema)
            .unwrap()
            .clone()
    };
    sim.set_ticket_price(cinema, "high");
    assert_eq!(theater_record(&sim)["ticketPrice"], "high");
    let loaded = deserialize(&sim.serialize()).unwrap();
    assert_eq!(stored(&loaded, cinema), Some("high"));
    sim.set_ticket_price(cinema, "normal");
    assert!(theater_record(&sim).get("ticketPrice").is_none());

    // A hand-edited step: Normal, an unknown step and one on another room
    // all load as none.
    for (id, step) in [(cinema, "normal"), (cinema, "garbage"), (office, "high")] {
        let mut raw = sim.serialize();
        for u in raw["units"].as_array_mut().unwrap() {
            if u["id"] == id {
                u["ticketPrice"] = step.into();
            }
        }
        let loaded = deserialize(&raw).unwrap();
        assert_eq!(stored(&loaded, id), None, "{step} on unit {id}");
    }

    // A Classic save has no ticket price.
    let (classic, cinema, _) = theater(GameMode::Classic);
    let mut raw = classic.serialize();
    for u in raw["units"].as_array_mut().unwrap() {
        if u["id"] == cinema {
            u["ticketPrice"] = "premium".into();
        }
    }
    let loaded = deserialize(&raw).unwrap();
    assert_eq!(stored(&loaded, cinema), None);
}

/// With whole weights a weighted draw lands where a uniform pick over a list
/// holding each entry that many times does, so a tower whose theaters all
/// charge Normal draws exactly as it did before ticket prices.
#[test]
fn a_weighted_draw_over_whole_weights_matches_the_uniform_pick() {
    let mut rng = Rng::new(7);
    let ones = [1.0; 5];
    let slots = [1.0, 2.0, 1.0];
    let pool = [0, 1, 1, 2];
    for _ in 0..5000 {
        let r = rng.next();
        assert_eq!(
            weighted_index(r, ones.iter().copied()),
            (r * 5.0).floor() as usize
        );
        assert_eq!(
            weighted_index(r, slots.iter().copied()),
            pool[(r * pool.len() as f64).floor() as usize]
        );
    }
}

#[test]
fn a_weighted_draw_follows_fractional_weights() {
    let mut rng = Rng::new(11);
    let weights = [1.25, 0.55];
    let mut hits = [0_u32; 2];
    for _ in 0..20_000 {
        hits[weighted_index(rng.next(), weights.iter().copied())] += 1;
    }
    let share = f64::from(hits[0]) / 20_000.0;
    assert!((share - 1.25 / 1.8).abs() < 0.02, "{hits:?}");
}
