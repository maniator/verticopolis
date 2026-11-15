//! Modern venue staff really come to work (`crowd::commuters`,
//! `crowd::workplace`): a shop opens its doors only once its staff have
//! ridden in from the ground lobby or the Metro, they come in four hours
//! before it opens and leave the same way after it closes, and a shop no route reaches never opens. A reload or a
//! save without a crowd keeps the staff at work, and a bulldozed shop sends
//! them out through the lobby, after a reload straight after the bulldoze
//! too. Classic venues open by the clock.
use std::collections::HashMap;

use crate::clock::{CalendarKind, GameMode};
use crate::facilities::Kind;
use crate::load::deserialize;
use crate::load_stream::load_save_text;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{at_time, room, served_tower, LEFT};

const SHOP_FLOOR: i64 = 4;
const TOP: i64 = 6;

/// A lobby, floors 2 to 6 on one elevator, and a rented shop on floor 4,
/// at `hour` on a Monday.
fn shop_tower(mode: GameMode, hour: i64) -> (Simulation, i64) {
    let mut sim = served_tower(mode, CalendarKind::RealWorld, TOP);
    let shop = room(
        &mut sim,
        Kind::Shop,
        SHOP_FLOOR,
        LEFT + 10,
        UnitState::Occupied,
    );
    at_time(&mut sim, 0, hour);
    (sim, shop)
}

fn staff_in(sim: &Simulation, id: i64) -> i64 {
    sim.tower.get_unit(id).map_or(0, |u| i64::from(u.staff_in))
}

fn open(sim: &Simulation, id: i64) -> bool {
    let hour = sim.clock.hour();
    let mode = sim.tower.mode;
    sim.tower
        .get_unit(id)
        .is_some_and(|u| u.open_for_business(hour, mode))
}

/// Where each commuter was first and last seen over a run, by floor.
#[derive(Default)]
struct Trail {
    first: HashMap<i64, i64>,
    last: HashMap<i64, i64>,
}

impl Trail {
    /// The commuters first seen on `from` and last seen on `to`.
    fn went(&self, from: i64, to: i64) -> usize {
        let ended = |id: &i64| self.last.get(id) == Some(&to);
        let firsts = self.first.iter();
        firsts.filter(|(id, &f)| f == from && ended(id)).count()
    }
}

/// Steps `minutes`, noting where each commuter appeared and vanished, and
/// checking every minute that a shop that waits for its staff is open
/// only with staff in.
fn trail(sim: &mut Simulation, shop: i64, minutes: i64) -> Trail {
    let commuters = |sim: &Simulation| -> HashMap<i64, i64> {
        let people = sim.crowd.people.iter().filter(|p| p.commuter);
        people.map(|p| (p.id, p.floor)).collect()
    };
    let mut t = Trail::default();
    let mut before = commuters(sim);
    for _ in 0..minutes {
        sim.tick(1.0);
        let waits = Kind::Shop.waits_for_staff(sim.tower.mode);
        let staffed = staff_in(sim, shop) > 0;
        assert!(!waits || !open(sim, shop) || staffed, "open with nobody in");
        let now = commuters(sim);
        for (id, floor) in &now {
            if !before.contains_key(id) {
                t.first.insert(*id, *floor);
            }
        }
        for (id, floor) in &before {
            if !now.contains_key(id) {
                t.last.insert(*id, *floor);
            }
        }
        before = now;
    }
    t
}

#[test]
fn a_shop_opens_once_its_staff_ride_in() {
    let (mut sim, shop) = shop_tower(GameMode::Modern, 5);
    let early = trail(&mut sim, shop, 60);
    assert!(early.first.is_empty(), "nobody comes before 6");
    assert_eq!(staff_in(&sim, shop), 0);
    // The crew of a shop that opens at 10 is called in at 6, four hours
    // ahead, and is in before the office rush starts at 7.
    let t = trail(&mut sim, shop, 60);
    let staff = Kind::Shop.staff_size();
    assert_eq!(t.went(1, SHOP_FLOOR), staff as usize, "from the lobby");
    assert_eq!(staff_in(&sim, shop), staff, "all in by 7");
    assert!(!open(&sim, shop), "still shut at 7");
    trail(&mut sim, shop, 210);
    assert!(open(&sim, shop), "open at 10:30");
    assert_eq!(sim.crowd.commuter_count, 0, "everyone got there");
}

#[test]
fn a_crew_is_called_in_four_hours_before_opening() {
    let called = |kind: Kind| (0..24).find(|&h| kind.staffed_at(h) && !kind.staffed_at(h - 1));
    assert_eq!(called(Kind::Shop), Some(6));
    assert_eq!(called(Kind::Spa), Some(5));
    assert_eq!(called(Kind::Restaurant), Some(7));
    assert_eq!(called(Kind::Cinema), Some(8));
    assert_eq!(called(Kind::PartyHall), Some(13));
    // A break of four hours or less keeps the crew in.
    assert!((7..23).all(|h| Kind::Restaurant.staffed_at(h)));
    assert!(!Kind::Restaurant.staffed_at(23) && !Kind::Office.staffed_at(12));
}

