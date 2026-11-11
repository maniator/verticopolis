use super::*;
use crate::clock::GameMode;
use crate::events::PendingChoice;
use crate::tower::UnitState;

/// A Classic tower with offices on floors 2 to `top`, a lobby on 1, and
/// `offices` Security offices on floor 1, every room open.
fn tower(top: i64, offices: usize) -> Simulation {
    let mut sim = Simulation::new_game(11, GameMode::Classic);
    sim.money = 1e9;
    for x in 160..220 {
        assert!(sim.build(Kind::Lobby, 1, x).ok);
    }
    for f in 2..=top {
        for x in 160..220 {
            assert!(sim.build(Kind::Floor, f, x).ok);
        }
        assert!(sim.build(Kind::Office, f, 170).ok, "office on {f}");
    }
    sim.star = 4;
    for i in 0..offices {
        let r = sim.build(Kind::Security, 2, 185 + 16 * i as i64);
        assert!(r.ok, "{:?}", r.reason);
    }
    for u in sim.tower.units.iter_mut() {
        if u.state == UnitState::Construction {
            u.state = UnitState::Empty;
        }
    }
    sim.gameplay.drain();
    sim
}

fn decline(sim: &mut Simulation) {
    sim.events.pending = Some(PendingChoice {
        kind: "bombThreat",
        cost: 300_000.0,
        message: String::new(),
    });
    sim.resolve_choice(false);
}

/// Steps the search minute by minute until it ends or `limit` minutes pass.
fn run(sim: &mut Simulation, limit: i64) {
    for _ in 0..limit {
        if sim.events.bomb.is_none() {
            return;
        }
        sim.clock.advance(1.0);
        sim.advance_bomb_search();
    }
}

#[test]
fn a_declined_ransom_in_classic_starts_a_search_instead_of_settling_at_once() {
    let mut sim = tower(8, 1);
    let money = sim.money;
    decline(&mut sim);
    let b = sim.events.bomb.as_ref().expect("a search runs");
    assert_eq!(b.guards.len(), GUARDS_PER_OFFICE);
    assert_eq!(
        b.deadline,
        (sim.clock.minutes / 1440.0).floor() * 1440.0 + 13.0 * 60.0,
        "1:00 PM today"
    );
    assert_eq!(sim.money, money, "nothing is charged until it ends");
    assert_eq!(sim.events.bombs_detonated, 0);
    let sweeping: Vec<i64> = b.guards.iter().filter_map(|g| g.floor).collect();
    assert_eq!(
        sweeping.len(),
        GUARDS_PER_OFFICE,
        "six floors, one guard each"
    );
    let mut unique = sweeping.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), sweeping.len(), "no two guards on one floor");
}

#[test]
fn enough_guards_find_the_bomb_before_the_deadline() {
    let mut sim = tower(6, 1);
    decline(&mut sim);
    let money = sim.money;
    run(&mut sim, 1500);
    assert!(sim.events.bomb.is_none());
    assert_eq!(sim.events.bombs_detonated, 0);
    assert!(
        sim.money < money && sim.money >= money - 5_000.0,
        "the evacuation fee"
    );
    assert!(sim.log.iter().any(|e| e.text.contains("found the bomb")));
}

#[test]
fn with_no_security_the_bomb_goes_off_at_the_deadline() {
    let mut sim = tower(6, 0);
    decline(&mut sim);
    let deadline = sim.events.bomb.as_ref().unwrap().deadline;
    assert!(sim.events.bomb.as_ref().unwrap().guards.is_empty());
    run(&mut sim, 1500);
    assert!(sim.events.bomb.is_none());
    assert_eq!(sim.events.bombs_detonated, 1);
    assert_eq!(sim.clock.minutes, deadline, "not a minute early or late");
    assert!(sim.tower.units.iter().any(|u| u.state == UnitState::Gutted));
}

#[test]
fn a_tower_too_tall_for_its_guards_can_lose_the_race() {
    // Six guards and an hour left: floor 61 is far out of reach of an
    // office on floor 2.
    let mut sim = tower(61, 1);
    decline(&mut sim);
    let b = sim.events.bomb.as_mut().unwrap();
    b.floor = 61;
    b.deadline = sim.clock.minutes + 60.0;
    run(&mut sim, 1500);
    assert!(sim.events.bomb.is_none());
    assert_eq!(sim.events.bombs_detonated, 1);
    assert!(sim.log.iter().any(|e| e.text.contains("ran out of time")));
}

#[test]
fn the_search_survives_a_save_and_load() {
    let mut sim = tower(30, 1);
    decline(&mut sim);
    sim.events.bomb.as_mut().unwrap().floor = 30;
    sim.clock.advance(45.0);
    sim.advance_bomb_search();
    let before = sim.events.bomb.clone().unwrap();
    assert!(!before.searched.is_empty());
    let saved = sim.serialize();
    assert_eq!(saved["events"]["bomb"], before.save_state());
    let back = crate::load_stream::load_save_text(saved.to_string().as_bytes()).expect("loads");
    assert_eq!(back.events.bomb, Some(before));
}

