//! When offices, clinics and fitness clubs pay rent (#2255). Classic, as
//! SimTower does, collects the whole quarterly rent each quarter. Modern
//! collects it with the monthly overhead: on the real-world calendar that is
//! a third every 30 days, so a new tower never runs 90 days on overhead alone
//! before its first rent. What one collection pays per price is
//! `catalog::charge_tests`.
use crate::clock::{CalendarKind, GameMode};
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{room, served_tower, LEFT};

const DAY: f64 = 24.0 * 60.0;

/// A served tower with three leased offices on floor 2.
fn office_tower(mode: GameMode, calendar: CalendarKind) -> Simulation {
    let mut sim = served_tower(mode, calendar, 3);
    for x in [LEFT + 4, LEFT + 14, LEFT + 24] {
        room(&mut sim, Kind::Office, 2, x, UnitState::Occupied);
    }
    sim
}

/// Runs the day rollover for days `0..days` and returns each office rent
/// collection as `(day, amount)`, read from the money the rollover's own
/// rent line reports.
fn office_rent_days(sim: &mut Simulation, days: i64) -> Vec<(i64, String)> {
    let mut paid = Vec::new();
    for day in 0..days {
        sim.clock.minutes = day as f64 * DAY;
        let seen = sim.log.len();
        sim.on_day();
        for entry in &sim.log[seen..] {
            if entry.text.contains("office rent collected") {
                paid.push((day, entry.text.clone()));
            }
        }
    }
    paid
}

#[test]
fn modern_real_world_offices_pay_a_third_of_their_rent_every_month() {
    let mut sim = office_tower(GameMode::Modern, CalendarKind::RealWorld);
    let per_office = sim.tower.units_of_kind(Kind::Office).next().unwrap().rent;
    // Three offices' quarterly rent, a 30-day share of the 90-day quarter.
    let quarterly = crate::econ::rent_of(Kind::Office, per_office, false) * 3.0;
    let monthly = crate::jsmath::round(quarterly * 30.0 / 90.0);
    let paid = office_rent_days(&mut sim, 91);
    let days: Vec<i64> = paid.iter().map(|p| p.0).collect();
    // Every 30 days from the first rollover, never a 90-day gap.
    assert_eq!(days, [0, 30, 60, 90]);
    // The first month pays all three offices a third of their quarterly rent
    // (a tenant may move out later in the run, so later lines only keep the
    // monthly wording).
    assert_eq!(
        paid[0].1,
        format!(
            "Monthly office rent collected: ${} (3 offices).",
            crate::services::with_thousands(monthly)
        )
    );
    assert!(
        paid.iter().all(|p| p.1.starts_with("Monthly office rent")),
        "{paid:?}"
    );
}

#[test]
fn classic_and_the_short_calendar_still_collect_each_quarter() {
    for (mode, calendar) in [
        (GameMode::Classic, CalendarKind::Canon),
        (GameMode::Modern, CalendarKind::Canon),
    ] {
        let mut sim = office_tower(mode, calendar);
        let paid = office_rent_days(&mut sim, 10);
        let days: Vec<i64> = paid.iter().map(|p| p.0).collect();
        assert_eq!(days, [0, 3, 6, 9], "{mode:?} {calendar:?}");
        assert!(
            paid.iter()
                .all(|p| p.1.starts_with("Quarterly office rent")),
            "{mode:?} {calendar:?}: {paid:?}"
        );
    }
}
