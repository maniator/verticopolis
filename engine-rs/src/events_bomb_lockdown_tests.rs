//! The tower's lockdown during a bomb search: everyone but Security's guards
//! holds still until the bomb is found or goes off, in both modes.

use super::tests::decline;
use super::{BombSearch, Guard};
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

/// A busy weekday morning: a lobby, offices on floors 2 to 10, one elevator
/// from the lobby to the top, a Security office and every office rented,
/// played to the next weekday's 8:30 AM rush.
fn busy_morning(mode: GameMode) -> Simulation {
    busy_morning_with(mode, true)
}

/// `busy_morning`, with or without its Security office.
fn busy_morning_with(mode: GameMode, security: bool) -> Simulation {
    let mut sim = Simulation::new_game(23, mode);
    sim.money = 1e9;
    sim.star = 4;
    for x in 160..240 {
        assert!(sim.build(Kind::Lobby, 1, x).ok);
    }
    for f in 2..=10 {
        for x in 160..240 {
            assert!(sim.build(Kind::Floor, f, x).ok);
        }
        for x in [164, 174, 184, 214, 224] {
            assert!(sim.build(Kind::Office, f, x).ok, "office on {f} at {x}");
        }
    }
    if security {
        assert!(sim.build(Kind::Security, 2, 194).ok);
    }
    assert!(sim.build_transport(Kind::ElevatorStandard, 204, 1, 10).ok);
    for u in sim.tower.units.iter_mut() {
        if u.state == UnitState::Construction {
            u.state = UnitState::Empty;
        }
        if u.kind == Kind::Office {
            (u.state, u.ever_occupied, u.occupants) = (UnitState::Occupied, true, 6);
        }
    }
    // On to 8:30 AM on a weekday.
    let rush = 8.0 * 60.0 + 30.0;
    loop {
        let to = (rush - sim.clock.minute_of_day()).rem_euclid(1440.0);
        sim.tick(if to == 0.0 { 1440.0 } else { to });
        if !sim.clock.is_weekend() {
            break;
        }
    }
    sim.events.pending = None;
    sim.gameplay.drain();
    sim
}

/// Each person's id, floor, height, tile and state; each shaft's cars; the
/// next person id; and the demand waiting at the lobby.
type Movement = (
    Vec<(i64, i64, u64, u64, &'static str)>,
    Vec<Vec<f64>>,
    i64,
    u64,
);

/// Where everyone and every car is, and the demand waiting at the lobby:
/// what a lockdown has to hold still.
fn movement(sim: &Simulation) -> Movement {
    let people = sim
        .crowd
        .people
        .iter()
        .map(|p| {
            (
                p.id,
                p.floor,
                p.fy.to_bits(),
                p.x.to_bits(),
                p.state.as_str(),
            )
        })
        .collect();
    let cars = sim
        .tower
        .transports
        .iter()
        .map(|t| t.car_positions.clone())
        .collect();
    (
        people,
        cars,
        sim.crowd.next_id,
        sim.elevators.waiting_at(1).to_bits(),
    )
}

fn assert_frozen_during_search(mode: GameMode) {
    let mut searched = busy_morning(mode);
    let mut control = busy_morning(mode);
    assert!(
        !searched.crowd.people.is_empty(),
        "{mode:?}: the morning rush has people in the tower"
    );
    assert_eq!(
        movement(&searched),
        movement(&control),
        "same seed, same game"
    );

    decline(&mut searched);
    assert!(
        searched.bomb_lockdown(),
        "{mode:?}: the refusal starts a search"
    );
    assert_eq!(
        searched.bomb_search_view().unwrap()["lockdown"],
        true,
        "{mode:?}: the view tells the renderer"
    );
    let held = movement(&searched);
    // Minute by minute until the guards find the bomb or it goes off; every
    // minute of the search leaves people and cars where they stood.
    let mut minutes = 0;
    while searched.bomb_lockdown() && minutes < 6 * 60 {
        searched.tick(1.0);
        control.tick(1.0);
        minutes += 1;
        if searched.bomb_lockdown() {
            assert_eq!(
                movement(&searched),
                held,
                "{mode:?}: someone moved {minutes} minute(s) into the search"
            );
        }
    }
    assert!(
        !searched.bomb_lockdown(),
        "{mode:?}: the guards kept searching and the search ended"
    );
    assert!(
        minutes >= 15,
        "{mode:?}: the search lasted {minutes} minute(s)"
    );
    assert_ne!(
        movement(&control),
        held,
        "{mode:?}: without a bomb the same minutes move people and cars"
    );

    // Once the bomb is found or goes off, the tower moves again.
    let after = movement(&searched);
    searched.tick(15.0);
    assert_ne!(
        movement(&searched),
        after,
        "{mode:?}: people and cars move again"
    );
}

#[test]
fn a_bomb_search_holds_everyone_but_the_guards_still_in_classic() {
    assert_frozen_during_search(GameMode::Classic);
}

#[test]
fn a_bomb_search_holds_everyone_but_the_guards_still_in_modern() {
    assert_frozen_during_search(GameMode::Modern);
}

/// A Modern hotel floor with a dirty room and a housekeeping crew, at
/// 7:30 AM, half an hour before the maids' shift starts.
fn dirty_hotel_before_the_shift() -> (Simulation, i64) {
    let mut sim = Simulation::new_game(29, GameMode::Modern);
    sim.money = 1e9;
    sim.star = 2;
    for x in 160..200 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        assert!(sim.tower.place(Kind::Floor, 2, x).ok);
    }
    assert!(sim.build_transport(Kind::ElevatorService, 190, 1, 2).ok);
    let room = sim.tower.place(Kind::HotelSingle, 2, 160).unit_id.unwrap();
    sim.tower.get_unit_mut(room).unwrap().state = UnitState::Dirty;
    assert!(sim.tower.place(Kind::Housekeeping, 2, 170).ok);
    let to = (7.0 * 60.0 + 30.0 - sim.clock.minute_of_day()).rem_euclid(1440.0);
    sim.tick(if to == 0.0 { 1440.0 } else { to });
    (sim, room)
}

