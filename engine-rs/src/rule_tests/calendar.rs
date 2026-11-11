//! The calendar a tower runs on: which one each mode resolves, how the clock
//! rolls quarters and years on it, and what a save keeps of it. The spans and
//! the clock readings are `clock::tests`; what each cadence collects is
//! `catalog::charge_tests`.
use crate::clock::{resolve_calendar, CalendarKind, Clock, GameMode, CANON, REAL_WORLD};
use crate::facilities::Kind;
use crate::load::deserialize;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{room, served_tower, LEFT};

const DAY: f64 = 24.0 * 60.0;

#[test]
fn classic_always_runs_canon_and_modern_honors_its_choice() {
    for kind in [CalendarKind::Canon, CalendarKind::RealWorld] {
        assert_eq!(
            resolve_calendar(GameMode::Classic, kind).kind,
            CalendarKind::Canon
        );
        assert_eq!(resolve_calendar(GameMode::Modern, kind).kind, kind);
    }
    assert_eq!(CalendarKind::parse("canon"), Some(CalendarKind::Canon));
    assert_eq!(
        CalendarKind::parse("realWorld"),
        Some(CalendarKind::RealWorld)
    );
    assert_eq!(CalendarKind::parse("nonsense"), None);
}

#[test]
fn the_quarter_rolls_on_its_boundary_and_the_year_wraps_to_the_first() {
    for calendar in [CANON, REAL_WORLD] {
        let at = |day: i64| Clock::new(day as f64 * DAY, calendar);
        let first = at(0).quarter();
        assert_eq!(at(calendar.quarter_days - 1).quarter(), first);
        assert_ne!(at(calendar.quarter_days).quarter(), first);
        assert_eq!(at(calendar.year_days).year(), at(0).year() + 1);
        assert_eq!(at(calendar.year_days).quarter(), 0);
    }
}

#[test]
fn canon_puts_the_weekend_in_the_trailing_slot_and_real_world_on_days_five_and_six() {
    let weekends = |calendar| -> Vec<i64> {
        (0..14)
            .filter(|&d| Clock::new(d as f64 * DAY, calendar).is_weekend())
            .collect()
    };
    assert_eq!(weekends(CANON), [2, 5, 8, 11]);
    assert_eq!(weekends(REAL_WORLD), [5, 6, 12, 13]);
}

#[test]
fn a_save_keeps_the_modern_choice_and_classic_reloads_canon() {
    let modern = Simulation::new_game_with(7, GameMode::Modern, CalendarKind::Canon, false);
    let loaded = deserialize(&modern.serialize()).unwrap();
    assert_eq!(loaded.modern_calendar, CalendarKind::Canon);
    assert_eq!(loaded.clock.calendar.kind, CalendarKind::Canon);

    let classic = Simulation::new_game_with(7, GameMode::Classic, CalendarKind::RealWorld, false);
    let loaded = deserialize(&classic.serialize()).unwrap();
    assert_eq!(loaded.clock.calendar.kind, CalendarKind::Canon);
}

#[test]
fn a_modern_save_without_the_field_or_with_an_unknown_one_loads_real_world() {
    let sim = Simulation::new_game_with(7, GameMode::Modern, CalendarKind::Canon, false);
    let mut save = sim.serialize();
    save.as_object_mut().unwrap().remove("modernCalendar");
    assert_eq!(
        deserialize(&save).unwrap().clock.calendar.kind,
        CalendarKind::RealWorld
    );
    save["modernCalendar"] = "nonsense".into();
    assert_eq!(
        deserialize(&save).unwrap().clock.calendar.kind,
        CalendarKind::RealWorld
    );
}

#[test]
fn a_reload_does_not_collect_the_period_that_just_passed_again() {
    let mut sim = served_tower(GameMode::Classic, CalendarKind::Canon, 3);
    for x in [LEFT + 4, LEFT + 14, LEFT + 24] {
        room(&mut sim, Kind::Office, 2, x, UnitState::Occupied);
    }
    sim.tick(7.0 * DAY);
    let mut loaded = deserialize(&sim.serialize()).unwrap();
    assert_eq!(loaded.money, sim.money);
    // Day 8 stays in the canon quarter and maintenance period both towers
    // already paid: the reload's next day collects nothing the original does not.
    sim.tick(DAY);
    loaded.tick(DAY);
    assert_eq!(loaded.money, sim.money);
}
