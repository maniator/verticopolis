//! Modern residents really leave for the day and come home
//! (`crowd::commuters`, the real-tenant-arrivals plan's homes step): a
//! condo's, apartment's or studio's head count is the residents at home. On
//! weekdays all but the one who stays in (nobody, in a studio) leave through
//! the ground lobby over 7 to 10 AM and come home the same way over 4 to 7
//! PM; on weekends and at night everyone is home. Nobody appears or vanishes
//! on a home floor, and a home's residents are not also the dispatch's
//! estimate, so an elevator carries only riders the player can see (owner,
//! 2026-11-15). Classic homes keep the clock's head count.
use std::collections::HashMap;

use crate::clock::{CalendarKind, GameMode};
use crate::facilities::Kind;
use crate::load_stream::load_save_text;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{at_time, room, served_tower, LEFT};

const HOME_FLOOR: i64 = 4;
const TOP: i64 = 6;
const LOBBY: i64 = 1;
const SATURDAY: i64 = 5;

/// A lobby, floors 2 to 6 on one elevator, and two homes on floor 4, at
/// 6 AM on `day` (Monday is 0), everyone home: a bought condo, and a rented
/// studio in Modern (studios are Modern only) or a second condo in Classic.
fn home_tower(mode: GameMode, day: i64) -> (Simulation, [i64; 2]) {
    let mut sim = served_tower(mode, CalendarKind::RealWorld, TOP);
    let condo = room(
        &mut sim,
        Kind::Condo,
        HOME_FLOOR,
        LEFT + 10,
        UnitState::Occupied,
    );
    let second = match mode {
        GameMode::Modern => Kind::RentalStudio,
        GameMode::Classic => Kind::Condo,
    };
    let other = room(&mut sim, second, HOME_FLOOR, LEFT + 40, UnitState::Occupied);
    for id in [condo, other] {
        let u = sim.tower.get_unit_mut(id).unwrap();
        u.occupants = u.resident_count();
    }
    at_time(&mut sim, day, 6);
    (sim, [condo, other])
}

fn occupants(sim: &Simulation, id: i64) -> i64 {
    sim.tower.get_unit(id).map_or(0, |u| u.occupants)
}

fn residents(sim: &Simulation, id: i64) -> i64 {
    sim.tower.get_unit(id).unwrap().resident_count()
}

/// What a run showed: per minute, the people who appeared less those who
/// vanished on the home floor against the change in the homes' visible head
/// count, and where each commuting resident was first and last seen.
#[derive(Default)]
struct Watch {
    ledger: Vec<(i64, i64, i64)>,
    first: HashMap<i64, i64>,
    last: HashMap<i64, i64>,
}

impl Watch {
    /// The commuters first seen on `from` and last seen on `to`.
    fn trips(&self, from: i64, to: i64) -> usize {
        (self.first.iter())
            .filter(|(id, &f)| f == from && self.last.get(id) == Some(&to))
            .count()
    }
}

fn watch(sim: &mut Simulation, homes: &[i64], minutes: i64) -> Watch {
    let visible = |sim: &Simulation| -> i64 {
        homes
            .iter()
            .filter_map(|&id| sim.tower.get_unit(id))
            .map(|u| u.visible_occupants())
            .sum()
    };
    let people = |sim: &Simulation| -> HashMap<i64, (i64, bool)> {
        (sim.crowd.people.iter())
            .filter(|p| !p.staff)
            .map(|p| (p.id, (p.floor, p.commuter)))
            .collect()
    };
    let mut w = Watch::default();
    let (mut before, mut seen) = (people(sim), visible(sim));
    for minute in 1..=minutes {
        sim.tick(1.0);
        let now = people(sim);
        let mut net = 0;
        for (id, &(floor, commuter)) in &now {
            if !before.contains_key(id) {
                net += i64::from(floor == HOME_FLOOR);
                if commuter {
                    w.first.insert(*id, floor);
                }
            }
        }
        for (id, &(floor, commuter)) in &before {
            if !now.contains_key(id) {
                net -= i64::from(floor == HOME_FLOOR);
                if commuter {
                    w.last.insert(*id, floor);
                }
            }
        }
        let count = visible(sim);
        w.ledger.push((minute, net, count - seen));
        (before, seen) = (now, count);
    }
    w
}

#[test]
fn residents_leave_on_weekday_mornings_and_come_home_in_the_evening() {
    let (mut sim, [condo, studio]) = home_tower(GameMode::Modern, 0);
    let (condo_all, studio_all) = (residents(&sim, condo), residents(&sim, studio));
    assert!(condo_all > 1 && studio_all > 0);
    // 6 to 11 AM: all but one of the condo's residents and the whole studio
    // walk out through the lobby.
    let morning = watch(&mut sim, &[condo, studio], 5 * 60);
    let out = (condo_all - 1 + studio_all) as usize;
    assert_eq!(morning.trips(HOME_FLOOR, LOBBY), out);
    assert_eq!((occupants(&sim, condo), occupants(&sim, studio)), (1, 0));
    // Nobody comes or goes on a weekday until 4 PM.
    let day = watch(&mut sim, &[condo, studio], 5 * 60);
    assert_eq!(sim.clock.hour(), 16);
    assert!(day.first.is_empty(), "{:?}", day.first);
    // 4 to 8:30 PM: they all come home from the lobby.
    let evening = watch(&mut sim, &[condo, studio], 4 * 60 + 30);
    assert_eq!(evening.trips(LOBBY, HOME_FLOOR), out);
    assert_eq!(occupants(&sim, condo), condo_all);
    assert_eq!(occupants(&sim, studio), studio_all);
    assert_eq!(sim.crowd.commuter_count, 0, "everyone got home");
}