fn maids(sim: &Simulation) -> usize {
    sim.crowd.people.iter().filter(|p| p.staff).count()
}

#[test]
fn no_maid_sets_out_during_a_bomb_search() {
    let (mut calm, calm_room) = dirty_hotel_before_the_shift();
    calm.tick(60.0);
    assert_eq!(
        calm.tower.get_unit(calm_room).unwrap().state,
        UnitState::Empty,
        "without a bomb the 8:00 AM shift cleans the room"
    );

    let (mut sim, room) = dirty_hotel_before_the_shift();
    let now = sim.clock.minutes;
    sim.events.bomb = Some(BombSearch {
        floor: 2,
        x: 165.0,
        deadline: now + 5.0 * 60.0,
        // One guard, still walking its first stretch when the shift starts.
        guards: vec![Guard {
            floor: Some(2),
            x: Some(160),
            done_at: now + 4.0 * 60.0,
            from: 2,
            route: Vec::new(),
            start: now,
            arrive: now,
        }],
        searched: Vec::new(),
        seq: 1,
    });
    sim.tick(60.0);
    assert!(sim.bomb_lockdown());
    assert_eq!(maids(&sim), 0, "nobody sets out while the search runs");
    assert_eq!(sim.tower.get_unit(room).unwrap().state, UnitState::Dirty);

    sim.events.bomb = None;
    sim.tick(60.0);
    assert_eq!(
        sim.tower.get_unit(room).unwrap().state,
        UnitState::Empty,
        "the crews go out once the search ends"
    );
}

/// With no Security nobody searches, so the bomb freezes nothing: the tower
/// runs exactly as it would with no bomb until it goes off.
fn assert_no_freeze_without_security(mode: GameMode) {
    let mut bombed = busy_morning_with(mode, false);
    let mut control = busy_morning_with(mode, false);
    decline(&mut bombed);
    assert!(
        bombed.events.bomb.is_some(),
        "{mode:?}: the bomb waits for 1:00 PM"
    );
    assert!(!bombed.bomb_lockdown(), "{mode:?}: no guards, no lockdown");
    assert_eq!(
        bombed.bomb_search_view().unwrap()["lockdown"],
        false,
        "{mode:?}: the view tells the renderer"
    );
    let before = movement(&bombed);
    for minute in 1..=30 {
        bombed.tick(1.0);
        control.tick(1.0);
        assert_eq!(
            movement(&bombed),
            movement(&control),
            "{mode:?}: the tower ran as without a bomb at minute {minute}"
        );
    }
    assert_ne!(movement(&bombed), before, "{mode:?}: people and cars moved");
}

#[test]
fn a_bomb_with_no_security_freezes_nothing_in_classic() {
    assert_no_freeze_without_security(GameMode::Classic);
}

#[test]
fn a_bomb_with_no_security_freezes_nothing_in_modern() {
    assert_no_freeze_without_security(GameMode::Modern);
}
