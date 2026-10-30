//! Tests for #1237: the reads under the panel getters (operational counts,
//! floor bounds, the served-floor test and the parking flood) answer from
//! the room index and revision-keyed memos exactly as the walks over every
//! unit did, after each kind of layout edit and in every unit state.

use std::collections::HashSet;

use crate::clock::GameMode;
use crate::facilities::{Kind, FACILITIES};
use crate::sim::Simulation;
use crate::tower::{Tower, Unit, UnitState};

pub(super) const STATES: [UnitState; 10] = [
    UnitState::Construction,
    UnitState::Empty,
    UnitState::Occupied,
    UnitState::MovingIn,
    UnitState::Vacating,
    UnitState::Asleep,
    UnitState::Dirty,
    UnitState::Infested,
    UnitState::Fire,
    UnitState::Gutted,
];

pub(super) fn must(placed: crate::tower::PlaceResult) -> i64 {
    assert!(placed.ok, "{:?}", placed.reason);
    placed.unit_id.unwrap_or(-1)
}

#[test]
fn the_state_list_names_every_state() {
    // A new state breaks this match, which points back at STATES, so the
    // "every state" loops in these tests can't quietly skip one.
    for state in STATES {
        match state {
            UnitState::Construction
            | UnitState::Empty
            | UnitState::Occupied
            | UnitState::MovingIn
            | UnitState::Vacating
            | UnitState::Asleep
            | UnitState::Dirty
            | UnitState::Infested
            | UnitState::Fire
            | UnitState::Gutted => {}
        }
    }
    let mut distinct = STATES.to_vec();
    distinct.dedup();
    assert_eq!(distinct.len(), STATES.len());
}

/// A lobby on floor 1, floor tiles on floors 2 to 4 and on basement floors
/// 0 and -1, x 100 to 179.
pub(super) fn stacked() -> Tower {
    let mut tower = Tower::new();
    let lobby = Kind::Lobby.facility().width;
    for x in (100..180).step_by(lobby as usize) {
        must(tower.place(Kind::Lobby, 1, x));
    }
    for floor in [2, 3, 4, 0, -1] {
        for x in 100..180 {
            must(tower.place(Kind::Floor, floor, x));
        }
    }
    tower
}

pub(super) fn game(tower: Tower) -> Simulation {
    let mut sim = Simulation::new_game(7, GameMode::Classic);
    sim.tower = tower;
    sim
}

/// `highest_floor` and `lowest_floor` as they walked every unit.
fn walked_bounds(tower: &Tower) -> (i64, i64) {
    let lo = tower.units.iter().map(|u| u.floor).fold(1, i64::min);
    let hi = tower.units.iter().map(|u| u.floor).fold(1, i64::max);
    (lo, hi)
}

fn assert_bounds(sim: &Simulation, expected: (i64, i64)) {
    assert_eq!(walked_bounds(&sim.tower), expected);
    assert_eq!(sim.tower.floor_bounds(), expected);
    // The second read is a memo hit and must give the same answer.
    assert_eq!((sim.lowest_floor(), sim.highest_floor()), expected);
}

#[test]
fn the_floor_bounds_follow_every_layout_edit() {
    // An empty tower reads the ground floor both ways, as `floorBounds` does.
    assert_eq!(Tower::new().floor_bounds(), (1, 1));
    let mut sim = game(stacked());
    assert_bounds(&sim, (-1, 4));
    let top = must(sim.tower.place(Kind::Floor, 5, 100));
    assert_bounds(&sim, (-1, 5));
    // A room or a shaft moves the revision and leaves the bounds alone.
    must(sim.tower.place(Kind::Office, 2, 104));
    must(sim.tower.place_transport(Kind::ElevatorStandard, 170, 1, 4));
    assert_bounds(&sim, (-1, 5));
    assert!(sim.tower.remove_unit(top).is_some());
    assert_bounds(&sim, (-1, 4));
    // A swap that keeps the unit count: the deepest tile goes and a top
    // tile comes, with no read in between, so only the revision tells.
    let deep: Vec<i64> = sim
        .tower
        .units
        .iter()
        .filter(|u| u.floor == -1)
        .map(|u| u.id)
        .collect();
    for id in &deep[1..] {
        assert!(sim.tower.remove_unit(*id).is_some());
    }
    assert_bounds(&sim, (-1, 4));
    let count = sim.tower.units.len();
    assert!(sim.tower.remove_unit(deep[0]).is_some());
    must(sim.tower.place(Kind::Floor, 5, 100));
    assert_eq!(sim.tower.units.len(), count);
    assert_bounds(&sim, (0, 5));
}

