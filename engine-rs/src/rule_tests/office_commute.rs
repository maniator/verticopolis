//! Modern office workers really come to work (`crowd::commuters`): an
//! office's head count is the workers who got to their desks. They come in
//! at the ground lobby or the Metro over 7 to 10 AM on weekdays and leave
//! the same way over 4 to 7 PM, so nobody appears or vanishes on an office
//! floor except by walking into or out of a room there. An office no route
//! reaches never fills, and one that is bulldozed or loses its tenant sends
//! its workers out through the lobby. Classic offices keep the clock's head
//! count until the 1994 rush is measured.
use std::collections::HashMap;

use serde_json::json;

use crate::clock::{CalendarKind, GameMode};
use crate::crowd::PState;
use crate::facilities::Kind;
use crate::load::deserialize;
use crate::load_stream::load_save_text;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{at_time, room, served_tower, LEFT};

const OFFICE_FLOOR: i64 = 5;
const TOP: i64 = 6;
const STAFF: i64 = 6;
/// The modes whose office workers commute as people.
const COMMUTING_MODES: [GameMode; 1] = [GameMode::Modern];

/// A lobby, floors 2 to 6 on one elevator, and two rented offices on
/// floor 5, at 6 AM on a Monday.
fn office_tower(mode: GameMode) -> (Simulation, [i64; 2]) {
    let mut sim = served_tower(mode, CalendarKind::RealWorld, TOP);
    let a = room(
        &mut sim,
        Kind::Office,
        OFFICE_FLOOR,
        LEFT + 10,
        UnitState::Occupied,
    );
    let b = room(
        &mut sim,
        Kind::Office,
        OFFICE_FLOOR,
        LEFT + 40,
        UnitState::Occupied,
    );
    at_time(&mut sim, 0, 6);
    (sim, [a, b])
}

pub(super) fn occupants(sim: &Simulation, id: i64) -> i64 {
    sim.tower.get_unit(id).map_or(0, |u| u.occupants)
}

