//! A Modern theater's two screens (#1950): each books, pays for, ages and
//! rebooks its own film, the theater counts and earns the screens' mean, a
//! theater whose screens match saves as one did before, and Classic keeps
//! its one screen.

use serde_json::Value;

use super::{put_screens, screens, ScreenFilm};
use crate::clock::GameMode;
use crate::economy::films::films_tests::{counts, theater};
use crate::economy::films::{
    fills_blockbuster_slot, film_income_mult, FilmRefusal, FilmTier, BLOCKBUSTER_INCOME_MULT,
    FADING_INCOME_SHARE, MODERN_BLOCKBUSTER_PRICE, MODERN_FEATURE_PRICE, MODERN_FULL_DRAW_DAYS,
    MODERN_REVIVAL_PRICE, MODERN_SPENT_DAYS, REVIVAL_INCOME_MULT, SPENT_INCOME_SHARE,
};
use crate::events::PendingChoice;
use crate::load::deserialize;
use crate::sim::Simulation;
use crate::tower::UnitState;

fn both(sim: &Simulation, id: i64) -> [ScreenFilm; 2] {
    screens(sim.tower.mode, sim.tower.get_unit(id).unwrap())
}

fn film(tier: FilmTier, days: u8, policy: Option<&'static str>) -> ScreenFilm {
    ScreenFilm {
        tier,
        days: Some(days),
        policy,
    }
}

/// Sets screen `screen`'s film and age without charging, as a save would
/// carry them.
fn show(sim: &mut Simulation, id: i64, screen: usize, tier: FilmTier, days: u8) {
    let mode = sim.tower.mode;
    let u = sim.tower.get_unit_mut(id).unwrap();
    let mut films = screens(mode, u);
    films[screen].tier = tier;
    films[screen].days = Some(days);
    put_screens(mode, u, films);
}

/// Sets the first screen's film and age, with the second showing the same,
/// as every theater from before #1950 does.
fn show_both(sim: &mut Simulation, id: i64, tier: FilmTier, days: u8) {
    let u = sim.tower.get_unit_mut(id).unwrap();
    let mut extras = u.extras_mut();
    extras.film_days = Some(days);
    extras.film_classic = tier == FilmTier::Classic;
    extras.film_blockbuster = tier == FilmTier::Blockbuster;
    extras.second_screen = None;
}

fn theater_record(sim: &Simulation, id: i64) -> Value {
    let raw = sim.serialize();
    raw["units"]
        .as_array()
        .unwrap()
        .iter()
        .find(|u| u["id"] == id)
        .unwrap()
        .clone()
}

#[test]
fn each_modern_screen_books_and_pays_for_its_own_film() {
    let (mut sim, cinema, _) = theater(GameMode::Modern);
    sim.change_film(cinema, FilmTier::New).unwrap();
    show(&mut sim, cinema, 0, FilmTier::New, 5);
    let before = sim.money;
    assert_eq!(
        sim.book_film(cinema, 1, FilmTier::Blockbuster),
        Ok(MODERN_BLOCKBUSTER_PRICE)
    );
    assert_eq!(sim.money, before - MODERN_BLOCKBUSTER_PRICE);
    assert_eq!(
        both(&sim, cinema),
        [
            film(FilmTier::New, 5, None),
            film(FilmTier::Blockbuster, 0, None)
        ],
        "the first screen keeps its film and its age"
    );
    let before = sim.money;
    assert_eq!(
        sim.book_film(cinema, 0, FilmTier::Classic),
        Ok(MODERN_REVIVAL_PRICE)
    );
    assert_eq!(sim.money, before - MODERN_REVIVAL_PRICE);
    assert_eq!(
        both(&sim, cinema),
        [
            film(FilmTier::Classic, 0, None),
            film(FilmTier::Blockbuster, 0, None)
        ],
        "the second screen keeps its film when the first books one"
    );
    assert!(sim
        .log
        .iter()
        .any(|e| e.text.contains("opens on the second screen")));
}

#[test]
fn booking_the_first_screen_keeps_a_mirrored_second_screens_film() {
    let (mut sim, cinema, _) = theater(GameMode::Modern);
    show_both(&mut sim, cinema, FilmTier::New, 30);
    assert_eq!(both(&sim, cinema)[1], film(FilmTier::New, 30, None));
    sim.change_film(cinema, FilmTier::Blockbuster).unwrap();
    assert_eq!(
        both(&sim, cinema),
        [
            film(FilmTier::Blockbuster, 0, None),
            film(FilmTier::New, 30, None)
        ]
    );
}

