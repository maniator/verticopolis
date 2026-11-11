//! Weather and the seasonal and visitor events: the daily weather is a
//! pure hash of the day that leaves the game stream alone and is mostly
//! clear, a thief robs a tower without Security and is always caught with
//! it, Santa crosses a three-star sky once a year (never a lower tower's,
//! and a reload keeps the once-a-year guard), fire defense makes fires
//! rarer, and the rescue fee scales with the rating. Rain's effect on
//! commerce is `faqWeatherEngine.integration.test.ts`.
use crate::clock::{CalendarKind, GameMode};
use crate::facilities::Kind;
use crate::load::deserialize;
use crate::rng::Rng;
use crate::sim::Simulation;
use crate::sim_loop::{weather_for, Weather};

const YEAR_DAYS: i64 = 360;

/// A Modern game on the real-world calendar, whose year is 360 days (Classic
/// always runs the canon twelve-day year).
fn real_world(seed: u32, star: i64) -> Simulation {
    let mut sim = Simulation::new_game_with(seed, GameMode::Modern, CalendarKind::RealWorld, false);
    sim.money = 1_000_000.0;
    sim.star = star;
    sim
}

/// The daily roll on each day in `days`, as the day boundary runs it.
fn run_days(sim: &mut Simulation, days: std::ops::Range<i64>) {
    for day in days {
        sim.clock.minutes = (day * 1440) as f64;
        sim.maybe_random_event();
    }
}

fn count(sim: &Simulation, needle: &str) -> usize {
    sim.log.iter().filter(|e| e.text.contains(needle)).count()
}

#[test]
fn the_weather_is_a_hash_of_the_day_that_leaves_the_game_stream_alone() {
    assert_eq!(weather_for(42), weather_for(42));
    let mut a = Simulation::new_game(123, GameMode::Classic);
    let mut b = Simulation::new_game(123, GameMode::Classic);
    let before = a.rng.seed();
    for _ in 0..50 {
        a.tick(60.0);
        b.tick(60.0);
    }
    assert_eq!((a.money, a.population()), (b.money, b.population()));
    // An empty tower draws nothing, so two days of weather moved no state.
    assert_eq!(a.rng.seed(), before);
}

#[test]
fn the_year_is_mostly_clear_with_some_cloud_and_rain() {
    let mut clear = 0;
    let mut cloudy = 0;
    let mut rain = 0;
    for day in 0..2 * YEAR_DAYS {
        match weather_for(day) {
            Weather::Clear => clear += 1,
            Weather::Cloudy => cloudy += 1,
            Weather::Rain => rain += 1,
        }
    }
    assert!(clear > cloudy + rain);
    assert!(cloudy > 0 && rain > 0);
}

#[test]
fn a_thief_robs_a_tower_without_security_and_security_catches_every_one() {
    let mut bare = real_world(7, 2);
    run_days(&mut bare, 0..800);
    assert!(count(&bare, "made off") > 0);
    assert!(bare.money < 1_000_000.0);

    let mut guarded = real_world(7, 2);
    for x in 0..20 {
        assert!(guarded.tower.place(Kind::Lobby, 1, x).ok);
        assert!(guarded.tower.place(Kind::Floor, 2, x).ok);
    }
    assert!(guarded.tower.place(Kind::Security, 2, 0).ok);
    run_days(&mut guarded, 0..800);
    assert!(count(&guarded, "caught a thief") > 0);
    assert_eq!(count(&guarded, "made off"), 0);
}

#[test]
fn santa_crosses_a_three_star_sky_once_a_year_and_skips_a_lower_tower() {
    let mut sim = real_world(7, 3);
    assert_eq!(sim.clock.calendar.year_days, YEAR_DAYS);
    run_days(&mut sim, 0..YEAR_DAYS);
    assert_eq!(count(&sim, "Santa"), 1);
    assert_eq!(sim.fx.santa_seq, 1, "one flyover, one cosmetic trigger");

    let mut low = real_world(7, 2);
    run_days(&mut low, 0..YEAR_DAYS);
    assert_eq!(count(&low, "Santa"), 0);
    assert_eq!(low.fx.santa_seq, 0);
}

#[test]
fn a_reload_keeps_santas_once_a_year_guard() {
    let mut sim = real_world(7, 3);
    run_days(&mut sim, 0..YEAR_DAYS);
    assert_eq!(count(&sim, "Santa"), 1);
    let mut loaded = deserialize(&sim.serialize()).unwrap();
    loaded.events.extra = Rng::new(999);
    let before = count(&loaded, "Santa");
    run_days(&mut loaded, YEAR_DAYS - 20..YEAR_DAYS);
    assert_eq!(count(&loaded, "Santa"), before);
}

/// Isolated offices one per floor (no spread), optionally with Security
/// and Medical on floor 2.
fn fire_tower(defended: bool, star: i64) -> Simulation {
    const WIDTH: i64 = 44;
    let mut sim = Simulation::new_game(7, GameMode::Classic);
    sim.money = 1_000_000.0;
    sim.star = star;
    for x in 0..WIDTH {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        assert!(sim.tower.place(Kind::Floor, 2, x).ok);
    }
    if defended {
        assert!(sim.tower.place(Kind::Security, 2, 0).ok);
        assert!(sim.tower.place(Kind::Medical, 2, 16).ok);
    }
    for floor in 3..=42 {
        for x in 0..WIDTH {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
        assert!(sim.tower.place(Kind::Office, floor, 0).ok);
    }
    sim
}

#[test]
fn fire_defense_makes_fires_rarer() {
    let mut bare = fire_tower(false, 3);
    let mut defended = fire_tower(true, 3);
    run_days(&mut bare, 0..500);
    run_days(&mut defended, 0..500);
    let bare_fires = count(&bare, "Fire broke out");
    assert!(bare_fires > 0);
    assert!(count(&defended, "Fire broke out") < bare_fires);
}

#[test]
fn the_rescue_fee_scales_with_the_rating() {
    let first_fee = |star: i64| -> Option<f64> {
        let mut sim = fire_tower(false, star);
        for day in 0..8000 {
            run_days(&mut sim, day..day + 1);
            if let Some(p) = sim
                .events
                .pending
                .as_ref()
                .filter(|p| p.kind == "fireRescue")
            {
                return Some(p.cost);
            }
        }
        None
    };
    assert_eq!(first_fee(2), Some(150_000.0));
    assert_eq!(first_fee(5), Some(500_000.0));
}
