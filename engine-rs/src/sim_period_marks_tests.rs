use serde_json::json;

use crate::clock::{CalendarKind, GameMode};
use crate::facilities::Kind;
use crate::load::deserialize;
use crate::sim::Simulation;
use crate::snapshot::state_view;

/// A first-day tower with offices to let: a lobby, one office floor and
/// stairs up to it.
fn first_day_tower(mode: GameMode) -> Simulation {
    let mut sim = Simulation::new_game_with(11, mode, CalendarKind::RealWorld, false);
    sim.money = 1e9;
    for x in 100..180 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        assert!(sim.tower.place(Kind::Floor, 2, x).ok);
    }
    assert!(sim.tower.place_transport(Kind::Stairs, 170, 1, 2).ok);
    for x in [110, 120, 130, 140, 150] {
        assert!(sim.tower.place(Kind::Office, 2, x).ok, "office at {x}");
    }
    sim
}

/// The bulletin's lines, each with the minute it was logged.
fn bulletin(sim: &Simulation) -> Vec<(f64, String)> {
    sim.log.iter().map(|e| (e.minute, e.text.clone())).collect()
}

#[test]
fn a_new_game_saves_the_marks_it_has_not_handled_and_a_later_day_saves_none() {
    let mut sim = first_day_tower(GameMode::Classic);
    assert_eq!(
        sim.serialize()["periodMarks"],
        json!({"hour": -1, "month": -1, "quarter": -1})
    );
    sim.tick(1.0);
    assert_eq!(
        sim.serialize()["periodMarks"],
        json!({"month": -1, "quarter": -1})
    );
    sim.tick(24.0 * 60.0);
    assert!(sim.serialize().get("periodMarks").is_none());
}

/// A game saved on its first day, before or after its first step, bills the
/// first maintenance and office rent at the first day's end after a reload,
/// exactly as the game that never saved does. The rent lands quarterly or,
/// for a Modern lease on the real-world calendar, monthly.
#[test]
fn a_first_day_reload_plays_on_as_the_unsaved_game() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        for minutes_before_save in [0, 600] {
            // Loaded once first, so a load's own one-time work (Classic snaps
            // the rents to its four levels) is behind both runs.
            let mut unsaved = deserialize(&first_day_tower(mode).serialize()).expect("loads");
            for _ in 0..minutes_before_save {
                unsaved.tick(1.0);
            }
            let mut reloaded = deserialize(&unsaved.serialize()).expect("reloads");
            let what = format!("{mode:?}, saved after {minutes_before_save} minutes");
            for hour in 0..48 {
                for _ in 0..60 {
                    unsaved.tick(1.0);
                    reloaded.tick(1.0);
                }
                let (r, u) = (state_view(&reloaded), state_view(&unsaved));
                assert_eq!(r, u, "{what}, hour {hour}");
            }
            assert_eq!(bulletin(&reloaded), bulletin(&unsaved), "{what}");
            let collected = |sim: &Simulation| {
                sim.log
                    .iter()
                    .any(|e| e.text.contains("office rent collected"))
            };
            assert!(
                collected(&unsaved),
                "{what}: the first office rent is collected"
            );
        }
    }
}

#[test]
fn a_save_without_the_marks_or_with_bad_ones_takes_the_clocks() {
    let mut save = first_day_tower(GameMode::Modern).serialize();
    save["periodMarks"] = json!({"hour": -2, "month": 0.5, "quarter": "-1"});
    let sim = deserialize(&save).expect("loads");
    let (hour, month, quarter) = (
        sim.clock.hour(),
        sim.maintenance_period(),
        sim.clock.quarter(),
    );
    assert_eq!(
        (sim.last_hour, sim.last_month, sim.last_quarter),
        (hour, month, quarter)
    );
    save.as_object_mut().unwrap().remove("periodMarks");
    let sim = deserialize(&save).expect("loads");
    assert_eq!(
        (sim.last_hour, sim.last_month, sim.last_quarter),
        (hour, month, quarter)
    );
}
