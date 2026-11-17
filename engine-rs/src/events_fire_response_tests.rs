use super::*;
use crate::clock::GameMode;
use crate::gameplay::GameplayEvent;
use crate::tower::UnitState;

/// A tower with a lobby on 1, offices on floors 2 to `top` at x 170, and a
/// Security office on floor `security` (none for `None`), every room open.
fn tower(mode: GameMode, top: i64, security: Option<i64>) -> Simulation {
    let mut sim = Simulation::new_game(11, mode);
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
    if let Some(f) = security {
        let r = sim.build(Kind::Security, f, 190);
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

/// The id of the office on `floor`.
fn office_on(sim: &Simulation, floor: i64) -> i64 {
    sim.tower
        .units
        .iter()
        .find(|u| u.kind == Kind::Office && u.floor == floor)
        .map(|u| u.id)
        .expect("an office there")
}

fn fire_on(sim: &mut Simulation, floor: i64) {
    let id = office_on(sim, floor);
    assert!(sim.start_fire_at(id));
}

fn drained(sim: &mut Simulation) -> Vec<GameplayEvent> {
    sim.gameplay.drain()
}

#[test]
fn guards_take_the_stairs_to_the_fire_and_only_then_help_contain_it() {
    let mut sim = tower(GameMode::Classic, 8, Some(2));
    let now = sim.clock.minutes;
    let base = 0.5;
    fire_on(&mut sim, 6);
    let r = sim.events.fire.clone().expect("Security answers the fire");
    assert_eq!(r.guards.len(), GUARDS_PER_OFFICE);
    let office = office_on(&sim, 6);
    let room = sim.tower.get_unit(office).unwrap();
    for (k, g) in r.guards.iter().enumerate() {
        assert_eq!((g.from, g.floors), (2, 4), "four floors of stairs up");
        assert_eq!(g.start, now + k as f64 * FIRE_GUARD_STAGGER_MINUTES);
        assert_eq!(g.arrive, g.start + 4.0 * STAIR_MINUTES_PER_FLOOR);
        assert!(g.done >= g.arrive);
        assert!(
            (room.x..room.x + room.width).contains(&g.at),
            "fights inside the room"
        );
        assert_eq!(
            g.route.last().map(|c| c.0),
            Some(6),
            "steps off on the fire's floor"
        );
    }
    // On its way, a guard helps nothing; once there, the 0.2 Security share.
    assert_eq!(sim.control_chance(6), base);
    let last = r.guards.iter().map(|g| g.done).fold(0.0, f64::max);
    sim.clock.minutes = r.guards[0].done;
    assert!((sim.control_chance(6) - (base + 0.2)).abs() < 1e-9);
    sim.clock.minutes = last;
    assert!((sim.control_chance(6) - (base + 0.2)).abs() < 1e-9);
    assert!(sim.log.iter().any(|e| e
        .text
        .contains("Security guards are taking the emergency stairs")));
}

#[test]
fn guards_from_too_far_down_do_not_change_the_odds() {
    let mut sim = tower(GameMode::Classic, 14, Some(2));
    let base = 0.5;
    fire_on(&mut sim, 13);
    sim.clock.minutes += 24.0 * 60.0;
    assert_eq!(
        sim.events.fire.as_ref().unwrap().guards.len(),
        GUARDS_PER_OFFICE
    );
    assert_eq!(
        sim.control_chance(13),
        base,
        "eleven floors is past the reach"
    );
}

#[test]
fn a_tower_without_security_sends_nobody_and_its_fire_burns_out() {
    let mut sim = tower(GameMode::Modern, 6, None);
    fire_on(&mut sim, 4);
    let r = sim.events.fire.as_ref().expect("the fire is tracked");
    assert!(r.guards.is_empty());
    drained(&mut sim);
    // The daily roll guts the last room ablaze.
    let office = office_on(&sim, 4);
    let i = sim.tower.units.iter().position(|u| u.id == office).unwrap();
    sim.gut(i);
    sim.events.active.clear();
    sim.advance_fire_response();
    assert_eq!(
        drained(&mut sim),
        [GameplayEvent::FireOut {
            by: FireOutcome::BurnedOut
        }]
    );
    assert!(sim.events.fire.is_none(), "nothing left to draw");
}

#[test]
fn the_helicopter_puts_the_fire_out_when_it_lands_then_flies_off() {
    let mut sim = tower(GameMode::Classic, 8, Some(2));
    fire_on(&mut sim, 6);
    let money = sim.money;
    sim.resolve_choice(true);
    assert_eq!(sim.money, money - 500_000.0, "Classic's fixed price");
    assert!(sim.helicopter_flying());
    assert_eq!(
        sim.call_fire_rescue(),
        Err(super::super::FireRescueRefusal::Coming)
    );
    let h = sim
        .events
        .fire
        .as_ref()
        .unwrap()
        .helicopter
        .clone()
        .unwrap();
    assert_eq!(h.arrive, h.called + HELICOPTER_FLIGHT_MINUTES);
    sim.clock.minutes = h.arrive - 1.0;
    sim.advance_fire_response();
    assert_eq!(sim.events.count(), 1, "still burning in the air");
    drained(&mut sim);
    sim.clock.minutes = h.arrive;
    sim.advance_fire_response();
    assert_eq!(sim.events.count(), 0);
    let office = office_on(&sim, 6);
    assert_eq!(sim.tower.get_unit(office).unwrap().state, UnitState::Gutted);
    assert_eq!(
        drained(&mut sim),
        [
            GameplayEvent::FireGutted { rooms: 1 },
            GameplayEvent::FireOut {
                by: FireOutcome::Rescue
            }
        ]
    );
    let view = sim.fire_response_view().unwrap();
    assert_eq!(view["out"], true);
    assert_eq!(
        view["guards"].as_array().unwrap().len(),
        0,
        "guards stand down"
    );
    assert!(view["helicopter"].is_object(), "still spraying");
    sim.clock.minutes = h.leave;
    sim.advance_fire_response();
    assert!(sim.events.fire.is_none());
}

#[test]
fn modern_keeps_the_star_scaled_rescue_price() {
    let mut sim = tower(GameMode::Modern, 4, None);
    sim.star = 3;
    assert_eq!(sim.fire_rescue_cost(), 270_000.0);
    sim.mode = GameMode::Classic;
    assert_eq!(sim.fire_rescue_cost(), 500_000.0);
}

#[test]
fn the_view_draws_each_guard_like_a_bomb_search_guard() {
    let mut sim = tower(GameMode::Classic, 6, Some(2));
    fire_on(&mut sim, 5);
    let r = sim.events.fire.clone().unwrap();
    let view = sim.fire_response_view().unwrap();
    assert_eq!(
        (view["floor"].as_i64(), view["seq"].as_i64()),
        (Some(5), Some(r.seq))
    );
    let g = &view["guards"][0];
    assert_eq!(g["floor"], 5);
    assert_eq!(g["from"], 2);
    assert_eq!(g["left"], r.guards[0].left);
    assert_eq!(g["right"], r.guards[0].at);
    assert_eq!(g["done"], r.guards[0].done);
    assert!(view["helicopter"].is_null());
}

#[test]
fn the_answer_survives_a_save_and_load() {
    let mut sim = tower(GameMode::Classic, 8, Some(2));
    fire_on(&mut sim, 6);
    sim.resolve_choice(true);
    let before = sim.events.fire.clone().unwrap();
    let saved = sim.serialize();
    assert_eq!(saved["events"]["fire"], before.save_state());
    let back = crate::load_stream::load_save_text(saved.to_string().as_bytes()).expect("loads");
    assert_eq!(back.events.fire, Some(before));
}

#[test]
fn a_save_without_a_fire_has_no_fire_key() {
    let sim = tower(GameMode::Classic, 3, Some(2));
    assert!(sim.serialize()["events"].get("fire").is_none());
}

#[test]
fn an_older_save_burning_with_no_answer_sends_guards_on_the_next_step() {
    let mut sim = tower(GameMode::Classic, 6, Some(2));
    fire_on(&mut sim, 4);
    let mut saved = sim.serialize();
    saved["events"].as_object_mut().unwrap().remove("fire");
    let mut back = crate::load_stream::load_save_text(saved.to_string().as_bytes()).expect("loads");
    assert!(back.events.fire.is_none());
    // The old rule holds until guards are out: Security within reach counts.
    assert!((back.control_chance(4) - 0.7).abs() < 1e-9);
    back.advance_fire_response();
    let r = back.events.fire.as_ref().expect("guards set out");
    assert_eq!(r.floor, 4);
    assert_eq!(r.guards.len(), GUARDS_PER_OFFICE);
    assert_eq!(r.guards[0].start, back.clock.minutes);
}

#[test]
fn a_malformed_fire_loads_as_none() {
    for bad in [
        serde_json::json!(null),
        serde_json::json!({"floor": 2}),
        serde_json::json!({"floor": 2, "x": 1, "width": 4, "guards": [{"from": "x"}], "out": false, "seq": 1}),
        serde_json::json!({"floor": 2, "x": 1, "width": 4, "guards": [], "helicopter": {"called": 1}, "out": false, "seq": 1}),
        serde_json::json!({"floor": 1e300, "x": 1, "width": 4, "guards": [], "out": false, "seq": 1}),
    ] {
        assert_eq!(FireResponse::from_save(&bad), None, "{bad}");
    }
}

#[test]
fn nothing_runs_while_no_fire_burns() {
    let mut sim = tower(GameMode::Classic, 4, Some(2));
    sim.advance_fire_response();
    assert!(sim.events.fire.is_none());
    assert!(drained(&mut sim).is_empty());
}

#[test]
fn in_modern_a_security_office_that_opens_mid_fire_sends_its_guards() {
    let mut sim = tower(GameMode::Modern, 6, None);
    fire_on(&mut sim, 5);
    assert!(sim.events.fire.as_ref().unwrap().guards.is_empty());
    let seq = sim.events.fire.as_ref().unwrap().seq;
    sim.join_fire_response(3, 190);
    let r = sim.events.fire.as_ref().unwrap();
    assert_eq!(r.guards.len(), GUARDS_PER_OFFICE);
    assert_eq!((r.guards[0].from, r.guards[0].floors), (3, 2));
    assert_eq!(r.seq, seq + 1);
}

#[test]
fn in_classic_a_late_office_stays_out_of_the_fire() {
    let mut sim = tower(GameMode::Classic, 6, None);
    fire_on(&mut sim, 5);
    sim.join_fire_response(3, 190);
    assert!(sim.events.fire.as_ref().unwrap().guards.is_empty());
}

#[test]
fn a_fire_put_out_as_the_next_starts_reports_out_and_hands_over_its_helicopter() {
    let mut sim = tower(GameMode::Classic, 8, Some(2));
    fire_on(&mut sim, 6);
    sim.resolve_choice(true);
    let h = sim
        .events
        .fire
        .as_ref()
        .unwrap()
        .helicopter
        .clone()
        .unwrap();
    // The day's roll contains the fire before the helicopter lands, and
    // the same roll starts another one, with no step between them.
    sim.clock.minutes = h.called + 1.0;
    sim.extinguish_all();
    drained(&mut sim);
    let money = sim.money;
    fire_on(&mut sim, 4);
    let outs: Vec<GameplayEvent> = drained(&mut sim)
        .into_iter()
        .filter(|e| matches!(e, GameplayEvent::FireOut { .. }))
        .collect();
    assert_eq!(
        outs,
        [GameplayEvent::FireOut {
            by: FireOutcome::BurnedOut
        }],
        "the first fire is reported out once, before its guards got there"
    );
    let r = sim.events.fire.clone().unwrap();
    assert_eq!(r.floor, 4, "the answer moves to the new fire");
    assert_eq!(
        r.helicopter,
        Some(h.clone()),
        "the paid helicopter keeps flying"
    );
    assert!(
        sim.events.pending.is_none(),
        "no second offer while it flies"
    );
    assert_eq!(sim.money, money);
    sim.clock.minutes = h.arrive;
    sim.advance_fire_response();
    assert_eq!(sim.events.count(), 0, "it puts the new fire out");
    assert!(drained(&mut sim).contains(&GameplayEvent::FireOut {
        by: FireOutcome::Rescue
    }));
}
