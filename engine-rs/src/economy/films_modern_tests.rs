//! Modern's films (#1950): a revival, a feature or a blockbuster bought one
//! at a time, a 28-day run at full draw and 14 fading, income that follows
//! the film's tier and age, and a theater that books its chosen film again
//! the morning its film is spent. No mode charges a theater each period.

use super::films_tests::{counts, film_days, theater};
use super::{
    film_income_mult, FilmRefusal, FilmTier, BLOCKBUSTER_INCOME_MULT, FADING_INCOME_SHARE,
    MODERN_BLOCKBUSTER_PRICE, MODERN_FEATURE_PRICE, MODERN_FULL_DRAW_DAYS, MODERN_REVIVAL_PRICE,
    MODERN_SPENT_DAYS, REVIVAL_INCOME_MULT, SPENT_INCOME_SHARE,
};
use crate::clock::GameMode;
use crate::economy::screens::{put_screens, screens, ScreenFilm};
use crate::sim::{LogKind, Simulation};
use crate::tower::UnitState;

fn tier(sim: &Simulation, id: i64) -> FilmTier {
    FilmTier::showing(sim.tower.get_unit(id).unwrap().extras())
}

/// Changes each screen alike, so the theater's two screens show one film
/// as every theater did before it had two (#1950).
fn each_screen(sim: &mut Simulation, id: i64, change: impl Fn(&mut ScreenFilm)) {
    let mode = sim.tower.mode;
    let u = sim.tower.get_unit_mut(id).unwrap();
    let mut films = screens(mode, u);
    films.iter_mut().for_each(change);
    put_screens(mode, u, films);
}

fn set_days(sim: &mut Simulation, id: i64, days: i64) {
    each_screen(sim, id, |f| f.days = Some(days as u8));
}

fn set_policy(sim: &mut Simulation, id: i64, policy: Option<&'static str>) {
    each_screen(sim, id, |f| f.policy = policy);
}

/// Books a `tier` film on both screens, each paying its own price.
fn book_both(sim: &mut Simulation, id: i64, tier: FilmTier) -> f64 {
    (0..2).map(|s| sim.book_film(id, s, tier).unwrap()).sum()
}

/// One morning as the day loop runs it: the rollover counts last night's
/// film, then a spent film is booked again.
fn morning(sim: &mut Simulation, id: i64) -> u8 {
    sim.roll_over_retail_day();
    let counted = sim.tower.get_unit(id).unwrap().visitors_yest.unwrap();
    sim.rebook_spent_films();
    counted
}

fn income_mult(sim: &Simulation, id: i64) -> f64 {
    let in_slot = sim.blockbusters.contains(&(id as f64));
    film_income_mult(sim.tower.mode, sim.tower.get_unit(id).unwrap(), in_slot)
}

#[test]
fn modern_sells_three_films_and_classic_no_blockbuster() {
    let (mut sim, cinema, _) = theater(GameMode::Modern);
    for (tier_bought, price) in [
        (FilmTier::Classic, MODERN_REVIVAL_PRICE),
        (FilmTier::New, MODERN_FEATURE_PRICE),
        (FilmTier::Blockbuster, MODERN_BLOCKBUSTER_PRICE),
    ] {
        set_days(&mut sim, cinema, 20);
        let before = sim.money;
        assert_eq!(sim.change_film(cinema, tier_bought), Ok(price));
        assert_eq!(sim.money, before - price);
        assert_eq!(tier(&sim, cinema), tier_bought);
        assert_eq!(film_days(&sim, cinema), Some(0));
    }
    let (mut classic, cinema, _) = theater(GameMode::Classic);
    let before = (classic.money, classic.save_text());
    assert_eq!(
        classic.change_film(cinema, FilmTier::Blockbuster),
        Err(FilmRefusal::Unavailable)
    );
    assert_eq!((classic.money, classic.save_text()), before);
}