#[test]
fn a_theater_whose_screens_match_saves_as_it_always_did() {
    let (mut sim, cinema, _) = theater(GameMode::Modern);
    sim.change_film(cinema, FilmTier::New).unwrap();
    assert!(theater_record(&sim, cinema).get("screen2").is_none());
    sim.book_film(cinema, 1, FilmTier::Blockbuster).unwrap();
    assert_eq!(
        theater_record(&sim, cinema)["screen2"],
        serde_json::json!({ "filmDays": 0, "filmBlockbuster": true })
    );
    // Booked alike on the same day, the screens match again and the second
    // is not stored.
    sim.book_film(cinema, 1, FilmTier::New).unwrap();
    assert!(theater_record(&sim, cinema).get("screen2").is_none());
    assert_eq!(
        sim.tower.get_unit(cinema).unwrap().extras().second_screen,
        None
    );
}

#[test]
fn a_saved_second_screen_loads_back_as_it_was() {
    let (mut sim, cinema, _) = theater(GameMode::Modern);
    sim.change_film(cinema, FilmTier::New).unwrap();
    sim.book_film(cinema, 1, FilmTier::Classic).unwrap();
    sim.set_screen_policy(cinema, 1, "blockbuster").unwrap();
    show(&mut sim, cinema, 1, FilmTier::Classic, 33);
    let raw = sim.serialize();
    let loaded = deserialize(&raw).unwrap();
    assert_eq!(both(&loaded, cinema), both(&sim, cinema));
    assert_eq!(
        both(&loaded, cinema)[1],
        film(FilmTier::Classic, 33, Some("blockbuster"))
    );
    assert_eq!(
        theater_record(&loaded, cinema),
        theater_record(&sim, cinema)
    );
}

#[test]
fn a_blockbuster_on_the_second_screen_alone_stays_there_across_a_save() {
    let (mut sim, cinema, _) = theater(GameMode::Modern);
    show(&mut sim, cinema, 0, FilmTier::New, 3);
    sim.book_film(cinema, 1, FilmTier::Blockbuster).unwrap();
    show(&mut sim, cinema, 1, FilmTier::Blockbuster, 2);
    assert!(sim.blockbusters.contains(&(cinema as f64)));
    let loaded = deserialize(&sim.serialize()).unwrap();
    assert_eq!(both(&loaded, cinema), both(&sim, cinema));
    assert_eq!(both(&loaded, cinema)[0].tier, FilmTier::New);
    assert_eq!(both(&loaded, cinema)[1].tier, FilmTier::Blockbuster);
}

#[test]
fn an_old_modern_save_shows_its_film_on_both_screens_and_charges_nothing() {
    let (mut sim, cinema, _) = theater(GameMode::Modern);
    sim.set_film_policy(cinema, "revival").unwrap();
    sim.set_screen_policy(cinema, 1, "revival").unwrap();
    show_both(&mut sim, cinema, FilmTier::Blockbuster, 9);
    let raw = sim.serialize();
    assert!(theater_record(&sim, cinema).get("screen2").is_none());
    let loaded = deserialize(&raw).unwrap();
    let first = film(FilmTier::Blockbuster, 9, Some("revival"));
    assert_eq!(both(&loaded, cinema), [first, first]);
    assert_eq!(loaded.money, sim.money);
    // A hand-written second screen like the first is not kept apart either.
    let mut raw = raw;
    for u in raw["units"].as_array_mut().unwrap() {
        if u["id"] == cinema {
            u["screen2"] = first.to_json();
        }
    }
    let loaded = deserialize(&raw).unwrap();
    assert_eq!(
        loaded
            .tower
            .get_unit(cinema)
            .unwrap()
            .extras()
            .second_screen,
        None
    );
}

#[test]
fn classic_runs_one_screen() {
    let (mut sim, cinema, office) = theater(GameMode::Classic);
    let before = (sim.money, sim.save_text());
    assert_eq!(
        sim.book_film(cinema, 1, FilmTier::New),
        Err(FilmRefusal::NoScreen)
    );
    assert_eq!(sim.set_screen_policy(cinema, 1, "off"), None);
    assert_eq!((sim.money, sim.save_text()), before);
    // A Classic save, or a room other than a theater, reads no second screen.
    let mut raw = sim.serialize();
    for u in raw["units"].as_array_mut().unwrap() {
        if u["id"] == cinema || u["id"] == office {
            u["screen2"] = film(FilmTier::Classic, 3, None).to_json();
        }
    }
    let loaded = deserialize(&raw).unwrap();
    for id in [cinema, office] {
        assert_eq!(
            loaded.tower.get_unit(id).unwrap().extras().second_screen,
            None
        );
    }
    let [first, second] = both(&loaded, cinema);
    assert_eq!(first, second);
    // Modern runs two screens and no third.
    let (mut modern, cinema, _) = theater(GameMode::Modern);
    assert_eq!(
        modern.book_film(cinema, 2, FilmTier::New),
        Err(FilmRefusal::NoScreen)
    );
}

