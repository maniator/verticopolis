//! An elevator shaft and a room never share a tile (`tower/shaft_rooms.rs`,
//! 4.x scope audit, 2026-11-17): a room is refused where an elevator runs,
//! an elevator is refused through a room, built or extended, in both modes.
//! Stairs and escalators still stand over rooms, an elevator still runs
//! down into a metro station, and a saved tower that already holds a room
//! under a shaft loads, plays and undoes as it did.
use crate::charges::ExtendEnd;
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::gameplay::RemovalMethod;
use crate::load::deserialize;
use crate::sim::Simulation;
use crate::tower::{ROOM_IN_SHAFT, SHAFT_THROUGH_ROOM};

use super::stocked_services::lay_basement;
use super::{lay_row, seeded_game, MID};

const ELEVATORS: [Kind; 3] = [
    Kind::ElevatorStandard,
    Kind::ElevatorService,
    Kind::ElevatorExpress,
];
const MODES: [GameMode; 2] = [GameMode::Classic, GameMode::Modern];

/// The shaft's column, inside the starter lobby.
const X: i64 = MID - 4;

/// Floors 2 to 8 over the 40-tile starter lobby, rich and at four stars.
fn base(mode: GameMode) -> Simulation {
    let mut sim = seeded_game(3, mode);
    sim.money = 1e9;
    sim.star = 4;
    for floor in 2..=8 {
        for x in MID - 20..MID + 20 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    sim
}

fn shaft(sim: &mut Simulation, kind: Kind, x: i64, bottom: i64, top: i64) -> i64 {
    let r = sim.build_transport(kind, x, bottom, top);
    assert!(r.ok, "{kind:?} at {x}: {:?}", r.reason);
    sim.tower.transports.last().unwrap().id
}

/// Run `edit` as one gesture and answer its undo step.
fn gesture(sim: &mut Simulation, edit: impl FnOnce(&mut Simulation)) -> crate::undo::Step {
    sim.begin_undo_journal("Edit");
    edit(sim);
    sim.end_undo_journal().expect("the edit changed the tower")
}

#[test]
fn a_room_is_refused_where_an_elevator_runs() {
    for mode in MODES {
        for kind in ELEVATORS {
            let mut sim = base(mode);
            shaft(&mut sim, kind, X, 1, 6);
            let w = kind.facility().width;
            let money = sim.money;
            for x in [X - 8, X, X + w - 1] {
                let r = sim.build(Kind::Office, 3, x);
                assert_eq!(
                    r.reason.as_deref(),
                    Some(ROOM_IN_SHAFT),
                    "{mode:?} {kind:?} {x}"
                );
            }
            assert_eq!(
                sim.money, money,
                "{mode:?} {kind:?}: a refusal costs nothing"
            );
            assert!(
                sim.build(Kind::Office, 3, X - 9).ok,
                "{mode:?} {kind:?}: left"
            );
            assert!(
                sim.build(Kind::Office, 3, X + w).ok,
                "{mode:?} {kind:?}: right"
            );
        }
    }
}

#[test]
fn a_two_story_room_is_refused_when_its_upper_story_meets_a_shaft() {
    assert_eq!(Kind::Cinema.floors(), 2);
    let mut sim = base(GameMode::Modern);
    shaft(&mut sim, Kind::ElevatorStandard, X, 3, 6);
    let r = sim.build(Kind::Cinema, 2, X - 4);
    assert_eq!(r.reason.as_deref(), Some(ROOM_IN_SHAFT));
}

#[test]
fn an_elevator_is_refused_through_a_room() {
    for mode in MODES {
        for kind in ELEVATORS {
            let mut sim = base(mode);
            assert!(sim.build(Kind::Office, 4, X).ok);
            let w = kind.facility().width;
            let money = sim.money;
            for x in [X - w + 1, X, X + 8] {
                let r = sim.build_transport(kind, x, 1, 6);
                assert_eq!(
                    r.reason.as_deref(),
                    Some(SHAFT_THROUGH_ROOM),
                    "{mode:?} {kind:?} {x}"
                );
            }
            assert_eq!(
                sim.money, money,
                "{mode:?} {kind:?}: a refusal costs nothing"
            );
            assert!(sim.tower.transports.is_empty());
            shaft(&mut sim, kind, X - w, 1, 6);
            shaft(&mut sim, kind, X + 9, 1, 6);
        }
    }
}

#[test]
fn stairs_and_escalators_still_stand_over_rooms() {
    for mode in MODES {
        let mut sim = base(mode);
        assert!(sim.build(Kind::Office, 2, X).ok);
        shaft(&mut sim, Kind::Stairs, X, 2, 3);
        shaft(&mut sim, Kind::Escalator, X - 10, 4, 5);
        assert!(sim.build(Kind::Office, 4, X - 10).ok, "{mode:?}");
    }
}

#[test]
fn an_extend_stops_short_of_a_room() {
    for mode in MODES {
        let mut sim = base(mode);
        let id = shaft(&mut sim, Kind::ElevatorStandard, X, 1, 4);
        assert!(sim.build(Kind::Office, 7, X - 2).ok);
        assert!(sim.begin_extend(id));
        let grown = sim.extend_transport(id, ExtendEnd::Up, 8);
        sim.end_extend();
        assert_eq!((grown.top, grown.added), (6, 2), "{mode:?}");
        let resized = sim.tower.resize_transport(id, 1, 7);
        assert_eq!(resized.reason.as_deref(), Some(SHAFT_THROUGH_ROOM));
    }
}

/// The platform of a station is the story above its tunnel row, and the
/// elevator that brings commuters runs down into it.
#[test]
fn an_elevator_still_runs_down_into_a_metro_station() {
    const TUNNEL: i64 = -7;
    let dug = || {
        let mut sim = Simulation::new_game(1, GameMode::Modern);
        sim.money = 1e12;
        sim.star = 5;
        lay_row(&mut sim, Kind::Lobby, 1);
        lay_basement(&mut sim, TUNNEL);
        sim
    };
    let (mut built_first, mut shaft_first) = (dug(), dug());

    assert!(built_first.build(Kind::Metro, TUNNEL, MID).ok);
    shaft(
        &mut built_first,
        Kind::ElevatorStandard,
        MID + 5,
        TUNNEL + 1,
        1,
    );

    shaft(
        &mut shaft_first,
        Kind::ElevatorStandard,
        MID + 5,
        TUNNEL + 1,
        1,
    );
    let r = shaft_first.build(Kind::Metro, TUNNEL, MID);
    assert!(r.ok, "{:?}", r.reason);
}

/// A tower saved before the rule, with an office under a shaft: it loads,
/// plays and saves exactly as before, and undo still puts back a sale of
/// that office and a bulldozed shaft.
fn legacy(mode: GameMode) -> (Simulation, i64, i64) {
    let mut sim = base(mode);
    let shaft_id = shaft(&mut sim, Kind::ElevatorStandard, X, 1, 6);
    let r = sim.tower.place(Kind::Office, 3, X - 2);
    assert!(r.ok, "the raw placement stands a tower up as given");
    (sim, shaft_id, r.unit_id.unwrap())
}

#[test]
fn a_saved_tower_with_a_room_under_a_shaft_loads_and_plays_as_before() {
    for mode in MODES {
        let (built, _, office) = legacy(mode);
        // A first load notes the star `base` set by hand as a milestone;
        // from that save on, a load gives back the same game.
        let mut sim = deserialize(&built.serialize()).unwrap();
        let mut loaded = deserialize(&sim.serialize()).unwrap();
        assert_eq!(loaded.save_text(), sim.save_text(), "{mode:?}: loads");
        assert!(loaded.tower.get_unit(office).is_some());
        for _ in 0..48 {
            sim.tick(30.0);
            loaded.tick(30.0);
        }
        assert_eq!(loaded.save_text(), sim.save_text(), "{mode:?}: plays");
    }
}

#[test]
fn undo_puts_back_a_room_or_a_shaft_an_old_tower_held_together() {
    for mode in MODES {
        let (mut sim, shaft_id, office) = legacy(mode);
        let before = sim.save_text();
        let sold = gesture(&mut sim, |s| assert!(s.sell_at(3, X - 2)));
        assert!(sim.tower.get_unit(office).is_none());
        let redo = sim.apply_undo_step(&sold).expect("the sale undoes");
        assert_eq!(sim.save_text(), before, "{mode:?}: the office is back");
        sim.apply_undo_step(&redo).expect("the sale redoes");
        assert!(sim.tower.get_unit(office).is_none());

        let (mut sim, shaft_id_2, _) = legacy(mode);
        assert_eq!(shaft_id_2, shaft_id);
        let before = sim.save_text();
        let razed = gesture(&mut sim, |s| {
            assert!(s.remove_facility(shaft_id, RemovalMethod::Bulldoze).ok);
        });
        assert!(sim.tower.get_transport(shaft_id).is_none());
        sim.apply_undo_step(&razed).expect("the bulldoze undoes");
        assert_eq!(sim.save_text(), before, "{mode:?}: the shaft is back");
    }
}

/// A shaft an old tower ran over a room comes back to its full span when
/// undo takes back a shrink, though a fresh extend there is refused.
#[test]
fn undo_of_a_shrink_gives_an_old_shaft_back_its_floors() {
    for mode in MODES {
        let (mut sim, shaft_id, _) = legacy(mode);
        let before = sim.save_text();
        let shrunk = gesture(&mut sim, |s| {
            assert!(s.begin_extend(shaft_id));
            let r = s.extend_transport(shaft_id, ExtendEnd::Up, 2);
            s.end_extend();
            assert_eq!(r.top, 2, "{mode:?}: {:?}", r.charge.reason);
        });
        let grown = sim.tower.resize_transport(shaft_id, 1, 6);
        assert_eq!(grown.reason.as_deref(), Some(SHAFT_THROUGH_ROOM));
        sim.apply_undo_step(&shrunk).expect("the shrink undoes");
        assert_eq!(
            sim.save_text(),
            before,
            "{mode:?}: the shaft has 1 to 6 again"
        );
    }
}
