use serde_json::json;

use crate::clock::{CalendarKind, GameMode};
use crate::facilities::Kind;
use crate::load::deserialize;
use crate::sim::{MoveIns, Simulation};

/// The bulletin's lines, oldest first, each with the minute it was logged.
fn bulletin(sim: &Simulation) -> Vec<(f64, String)> {
    sim.log.iter().map(|e| (e.minute, e.text.clone())).collect()
}

#[test]
fn a_day_with_no_move_ins_saves_no_key_and_counts_above_zero_are_written() {
    let mut sim = Simulation::new_game(3, GameMode::Modern);
    assert!(sim.serialize().get("moveIns").is_none());
    sim.move_ins_today = MoveIns {
        offices: 2,
        rooms: 5,
        ..MoveIns::default()
    };
    assert_eq!(
        sim.serialize()["moveIns"],
        json!({"offices": 2, "rooms": 5})
    );
}

#[test]
fn a_reload_keeps_the_days_move_ins_for_the_evening_report() {
    let mut sim = Simulation::new_game(3, GameMode::Classic);
    sim.move_ins_today = MoveIns {
        offices: 1,
        condos: 2,
        rooms: 3,
        fitness: 1,
        clinic: 1,
        rentals: 4,
    };
    let mut loaded = deserialize(&sim.serialize()).expect("loads");
    sim.report_move_ins();
    loaded.report_move_ins();
    let report = sim.log.last().expect("a report").text.clone();
    assert!(report.starts_with("New tenants: 1 office"), "{report}");
    assert_eq!(loaded.log.last().expect("a report").text, report);
    // The report starts the next day's count over, and so does the save.
    assert!(loaded.serialize().get("moveIns").is_none());
}

#[test]
fn a_save_without_the_counts_or_with_bad_ones_starts_them_at_zero() {
    let mut save = Simulation::new_game(3, GameMode::Modern).serialize();
    save["moveIns"] = json!({"offices": -2, "condos": 1.5, "rooms": "7", "fitness": 4, "spa": 9});
    let m = deserialize(&save).expect("loads").move_ins_today;
    assert_eq!(
        (m.offices, m.condos, m.rooms, m.fitness, m.clinic, m.rentals),
        (0, 0, 0, 4, 0, 0)
    );
    save["moveIns"] = json!([1, 2, 3]);
    let m = deserialize(&save).expect("loads").move_ins_today;
    assert_eq!(m.offices + m.condos + m.rooms + m.fitness, 0);
}

/// A small tower with rooms to let: a lobby, five floors served by an
/// elevator and stairs, and offices, condos and hotel rooms still empty.
fn tower_to_let(mode: GameMode) -> Simulation {
    let mut sim = Simulation::new_game_with(11, mode, CalendarKind::RealWorld, false);
    sim.money = 1e9;
    for x in 100..180 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        for f in 2..=6 {
            assert!(sim.tower.place(Kind::Floor, f, x).ok);
        }
    }
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorStandard, 100, 1, 6)
            .ok
    );
    assert!(sim.tower.place_transport(Kind::Stairs, 170, 1, 2).ok);
    for x in [110, 120, 130, 140, 150] {
        assert!(sim.tower.place(Kind::Office, 2, x).ok, "office at {x}");
    }
    for x in [104, 124, 144] {
        assert!(sim.tower.place(Kind::Condo, 4, x).ok, "condo at {x}");
    }
    for x in (106..166).step_by(6) {
        assert!(sim.tower.place(Kind::HotelSingle, 3, x).ok);
        assert!(sim.tower.place(Kind::HotelSingle, 5, x).ok);
    }
    sim
}

/// #2256: a tower saved and reloaded mid-day logs the same bulletin over the
/// next days as the one that never reloaded. The day's move-ins were the one
/// thing between them: without them the reloaded run dropped or shortened
/// the evening's "New tenants:" line.
#[test]
fn a_reloaded_tower_logs_the_same_bulletin_as_the_unbroken_one() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        // Loaded once first, so a load's own one-time work (Classic snaps the
        // rents to its four levels) is behind both runs.
        let mut unbroken = deserialize(&tower_to_let(mode).serialize()).expect("loads");
        let mut minutes = 0;
        while unbroken.move_ins_today.save_json().is_none() {
            unbroken.tick(1.0);
            minutes += 1;
            assert!(minutes < 3 * 24 * 60, "{mode:?}: nobody moves in");
        }
        let mut reloaded = deserialize(&unbroken.serialize()).expect("reloads");
        let reports = |sim: &Simulation| {
            sim.log
                .iter()
                .filter(|e| e.text.starts_with("New tenants:"))
                .count()
        };
        let before = reports(&unbroken);
        for _ in 0..2 * 24 * 60 {
            unbroken.tick(1.0);
            reloaded.tick(1.0);
        }
        assert!(
            reports(&unbroken) > before,
            "{mode:?}: the run logs a move-in report"
        );
        assert_eq!(bulletin(&reloaded), bulletin(&unbroken), "{mode:?}");
    }
}