#[test]
fn a_save_without_a_search_has_no_bomb_key() {
    let sim = tower(3, 1);
    assert!(sim.serialize()["events"].get("bomb").is_none());
}

#[test]
fn a_malformed_bomb_loads_as_none() {
    for bad in [
        serde_json::json!(null),
        serde_json::json!(3),
        serde_json::json!({"floor": 2}),
        serde_json::json!({"floor": 2, "x": 1, "deadline": 9, "guards": [{"floor": "x", "doneAt": 1}], "searched": []}),
        serde_json::json!({"floor": 2, "x": 1, "deadline": 9, "guards": [], "searched": [null]}),
    ] {
        assert_eq!(BombSearch::from_save(&bad), None, "{bad}");
    }
}

/// The regression this file exists for: a refused ransom used to settle on
/// the spot in both modes ("found nothing", or an instant blast). In either
/// mode it has to start a search that nothing settles before the clock moves.
#[test]
fn a_refused_ransom_never_settles_at_once_in_either_mode() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        for offices in [0, 1] {
            let mut sim = tower(6, offices);
            sim.mode = mode;
            let money = sim.money;
            decline(&mut sim);
            assert!(sim.events.bomb.is_some(), "{mode:?}, {offices} office(s)");
            assert_eq!(sim.money, money, "{mode:?}: nothing charged yet");
            assert_eq!(sim.events.bombs_detonated, 0, "{mode:?}: no blast yet");
            assert!(
                !sim.log.iter().any(|e| e.text.contains("found nothing")),
                "{mode:?}: no instant sweep"
            );
            sim.advance_bomb_search();
            assert!(sim.events.bomb.is_some(), "{mode:?}: still searching");
        }
    }
}

#[test]
fn modern_searches_on_the_clock_too() {
    let mut sim = tower(6, 1);
    sim.mode = GameMode::Modern;
    decline(&mut sim);
    run(&mut sim, 1500);
    assert!(sim.events.bomb.is_none());
    assert_eq!(sim.events.bombs_detonated, 0);
}

#[test]
fn in_modern_a_security_office_that_opens_mid_search_joins_it() {
    let mut sim = tower(6, 0);
    sim.mode = GameMode::Modern;
    decline(&mut sim);
    assert!(sim.events.bomb.as_ref().unwrap().guards.is_empty());
    sim.join_bomb_search(2);
    let b = sim.events.bomb.as_ref().unwrap();
    assert_eq!(b.guards.len(), GUARDS_PER_OFFICE);
    assert!(
        b.guards.iter().any(|g| g.floor.is_some()),
        "they set out at once"
    );
    run(&mut sim, 1500);
    assert_eq!(sim.events.bombs_detonated, 0);
}

#[test]
fn a_new_office_joins_through_finished_construction() {
    let mut sim = tower(6, 0);
    sim.mode = GameMode::Modern;
    decline(&mut sim);
    assert!(sim.build(Kind::Security, 3, 185).ok);
    sim.clock.advance(24.0 * 60.0);
    sim.finish_construction();
    assert_eq!(
        sim.events.bomb.as_ref().map(|b| b.guards.len()),
        Some(GUARDS_PER_OFFICE)
    );
}

#[test]
fn in_classic_a_late_office_stays_out_of_the_search() {
    let mut sim = tower(6, 0);
    decline(&mut sim);
    sim.join_bomb_search(2);
    assert!(sim.events.bomb.as_ref().unwrap().guards.is_empty());
}

#[test]
fn a_found_bomb_reports_bomb_found() {
    let mut sim = tower(6, 1);
    decline(&mut sim);
    run(&mut sim, 1500);
    let events = sim.gameplay.drain();
    assert!(events.contains(&crate::gameplay::GameplayEvent::BombFound));
}

#[test]
fn one_long_step_hands_out_floors_in_the_order_short_steps_would() {
    // Every hiding floor, each with the clock run minute by minute and in
    // one jump to the deadline: the same outcome and the same floors swept.
    for floor in 3..=30 {
        let start = |sim: &mut Simulation| {
            decline(sim);
            sim.events.bomb.as_mut().unwrap().floor = floor;
        };
        let (mut short, mut long) = (tower(30, 2), tower(30, 2));
        start(&mut short);
        start(&mut long);
        let deadline = short.events.bomb.as_ref().unwrap().deadline;
        while short.events.bomb.is_some() && short.clock.minutes < deadline {
            short.clock.advance(1.0);
            short.advance_bomb_search();
        }
        long.clock.minutes = deadline;
        long.advance_bomb_search();
        assert_eq!(
            short.events.bombs_detonated, long.events.bombs_detonated,
            "bomb on floor {floor}"
        );
    }
}

#[test]
fn the_view_leaves_out_the_hiding_place() {
    let mut sim = tower(8, 1);
    decline(&mut sim);
    let v = sim.bomb_search_view().unwrap();
    assert!(v.get("floor").is_none() && v.get("x").is_none());
    let sweeping = v["sweeping"].as_array().unwrap();
    assert_eq!(sweeping.len(), GUARDS_PER_OFFICE);
    for s in sweeping {
        assert!(
            s["left"].as_i64().unwrap() < s["right"].as_i64().unwrap(),
            "{s}"
        );
    }
}

