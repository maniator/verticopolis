//! Native tests for the housekeeping dispatch order on a scripted tower with
//! a split staff network (#1143 item 6): the per-floor crew orders against the
//! per-room sort they replace, the order each mode sends crews in, the orders
//! kept between passes, and the staff-connectivity memo across a revision.

use std::collections::HashMap;

use super::{CrewOrders, Housekeeping, HK_MAIDS_PER_UNIT};
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

fn put(sim: &mut Simulation, kind: Kind, floor: i64, x: i64) -> i64 {
    let r = sim.build(kind, floor, x);
    assert!(r.ok, "{kind:?} at {floor},{x}: {:?}", r.reason);
    sim.tower.unit_at(floor, x).expect("a unit there").id
}

fn shaft(sim: &mut Simulation, kind: Kind, x: i64, bottom: i64, top: i64) {
    let r = sim.build_transport(kind, x, bottom, top);
    assert!(r.ok, "{kind:?} {bottom}-{top} at {x}: {:?}", r.reason);
}

/// Floors 2 to 9. A service elevator joins floors 2 to 5 and another joins 6
/// to 8; floor 9 has no staff link. Crews stand on floors 2, 4 and 6, built
/// floor 4 first so that id order and floor order differ. Returns the tower
/// and the crew ids, low floor first.
fn split_hotel(mode: GameMode) -> (Simulation, [i64; 3]) {
    let mut sim = Simulation::new_game(11, mode);
    sim.money = 1.0e9;
    sim.star = 5;
    for x in 150..230 {
        put(&mut sim, Kind::Lobby, 1, x);
    }
    for fl in 2..=9 {
        for x in 151..229 {
            put(&mut sim, Kind::Floor, fl, x);
        }
    }
    shaft(&mut sim, Kind::ElevatorService, 152, 2, 5);
    shaft(&mut sim, Kind::ElevatorService, 156, 6, 8);
    let [c4, c2, c6] = [4, 2, 6].map(|fl| put(&mut sim, Kind::Housekeeping, fl, 200));
    for id in [c4, c2, c6] {
        sim.tower.get_unit_mut(id).unwrap().state = UnitState::Empty;
    }
    (sim, [c2, c4, c6])
}

#[test]
fn each_floor_order_matches_the_per_room_sort_it_replaces() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let (sim, [c2, c4, c6]) = split_hotel(mode);
        let (crews, _) = sim.housekeeping.crews_and_rooms(&sim.tower);
        let ids: Vec<i64> = crews.iter().map(|c| c.0).collect();
        assert_eq!(ids, [c4, c2, c6], "tower order");
        assert!(c4 < c2, "the floor-4 crew has the lower id");
        let modern = mode == GameMode::Modern;
        let mut orders = CrewOrders::new(&sim.tower, modern, crews.clone());
        for floor in -1..=10 {
            // What dispatch did for every room: clone, sort in Modern, then
            // skip each crew the staff network does not connect.
            let mut per_room = crews.clone();
            if modern {
                per_room.sort_by(|c1, c2| {
                    ((c1.1 - floor).abs())
                        .cmp(&(c2.1 - floor).abs())
                        .then(c1.0.cmp(&c2.0))
                });
            }
            per_room.retain(|c| sim.tower.staff_connected(c.1, floor));
            let nearest = per_room.iter().map(|c| (c.1 - floor).abs()).min();
            let order = orders.for_floor(&sim.tower, floor);
            assert_eq!(order, &per_room[..], "{mode:?} floor {floor}");
            if modern {
                let head = order.first().map(|c| (c.1 - floor).abs());
                assert_eq!(head, nearest, "floor {floor}");
            }
        }
    }
}

/// Sets the clock an hour into the shift, when dispatch may start rooms.
fn in_shift(sim: &mut Simulation) {
    let start = sim.mode.housekeeping_shift().start as f64;
    sim.clock.minutes = (start + 1.0) * 60.0;
}

fn dirty(sim: &mut Simulation, room: i64) {
    let u = sim.tower.get_unit_mut(room).unwrap();
    u.state = UnitState::Dirty;
    u.dirty_days = Some(0);
}

/// The crews and rooms the room walk finds are the ones the two walks over
/// every unit found before it, in the same order.
fn assert_walk_matches_units(sim: &Simulation) {
    let crews: Vec<_> = sim
        .tower
        .units
        .iter()
        .filter(|u| u.kind == Kind::Housekeeping && u.is_operational())
        .map(|u| (u.id, u.floor, u.x, u.width))
        .collect();
    let rooms: Vec<_> = sim
        .tower
        .units
        .iter()
        .filter(|u| {
            u.kind.is_hotel()
                && u.state == UnitState::Dirty
                && !sim.housekeeping.assigned_room.contains_key(&u.id)
        })
        .map(|u| (u.id, u.floor, u.x, u.width, u.dirty_days.unwrap_or(0)))
        .collect();
    assert_eq!(sim.housekeeping.crews_and_rooms(&sim.tower), (crews, rooms));
}

