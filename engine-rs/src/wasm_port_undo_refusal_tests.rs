//! The refusals an undo or a redo meets, what the player reads for each,
//! and which keep the step for another try.
use super::tests::{code, engine, gesture, units};
use super::*;
use crate::facilities::Kind;
use crate::gameplay::RemovalMethod;
use crate::tower::UnitState;

#[test]
fn a_step_on_a_burning_room_waits_and_one_on_an_opened_room_is_dropped() {
    let mut e = engine();
    for x in 100..140 {
        assert!(e.sim.tower.place(Kind::Lobby, 1, x).ok);
        assert!(e.sim.tower.place(Kind::Floor, 2, x).ok);
    }
    // An older edit an undo can still reach once time has passed: a sale.
    e.port_build(code(Kind::Office), 2.0, 125.0);
    let sold = e.sim.tower.unit_at(2, 125).unwrap().id;
    e.port_undo_capture("Sell Office");
    assert!(e.sim.remove_facility(sold, RemovalMethod::Sell).ok);
    e.port_undo_commit();
    e.port_undo_capture("Build Office");
    e.port_build(code(Kind::Office), 2.0, 110.0);
    e.port_undo_commit();
    let id = e.sim.tower.unit_at(2, 110).unwrap().id;
    e.sim.tower.get_unit_mut(id).unwrap().state = UnitState::Fire;
    let generation = e.generation;
    assert_eq!(e.port_undo(), vec![0.0, generation as f64]);
    assert_eq!(
        e.last_reason_text().as_deref(),
        Some("Can't undo that while the room is on fire.")
    );
    assert_eq!(
        e.port_undo_depths(),
        vec![2.0, 0.0],
        "it waits for the fire"
    );
    assert_eq!(e.generation, generation, "a refusal is no swap");
    e.sim.tower.get_unit_mut(id).unwrap().state = UnitState::Construction;
    while e.sim.tower.get_unit(id).unwrap().state == UnitState::Construction {
        e.sim.tick(10.0);
    }
    let before = (e.sim.save_text(), e.sim.money);
    assert_eq!(e.port_undo()[0], 0.0);
    assert_eq!(
        e.last_reason_text().as_deref(),
        Some(
            "Can't undo that: the room has opened since. Sell it instead. \
             Undo again for the edit before it."
        )
    );
    assert_eq!((e.sim.save_text(), e.sim.money), before, "nothing changed");
    assert_eq!(e.port_undo_depths(), vec![1.0, 0.0], "it is dropped");
    assert_eq!(e.port_undo()[0], 1.0, "the edit before it undoes");
    assert!(e.sim.tower.get_unit(id).is_some(), "the opened room stays");
    assert!(
        e.sim.tower.get_unit(sold).is_some(),
        "and the sold one is back"
    );
}

/// Only an edit clears what stands in a step's way, and undoing that edit
/// puts the block back, so a blocked step is dropped like any other that
/// can never apply.
#[test]
fn a_step_something_stands_in_the_way_of_is_dropped() {
    let mut e = engine();
    for x in 100..140 {
        assert!(e.sim.tower.place(Kind::Lobby, 1, x).ok);
        assert!(e.sim.tower.place(Kind::Floor, 2, x).ok);
    }
    // An older edit an undo can still reach once time has passed: a sale.
    e.port_build(code(Kind::Office), 2.0, 125.0);
    let older = e.sim.tower.unit_at(2, 125).unwrap().id;
    e.port_undo_capture("Sell Office");
    assert!(e.sim.remove_facility(older, RemovalMethod::Sell).ok);
    e.port_undo_commit();
    e.port_build(code(Kind::Office), 2.0, 110.0);
    let sold = e.sim.tower.unit_at(2, 110).unwrap().id;
    e.port_undo_capture("Sell Office");
    assert!(e.sim.remove_facility(sold, RemovalMethod::Sell).ok);
    e.port_undo_commit();
    e.port_undo_capture("Build Office");
    e.port_build(code(Kind::Office), 2.0, 110.0);
    e.port_undo_commit();
    let built = e.sim.tower.unit_at(2, 110).unwrap().id;
    while e.sim.tower.get_unit(built).unwrap().state == UnitState::Construction {
        e.sim.tick(10.0);
    }
    assert_eq!(e.port_undo()[0], 0.0, "the new office has opened");
    let before = (e.sim.save_text(), e.sim.money);
    assert_eq!(e.port_undo()[0], 0.0);
    assert_eq!(
        e.last_reason_text().as_deref(),
        Some(
            "Can't undo that: something in the tower stands in the way. \
             Undo again for the edit before it."
        )
    );
    assert_eq!((e.sim.save_text(), e.sim.money), before, "nothing changed");
    assert_eq!(e.port_undo_depths(), vec![1.0, 0.0], "it is dropped");
    assert_eq!(e.port_undo()[0], 1.0, "the edit before it undoes");
}