#[test]
fn a_modern_film_draws_28_days_fades_14_then_is_spent() {
    let (mut sim, cinema, _) = theater(GameMode::Modern);
    book_both(&mut sim, cinema, FilmTier::New);
    set_policy(&mut sim, cinema, Some("off"));
    let nights = counts(&mut sim, cinema, 44);
    assert_eq!(nights[..28], [120; 28]);
    assert_eq!(nights[28..42], [80; 14]);
    assert_eq!(nights[42..], [40, 40]);
    // A revival never counts past a fading film.
    book_both(&mut sim, cinema, FilmTier::Classic);
    assert_eq!(counts(&mut sim, cinema, 1), [80]);
}

#[test]
fn modern_income_follows_the_film_and_classic_keeps_its_blockbuster_slot() {
    let (mut sim, cinema, _) = theater(GameMode::Modern);
    let full = MODERN_FULL_DRAW_DAYS;
    let spent = MODERN_SPENT_DAYS;
    for (tier_bought, peak) in [
        (FilmTier::Classic, REVIVAL_INCOME_MULT),
        (FilmTier::New, 1.0),
        (FilmTier::Blockbuster, BLOCKBUSTER_INCOME_MULT),
    ] {
        book_both(&mut sim, cinema, tier_bought);
        for (days, share) in [
            (0, 1.0),
            (full - 1, 1.0),
            (full, FADING_INCOME_SHARE),
            (spent - 1, FADING_INCOME_SHARE),
            (spent, SPENT_INCOME_SHARE),
        ] {
            set_days(&mut sim, cinema, days);
            assert_eq!(
                income_mult(&sim, cinema),
                peak * share,
                "{tier_bought:?} on day {days}"
            );
        }
    }
    let (mut classic, cinema, _) = theater(GameMode::Classic);
    classic.change_film(cinema, FilmTier::New).unwrap();
    assert_eq!(income_mult(&classic, cinema), BLOCKBUSTER_INCOME_MULT);
    classic.blockbusters.clear();
    assert_eq!(income_mult(&classic, cinema), 1.0, "only the slot counts");
}

#[test]
fn only_a_modern_blockbuster_at_full_draw_holds_a_blockbuster_slot() {
    let (mut sim, cinema, _) = theater(GameMode::Modern);
    let key = cinema as f64;
    sim.change_film(cinema, FilmTier::New).unwrap();
    assert!(sim.blockbusters.is_empty(), "a feature holds no slot");
    sim.change_film(cinema, FilmTier::Blockbuster).unwrap();
    assert_eq!(sim.blockbusters, [key]);
    counts(&mut sim, cinema, MODERN_FULL_DRAW_DAYS as usize - 1);
    assert_eq!(sim.blockbusters, [key], "still at full draw");
    counts(&mut sim, cinema, 1);
    assert!(sim.blockbusters.is_empty(), "fading");
}

#[test]
fn a_spent_film_is_booked_again_after_its_last_night_is_counted() {
    let (mut sim, cinema, _) = theater(GameMode::Modern);
    book_both(&mut sim, cinema, FilmTier::New);
    for screen in 0..2 {
        assert_eq!(
            sim.set_screen_policy(cinema, screen, "blockbuster"),
            Some("blockbuster")
        );
    }
    set_days(&mut sim, cinema, MODERN_SPENT_DAYS - 1);
    let before = sim.money;
    assert_eq!(morning(&mut sim, cinema), 80, "the old film's last night");
    // Each screen books its own (#1950).
    assert_eq!(sim.money, before - 2.0 * MODERN_BLOCKBUSTER_PRICE);
    assert_eq!(tier(&sim, cinema), FilmTier::Blockbuster);
    assert_eq!(film_days(&sim, cinema), Some(0));
    assert_eq!(sim.blockbusters, [cinema as f64]);
    assert_eq!(morning(&mut sim, cinema), 120, "the new film");
}