/// The workers you can see in the offices: at their desks and not out for
/// lunch or a sales call.
pub(super) fn visible(sim: &Simulation, offices: &[i64]) -> i64 {
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

/// The commuting workers first seen on `floor` during the watch.
fn set_out_from(w: &Watch, floor: i64) -> i64 {
    w.first.values().filter(|f| f.1 && f.0 == floor).count() as i64
}

#[test]
fn the_evening_rush_is_spread_from_4_to_7() {
    for mode in COMMUTING_MODES {
        let (mut sim, offices) = at_work(mode);
        // 10:30 to 4 PM: nobody leaves during office hours.
        let day = watch(&mut sim, &offices, 5 * 60 + 30);
        assert_eq!(sim.clock.hour(), 16);
        assert_eq!(
            set_out_from(&day, OFFICE_FLOOR),
            0,
            "{mode:?}: none before 4"
        );
        // Six owed per office: two from 4, two from 5, the last two from 6.
        for hour in 16..19 {
            let w = watch(&mut sim, &offices, 60);
            let left = set_out_from(&w, OFFICE_FLOOR);
            assert_eq!(left, 2 * 2, "{mode:?}: {hour}:00 to {}:00", hour + 1);
        }
        let late = watch(&mut sim, &offices, 60);
        assert_eq!(
            set_out_from(&late, OFFICE_FLOOR),
            0,
            "{mode:?}: all left by 7"
        );
        for id in offices {
            assert_eq!(occupants(&sim, id), 0, "{mode:?}: home by 8 PM");
        }
    }
}

#[test]
fn an_office_fills_only_as_its_workers_arrive() {
    for mode in COMMUTING_MODES {
        let (mut sim, offices) = office_tower(mode);
        let w = watch(&mut sim, &offices, 60);
        assert_eq!(sim.clock.hour(), 7);
        for id in offices {
            assert_eq!(occupants(&sim, id), 0, "{mode:?}: nobody is in at 7:00");
            let booked = crate::crowd::commuters::coming_to(&sim.crowd, id);
            assert_eq!(booked, STAFF / 3, "{mode:?}: a third booked at 7");
        }
        // The rush is spread: a third of the six set out from 7, half of
        // the rest from 8, and the last from 9, two an hour per office.
        let mut w2 = watch(&mut sim, &offices, 60);
        assert_eq!(set_out_from(&w2, 1), 2 * 2, "{mode:?}: 7 to 8");
        let w3 = watch(&mut sim, &offices, 60);
        assert_eq!(set_out_from(&w3, 1), 2 * 2, "{mode:?}: 8 to 9");
        // The last set out by 10 and are at their desks by 10:30.
        let w4 = watch(&mut sim, &offices, 90);
        assert_eq!(set_out_from(&w4, 1), 2 * 2, "{mode:?}: 9 to 10");
        for id in offices {
            assert_eq!(occupants(&sim, id), STAFF, "{mode:?}: full by 10:30");
        }
        for part in [w3, w4] {
            for (id, first) in part.first {
                w2.first.entry(id).or_insert(first);
            }
            w2.last.extend(part.last);
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
        assert!(w.first.values().all(|f| !f.1), "{mode:?}: none before 7");
    }
}

/// Classic offices count their workers by the clock.
#[test]
fn classic_offices_keep_the_clocks_head_count() {
    let (mut sim, offices) = office_tower(GameMode::Classic);
    let w = watch(&mut sim, &offices, 2 * 60 + 1);
    assert!(w.first.values().all(|f| !f.1), "no commuters");
    for id in offices {
        assert_eq!(occupants(&sim, id), STAFF, "in at 8 by the clock");
    }
    assert!(sim.crowd.desks.is_empty() && sim.crowd.shifts.is_empty());
}

#[test]
fn no_one_appears_or_vanishes_on_an_office_floor() {
    for mode in COMMUTING_MODES {
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
    let cut_off = room(
        &mut sim,
        Kind::Office,
        TOP + 1,
        LEFT + 5,
        UnitState::Occupied,
    );
    at_time(&mut sim, 0, 7);
    let mut most = 0;
    for _ in 0..(11 * 60) {
        sim.tick(1.0);
        most = most.max(occupants(&sim, cut_off));
    }
    assert_eq!(most, 0, "no worker can get there");
    assert_eq!(sim.crowd.commuter_count, 0);
}

/// Steps to 10:30 AM, when both offices are full.
fn at_work(mode: GameMode) -> (Simulation, [i64; 2]) {
    let (mut sim, offices) = office_tower(mode);
    for _ in 0..(4 * 60 + 30) {
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
        assert_eq!(
            first.0, OFFICE_FLOOR,
            "{mode:?}: {id} set out at the office"
        );
        assert_eq!(w.last.get(id).map(|l| l.0), Some(1), "{mode:?}: {id} left");
    }
    leavers.len()
}

#[test]
fn a_bulldozed_office_sends_its_workers_out() {
    for mode in COMMUTING_MODES {
        let (mut sim, offices) = at_work(mode);
        assert!(sim.tower.remove_unit(offices[0]).is_some());
        let w = watch(&mut sim, &offices[1..], 60);
        assert_eq!(all_left_by_the_lobby(&w, mode), STAFF as usize);
        assert_eq!(occupants(&sim, offices[1]), STAFF, "{mode:?}");
    }
}

#[test]
fn an_office_that_loses_its_tenant_sends_its_workers_home() {
    for mode in COMMUTING_MODES {
        let (mut sim, offices) = office_tower(mode);
        for _ in 0..(2 * 60 + 10) {
            sim.tick(1.0);
        }
        let inside = occupants(&sim, offices[0]);
        let coming = crate::crowd::commuters::coming_to(&sim.crowd, offices[0]);
        assert!(coming > 0, "{mode:?}: some are still on the way at 8:10");
        sim.tower.get_unit_mut(offices[0]).unwrap().state = UnitState::Empty;
        let w = watch(&mut sim, &offices, 2 * 60);
        assert!(
            w.peak <= inside,
            "{mode:?}: nobody sat down after the eviction"
        );
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
    // A load keeps the head counts (and the crowd, which is nobody now).
    let mut sim = deserialize(&sim.serialize()).unwrap();
    assert!(sim.tower.remove_unit(offices[0]).is_some());
    let w = watch(&mut sim, &offices[1..], 9 * 60 + 15);
    assert_eq!(
        all_left_by_the_lobby(&w, GameMode::Modern),
        2 * STAFF as usize
    );
    assert_eq!(occupants(&sim, offices[1]), 0);
}

#[test]
fn the_elevator_estimate_leaves_office_workers_to_the_crowd() {
    for (mode, estimated) in [(GameMode::Modern, false), (GameMode::Classic, true)] {
        let (mut sim, offices) = office_tower(mode);
        at_time(&mut sim, 0, 8);
        for id in offices {
            sim.tower.get_unit_mut(id).unwrap().occupants = STAFF;
        }
        sim.elevators.accumulate(&sim.tower, 5.0, 1.45);
        let waiting = sim.elevators.waiting_at(OFFICE_FLOOR);
        assert_eq!(waiting > 0.0, estimated, "{mode:?}: {waiting}");
    }
}

#[test]
fn workers_whose_elevator_is_bulldozed_on_the_way_never_vanish() {
    for mode in COMMUTING_MODES {
        let (mut sim, offices) = office_tower(mode);
        // Step to the first minute a worker is riding the only elevator up.
        let riding = |sim: &Simulation| {
            sim.crowd
                .people
                .iter()
                .any(|p| p.commuter && p.state == PState::Riding)
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
        let on_the_way = sim.crowd.people.iter().filter(|p| p.commuter).count() as i64;
        assert_eq!(
            sim.crowd.commuter_count, on_the_way,
            "{mode:?}: the count matches the crowd"
        );
    }
}

#[test]
fn a_reload_mid_rush_plays_on_as_it_would_have() {
    let (mut sim, offices) = office_tower(GameMode::Modern);
    // 8:30 AM: some workers at their desks, some on the way, more booked.
    for _ in 0..150 {
        sim.tick(1.0);
    }
    assert!(sim.crowd.commuter_count > 0, "workers on the way");
    assert!(!sim.crowd.shifts.is_empty(), "arrivals booked");
    let mut loaded = load_save_text(sim.save_text().as_bytes()).unwrap();
    assert_eq!(loaded.crowd.desks, sim.crowd.desks);
    assert_eq!(loaded.crowd.shifts, sim.crowd.shifts);
    assert_eq!(loaded.crowd.commuter_count, sim.crowd.commuter_count);
    for _ in 0..90 {
        sim.tick(1.0);
        loaded.tick(1.0);
    }
    assert_eq!(loaded.crowd.view(), sim.crowd.view());
    assert_eq!(loaded.crowd.desks, sim.crowd.desks);
    for id in offices {
        assert_eq!(occupants(&loaded, id), occupants(&sim, id));
    }
}

#[test]
fn a_worker_who_turned_back_never_overfills_the_office() {
    // 10:30 AM, both offices full; one worker who had set out for home
    // waited too long, turned back, and walks to a desk filled meanwhile.
    let (sim, offices) = at_work(GameMode::Modern);
    let office = sim.tower.get_unit(offices[0]).unwrap().clone();
    let shaft = sim.tower.transports[0].id;
    let mut save = sim.serialize();
    let desk_x = (office.x + 4) as f64;
    save["crowd"]["people"].as_array_mut().unwrap().push(json!({
        "id": 9_000, "state": "toDest", "floor": OFFICE_FLOOR, "fy": OFFICE_FLOOR as f64,
        "x": desk_x + 3.0, "startX": desk_x, "floors": [OFFICE_FLOOR, 1],
        "originFloor": OFFICE_FLOOR, "shafts": [shaft], "leg": 0, "shaftId": shaft,
        "destX": desk_x, "wait": 0.0, "tripWait": 0.0, "age": 0.0, "linger": 0.0,
        "returning": true, "errand": { "place": "office", "inbound": false },
        "commute": { "officeId": office.id, "inbound": false },
    }));
    let mut sim = load_save_text(save.to_string().as_bytes()).unwrap();
    assert_eq!(sim.crowd.commuter_count, 1, "the worker loads");
    let w = watch(&mut sim, &offices, 30);
    // They found the office full and left by the lobby.
    assert!(w.peak <= STAFF, "{} at the desks", w.peak);
    assert_eq!(occupants(&sim, offices[0]), STAFF);
    assert_eq!(
        w.last.get(&9_000).map(|l| l.0),
        Some(1),
        "left by the lobby"
    );
    // So a save taken any minute of it loads as the same game.
    let mut sim = load_save_text(save.to_string().as_bytes()).unwrap();
    let mut reloaded = load_save_text(save.to_string().as_bytes()).unwrap();
    for minute in 1..=30 {
        sim.tick(1.0);
        reloaded = load_save_text(reloaded.save_text().as_bytes()).unwrap();
        reloaded.tick(1.0);
        assert_eq!(reloaded.save_text(), sim.save_text(), "minute {minute}");
    }
}