#[test]
fn clock_label_reads_like_a_wall_clock() {
    assert_eq!(clock_label(180.0), "3:00 AM");
    assert_eq!(clock_label(1440.0 * 3.0 + 13.0 * 60.0 + 5.0), "1:05 PM");
    assert_eq!(clock_label(0.0), "12:00 AM");
}

#[test]
fn the_deadline_is_the_next_one_pm() {
    assert_eq!(deadline_after(7.0 * 60.0), 13.0 * 60.0);
    assert_eq!(deadline_after(13.0 * 60.0), 1440.0 + 13.0 * 60.0);
    assert_eq!(
        deadline_after(1440.0 * 5.0 + 1.0),
        1440.0 * 5.0 + 13.0 * 60.0
    );
}

#[test]
fn classic_needs_security_before_a_ransom_call() {
    let mut sim = tower(4, 0);
    sim.star = 4;
    for _ in 0..400 {
        sim.maybe_random_event();
        assert!(sim
            .events
            .pending
            .as_ref()
            .is_none_or(|p| p.kind != "bombThreat"));
        sim.events.pending = None;
        sim.events.active.clear();
    }
}

#[test]
fn an_office_opening_in_a_long_step_cannot_take_a_floor_a_guard_reached_first() {
    // Modern: the lone office's guards reach floor 9 before the deadline. A
    // second office on floor 9 finishes inside the same long step, after the
    // deadline; its guards must not claim the floor first.
    let mut sim = tower(30, 1);
    sim.mode = GameMode::Modern;
    decline(&mut sim);
    assert!(sim.build(Kind::Security, 9, 185).ok);
    let b = sim.events.bomb.as_mut().unwrap();
    b.floor = 9;
    let deadline = b.deadline;
    sim.clock.minutes = deadline + 24.0 * 60.0;
    sim.finish_construction_and_search();
    assert!(sim.events.bomb.is_none());
    assert_eq!(sim.events.bombs_detonated, 0);
}

#[test]
fn an_office_opening_mid_step_joins_from_the_minute_it_opened() {
    // Modern, no Security yet: an office on the bomb's floor opens 25
    // minutes before the deadline. Minute steps and one 30-minute step
    // must end the same way.
    let outcome = |long: bool| {
        let mut sim = tower(30, 0);
        sim.mode = GameMode::Modern;
        decline(&mut sim);
        assert!(sim.build(Kind::Security, 9, 185).ok);
        let b = sim.events.bomb.as_mut().unwrap();
        b.floor = 9;
        let deadline = b.deadline;
        let id = sim
            .tower
            .units
            .iter()
            .find(|u| u.kind == Kind::Security)
            .unwrap()
            .id;
        let (u, _) = sim.tower.marked_by_id(id).unwrap();
        u.extras_mut().complete_at = Some(deadline - 25.0);
        sim.clock.minutes = deadline - 30.0;
        if long {
            sim.clock.minutes = deadline;
            sim.finish_construction_and_search();
        } else {
            while sim.events.bomb.is_some() && sim.clock.minutes < deadline {
                sim.clock.advance(1.0);
                sim.finish_construction_and_search();
            }
        }
        (sim.events.bomb.is_none(), sim.events.bombs_detonated)
    };
    assert_eq!(outcome(false), (true, 0), "minute steps find it");
    assert_eq!(outcome(true), outcome(false));
}

#[test]
fn one_long_step_still_finds_a_bomb_a_guard_reached_in_time() {
    // A guard that clears floors in a row inside one big step reaches the
    // bomb's floor before the deadline: found, though the step ends after it.
    let mut sim = tower(30, 1);
    decline(&mut sim);
    let b = sim.events.bomb.as_mut().unwrap();
    b.floor = 9;
    let deadline = b.deadline;
    sim.clock.minutes = deadline + 30.0;
    sim.advance_bomb_search();
    assert!(sim.events.bomb.is_none());
    assert_eq!(sim.events.bombs_detonated, 0);
}

/// The log is tucked away on a phone, so every turn of a bomb threat has to
/// be a kind the game toasts on screen (good or bad), never a quiet info line.
#[test]
fn every_turn_of_a_bomb_threat_is_a_line_the_game_toasts() {
    use crate::sim::LogKind;
    let toasts = |sim: &Simulation, from: usize| {
        sim.log[from..]
            .iter()
            .filter(|e| e.text.contains('💣'))
            .all(|e| matches!(e.kind, LogKind::Good | LogKind::Bad))
    };
    for (offices, mode) in [(1, GameMode::Classic), (0, GameMode::Modern)] {
        let mut sim = tower(6, offices);
        sim.mode = mode;
        let from = sim.log.len();
        decline(&mut sim);
        sim.join_bomb_search(2);
        run(&mut sim, 1500);
        assert!(sim.events.bomb.is_none(), "{mode:?}: the search ended");
        assert!(
            sim.log[from..]
                .iter()
                .filter(|e| e.text.contains('💣'))
                .count()
                >= 2
        );
        assert!(toasts(&sim, from), "{mode:?}");
    }
}