#[test]
fn a_redo_that_is_blocked_or_meets_a_changed_tower_ends_the_trail() {
    let mut e = engine();
    gesture(&mut e, "Build Lobby", 100.0);
    gesture(&mut e, "Build Lobby", 120.0);
    assert_eq!(e.port_undo()[0], 1.0);
    assert_eq!(e.port_undo()[0], 1.0);
    // An edit with no gesture open lays a lobby where the undone one stood.
    e.port_build(code(Kind::Lobby), 1.0, 100.0);
    let before = (e.sim.save_text(), e.sim.money);
    assert_eq!(e.port_redo()[0], 0.0);
    assert_eq!(
        e.last_reason_text().as_deref(),
        Some("Can't redo that: something in the tower stands in the way.")
    );
    assert_eq!((e.sim.save_text(), e.sim.money), before);
    assert_eq!(e.port_undo_depths(), vec![0.0, 0.0], "the redo trail ends");

    // A shaft changed outside every gesture never matches its redo again.
    let mut e = engine();
    for x in 100..140 {
        assert!(e.sim.tower.place(Kind::Lobby, 1, x).ok);
        for f in 2..=5 {
            assert!(e.sim.tower.place(Kind::Floor, f, x).ok);
        }
    }
    assert!(e.sim.build_transport(Kind::ElevatorStandard, 120, 1, 4).ok);
    let lift = e.sim.tower.transports[0].id;
    e.port_undo_capture("Extend");
    assert!(e.sim.resize_transport(lift, 1, 5).ok);
    e.port_undo_commit();
    assert_eq!(e.port_undo()[0], 1.0);
    e.sim.tower.get_transport_mut(lift).unwrap().cars += 1;
    assert_eq!(e.port_redo()[0], 0.0);
    assert_eq!(
        e.last_reason_text().as_deref(),
        Some("Can't redo that: the tower has changed since.")
    );
    assert_eq!(e.port_undo_depths(), vec![0.0, 0.0], "the redo trail ends");

    // The last undo step dropped says nothing of an edit before it.
    let mut e = engine();
    gesture(&mut e, "Build Lobby", 100.0);
    let id = e.sim.tower.unit_at(1, 100).unwrap().id;
    e.sim.tower.remove_unit(id);
    assert_eq!(e.port_undo()[0], 0.0);
    assert_eq!(
        e.last_reason_text().as_deref(),
        Some("Can't undo that: the tower has changed since.")
    );
    assert_eq!(e.port_undo_depths(), vec![0.0, 0.0]);
}

#[test]
fn an_undo_the_balance_cannot_pay_for_is_refused_and_stays_available() {
    let mut e = engine();
    let start = units(&e);
    gesture(&mut e, "Build Lobby", 100.0);
    e.port_undo();
    // The redo charges the lobby again.
    e.sim.money = 0.0;
    let before = e.sim.save_text();
    assert_eq!(e.port_redo()[0], 0.0);
    assert_eq!(
        e.last_reason_text().as_deref(),
        Some("Not enough money to redo that.")
    );
    assert!(e.port_undo_notice().is_none());
    assert_eq!(e.sim.save_text(), before);
    assert_eq!(
        e.port_undo_depths(),
        vec![0.0, 1.0],
        "the redo step was kept"
    );
    e.sim.money = 1e9;
    assert_eq!(e.port_redo()[0], 1.0);
    assert_eq!(units(&e), start + 1);
}

/// The probe that found the floor hole: a lobby, floors over it, an
/// elevator and an office, then three days. Each undo is refused and
/// nothing comes back for the lobby or the floors under the used builds.
#[test]
fn ground_under_used_builds_never_comes_back_at_full_price() {
    let mut e = engine();
    e.port_undo_capture("Build Lobby");
    for x in 100..130 {
        e.port_build(code(Kind::Lobby), 1.0, x as f64);
    }
    e.port_undo_commit();
    e.port_undo_capture("Build Floor");
    for floor in 2..=4 {
        for x in 100..130 {
            e.port_build(code(Kind::Floor), floor as f64, x as f64);
        }
    }
    e.port_undo_commit();
    e.port_undo_capture("Build Elevator");
    assert!(e.sim.build_transport(Kind::ElevatorStandard, 110, 1, 4).ok);
    e.port_undo_commit();
    e.port_undo_capture("Build Office");
    e.port_build(code(Kind::Office), 3.0, 115.0);
    e.port_undo_commit();
    e.sim.tick(60.0 * 24.0 * 3.0);
    let (money, count) = (e.sim.money, units(&e));
    let shafts = e.sim.tower.transports.len();
    for _ in 0..4 {
        assert_eq!(e.port_undo()[0], 0.0, "{:?}", e.last_reason_text());
        assert_eq!(e.sim.money, money, "no money back");
    }
    assert_eq!(e.port_undo_depths(), vec![0.0, 0.0]);
    assert_eq!(units(&e), count, "every build stays");
    assert_eq!(e.sim.tower.transports.len(), shafts);
}

