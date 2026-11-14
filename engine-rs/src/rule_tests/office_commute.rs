//! Office workers really come to work (`crowd::commuters`): an office's
//! head count is the workers who got to their desks. Each one comes in at
//! the ground lobby or the Metro from 8 AM on weekdays and leaves the same
//! way from 6 PM, so nobody appears or vanishes on an office floor except
//! by walking into or out of a room there. An office no route reaches never
//! fills, and one that is bulldozed or loses its tenant sends its workers
//! out through the lobby.
use std::collections::HashMap;

use crate::clock::{CalendarKind, GameMode};
use crate::load::deserialize;
use crate::crowd::PState;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{at_time, room, served_tower, LEFT};

const OFFICE_FLOOR: i64 = 5;
const TOP: i64 = 6;
const STAFF: i64 = 6;

/// A lobby, floors 2 to 6 on one elevator, and two rented offices on
/// floor 5, at 6 AM on a Monday.
fn office_tower(mode: GameMode) -> (Simulation, [i64; 2]) {
    let mut sim = served_tower(mode, CalendarKind::RealWorld, TOP);
    let a = room(&mut sim, Kind::Office, OFFICE_FLOOR, LEFT + 10, UnitState::Occupied);
    let b = room(&mut sim, Kind::Office, OFFICE_FLOOR, LEFT + 40, UnitState::Occupied);
    at_time(&mut sim, 0, 6);
    (sim, [a, b])
}

fn occupants(sim: &Simulation, id: i64) -> i64 {
    sim.tower.get_unit(id).map_or(0, |u| u.occupants)
}

/// The workers you can see in the offices: at their desks and not out for
/// lunch or a sales call.
fn visible(sim: &Simulation, offices: &[i64]) -> i64 {
    offices
        .iter()
        .filter_map(|&id| sim.tower.get_unit(id))
        .map(|u| u.visible_occupants())
        .sum()
}

/// What a run of `minutes` showed: every person who appeared or vanished
/// on the office floor, against the change in the offices' visible head
/// count that minute; and where each commuting worker was first and last
/// seen.
#[derive(Default)]
struct Watch {
    /// (minute, appeared - vanished on the office floor, change in the
    /// visible head count).
    ledger: Vec<(i64, i64, i64)>,
    first: HashMap<i64, (i64, bool)>,
    last: HashMap<i64, (i64, bool)>,
    /// The most workers seen at the first office's desks at once.
    peak: i64,
}

fn watch(sim: &mut Simulation, offices: &[i64], minutes: i64) -> Watch {
    let mut w = Watch::default();
    let mut floor_of: HashMap<i64, (i64, bool)> = sim
        .crowd
        .people
        .iter()
        .filter(|p| !p.staff)
        .map(|p| (p.id, (p.floor, p.commuter)))
        .collect();
    let mut seen = visible(sim, offices);
    for minute in 1..=minutes {
        sim.tick(1.0);
        let mut net = 0;
        let mut now: HashMap<i64, (i64, bool)> = HashMap::new();
        for p in sim.crowd.people.iter().filter(|p| !p.staff) {
            now.insert(p.id, (p.floor, p.commuter));
            if !floor_of.contains_key(&p.id) {
                w.first.insert(p.id, (p.floor, p.commuter));
                if p.floor == OFFICE_FLOOR {
                    net += 1;
                }
            }
        }
        for (id, at) in &floor_of {
            if !now.contains_key(id) {
                w.last.insert(*id, *at);
                if at.0 == OFFICE_FLOOR {
                    net -= 1;
                }
            }
        }
        floor_of = now;
        let count = visible(sim, offices);
        w.ledger.push((minute, net, count - seen));
        w.peak = w.peak.max(occupants(sim, offices[0]));
        seen = count;
    }
    w
}

