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

#[test]
fn modern_still_answers_at_once() {
    let mut sim = tower(6, 1);
    sim.mode = GameMode::Modern;
    decline(&mut sim);
    assert!(sim.events.bomb.is_none());
    assert!(sim.log.iter().any(|e| e.text.contains("found nothing")));
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
