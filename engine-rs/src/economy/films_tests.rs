//! Changing a theatre's film (#1932): Classic charges $300,000 for a new film
//! or $150,000 for a classic and nothing each period, a classic's count never
//! passes 80, a changed film starts its age again, and Modern's booking
//! starts a fresh film.

use super::{FilmRefusal, CLASSIC_FILM_PRICE, NEW_FILM_PRICE};
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

fn put(sim: &mut Simulation, kind: Kind, floor: i64, x: i64) -> i64 {
    let r = sim.build(kind, floor, x);
    assert!(r.ok, "{kind:?} at {floor},{x}: {:?}", r.reason);
    sim.tower.unit_at(floor, x).expect("a unit there").id
}

/// An open theatre on floors 2 and 3, and an office, in a tower of `mode`.
fn theatre(mode: GameMode) -> (Simulation, i64, i64) {
    let mut sim = Simulation::new_game(5, mode);
    sim.money = 1.0e9;
    sim.star = 5;
    for x in 150..260 {
        put(&mut sim, Kind::Lobby, 1, x);
    }
    for fl in 2..=3 {
        for x in 151..259 {
            put(&mut sim, Kind::Floor, fl, x);
        }
    }
    let cinema = put(&mut sim, Kind::Cinema, 2, 180);
    let office = put(&mut sim, Kind::Office, 2, 220);
    let (u, at) = sim.tower.marked_by_id(cinema).unwrap();
    u.set_state(at, UnitState::Empty);
    (sim, cinema, office)
}

fn counts(sim: &mut Simulation, id: i64, nights: usize) -> Vec<u8> {
    (0..nights)
        .map(|_| {
            sim.roll_over_retail_day();
            sim.tower.get_unit(id).unwrap().visitors_yest.unwrap()
        })
        .collect()
}

fn film_days(sim: &Simulation, id: i64) -> Option<u8> {
    sim.tower.get_unit(id).unwrap().extras().film_days
}

#[test]
fn a_new_film_costs_300000_and_starts_the_film_again() {
    let (mut sim, cinema, _) = theatre(GameMode::Classic);
    assert_eq!(counts(&mut sim, cinema, 10).last(), Some(&40));
    let before = sim.money;
    assert_eq!(sim.change_film(cinema, false), Ok(NEW_FILM_PRICE));
    assert_eq!(sim.money, before - NEW_FILM_PRICE);
    assert_eq!(film_days(&sim, cinema), Some(0));
    assert_eq!(
        counts(&mut sim, cinema, 10),
        [120, 120, 120, 120, 120, 120, 80, 80, 80, 40]
    );
}

#[test]
fn a_classic_costs_150000_and_never_counts_more_than_80() {
    let (mut sim, cinema, _) = theatre(GameMode::Classic);
    let before = sim.money;
    assert_eq!(sim.change_film(cinema, true), Ok(CLASSIC_FILM_PRICE));
    assert_eq!(sim.money, before - CLASSIC_FILM_PRICE);
    assert_eq!(
        counts(&mut sim, cinema, 10),
        [80, 80, 80, 80, 80, 80, 80, 80, 80, 40]
    );
    // A new film after the classic draws a full house again.
    sim.change_film(cinema, false).unwrap();
    assert_eq!(counts(&mut sim, cinema, 1), [120]);
}

#[test]
fn a_classic_film_survives_a_save_and_a_load() {
    let (mut sim, cinema, _) = theatre(GameMode::Classic);
    sim.change_film(cinema, true).unwrap();
    let text = sim.save_text();
    assert!(text.contains("\"filmClassic\":true"));
    let mut back = crate::load_stream::load_save_text(text.as_bytes()).expect("the save loads");
    assert!(back.tower.get_unit(cinema).unwrap().extras().film_classic);
    assert_eq!(counts(&mut back, cinema, 1), [80]);
}

#[test]
fn classic_charges_no_booking_each_period() {
    let (mut sim, cinema, _) = theatre(GameMode::Classic);
    let before = sim.money;
    sim.pay_maintenance();
    let maintenance_without_films = before - sim.money;
    sim.tower.get_unit_mut(cinema).unwrap().state = UnitState::Gutted;
    let before = sim.money;
    sim.pay_maintenance();
    assert_eq!(
        before - sim.money,
        maintenance_without_films,
        "an open theatre adds nothing to the period's upkeep"
    );
}

#[test]
fn only_a_new_film_in_its_first_days_is_a_classic_blockbuster() {
    let (mut sim, cinema, _) = theatre(GameMode::Classic);
    let key = cinema as f64;
    sim.change_film(cinema, false).unwrap();
    assert_eq!(sim.blockbusters, [key], "a new film fills the house");
    counts(&mut sim, cinema, 5);
    assert_eq!(sim.blockbusters, [key], "still new after five mornings");
    counts(&mut sim, cinema, 1);
    assert!(sim.blockbusters.is_empty(), "past its full draw");
    sim.change_film(cinema, true).unwrap();
    assert!(
        sim.blockbusters.is_empty(),
        "a classic never fills the house"
    );
}