#[test]
fn an_office_fills_only_as_its_workers_arrive() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let (mut sim, offices) = office_tower(mode);
        let w = watch(&mut sim, &offices, 2 * 60);
        assert_eq!(sim.clock.hour(), 8);
        for id in offices {
            assert_eq!(occupants(&sim, id), 0, "{mode:?}: nobody is in at 8:00");
        }
        let w2 = watch(&mut sim, &offices, 2 * 60);
        for id in offices {
            assert_eq!(occupants(&sim, id), STAFF, "{mode:?}: full by 10 AM");
        }
        assert_eq!(sim.crowd.commuter_count, 0, "{mode:?}: everyone sat down");
        // Each worker who sat down was a person who walked in from the
        // lobby and was last seen on the office floor.
        let came = w2
            .last
            .iter()
            .filter(|(id, at)| at.1 && at.0 == OFFICE_FLOOR && w2.first[id] == (1, true))
            .count() as i64;
        assert_eq!(came, 2 * STAFF, "{mode:?}");
        assert!(w.first.values().all(|f| !f.1), "{mode:?}: none before 8");
    }
}

#[test]
fn no_one_appears_or_vanishes_on_an_office_floor() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let (mut sim, offices) = office_tower(mode);
        let w = watch(&mut sim, &offices, 24 * 60);
        // Anyone who appeared on the office floor walked out of an office
        // there, and anyone who vanished there walked into one.
        for &(minute, net, change) in &w.ledger {
            assert_eq!(net, -change, "{mode:?}: minute {minute}");
        }
        let commuters: Vec<i64> = w.first.iter().filter(|f| f.1 .1).map(|f| *f.0).collect();
        assert!(commuters.len() as i64 >= 4 * STAFF, "{mode:?}: in and out");
        for id in commuters {
            let (first, last) = (w.first[&id].0, w.last.get(&id).map(|l| l.0));
            assert!(
                (first == 1 && last == Some(OFFICE_FLOOR))
                    || (first == OFFICE_FLOOR && last == Some(1)),
                "{mode:?}: worker {id} went {first} to {last:?}"
            );
        }
        for id in offices {
            assert_eq!(occupants(&sim, id), 0, "{mode:?}: everyone went home");
        }
    }
}

#[test]
fn an_office_no_route_reaches_never_fills() {
    let mut sim = served_tower(GameMode::Modern, CalendarKind::RealWorld, TOP);
    for x in LEFT..LEFT + 20 {
        assert!(sim.build(Kind::Floor, TOP + 1, x).ok);
    }
    let cut_off = room(&mut sim, Kind::Office, TOP + 1, LEFT + 5, UnitState::Occupied);
    at_time(&mut sim, 0, 7);
    let mut most = 0;
    for _ in 0..(11 * 60) {
        sim.tick(1.0);
        most = most.max(occupants(&sim, cut_off));
    }
    assert_eq!(most, 0, "no worker can get there");
    assert_eq!(sim.crowd.commuter_count, 0);
}

/// Steps to 10 AM, when both offices are full.
fn at_work(mode: GameMode) -> (Simulation, [i64; 2]) {
    let (mut sim, offices) = office_tower(mode);
    for _ in 0..(4 * 60) {
        sim.tick(1.0);
    }
    for id in offices {
        assert_eq!(occupants(&sim, id), STAFF);
    }
    (sim, offices)
}

/// Every commuting worker who appeared since the watch began was first
/// seen on the office floor and walked out through the lobby.
fn all_left_by_the_lobby(w: &Watch, mode: GameMode) -> usize {
    let leavers: Vec<_> = w.first.iter().filter(|f| f.1 .1).collect();
    for (id, first) in &leavers {
        assert_eq!(first.0, OFFICE_FLOOR, "{mode:?}: {id} set out at the office");
        assert_eq!(w.last.get(id).map(|l| l.0), Some(1), "{mode:?}: {id} left");
    }
    leavers.len()
}

#[test]
fn a_bulldozed_office_sends_its_workers_out() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let (mut sim, offices) = at_work(mode);
        assert!(sim.tower.remove_unit(offices[0]).is_some());
        let w = watch(&mut sim, &offices[1..], 60);
        assert_eq!(all_left_by_the_lobby(&w, mode), STAFF as usize);
        assert_eq!(occupants(&sim, offices[1]), STAFF, "{mode:?}");
    }
}