/// Dirty rooms: two on floor 5 (the second dirtier), one on floor 3, one on
/// floor 7, one on floor 8 (dirtier than the plain ones) and one on floor 9.
/// The floor-6 crew has one maid left. Returns the assignments as room id ->
/// crew id.
fn dispatch_once(mode: GameMode) -> (Simulation, HashMap<i64, i64>, [i64; 3], [i64; 6]) {
    let (mut sim, crews) = split_hotel(mode);
    let rooms = [(5, 170), (5, 180), (3, 170), (7, 170), (8, 170), (9, 170)]
        .map(|(fl, x)| put(&mut sim, Kind::HotelSingle, fl, x));
    let dirt = [0, 2, 0, 0, 1, 0];
    for (id, days) in rooms.iter().zip(dirt) {
        let u = sim.tower.get_unit_mut(*id).unwrap();
        u.state = UnitState::Dirty;
        u.dirty_days = Some(days);
    }
    sim.housekeeping = Housekeeping::default();
    sim.housekeeping
        .maids_out
        .insert(crews[2], HK_MAIDS_PER_UNIT - 1);
    assert_walk_matches_units(&sim);
    in_shift(&mut sim);
    sim.dispatch_housekeepers();
    let sent = sim
        .housekeeping
        .assigned_room
        .iter()
        .map(|(room, (crew, _))| (*room, *crew))
        .collect();
    (sim, sent, crews, rooms)
}

fn nudged_once(sim: &Simulation) -> bool {
    sim.log
        .iter()
        .filter(|e| e.text.contains("can't reach 1 dirty room"))
        .count()
        == 1
}

#[test]
fn modern_sends_the_nearest_connected_crew_to_the_most_urgent_room() {
    let (sim, sent, [c2, c4, c6], [r5, r5_dirtier, r3, r7, r8, r9]) =
        dispatch_once(GameMode::Modern);
    // The dirtier floor-5 room goes first and takes the nearest crew; floor 5
    // is then busy for that crew, so the other room takes the next one.
    assert_eq!(sent.get(&r5_dirtier), Some(&c4));
    assert_eq!(sent.get(&r5), Some(&c2));
    // Two crews a floor away: the lower id wins the tie, though its floor is
    // the higher one.
    assert_eq!(sent.get(&r3), Some(&c4));
    // Only the floor-6 crew reaches floors 7 and 8, and it has one maid left:
    // the dirtier floor-8 room outranks floor 7 and takes her.
    assert_eq!(sent.get(&r8), Some(&c6));
    assert_eq!(sent.get(&r7), None);
    assert_eq!(sent.get(&r9), None);
    assert_eq!(sent.len(), 4);
    // Floor 7 waits on a busy crew; only floor 9 counts as unreachable.
    assert!(nudged_once(&sim));
}

#[test]
fn classic_tries_the_connected_crews_in_tower_order() {
    let (sim, sent, [c2, c4, c6], [r5, r5_dirtier, r3, r7, r8, r9]) =
        dispatch_once(GameMode::Classic);
    // Rooms in tower order, crews in tower order (floor 4 first): the first
    // floor-5 room takes the floor-4 crew, which leaves floor 5 to the
    // floor-2 crew.
    assert_eq!(sent.get(&r5), Some(&c4));
    assert_eq!(sent.get(&r5_dirtier), Some(&c2));
    assert_eq!(sent.get(&r3), Some(&c4));
    // Floor 7 comes before floor 8 in tower order and takes the last maid.
    assert_eq!(sent.get(&r7), Some(&c6));
    assert_eq!(sent.get(&r8), None);
    assert_eq!(sent.get(&r9), None);
    assert_eq!(sent.len(), 4);
    assert!(nudged_once(&sim));
}

#[test]
fn a_crew_cleans_its_own_floor_with_no_staff_link() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let mut sim = Simulation::new_game(11, mode);
        sim.money = 1.0e9;
        sim.star = 5;
        for x in 150..230 {
            put(&mut sim, Kind::Lobby, 1, x);
        }
        for x in 151..229 {
            put(&mut sim, Kind::Floor, 2, x);
        }
        let crew = put(&mut sim, Kind::Housekeeping, 2, 200);
        sim.tower.get_unit_mut(crew).unwrap().state = UnitState::Empty;
        let room = put(&mut sim, Kind::HotelSingle, 2, 170);
        dirty(&mut sim, room);
        assert_eq!(sim.tower.staff_component(2), None, "no staff transport");
        in_shift(&mut sim);
        sim.dispatch_housekeepers();
        let sent = sim.housekeeping.assigned_room.get(&room).map(|a| a.0);
        assert_eq!(sent, Some(crew), "{mode:?}");
        assert!(
            !sim.log.iter().any(|e| e.text.contains("can't reach")),
            "{mode:?}"
        );
    }
}

