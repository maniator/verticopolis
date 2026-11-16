//! Modern hotel guests really check in and check out
//! (`crowd::commuters`, the real-tenant-arrivals plan's hotels step): a
//! hotel room's head count is the guests in it. Once a room is let for the
//! night they ride up from the ground lobby in the next hour's pass, sleep
//! in the room, and ride back down over the hour of their checkout. Nobody
//! appears or vanishes on a hotel floor, and a guest is never also the
//! dispatch's estimate, so an elevator carries only riders the player can
//! see, and none for guests asleep in their rooms (owner, 2026-11-16).
//! Classic hotels keep the clock's head count.
use std::collections::HashMap;

use crate::clock::{CalendarKind, GameMode};
use crate::facilities::Kind;
use crate::load_stream::load_save_text;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{at_time, room, served_tower, LEFT};

const HOTEL_FLOOR: i64 = 4;
const TOP: i64 = 6;
const LOBBY: i64 = 1;

/// A lobby, floors 2 to 6 on one elevator, and three hotel rooms on floor
/// 4 (a single, a double and a suite), vacant and clean, at 5 PM on a
/// Monday, when the evening's check-in begins.
fn hotel_tower(mode: GameMode) -> (Simulation, [i64; 3]) {
    let mut sim = served_tower(mode, CalendarKind::RealWorld, TOP);
    let rooms = [
        (Kind::HotelSingle, LEFT + 10),
        (Kind::HotelDouble, LEFT + 25),
        (Kind::HotelSuite, LEFT + 45),
    ]
    .map(|(kind, x)| room(&mut sim, kind, HOTEL_FLOOR, x, UnitState::Empty));
    at_time(&mut sim, 0, 17);
    (sim, rooms)
}

/// Lets every room for the night, as the evening's check-in does.
fn let_rooms(sim: &mut Simulation, rooms: &[i64]) {
    for &id in rooms {
        sim.tower.get_unit_mut(id).unwrap().state = UnitState::Asleep;
    }
}

fn occupants(sim: &Simulation, id: i64) -> i64 {
    sim.tower.get_unit(id).map_or(0, |u| u.occupants)
}

fn guests(sim: &Simulation, rooms: &[i64]) -> i64 {
    rooms
        .iter()
        .map(|&id| sim.tower.get_unit(id).unwrap().kind.facility().population)
        .sum()
}

/// What a run showed: per minute, the people who appeared less those who
/// vanished on the hotel floor against the change in the rooms' visible
/// head count, and where each commuting guest was first and last seen.
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