#[test]
fn each_screen_draws_half_the_house_and_ages_each_night() {
    let (mut sim, cinema, _) = theater(GameMode::Modern);
    sim.set_film_policy(cinema, "off").unwrap();
    sim.set_screen_policy(cinema, 1, "off").unwrap();
    show(&mut sim, cinema, 0, FilmTier::Blockbuster, 0);
    show(
        &mut sim,
        cinema,
        1,
        FilmTier::New,
        MODERN_FULL_DRAW_DAYS as u8,
    );
    // A full house of 120 on one screen and a fading film's 80 on the other.
    assert_eq!(counts(&mut sim, cinema, 1), [100]);
    let [first, second] = both(&sim, cinema);
    assert_eq!(first.days, Some(1));
    assert_eq!(second.days, Some(MODERN_FULL_DRAW_DAYS as u8 + 1));
    // Spent on one screen and full on the other: (40 + 120) / 2.
    show(&mut sim, cinema, 1, FilmTier::New, MODERN_SPENT_DAYS as u8);
    assert_eq!(counts(&mut sim, cinema, 1), [80]);
}

#[test]
fn the_theater_earns_the_mean_of_its_screens() {
    let (mut sim, cinema, _) = theater(GameMode::Modern);
    show(&mut sim, cinema, 0, FilmTier::Blockbuster, 0);
    show(
        &mut sim,
        cinema,
        1,
        FilmTier::Classic,
        MODERN_SPENT_DAYS as u8,
    );
    let mult = film_income_mult(GameMode::Modern, sim.tower.get_unit(cinema).unwrap(), false);
    let want = (BLOCKBUSTER_INCOME_MULT + REVIVAL_INCOME_MULT * SPENT_INCOME_SHARE) / 2.0;
    assert!((mult - want).abs() < 1e-12, "{mult} against {want}");
    show(
        &mut sim,
        cinema,
        1,
        FilmTier::New,
        MODERN_FULL_DRAW_DAYS as u8,
    );
    let mult = film_income_mult(GameMode::Modern, sim.tower.get_unit(cinema).unwrap(), false);
    let want = (BLOCKBUSTER_INCOME_MULT + FADING_INCOME_SHARE) / 2.0;
    assert!((mult - want).abs() < 1e-12, "{mult} against {want}");
}

#[test]
fn a_blockbuster_at_full_draw_on_either_screen_fills_the_slot() {
    let (mut sim, cinema, _) = theater(GameMode::Modern);
    let fills = |sim: &Simulation| {
        fills_blockbuster_slot(GameMode::Modern, sim.tower.get_unit(cinema).unwrap())
    };
    show(&mut sim, cinema, 0, FilmTier::New, 0);
    assert!(!fills(&sim));
    sim.book_film(cinema, 1, FilmTier::Blockbuster).unwrap();
    assert!(fills(&sim));
    assert!(sim.blockbusters.contains(&(cinema as f64)));
    show(
        &mut sim,
        cinema,
        1,
        FilmTier::Blockbuster,
        MODERN_FULL_DRAW_DAYS as u8,
    );
    assert!(!fills(&sim), "a fading blockbuster fills no slot");
    show(&mut sim, cinema, 0, FilmTier::Blockbuster, 3);
    assert!(fills(&sim));
}

#[test]
fn each_spent_screen_books_its_own_policys_film_and_pays() {
    let (mut sim, cinema, _) = theater(GameMode::Modern);
    sim.set_film_policy(cinema, "off").unwrap();
    sim.set_screen_policy(cinema, 1, "revival").unwrap();
    show(&mut sim, cinema, 0, FilmTier::New, MODERN_SPENT_DAYS as u8);
    show(&mut sim, cinema, 1, FilmTier::New, MODERN_SPENT_DAYS as u8);
    let before = sim.money;
    sim.rebook_spent_films();
    assert_eq!(sim.money, before - MODERN_REVIVAL_PRICE);
    assert_eq!(
        both(&sim, cinema),
        [
            film(FilmTier::New, MODERN_SPENT_DAYS as u8, Some("off")),
            film(FilmTier::Classic, 0, Some("revival"))
        ]
    );
}