#[test]
fn the_day_loop_rebooks_on_the_morning_the_film_is_spent_after_counting_its_last_night() {
    // Through the day loop rather than the helper above: the rollover counts
    // the old film's last night, then the same morning books the new film.
    let (mut sim, cinema, _) = theater(GameMode::Modern);
    sim.star = 1; // no fires: the theater stays open through the run
    book_both(&mut sim, cinema, FilmTier::New);
    set_days(&mut sim, cinema, MODERN_SPENT_DAYS - 3);
    let mut mornings: Vec<(u8, Option<u8>)> = Vec::new();
    for _ in 0..5 {
        sim.tick(60.0 * 24.0);
        let u = sim.tower.get_unit(cinema).unwrap();
        mornings.push((u.visitors_yest.unwrap_or(0), u.extras().film_days));
    }
    let rebooked = mornings
        .iter()
        .position(|&(_, days)| days == Some(0))
        .expect("a morning that books the new film");
    assert_eq!(
        mornings[rebooked].0, 80,
        "the old film's last night: {mornings:?}"
    );
    assert_eq!(
        mornings[rebooked + 1],
        (120, Some(1)),
        "the new film's first night: {mornings:?}"
    );
    assert!(sim
        .log
        .iter()
        .any(|e| e.text.contains("A feature opens at the movie theater")));
}

#[test]
fn a_theater_with_no_policy_rebooks_a_feature_and_off_keeps_its_spent_film() {
    for (policy, rebooked) in [(None, true), (Some("auto"), true), (Some("off"), false)] {
        let (mut sim, cinema, _) = theater(GameMode::Modern);
        book_both(&mut sim, cinema, FilmTier::Classic);
        set_policy(&mut sim, cinema, policy);
        set_days(&mut sim, cinema, MODERN_SPENT_DAYS - 1);
        let before = sim.money;
        morning(&mut sim, cinema);
        if rebooked {
            let both = 2.0 * MODERN_FEATURE_PRICE;
            assert_eq!(sim.money, before - both, "{policy:?}");
            assert_eq!(tier(&sim, cinema), FilmTier::New, "{policy:?}");
        } else {
            assert_eq!(sim.money, before, "{policy:?}");
            assert_eq!(film_days(&sim, cinema), Some(MODERN_SPENT_DAYS as u8));
            assert_eq!(morning(&mut sim, cinema), 40, "the spent film shows on");
        }
    }
}

#[test]
fn a_closed_or_unaffordable_theater_books_nothing_and_says_so_once() {
    let (mut sim, cinema, _) = theater(GameMode::Modern);
    set_days(&mut sim, cinema, MODERN_SPENT_DAYS);
    sim.tower.get_unit_mut(cinema).unwrap().state = UnitState::Gutted;
    let before = sim.money;
    sim.rebook_spent_films();
    assert_eq!(sim.money, before, "a closed theater books nothing");
    sim.tower.get_unit_mut(cinema).unwrap().state = UnitState::Empty;
    set_days(&mut sim, cinema, MODERN_SPENT_DAYS - 1);
    sim.money = MODERN_FEATURE_PRICE - 1.0;
    let warnings = |sim: &Simulation| {
        sim.log
            .iter()
            .filter(|e| e.kind == LogKind::Bad && e.text.contains("can't afford"))
            .count()
    };
    morning(&mut sim, cinema);
    assert_eq!(sim.money, MODERN_FEATURE_PRICE - 1.0);
    assert_eq!(warnings(&sim), 2, "a line for each screen");
    morning(&mut sim, cinema);
    assert_eq!(warnings(&sim), 2, "only on the morning the film is spent");
    sim.money = 2.0 * MODERN_FEATURE_PRICE;
    morning(&mut sim, cinema);
    assert_eq!(tier(&sim, cinema), FilmTier::New);
    assert_eq!(film_days(&sim, cinema), Some(0), "booked once it can pay");
}