#[test]
fn no_one_appears_or_vanishes_on_a_home_floor() {
    let (mut sim, homes) = home_tower(GameMode::Modern, 0);
    let w = watch(&mut sim, &homes, 24 * 60);
    // Anyone who appeared on the home floor walked out of a home there, and
    // anyone who vanished there walked into one.
    for &(minute, net, change) in &w.ledger {
        assert_eq!(net, -change, "minute {minute}");
    }
    assert!(!w.first.is_empty());
    for (id, first) in &w.first {
        let last = w.last.get(id).copied();
        assert!(
            (*first == LOBBY && last == Some(HOME_FLOOR))
                || (*first == HOME_FLOOR && last == Some(LOBBY)),
            "resident {id} went {first} to {last:?}"
        );
    }
}

#[test]
fn everyone_stays_home_at_the_weekend() {
    let (mut sim, homes) = home_tower(GameMode::Modern, SATURDAY);
    assert!(sim.clock.is_weekend());
    let w = watch(&mut sim, &homes, 12 * 60);
    assert!(w.first.is_empty(), "{:?}", w.first);
    for id in homes {
        assert_eq!(occupants(&sim, id), residents(&sim, id));
    }
}

#[test]
fn classic_homes_keep_the_clocks_head_count() {
    let (mut sim, homes) = home_tower(GameMode::Classic, 0);
    let w = watch(&mut sim, &homes, 5 * 60);
    assert!(w.first.is_empty(), "no commuters");
    assert!(sim.crowd.desks.is_empty() && sim.crowd.shifts.is_empty());
    assert_eq!(occupants(&sim, homes[0]), 1, "the clock's daytime count");
}

#[test]
fn a_home_that_loses_its_tenant_sends_its_residents_out() {
    let (mut sim, [condo, studio]) = home_tower(GameMode::Modern, SATURDAY);
    for _ in 0..30 {
        sim.tick(1.0);
    }
    let home = occupants(&sim, condo);
    assert!(home > 0);
    sim.tower.get_unit_mut(condo).unwrap().state = UnitState::Empty;
    let w = watch(&mut sim, &[condo, studio], 2 * 60);
    assert_eq!(w.trips(HOME_FLOOR, LOBBY), home as usize);
    assert_eq!(occupants(&sim, condo), 0);
    assert_eq!(occupants(&sim, studio), residents(&sim, studio));
    for &(minute, net, change) in &w.ledger {
        assert_eq!(net, -change, "minute {minute}");
    }
}

#[test]
fn the_elevator_estimate_leaves_residents_to_the_crowd() {
    for (mode, estimated) in [(GameMode::Modern, false), (GameMode::Classic, true)] {
        let (mut sim, _) = home_tower(mode, 0);
        sim.elevators.accumulate(&sim.tower, 5.0, 1.45);
        let home = sim.elevators.waiting_at(HOME_FLOOR);
        assert_eq!(home > 0.0, estimated, "{mode:?}: {home} at the homes");
        // Nor are they the lobby's share of the tower's population.
        let lobby = sim.elevators.waiting_at(LOBBY);
        assert_eq!(lobby > 0.0, estimated, "{mode:?}: {lobby} at the lobby");
    }
}

#[test]
fn a_reload_mid_rush_plays_on_as_it_would_have() {
    let (mut sim, homes) = home_tower(GameMode::Modern, 0);
    // 8:05 AM: some residents gone, some on the way out, more booked.
    for _ in 0..125 {
        sim.tick(1.0);
    }
    assert!(!sim.crowd.shifts.is_empty(), "departures booked");
    let mut loaded = load_save_text(sim.save_text().as_bytes()).unwrap();
    assert_eq!(loaded.crowd.desks, sim.crowd.desks);
    assert_eq!(loaded.crowd.shifts, sim.crowd.shifts);
    for _ in 0..12 * 60 {
        sim.tick(1.0);
        loaded.tick(1.0);
    }
    // The same crowd, desks and rooms (the setup's star skips the
    // milestones a load then records, so the whole save is not compared).
    let (a, b) = (loaded.serialize(), sim.serialize());
    assert_eq!(a["crowd"], b["crowd"]);
    assert_eq!(a["units"], b["units"]);
    for id in homes {
        assert_eq!(occupants(&loaded, id), occupants(&sim, id));
    }
}

#[test]
fn a_home_let_by_day_has_its_stay_at_home_resident_come_in() {
    let (mut sim, [condo, studio]) = home_tower(GameMode::Modern, 0);
    // 11 AM on a weekday: the condo stands empty, then a family moves in.
    for id in [condo, studio] {
        let u = sim.tower.get_unit_mut(id).unwrap();
        (u.state, u.occupants) = (UnitState::Empty, 0);
    }
    for _ in 0..5 * 60 {
        sim.tick(1.0);
    }
    assert_eq!(occupants(&sim, condo), 0);
    sim.tower.get_unit_mut(condo).unwrap().state = UnitState::Occupied;
    // It books at noon, the next hour's pass, and rides in before 3 PM.
    let w = watch(&mut sim, &[condo], 4 * 60);
    assert_eq!(sim.clock.hour(), 15);
    // The one who stays in rides up from the lobby; the rest come at 4 PM.
    assert_eq!(w.trips(LOBBY, HOME_FLOOR), 1);
    assert_eq!(occupants(&sim, condo), 1);
}