#[test]
fn a_room_off_the_crews_network_counts_as_unreachable() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let (mut sim, _) = split_hotel(mode);
        // Floor 3 in two runs: the service elevator lands on the left one, so
        // floor 3 is staff-connected while its right run is not.
        for x in 190..196 {
            let id = sim.tower.unit_at(3, x).expect("a floor tile").id;
            assert!(sim.tower.remove_unit(id).is_some());
        }
        let room = put(&mut sim, Kind::HotelSingle, 3, 210);
        dirty(&mut sim, room);
        assert!(sim.tower.staff_connected(2, 3) && sim.tower.staff_connected(4, 3));
        in_shift(&mut sim);
        sim.dispatch_housekeepers();
        assert!(sim.housekeeping.assigned_room.is_empty(), "{mode:?}");
        assert!(nudged_once(&sim), "{mode:?}");
    }
}

#[test]
fn crew_orders_follow_the_crews_and_the_tower_between_passes() {
    let (mut sim, [c2, c4, c6]) = split_hotel(GameMode::Modern);
    let r3 = put(&mut sim, Kind::HotelSingle, 3, 170);
    let r9 = put(&mut sim, Kind::HotelSingle, 9, 170);
    let pass = |sim: &mut Simulation| {
        for room in [r3, r9] {
            dirty(sim, room);
        }
        sim.housekeeping.reset_shift();
        assert_walk_matches_units(sim);
        in_shift(sim);
        sim.dispatch_housekeepers();
        let crew_of = |room| sim.housekeeping.assigned_room.get(&room).map(|a| a.0);
        (crew_of(r3), crew_of(r9))
    };
    assert_eq!(pass(&mut sim), (Some(c4), None));
    let kept = sim.housekeeping.crew_orders.as_mut().expect("kept");
    assert_eq!(kept.revision, sim.tower.revision);
    assert!(kept.holds(&sim.tower, true, &kept.crews));
    assert!(
        !kept.holds(&sim.tower, false, &kept.crews),
        "the mode is in the key"
    );
    // Floor 7 has no dirty room, so a marker there shows the orders were
    // reused rather than rebuilt.
    kept.by_floor.insert(7, Vec::new());
    let marked = |sim: &Simulation| {
        let kept = sim.housekeeping.crew_orders.as_ref().expect("kept");
        kept.by_floor.get(&7).is_some()
    };
    assert_eq!(pass(&mut sim), (Some(c4), None));
    assert!(marked(&sim), "nothing changed, so the orders were reused");
    // Stairs from 8 to 9 bring floor 9 onto the floor-6 crew's network: a
    // new revision with the same crews.
    shaft(&mut sim, Kind::Stairs, 210, 8, 9);
    assert_eq!(pass(&mut sim), (Some(c4), Some(c6)));
    assert!(!marked(&sim), "a new revision rebuilds the orders");
    // A fire takes the floor-4 crew out without a new revision.
    sim.tower.get_unit_mut(c4).unwrap().state = UnitState::Fire;
    assert_eq!(pass(&mut sim), (Some(c2), Some(c6)));
    let loaded = crate::load::deserialize(&sim.serialize()).expect("a save loads");
    assert!(
        loaded.housekeeping.crew_orders.is_none(),
        "a load starts fresh"
    );
}

#[test]
fn staff_connectivity_follows_the_network_after_a_build() {
    let (mut sim, _) = split_hotel(GameMode::Modern);
    let comp_of = |sim: &Simulation, floors: std::ops::RangeInclusive<i64>| {
        floors
            .map(|f| sim.tower.staff_component(f))
            .collect::<Vec<_>>()
    };
    let low = sim.tower.staff_component(2).expect("floor 2 is served");
    let high = sim.tower.staff_component(6).expect("floor 6 is served");
    assert_ne!(low, high);
    assert_eq!(comp_of(&sim, 2..=5), vec![Some(low); 4]);
    assert_eq!(comp_of(&sim, 6..=8), vec![Some(high); 3]);
    for f in [-1, 0, 1, 9, 10] {
        assert_eq!(sim.tower.staff_component(f), None, "floor {f}");
    }
    assert!(sim.tower.staff_connected(2, 5));
    assert!(!sim.tower.staff_connected(2, 7));
    assert!(sim.tower.staff_connected(9, 9), "a floor reaches itself");
    assert!(!sim.tower.staff_connected(9, 2));
    // Stairs from 5 to 6 join the two networks under a new revision.
    shaft(&mut sim, Kind::Stairs, 170, 5, 6);
    let joined = sim.tower.staff_component(2).expect("floor 2 is served");
    assert_eq!(comp_of(&sim, 2..=8), vec![Some(joined); 7]);
    for f in [-1, 0, 1, 9, 10] {
        assert_eq!(sim.tower.staff_component(f), None, "floor {f}");
    }
    assert!(sim.tower.staff_connected(2, 7));
    assert!(sim.tower.staff_connected(8, 3));
    assert!(!sim.tower.staff_connected(9, 2));
    let comps = sim.tower.staff_components();
    for a in -1..=10 {
        assert_eq!(sim.tower.staff_component(a), comps.get(&a).copied());
        for b in -1..=10 {
            let same = a == b || comps.get(&a).is_some_and(|ca| comps.get(&b) == Some(ca));
            assert_eq!(sim.tower.staff_connected(a, b), same, "{a} -> {b}");
        }
    }
}