#[test]
fn matching_spent_screens_each_book_again_and_match_once_more() {
    let (mut sim, cinema, _) = theater(GameMode::Modern);
    show_both(&mut sim, cinema, FilmTier::New, MODERN_SPENT_DAYS as u8);
    assert_eq!(
        sim.tower.get_unit(cinema).unwrap().extras().second_screen,
        None
    );
    let before = sim.money;
    sim.rebook_spent_films();
    assert_eq!(sim.money, before - 2.0 * MODERN_FEATURE_PRICE);
    assert_eq!(
        both(&sim, cinema),
        [film(FilmTier::New, 0, None), film(FilmTier::New, 0, None)]
    );
    assert_eq!(
        sim.tower.get_unit(cinema).unwrap().extras().second_screen,
        None
    );
}

#[test]
fn a_screen_that_cannot_pay_keeps_its_film_and_says_so_once() {
    let (mut sim, cinema, _) = theater(GameMode::Modern);
    sim.set_film_policy(cinema, "off").unwrap();
    show(&mut sim, cinema, 1, FilmTier::New, MODERN_SPENT_DAYS as u8);
    sim.money = MODERN_FEATURE_PRICE - 1.0;
    sim.rebook_spent_films();
    assert_eq!(sim.money, MODERN_FEATURE_PRICE - 1.0);
    assert_eq!(both(&sim, cinema)[1].days, Some(MODERN_SPENT_DAYS as u8));
    let warned = |sim: &Simulation| {
        sim.log
            .iter()
            .filter(|e| {
                e.text
                    .contains("can't afford its next feature on the second screen")
            })
            .count()
    };
    assert_eq!(warned(&sim), 1);
    show(
        &mut sim,
        cinema,
        1,
        FilmTier::New,
        MODERN_SPENT_DAYS as u8 + 1,
    );
    sim.rebook_spent_films();
    assert_eq!(warned(&sim), 1, "only the morning the film is spent");
}

#[test]
fn a_policy_on_one_screen_leaves_the_other() {
    let (mut sim, cinema, _) = theater(GameMode::Modern);
    assert_eq!(
        sim.set_screen_policy(cinema, 1, "blockbuster"),
        Some("blockbuster")
    );
    assert_eq!(both(&sim, cinema)[0].policy, None);
    assert_eq!(sim.set_film_policy(cinema, "off"), Some("off"));
    let [first, second] = both(&sim, cinema);
    assert_eq!(
        (first.policy, second.policy),
        (Some("off"), Some("blockbuster"))
    );
    assert_eq!(sim.set_screen_policy(cinema, 1, "garbage"), None);
}

#[test]
fn a_gutted_theater_reopens_with_a_new_film_on_each_screen_and_keeps_their_choices() {
    let (mut sim, cinema, _) = theater(GameMode::Modern);
    sim.set_film_policy(cinema, "off").unwrap();
    sim.set_screen_policy(cinema, 1, "revival").unwrap();
    show(&mut sim, cinema, 0, FilmTier::Blockbuster, 5);
    show(&mut sim, cinema, 1, FilmTier::Classic, 9);
    let (u, at) = sim.tower.marked_by_id(cinema).unwrap();
    u.set_state(at, UnitState::Fire);
    sim.events.active.insert(cinema);
    sim.events.pending = Some(PendingChoice {
        kind: "fireRescue",
        cost: 0.0,
        message: String::new(),
    });
    sim.resolve_choice(true);
    assert_eq!(sim.tower.get_unit(cinema).unwrap().state, UnitState::Gutted);
    let [first, second] = both(&sim, cinema);
    assert_eq!(
        (first.tier, first.days_shown(), first.policy),
        (FilmTier::New, 0, Some("off"))
    );
    assert_eq!(
        (second.tier, second.days_shown(), second.policy),
        (FilmTier::New, 0, Some("revival"))
    );
}

#[test]
fn a_theater_gutted_before_the_nights_count_loads_with_a_new_film() {
    let (mut sim, cinema, _) = theater(GameMode::Modern);
    show_both(&mut sim, cinema, FilmTier::Blockbuster, 2);
    sim.blockbusters.push(cinema as f64);
    let (u, at) = sim.tower.marked_by_id(cinema).unwrap();
    u.set_state(at, UnitState::Fire);
    sim.events.active.insert(cinema);
    sim.events.pending = Some(PendingChoice {
        kind: "fireRescue",
        cost: 0.0,
        message: String::new(),
    });
    sim.resolve_choice(true);
    assert!(
        sim.blockbusters.contains(&(cinema as f64)),
        "until the count"
    );
    let loaded = deserialize(&sim.serialize()).unwrap();
    assert_eq!(both(&loaded, cinema), both(&sim, cinema));
    assert_eq!(both(&loaded, cinema)[0].tier, FilmTier::New);
}