#[test]
fn a_film_change_is_refused_with_its_reason() {
    let (mut sim, cinema, office) = theatre(GameMode::Classic);
    let before = (sim.money, sim.save_text());
    assert_eq!(sim.change_film(office, false), Err(FilmRefusal::NotTheater));
    assert_eq!(sim.change_film(-1, false), Err(FilmRefusal::NotTheater));
    sim.money = NEW_FILM_PRICE - 1.0;
    assert_eq!(
        sim.change_film(cinema, false),
        Err(FilmRefusal::Funds {
            cost: NEW_FILM_PRICE
        })
    );
    sim.money = before.0;
    sim.tower.get_unit_mut(cinema).unwrap().state = UnitState::Gutted;
    assert_eq!(sim.change_film(cinema, true), Err(FilmRefusal::Closed));
    sim.tower.get_unit_mut(cinema).unwrap().state = UnitState::Empty;
    assert_eq!(
        (sim.money, sim.save_text()),
        before,
        "a refusal changes nothing"
    );
    let reasons = [
        FilmRefusal::Unavailable,
        FilmRefusal::NotTheater,
        FilmRefusal::Closed,
        FilmRefusal::Funds { cost: 0.0 },
    ]
    .map(|r| r.reason());
    assert_eq!(reasons, ["unavailable", "notTheater", "closed", "funds"]);
}

#[test]
fn modern_books_a_film_each_period_and_each_booking_starts_it_again() {
    let (mut sim, cinema, _) = theatre(GameMode::Modern);
    assert_eq!(
        sim.change_film(cinema, false),
        Err(FilmRefusal::Unavailable)
    );
    counts(&mut sim, cinema, 10);
    assert_eq!(film_days(&sim, cinema), Some(10));
    sim.tower.get_unit_mut(cinema).unwrap().state = UnitState::Gutted;
    let before = sim.money;
    sim.pay_maintenance();
    let without_booking = before - sim.money;
    assert_eq!(
        film_days(&sim, cinema),
        Some(10),
        "a closed theatre books nothing"
    );
    sim.tower.get_unit_mut(cinema).unwrap().state = UnitState::Empty;
    let before = sim.money;
    let booked = sim.pay_maintenance();
    assert!(
        before - sim.money > without_booking,
        "the booking is charged"
    );
    assert_eq!(booked, [cinema]);
    // The day's rollover counts the spent film's last night, then the
    // booked film opens.
    assert_eq!(counts(&mut sim, cinema, 1), [40], "the spent film");
    sim.start_booked_films(&booked);
    assert_eq!(film_days(&sim, cinema), Some(0), "the booking's fresh film");
    assert_eq!(
        counts(&mut sim, cinema, 7),
        [120, 120, 120, 120, 120, 120, 80]
    );
}

#[test]
fn a_modern_booking_opens_after_the_night_the_spent_film_showed() {
    // Through the day loop: maintenance comes before the rollover, and the
    // booked film still starts only once the rollover has counted.
    let (mut sim, cinema, _) = theatre(GameMode::Modern);
    sim.star = 1; // no fires: the theatre stays open through the period
    let mut boundary = None;
    let mut nights: Vec<u8> = Vec::new();
    for day in 0..40 {
        let month = sim.last_month;
        sim.tick(60.0 * 24.0);
        if day > 0 && sim.last_month != month && boundary.is_none() {
            boundary = Some(nights.len());
        }
        nights.push(
            sim.tower
                .get_unit(cinema)
                .unwrap()
                .visitors_yest
                .unwrap_or(0),
        );
    }
    let at = boundary.expect("a maintenance period ended");
    assert_eq!(nights[at], 40, "the spent film's last night: {nights:?}");
    assert_eq!(
        &nights[at + 1..at + 7],
        [120; 6],
        "the new film: {nights:?}"
    );
}

#[test]
fn a_film_change_is_a_payment_and_leaves_no_undo_step() {
    // The card's buttons open a gesture around the change, as every editor
    // action does: the film and its price stay, and no step hands the price
    // back (the way the exterminator's fee stays paid).
    let (mut sim, cinema, _) = theatre(GameMode::Classic);
    let money = sim.money;
    sim.begin_undo_journal("Film change");
    assert_eq!(sim.change_film(cinema, false), Ok(NEW_FILM_PRICE));
    assert!(sim.end_undo_journal().is_none(), "no step");
    assert_eq!(sim.money, money - NEW_FILM_PRICE);
}

#[test]
fn a_classic_theater_is_a_blockbuster_from_the_evening_it_opens() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let (mut sim, cinema, _) = theatre(mode);
        // Put it back under construction, due now, so it opens through the
        // game's own path.
        let (u, at) = sim.tower.marked_by_id(cinema).unwrap();
        u.set_state(at, UnitState::Construction);
        u.extras_mut().complete_at = Some(sim.clock.minutes);
        sim.constructing.insert(cinema);
        sim.blockbusters.clear();
        sim.finish_construction();
        assert_eq!(
            sim.blockbusters.contains(&(cinema as f64)),
            mode == GameMode::Classic,
            "{mode:?}: Modern's blockbusters come from its booking"
        );
    }
}