#[test]
fn no_mode_charges_a_theater_each_period() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let (mut sim, cinema, _) = theater(mode);
        sim.tower.get_unit_mut(cinema).unwrap().state = UnitState::Gutted;
        let before = sim.money;
        sim.pay_maintenance();
        let without = before - sim.money;
        sim.tower.get_unit_mut(cinema).unwrap().state = UnitState::Empty;
        let before = sim.money;
        sim.pay_maintenance();
        let overhead = mode.operating_overhead_per_unit();
        let scale = sim.clock.calendar.maint_period_days as f64 / 30.0;
        assert_eq!(
            before - sim.money,
            without + crate::jsmath::round(overhead * scale),
            "{mode:?}: an open theater adds only the overhead"
        );
    }
}

#[test]
fn an_old_modern_save_keeps_its_booked_blockbuster() {
    let (mut sim, cinema, _) = theater(GameMode::Modern);
    sim.blockbusters = vec![cinema as f64];
    let text = sim.save_text();
    assert!(
        !text.contains("filmBlockbuster"),
        "a save from before #1950"
    );
    let back = crate::load_stream::load_save_text(text.as_bytes()).expect("the save loads");
    assert_eq!(tier(&back, cinema), FilmTier::Blockbuster);
    // A save written now carries the tier itself.
    let text = back.save_text();
    assert!(text.contains("\"filmBlockbuster\":true"));
    // A Classic save's slot list says nothing about the tier.
    let (mut classic, cinema, _) = theater(GameMode::Classic);
    classic.blockbusters = vec![cinema as f64];
    let back = crate::load_stream::load_save_text(classic.save_text().as_bytes()).unwrap();
    assert_eq!(tier(&back, cinema), FilmTier::New);
    // Classic has no blockbuster, so a Classic save that carries the flag
    // shows a new film.
    let text = classic.save_text().replace(
        "\"kind\":\"cinema\"",
        "\"kind\":\"cinema\",\"filmBlockbuster\":true",
    );
    assert!(text.contains("\"filmBlockbuster\":true"));
    let back = crate::load_stream::load_save_text(text.as_bytes()).unwrap();
    assert_eq!(tier(&back, cinema), FilmTier::New);
}

#[test]
fn each_rebook_choice_names_an_offered_film_and_a_policy_the_save_takes() {
    let films = GameMode::Modern.films();
    let (mut sim, cinema, _) = theater(GameMode::Modern);
    for r in films.rebooks {
        assert_eq!(sim.set_film_policy(cinema, r.policy), Some(r.policy));
        assert_eq!(r.film, r.tier.map(FilmTier::key), "{}", r.policy);
        if let Some(t) = r.tier {
            assert!(
                films.offer(t).is_some(),
                "{} books an offered film",
                r.policy
            );
        }
        assert_eq!(films.rebooked(Some(r.policy)), r.tier);
    }
    assert_eq!(films.rebooked(None), Some(FilmTier::New));
    assert!(GameMode::Classic.films().rebooks.is_empty());
    assert_eq!(GameMode::Classic.films().rebooked(None), None);
}

#[test]
fn a_gutted_theater_drops_its_blockbuster() {
    // A theater that burns down shows no film: a rebuilt one opens with a
    // feature, so the gutted shell keeps no blockbuster on its card or save.
    let (mut sim, cinema, _) = theater(GameMode::Modern);
    sim.change_film(cinema, FilmTier::Blockbuster).unwrap();
    let (u, at) = sim.tower.marked_by_id(cinema).unwrap();
    u.set_state(at, UnitState::Fire);
    sim.events.active.insert(cinema);
    sim.events.pending = Some(crate::events::PendingChoice {
        kind: "fireRescue",
        cost: 0.0,
        message: String::new(),
    });
    sim.resolve_choice(true);
    let u = sim.tower.get_unit(cinema).unwrap();
    assert_eq!(u.state, UnitState::Gutted);
    assert!(!u.extras().film_blockbuster);
    assert_eq!(tier(&sim, cinema), FilmTier::New);
}