fn watch(sim: &mut Simulation, rooms: &[i64], minutes: i64) -> Watch {
    let visible = |sim: &Simulation| -> i64 {
        rooms
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
                net += i64::from(floor == HOTEL_FLOOR);
                if commuter {
                    w.first.insert(*id, floor);
                }
            }
        }
        for (id, &(floor, commuter)) in &before {
            if !now.contains_key(id) {
                net -= i64::from(floor == HOTEL_FLOOR);
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
fn guests_ride_up_to_check_in_and_ride_down_after_checkout() {
    let (mut sim, rooms) = hotel_tower(GameMode::Modern);
    let all = guests(&sim, &rooms);
    // 5 PM: the rooms are let. Nobody is in them until the guests get there.
    let_rooms(&mut sim, &rooms);
    for id in rooms {
        assert_eq!(occupants(&sim, id), 0, "a let room starts empty");
    }
    // By 8 PM every guest rode up from the lobby.
    let evening = watch(&mut sim, &rooms, 3 * 60);
    assert_eq!(evening.trips(LOBBY, HOTEL_FLOOR), all as usize);
    for id in rooms {
        let u = sim.tower.get_unit(id).unwrap();
        assert_eq!(u.occupants, u.kind.facility().population, "{:?}", u.kind);
    }
    // Nobody comes or goes through the night.
    let night = watch(&mut sim, &rooms, 11 * 60);
    assert_eq!(sim.clock.hour(), 7);
    assert!(night.first.is_empty(), "{:?}", night.first);
    // Checkout at 8 AM, and the late checkouts at 2 PM: every guest rides
    // down to the lobby and leaves by 4 PM.
    let morning = watch(&mut sim, &rooms, 9 * 60);
    assert_eq!(morning.trips(HOTEL_FLOOR, LOBBY), all as usize);
    for id in rooms {
        let u = sim.tower.get_unit(id).unwrap();
        assert_eq!(
            (u.state, u.occupants),
            (UnitState::Dirty, 0),
            "{:?}",
            u.kind
        );
    }
    assert_eq!(sim.crowd.commuter_count, 0, "everyone got out");
}

#[test]
fn no_one_appears_or_vanishes_on_a_hotel_floor() {
    let (mut sim, rooms) = hotel_tower(GameMode::Modern);
    let_rooms(&mut sim, &rooms);
    let w = watch(&mut sim, &rooms, 24 * 60);
    // Anyone who appeared on the hotel floor walked out of a room there,
    // and anyone who vanished there walked into one.
    for &(minute, net, change) in &w.ledger {
        assert_eq!(net, -change, "minute {minute}");
    }
    assert!(!w.first.is_empty());
    for (id, first) in &w.first {
        let last = w.last.get(id).copied();
        assert!(
            (*first == LOBBY && last == Some(HOTEL_FLOOR))
                || (*first == HOTEL_FLOOR && last == Some(LOBBY)),
            "guest {id} went {first} to {last:?}"
        );
    }
}

#[test]
fn sleeping_guests_call_no_elevator() {
    for (mode, estimated) in [(GameMode::Modern, false), (GameMode::Classic, true)] {
        let (mut sim, rooms) = hotel_tower(mode);
        let_rooms(&mut sim, &rooms);
        // 1 AM, everyone checked in and asleep.
        for _ in 0..8 * 60 {
            sim.tick(1.0);
        }
        assert_eq!(sim.clock.hour(), 1);
        let in_rooms: i64 = rooms.iter().map(|&id| occupants(&sim, id)).sum();
        assert_eq!(in_rooms, guests(&sim, &rooms), "{mode:?}: everyone in");
        let mut fresh = crate::dispatch::ElevatorDispatch::new();
        fresh.accumulate(&sim.tower, 60.0, 1.0);
        let floor = fresh.waiting_at(HOTEL_FLOOR);
        assert_eq!(floor > 0.0, estimated, "{mode:?}: {floor} at the rooms");
        // Nor are they the lobby's share of the tower's population.
        let lobby = fresh.waiting_at(LOBBY);
        assert_eq!(lobby > 0.0, estimated, "{mode:?}: {lobby} at the lobby");
    }
}

#[test]
fn classic_hotels_keep_the_clocks_head_count() {
    let (mut sim, rooms) = hotel_tower(GameMode::Classic);
    let_rooms(&mut sim, &rooms);
    let w = watch(&mut sim, &rooms, 2 * 60);
    assert!(w.first.is_empty(), "no commuters");
    assert!(sim.crowd.desks.is_empty() && sim.crowd.shifts.is_empty());
    assert_eq!(occupants(&sim, rooms[1]), 2, "the clock fills a let room");
}

#[test]
fn a_room_that_burns_sends_its_guests_out_at_once() {
    let (mut sim, rooms) = hotel_tower(GameMode::Modern);
    let_rooms(&mut sim, &rooms);
    for _ in 0..4 * 60 {
        sim.tick(1.0);
    }
    let suite = rooms[2];
    let inside = occupants(&sim, suite);
    assert!(inside > 0);
    sim.tower.get_unit_mut(suite).unwrap().state = UnitState::Fire;
    let w = watch(&mut sim, &rooms, 90);
    assert_eq!(w.trips(HOTEL_FLOOR, LOBBY), inside as usize);
    assert_eq!(occupants(&sim, suite), 0);
    for &(minute, net, change) in &w.ledger {
        assert_eq!(net, -change, "minute {minute}");
    }
}

#[test]
fn a_reload_mid_check_in_plays_on_as_it_would_have() {
    let (mut sim, rooms) = hotel_tower(GameMode::Modern);
    let_rooms(&mut sim, &rooms);
    // 5:20 PM: the guests are booked and some are on their way up.
    for _ in 0..20 {
        sim.tick(1.0);
    }
    assert!(
        sim.crowd.desks.values().any(|d| d.coming > 0),
        "guests on the way"
    );
    let mut loaded = load_save_text(sim.save_text().as_bytes()).unwrap();
    assert_eq!(loaded.crowd.desks, sim.crowd.desks);
    assert_eq!(loaded.crowd.shifts, sim.crowd.shifts);
    for _ in 0..18 * 60 {
        sim.tick(1.0);
        loaded.tick(1.0);
    }
    let (a, b) = (loaded.serialize(), sim.serialize());
    assert_eq!(a["crowd"], b["crowd"]);
    assert_eq!(a["units"], b["units"]);
}

#[test]
fn an_older_save_keeps_its_sleeping_guests_in_their_rooms() {
    let (mut sim, rooms) = hotel_tower(GameMode::Modern);
    // A save from before guests checked in as people: let rooms with the
    // clock's head count and no desks.
    let_rooms(&mut sim, &rooms);
    for &id in &rooms {
        let u = sim.tower.get_unit_mut(id).unwrap();
        u.occupants = u.kind.facility().population;
    }
    sim.crowd.desks.clear();
    sim.crowd.shifts.clear();
    sim.crowd.desk_revision = None;
    let mut save = sim.serialize();
    let crowd = save["crowd"].as_object_mut().unwrap();
    for key in ["desks", "shifts", "desksStale", "venueStaff"] {
        crowd.remove(key);
    }
    let mut loaded = load_save_text(save.to_string().as_bytes()).unwrap();
    // The guests stay asleep in their rooms: nobody rides in or out.
    let w = watch(&mut loaded, &rooms, 60);
    assert!(w.first.is_empty(), "{:?}", w.first);
    for id in rooms {
        let u = loaded.tower.get_unit(id).unwrap();
        assert_eq!(u.occupants, u.kind.facility().population, "{:?}", u.kind);
        assert_eq!(loaded.crowd.desks[&id].inside, u.occupants);
    }
}