#[test]
fn a_reload_rebuilds_the_floor_bounds() {
    let mut sim = game(stacked());
    must(sim.tower.place(Kind::Floor, 5, 100));
    assert_bounds(&sim, (-1, 5));
    let loaded = crate::load::deserialize(&sim.serialize()).expect("the save loads");
    assert_bounds(&loaded, (-1, 5));
    // Pin the reset itself: a list assigned wholesale, as a load does, with
    // the top tile gone but the same unit count and revision, still reads
    // the memo's old answer until `reindex` resets it.
    let mut units = sim.tower.units.clone();
    let top = units.iter().position(|u| u.floor == 5).unwrap();
    units[top].floor = 4;
    let (count, revision) = (sim.tower.units.len(), sim.tower.revision);
    sim.tower.units = units;
    assert_eq!(
        (sim.tower.units.len(), sim.tower.revision),
        (count, revision)
    );
    assert_eq!(walked_bounds(&sim.tower), (-1, 4));
    assert_eq!(sim.tower.floor_bounds(), (-1, 5));
    sim.tower.reindex();
    assert_bounds(&sim, (-1, 4));
}

/// The operational and kind checks for every kind in the catalog, against
/// the walks over every unit they replaced.
fn assert_kind_checks(sim: &Simulation) {
    for kind in FACILITIES.iter().map(|f| f.kind) {
        let count = sim
            .tower
            .units
            .iter()
            .filter(|u| u.kind == kind && u.is_operational())
            .count() as i64;
        let any = sim.tower.units.iter().any(|u| u.kind == kind);
        assert_eq!(sim.count_operational(kind), count, "{kind:?}");
        assert_eq!(sim.has_operational(kind), count > 0, "{kind:?}");
        assert_eq!(sim.has_any(kind), any, "{kind:?}");
    }
}

#[test]
fn the_kind_checks_match_the_full_walk() {
    let mut sim = game(stacked());
    assert_kind_checks(&sim);
    let security = must(sim.tower.place(Kind::Security, 2, 100));
    let medical = must(sim.tower.place(Kind::Medical, 2, 120));
    let recycling = must(sim.tower.place(Kind::Recycling, -1, 100));
    let suite = must(sim.tower.place(Kind::HotelSuite, 4, 100));
    must(sim.tower.place(Kind::HotelSuite, 4, 110));
    must(sim.tower.place(Kind::Office, 3, 130));
    assert_kind_checks(&sim);
    // The index lists rooms and their state is read live, so every state of
    // every room reads like the walk without a revision change.
    for id in [security, medical, recycling, suite] {
        for state in STATES {
            sim.tower.get_unit_mut(id).unwrap().state = state;
            assert_kind_checks(&sim);
        }
    }
    // A tile kind still walks every unit, tiles in every state included.
    let tile = sim.tower.unit_at(2, 170).map(|u| u.id).unwrap();
    for state in STATES {
        sim.tower.get_unit_mut(tile).unwrap().state = state;
        assert_kind_checks(&sim);
    }
    // Removals, a swap that keeps the count, and a reload.
    assert!(sim.tower.remove_unit(security).is_some());
    assert_kind_checks(&sim);
    let count = sim.tower.units.len();
    assert!(sim.tower.remove_unit(medical).is_some());
    must(sim.tower.place(Kind::Floor, 5, 100));
    assert_eq!(sim.tower.units.len(), count);
    assert_kind_checks(&sim);
    let loaded = crate::load::deserialize(&sim.serialize()).expect("the save loads");
    assert_kind_checks(&loaded);
}

/// Every floor's answer, read through `is_floor_served` before the set
/// clone when `fresh` is set, so the in-place read also fills the memo.
fn assert_served(tower: &Tower, served: &[i64], fresh: bool) {
    let floors = -2..=8;
    let asked: Vec<bool> = if fresh {
        floors.clone().map(|f| tower.is_floor_served(f)).collect()
    } else {
        Vec::new()
    };
    let set = tower.served_floors();
    let mut sorted: Vec<i64> = set.iter().copied().collect();
    sorted.sort_unstable();
    assert_eq!(sorted, served);
    for (k, f) in floors.enumerate() {
        let expected = f == 1 || set.contains(&f);
        assert_eq!(tower.is_floor_served(f), expected, "floor {f}");
        if fresh {
            assert_eq!(asked[k], expected, "floor {f}, first read");
        }
    }
}

