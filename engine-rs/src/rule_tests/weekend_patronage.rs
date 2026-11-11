//! The weekday and weekend commercial swing (#398), from the retired
//! `weekendPatronage.integration.test.ts`: on the canon three-day week a
//! Classic restaurant banks more on the weekend day (the 1994 48/35), and a
//! Modern fast food banks less on a real-world weekend (0.7, no office
//! lunch crowd). The per-kind visitor caps by weekend are also
//! `economy::visitors::tests::the_caps_follow_the_original_by_kind_and_weekend`.
use crate::clock::{Clock, GameMode};
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::sim_loop::Weather;
use crate::tower::UnitState;

use super::seeded_game;

/// A starter-lobby game with floors 2 and 3 over the lobby, an elevator at
/// its right edge, four occupied offices on floor 2 and `venue` occupied on
/// floor 3. Returns the sim and the venue.
fn venue_tower(seed: u32, mode: GameMode, venue: Kind) -> (Simulation, i64) {
    let mut sim = seeded_game(seed, mode);
    sim.money = 1e9;
    let lobby: Vec<i64> = sim
        .tower
        .units
        .iter()
        .filter(|u| u.floor == 1 && u.kind == Kind::Lobby)
        .map(|u| u.x)
        .collect();
    let (x0, x1) = (*lobby.iter().min().unwrap(), *lobby.iter().max().unwrap());
    for floor in 2..=3 {
        for x in x0..=x1 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorStandard, x1, 1, 3)
            .ok
    );
    for x in [x0, x0 + 10, x0 + 20, x0 + 30] {
        let r = sim.tower.place(Kind::Office, 2, x);
        assert!(r.ok, "{:?}", r.reason);
        sim.tower.get_unit_mut(r.unit_id.unwrap()).unwrap().state = UnitState::Occupied;
    }
    let r = sim.tower.place(venue, 3, x0);
    assert!(r.ok, "{:?}", r.reason);
    let id = r.unit_id.unwrap();
    sim.tower.get_unit_mut(id).unwrap().state = UnitState::Occupied;
    (sim, id)
}

/// The venue's flushed take from 07:00 to 15:00 on `day`, on a clear day.
fn profit_on_day(seed: u32, mode: GameMode, kind: Kind, day: i64) -> f64 {
    let (mut sim, venue) = venue_tower(seed, mode, kind);
    sim.clock = Clock::new((day * 1440 + 7 * 60) as f64, sim.clock.calendar);
    sim.weather = Weather::Clear;
    sim.tower
        .get_unit_mut(venue)
        .unwrap()
        .extras_mut()
        .profit_today = Some(0.0);
    for _ in 0..8 {
        sim.tick(60.0);
    }
    sim.tower
        .get_unit(venue)
        .unwrap()
        .extras()
        .profit_today
        .unwrap_or(0.0)
}

#[test]
fn a_classic_restaurant_banks_more_on_the_canon_weekend_day() {
    let (sim, _) = venue_tower(31, GameMode::Classic, Kind::Restaurant);
    assert_eq!(sim.clock.calendar.week_days, 3);
    let weekday = profit_on_day(31, GameMode::Classic, Kind::Restaurant, 1);
    let weekend = profit_on_day(31, GameMode::Classic, Kind::Restaurant, 2);
    assert!(weekday > 0.0);
    assert!(
        weekend > weekday,
        "{weekend} on the weekend against {weekday}"
    );
}

#[test]
fn a_modern_fast_food_banks_less_on_a_weekend() {
    let (sim, _) = venue_tower(32, GameMode::Modern, Kind::FastFood);
    assert_eq!(sim.clock.calendar.week_days, 7);
    let weekday = profit_on_day(32, GameMode::Modern, Kind::FastFood, 1);
    let weekend = profit_on_day(32, GameMode::Modern, Kind::FastFood, 5);
    assert!(weekday > 0.0);
    assert!(
        weekend < weekday,
        "{weekend} on the weekend against {weekday}"
    );
}

/// The multipliers behind the swing: the 1994 48/35 for a Classic
/// restaurant and 0.7 for a Modern fast food on the weekend, none on a
/// weekday. The Modern fast food's weekday lead above also comes from the
/// smaller weekend demand pool, so this pins the 0.7 on its own.
#[test]
fn the_weekend_multipliers_follow_the_original_and_the_modern_tuning() {
    use crate::economy::weekend_multiplier;
    let classic = weekend_multiplier(GameMode::Classic, Kind::Restaurant, true);
    assert_eq!(classic, 48.0 / 35.0);
    assert_eq!(
        weekend_multiplier(GameMode::Modern, Kind::FastFood, true),
        0.7
    );
    for mode in [GameMode::Classic, GameMode::Modern] {
        for kind in [Kind::Restaurant, Kind::FastFood] {
            assert_eq!(
                weekend_multiplier(mode, kind, false),
                1.0,
                "{mode:?} {kind:?}"
            );
        }
    }
}