#[test]
fn the_staff_leave_through_the_lobby_after_closing() {
    let (mut sim, shop) = shop_tower(GameMode::Modern, 12);
    let staff = Kind::Shop.staff_size();
    assert_eq!(staff_in(&sim, shop), staff, "at work at noon");
    trail(&mut sim, shop, 8 * 60 + 59);
    assert_eq!(staff_in(&sim, shop), staff, "still in at 20:59");
    let t = trail(&mut sim, shop, 120);
    assert_eq!(t.went(SHOP_FLOOR, 1), staff as usize, "out by the lobby");
    assert_eq!(staff_in(&sim, shop), 0);
    assert!(!open(&sim, shop));
    assert_eq!(sim.crowd.commuter_count, 0);
}

#[test]
fn a_shop_no_route_reaches_never_opens() {
    let mut sim = served_tower(GameMode::Modern, CalendarKind::RealWorld, TOP);
    for x in LEFT..LEFT + 20 {
        assert!(sim.build(Kind::Floor, TOP + 1, x).ok);
    }
    let cut_off = room(&mut sim, Kind::Shop, TOP + 1, LEFT + 5, UnitState::Occupied);
    at_time(&mut sim, 0, 5);
    let mut opened = false;
    for _ in 0..(7 * 60) {
        sim.tick(1.0);
        opened |= open(&sim, cut_off) || staff_in(&sim, cut_off) > 0;
    }
    assert!(!opened, "no one can get there");
    assert_eq!(sim.crowd.commuter_count, 0);
}

#[test]
fn classic_shops_open_by_the_clock() {
    let (mut sim, shop) = shop_tower(GameMode::Classic, 9);
    let t = trail(&mut sim, shop, 90);
    assert!(t.first.is_empty(), "no staff commute");
    assert_eq!(staff_in(&sim, shop), 0);
    assert!(open(&sim, shop), "open at 10:30 by the clock");
    assert!(sim.crowd.desks.is_empty() && sim.crowd.shifts.is_empty());
}

#[test]
fn a_reload_keeps_the_staff_at_work() {
    let (mut sim, shop) = shop_tower(GameMode::Modern, 12);
    let mut loaded = load_save_text(sim.save_text().as_bytes()).unwrap();
    assert_eq!(loaded.crowd.desks, sim.crowd.desks);
    assert_eq!(staff_in(&loaded, shop), staff_in(&sim, shop));
    for _ in 0..60 {
        sim.tick(1.0);
        loaded.tick(1.0);
    }
    assert_eq!(loaded.crowd.view(), sim.crowd.view());
    assert_eq!(staff_in(&loaded, shop), Kind::Shop.staff_size());
    assert!(open(&loaded, shop));
}

#[test]
fn a_save_without_a_crowd_opens_with_its_staff_in() {
    let (sim, shop) = shop_tower(GameMode::Modern, 12);
    let mut save = sim.serialize();
    save.as_object_mut().unwrap().remove("crowd");
    let mut loaded = deserialize(&save).unwrap();
    assert_eq!(staff_in(&loaded, shop), Kind::Shop.staff_size());
    loaded.tick(1.0);
    assert!(open(&loaded, shop), "open straight after the load");
}

#[test]
fn a_bulldozed_shop_sends_its_staff_out() {
    let (mut sim, shop) = shop_tower(GameMode::Modern, 12);
    assert!(sim.tower.remove_unit(shop).is_some());
    let t = trail(&mut sim, shop, 60);
    let staff = Kind::Shop.staff_size() as usize;
    assert_eq!(t.went(SHOP_FLOOR, 1), staff, "out by the lobby");
    assert_eq!(sim.crowd.commuter_count, 0);
}

#[test]
fn staff_leaving_a_bulldozed_shop_still_go_home_from_work() {
    use crate::crowd::trip::{Errand, ErrandPlace};
    let (mut sim, shop) = shop_tower(GameMode::Modern, 12);
    assert!(sim.tower.remove_unit(shop).is_some());
    sim.tick(1.0);
    let leaving: Vec<_> = (sim.crowd.people.iter())
        .filter(|p| p.commute.is_some_and(|c| c.workplace_id == shop))
        .map(|p| p.errand)
        .collect();
    assert_eq!(leaving.len() as i64, Kind::Shop.staff_size());
    let from_work = Errand {
        place: ErrandPlace::Work,
        inbound: false,
    };
    assert!(leaving.iter().all(|e| *e == Some(from_work)), "{leaving:?}");
}