/// Round 1's probe within the hour, so only the ground rule refuses the
/// floors: a ridden elevator stands on them.
#[test]
fn floors_under_a_ridden_shaft_never_come_back_within_the_hour() {
    let mut e = engine();
    let runs = e.sim.on_hour_runs;
    e.port_undo_capture("Build Lobby");
    for x in 100..130 {
        e.port_build(code(Kind::Lobby), 1.0, x as f64);
    }
    e.port_undo_commit();
    e.port_undo_capture("Build Floor");
    for x in 100..130 {
        e.port_build(code(Kind::Floor), 2.0, x as f64);
    }
    e.port_undo_commit();
    e.port_undo_capture("Build Elevator");
    assert!(e.sim.build_transport(Kind::ElevatorStandard, 110, 1, 2).ok);
    e.port_undo_commit();
    let lift = e.sim.tower.transports[0].id;
    e.sim.tower.note_ride(lift);
    let (money, count) = (e.sim.money, units(&e));
    let said = |e: &Engine| e.last_reason_text().unwrap_or_default();
    assert_eq!(e.port_undo()[0], 0.0);
    assert!(said(&e).starts_with("Can't undo that: it has been in use since."));
    for _ in 0..2 {
        assert_eq!(e.port_undo()[0], 0.0);
        assert!(said(&e).starts_with("Can't undo that: something in the tower stands in the way."));
    }
    assert_eq!(e.sim.on_hour_runs, runs, "no hourly pass ran");
    assert_eq!(e.port_undo_depths(), vec![0.0, 0.0]);
    assert_eq!(
        (e.sim.money, units(&e)),
        (money, count),
        "nothing came back"
    );
}

/// Within the hour, so only the ground rule refuses the floor: a room
/// built on it since, with no gesture open, stands on it.
#[test]
fn a_floor_under_a_room_built_since_never_comes_back_within_the_hour() {
    let mut e = engine();
    let runs = e.sim.on_hour_runs;
    for x in 100..130 {
        assert!(e.sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    e.port_undo_capture("Build Floor");
    for x in 100..130 {
        e.port_build(code(Kind::Floor), 2.0, x as f64);
    }
    e.port_undo_commit();
    e.port_build(code(Kind::Office), 2.0, 110.0);
    let (money, count) = (e.sim.money, units(&e));
    assert_eq!(e.port_undo()[0], 0.0);
    assert_eq!(
        e.last_reason_text().as_deref(),
        Some("Can't undo that: something in the tower stands in the way.")
    );
    assert_eq!(e.sim.on_hour_runs, runs, "no hourly pass ran");
    assert_eq!(e.port_undo_depths(), vec![0.0, 0.0]);
    assert_eq!(
        (e.sim.money, units(&e)),
        (money, count),
        "nothing came back"
    );
}

/// What the player reads for each refusal, and whether it drops the step:
/// only time can make a step apply, and time brings in money and puts a
/// fire out but changes nothing else back.
#[test]
fn each_refusal_reads_as_the_player_sees_it() {
    let waits = [
        (
            StepRefused::NotEnoughMoney,
            "Not enough money to undo that.",
        ),
        (
            StepRefused::OnFire,
            "Can't undo that while the room is on fire.",
        ),
    ];
    let drops = [
        (
            StepRefused::InUse { sellable: true },
            "Can't undo that: it has been in use since. Sell it instead.",
        ),
        (
            StepRefused::InUse { sellable: false },
            "Can't undo that: it has been in use since.",
        ),
        (
            StepRefused::GroundUsed { sellable: true },
            "Can't undo that: its floor has been in use since the clock passed the hour. \
             Sell it instead.",
        ),
        (
            StepRefused::GroundUsed { sellable: false },
            "Can't undo that: its floor has been in use since the clock passed the hour.",
        ),
        (
            StepRefused::Opened { sellable: true },
            "Can't undo that: the room has opened since. Sell it instead.",
        ),
        (
            StepRefused::Opened { sellable: false },
            "Can't undo that: the room has opened since.",
        ),
        (
            StepRefused::ShaftUsed,
            "Can't undo that: it has been in use since. Sell it instead.",
        ),
        (
            StepRefused::UsedThenSold,
            "Can't undo that: it was in use before it was sold.",
        ),
        (
            StepRefused::SearchedForTreasure { sellable: true },
            "Can't undo that: building it dug for treasure. Sell it instead.",
        ),
        (
            StepRefused::SearchedForTreasure { sellable: false },
            "Can't undo that: building it dug for treasure.",
        ),
        (
            StepRefused::PriceFixed,
            "Can't undo that: a sold condo keeps its price.",
        ),
        (
            StepRefused::UseChanged,
            "Can't undo that: the room has changed since.",
        ),
        (
            StepRefused::Blocked,
            "Can't undo that: something in the tower stands in the way.",
        ),
        (
            StepRefused::Stale,
            "Can't undo that: the tower has changed since.",
        ),
    ];
    for (lasting, cases) in [(false, &waits[..]), (true, &drops[..])] {
        for &(why, text) in cases {
            assert_eq!(refusal(why, "undo"), text, "{why:?}");
            assert_eq!(why.is_lasting(), lasting, "{why:?}");
        }
    }
    assert_eq!(
        refusal(StepRefused::OnFire, "redo"),
        "Can't redo that while the room is on fire."
    );
}