#[test]
fn is_floor_served_follows_every_shaft_edit() {
    let mut tower = stacked();
    assert_served(&tower, &[1], true);
    let lift = must(tower.place_transport(Kind::ElevatorStandard, 170, 1, 4));
    assert_served(&tower, &[1, 2, 3, 4], true);
    // A shaft that never reaches a served floor adds nothing.
    let stairs = must(tower.place_transport(Kind::Stairs, 160, -1, 0));
    assert_served(&tower, &[1, 2, 3, 4], false);
    assert!(tower.remove_transport(lift).is_some());
    assert_served(&tower, &[1], true);
    assert!(tower.remove_transport(stairs).is_some());
    must(tower.place_transport(Kind::ElevatorStandard, 170, -1, 3));
    assert_served(&tower, &[-1, 0, 1, 2, 3], false);
    // A reload answers like the tower it came from.
    let mut sim = game(tower);
    sim.tower.reindex();
    assert_served(&sim.tower, &[-1, 0, 1, 2, 3], true);
    let loaded = crate::load::deserialize(&sim.serialize()).expect("the save loads");
    assert_served(&loaded.tower, &[-1, 0, 1, 2, 3], true);
}

/// `functionalParkingSet` as it seeded from every unit.
fn walked_parking(tower: &Tower) -> HashSet<i64> {
    let usable = |u: Option<&Unit>| {
        u.is_some_and(|u| matches!(u.kind, Kind::Parking | Kind::ParkingRamp) && u.is_operational())
    };
    let mut stack: Vec<(i64, i64)> = Vec::new();
    for u in &tower.units {
        if u.kind == Kind::ParkingRamp && u.is_operational() {
            for i in 0..u.width {
                stack.push((u.floor, u.x + i));
            }
        }
    }
    let mut visited: HashSet<(i64, i64)> = HashSet::new();
    let mut reached: HashSet<i64> = HashSet::new();
    while let Some((f, x)) = stack.pop() {
        if !visited.insert((f, x)) {
            continue;
        }
        let u = tower.room_at(f, x);
        if !usable(u) {
            continue;
        }
        let u = u.unwrap();
        if u.kind == Kind::Parking {
            reached.insert(u.id);
        }
        stack.push((f, x - 1));
        stack.push((f, x + 1));
        if u.kind == Kind::ParkingRamp {
            stack.push((f - 1, x));
            stack.push((f + 1, x));
        }
    }
    reached
}

fn assert_parking(tower: &Tower, spaces: usize) {
    let walked = walked_parking(tower);
    assert_eq!(walked.len(), spaces);
    assert_eq!(tower.functional_parking_set(), walked);
    assert_eq!(tower.functional_parking_spots(), spaces as i64);
}

#[test]
fn the_parking_flood_seeds_from_the_ramps_alone() {
    let mut tower = stacked();
    assert_parking(&tower, 0);
    let ramp = must(tower.place(Kind::ParkingRamp, 0, 100));
    let width = Kind::ParkingRamp.facility().width;
    let space = Kind::Parking.facility().width;
    must(tower.place(Kind::Parking, 0, 100 + width));
    must(tower.place(Kind::Parking, 0, 100 + width + space));
    // A space cut off from every ramp is not functional.
    must(tower.place(Kind::Parking, 0, 170));
    assert_parking(&tower, 2);
    // A second ramp below joins the lower floor's spaces to the flood.
    let lower = must(tower.place(Kind::ParkingRamp, -1, 100));
    must(tower.place(Kind::Parking, -1, 100 + width));
    assert_parking(&tower, 3);
    // A ramp that is not operational seeds nothing and carries nothing.
    for state in STATES {
        tower.get_unit_mut(ramp).unwrap().state = state;
        let expected = if tower.get_unit(ramp).unwrap().is_operational() {
            3
        } else {
            1
        };
        assert_parking(&tower, expected);
    }
    tower.get_unit_mut(ramp).unwrap().state = UnitState::Occupied;
    assert_parking(&tower, 3);
    // A swap that keeps the unit count: a tile goes and a space joins the
    // lower floor's run, with no read in between, so only the revision tells.
    let count = tower.units.len();
    let tile = tower.unit_at(2, 179).map(|u| u.id).unwrap();
    assert!(tower.remove_unit(tile).is_some());
    must(tower.place(Kind::Parking, -1, 100 + width + space));
    assert_eq!(tower.units.len(), count);
    assert_parking(&tower, 4);
    // Without the lower ramp its floor's spaces are cut off again.
    assert!(tower.remove_unit(lower).is_some());
    assert_parking(&tower, 2);
    tower.reindex();
    assert_parking(&tower, 2);
    let sim = game(tower);
    let loaded = crate::load::deserialize(&sim.serialize()).expect("the save loads");
    assert_parking(&loaded.tower, 2);
}