/// A save made after a bulldoze but before the next step loads the crowd
/// it held, and the staff go out at that step in both games.
#[test]
fn a_reload_straight_after_a_bulldoze_keeps_the_crowd() {
    let (mut sim, shop) = shop_tower(GameMode::Modern, 12);
    assert!(sim.tower.remove_unit(shop).is_some());
    let mut loaded = load_save_text(sim.save_text().as_bytes()).unwrap();
    assert_eq!(loaded.crowd.view(), sim.crowd.view(), "as saved");
    sim.tick(1.0);
    loaded.tick(1.0);
    assert_eq!(loaded.crowd.view(), sim.crowd.view(), "after a step");
    assert_eq!(
        sim.crowd.commuter_count,
        Kind::Shop.staff_size(),
        "sent out"
    );
}

#[test]
fn no_venue_keeps_more_staff_than_an_office_holds() {
    // A save's desks are clamped to an office's head count
    // (`commuters_save::desk_from`), so a venue's staff must fit under it.
    let most = Kind::Office.facility().population;
    let kinds = crate::facilities::FACILITIES.iter().map(|f| f.kind);
    for kind in kinds.clone() {
        assert!(kind.staff_size() <= most, "{kind:?}");
    }
    assert!(kinds.into_iter().any(|k| k.staff_size() == most));
}

/// A shop finished mid-hour calls its crew in at once, so a save made
/// before they arrive loads with nobody in yet and plays on the same.
#[test]
fn a_reload_after_a_shop_opens_mid_hour_keeps_its_crew_on_the_way() {
    let (mut sim, _) = shop_tower(GameMode::Modern, 12);
    let dur = Kind::Shop.build_minutes();
    // Built so it finishes at half past an hour the shop is staffed.
    while (sim.clock.minutes + dur).rem_euclid(60.0) != 30.0 {
        sim.tick(1.0);
    }
    assert!(sim.build(Kind::Shop, SHOP_FLOOR + 1, LEFT + 10).ok);
    let shop = sim.tower.unit_at(SHOP_FLOOR + 1, LEFT + 10).unwrap().id;
    while sim.tower.get_unit(shop).unwrap().state == UnitState::Construction {
        sim.tick(1.0);
    }
    assert!(Kind::Shop.staffed_at(sim.clock.hour()));
    let staff = Kind::Shop.staff_size();
    let desk = sim.crowd.desks[&shop];
    assert_eq!(desk.coming + desk.inside, staff, "called in at once");
    assert!(desk.inside < staff, "not all in yet");
    let mut loaded = load_save_text(sim.save_text().as_bytes()).unwrap();
    assert_eq!(loaded.crowd.desks, sim.crowd.desks);
    assert_eq!(staff_in(&loaded, shop), staff_in(&sim, shop));
    for _ in 0..60 {
        sim.tick(1.0);
        loaded.tick(1.0);
    }
    assert_eq!(loaded.crowd.view(), sim.crowd.view());
    assert_eq!(staff_in(&loaded, shop), staff, "all in");
}

/// A save whose game had its venue staff commute keeps a shop with no
/// crew in empty on reload, and a save from before they commuted
/// (`venueStaff` absent) has an open shop's crew at work.
#[test]
fn a_reload_leaves_a_shop_whose_crew_never_got_in_empty() {
    let (mut sim, _) = shop_tower(GameMode::Modern, 12);
    sim.tick(1.0);
    for x in LEFT..LEFT + 20 {
        assert!(sim.build(Kind::Floor, TOP + 1, x).ok);
    }
    let cut_off = room(&mut sim, Kind::Shop, TOP + 1, LEFT + 5, UnitState::Occupied);
    // No route reaches it: every arrival booked this hour gives up.
    while sim.crowd.desks.get(&cut_off).is_some_and(|d| d.coming > 0) {
        sim.tick(1.0);
    }
    assert_eq!(sim.clock.hour(), 12);
    let mut loaded = load_save_text(sim.save_text().as_bytes()).unwrap();
    assert_eq!(staff_in(&loaded, cut_off), 0, "nobody appears inside");
    assert_eq!(loaded.crowd.desks, sim.crowd.desks);
    for _ in 0..60 {
        sim.tick(1.0);
        loaded.tick(1.0);
    }
    assert_eq!(loaded.crowd.view(), sim.crowd.view());
    assert_eq!(staff_in(&loaded, cut_off), 0);
    // Without its desk row, the mark alone keeps the shop empty.
    let mut save = sim.serialize();
    let desks = save["crowd"]["desks"].as_array_mut().unwrap();
    desks.retain(|row| row[0] != cut_off);
    assert_eq!(staff_in(&deserialize(&save).unwrap(), cut_off), 0);
    let crowd = save["crowd"].as_object_mut().unwrap();
    crowd.remove("venueStaff").expect("a Modern save marks it");
    let staff = Kind::Shop.staff_size();
    assert_eq!(staff_in(&deserialize(&save).unwrap(), cut_off), staff);
}