#[test]
fn an_office_that_loses_its_tenant_sends_its_workers_home() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let (mut sim, offices) = office_tower(mode);
        for _ in 0..(2 * 60 + 10) {
            sim.tick(1.0);
        }
        let inside = occupants(&sim, offices[0]);
        let coming = crate::crowd::commuters::coming_to(&sim.crowd, offices[0]);
        assert!(coming > 0, "{mode:?}: some are still on the way at 8:10");
        sim.tower.get_unit_mut(offices[0]).unwrap().state = UnitState::Empty;
        let w = watch(&mut sim, &offices, 2 * 60);
        assert!(w.peak <= inside, "{mode:?}: nobody sat down after the eviction");
        assert_eq!(occupants(&sim, offices[0]), 0, "{mode:?}: all went home");
        for (minute, net, change) in &w.ledger {
            assert_eq!(*net, -change, "{mode:?}: minute {minute}");
        }
        for (id, first) in w.first.iter().filter(|f| f.1 .1) {
            let last = w.last.get(id).map(|l| l.0);
            assert!(
                (first.0 == 1 && last == Some(OFFICE_FLOOR))
                    || (first.0 == OFFICE_FLOOR && last == Some(1)),
                "{mode:?}: worker {id} went {} to {last:?}",
                first.0
            );
        }
    }
}

#[test]
fn a_loaded_tower_keeps_its_workers_inside_until_they_go_home() {
    let (sim, offices) = at_work(GameMode::Modern);
    // A load starts a fresh crowd; the saved head counts stay.
    let mut sim = deserialize(&sim.serialize()).unwrap();
    assert!(sim.tower.remove_unit(offices[0]).is_some());
    let w = watch(&mut sim, &offices[1..], 9 * 60 + 45);
    assert_eq!(all_left_by_the_lobby(&w, GameMode::Modern), 2 * STAFF as usize);
    assert_eq!(occupants(&sim, offices[1]), 0);
}

#[test]
fn the_elevator_estimate_leaves_office_workers_to_the_crowd() {
    let (mut sim, offices) = office_tower(GameMode::Classic);
    at_time(&mut sim, 0, 8);
    for id in offices {
        sim.tower.get_unit_mut(id).unwrap().occupants = STAFF;
    }
    sim.elevators.accumulate(&sim.tower, 5.0, 1.45);
    assert_eq!(sim.elevators.waiting_at(OFFICE_FLOOR), 0.0);
}

#[test]
fn workers_whose_elevator_is_bulldozed_on_the_way_never_vanish() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let (mut sim, offices) = office_tower(mode);
        // Step to the first minute a worker is riding the only elevator up.
        let riding = |sim: &Simulation| {
            sim.crowd.people.iter().any(|p| p.commuter && p.state == PState::Riding)
        };
        while !riding(&sim) {
            sim.tick(1.0);
            assert!(sim.clock.hour() < 10, "{mode:?}: nobody rode by 10 AM");
        }
        let shaft = sim.tower.transports[0].id;
        assert!(sim.tower.remove_transport(shaft).is_some());
        let inside: i64 = offices.iter().map(|&id| occupants(&sim, id)).sum();
        let w = watch(&mut sim, &offices, 3 * 60);
        for &(minute, net, change) in &w.ledger {
            assert_eq!(net, -change, "{mode:?}: minute {minute}");
        }
        // Whoever was riding or waiting turned back or sat down; nobody
        // left the crowd anywhere but the lobby or the office floor.
        for (id, last) in w.last.iter().filter(|l| l.1 .1) {
            assert!(
                last.0 == 1 || last.0 == OFFICE_FLOOR,
                "{mode:?}: worker {id} vanished on floor {}",
                last.0
            );
        }
        let now: i64 = offices.iter().map(|&id| occupants(&sim, id)).sum();
        assert_eq!(now, inside, "{mode:?}: no route is left to the desks");
        let travelling = sim.crowd.people.iter().filter(|p| p.commuter).count() as i64;
        assert_eq!(sim.crowd.commuter_count, travelling, "{mode:?}: the count matches the crowd");
    }
}

