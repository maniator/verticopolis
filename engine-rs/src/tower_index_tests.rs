//! Tests for `tower_index.rs` and the noise memo: every revision-keyed
//! answer equals the walk it replaced, after each kind of layout edit.

use crate::clock::GameMode;
use crate::crowd::spawn::{max_staff_for, pick_x, pick_x_in_segment};
use crate::facilities::Kind;
use crate::housekeeping::HK_MAIDS_PER_UNIT;
use crate::sim::Simulation;
use crate::tower::{Tower, UnitState};

/// `pickX`'s tile list as the walk over every unit builds it.
fn walked_tiles(tower: &Tower, floor: i64) -> Vec<i64> {
    let mut tiles = Vec::new();
    for u in &tower.units {
        if u.kind.is_structural() && u.floor == floor {
            tiles.extend((0..u.width).map(|i| u.x + i));
        }
    }
    tiles
}

fn walked_rooms(tower: &Tower) -> Vec<usize> {
    (0..tower.units.len())
        .filter(|&i| !tower.units[i].kind.is_structural())
        .collect()
}

/// `pickX` and `pickXInSegment` as they were before the index.
fn walked_pick_x(tower: &Tower, floor: i64, seed: i32) -> i64 {
    let tiles = walked_tiles(tower, floor);
    let at = (seed as i64).unsigned_abs() as usize;
    if tiles.is_empty() {
        return 2 + (at % 40) as i64;
    }
    tiles[at % tiles.len()]
}

fn walked_pick_x_in_segment(tower: &Tower, floor: i64, seed: i32, anchor_x: i64) -> i64 {
    let (mut lo, mut hi) = (anchor_x, anchor_x);
    for (start, end) in tower.segments_of(floor) {
        if anchor_x < start {
            break;
        }
        if anchor_x <= end {
            (lo, hi) = (start, end);
            break;
        }
    }
    let tiles: Vec<i64> = walked_tiles(tower, floor)
        .into_iter()
        .filter(|&x| x >= lo && x <= hi)
        .collect();
    if tiles.is_empty() {
        return anchor_x;
    }
    tiles[(seed as i64).unsigned_abs() as usize % tiles.len()]
}

const SEEDS: [i32; 9] = [0, 1, -1, 7, -40, 2654435, 123456789, i32::MAX, i32::MIN];

/// Every floor from below the lot to above the tower, every seed, and
/// every anchor across the span (gaps and the lot's edges included).
fn assert_matches_walks(tower: &Tower) {
    assert_eq!(&*tower.room_index(), walked_rooms(tower).as_slice());
    assert_eq!(tower.room_indices(), walked_rooms(tower));
    let rooms: Vec<i64> = tower.room_units().map(|u| u.id).collect();
    let walked: Vec<i64> = walked_rooms(tower)
        .iter()
        .map(|&i| tower.units[i].id)
        .collect();
    assert_eq!(rooms, walked);
    for floor in -2..=7 {
        let tiles = tower
            .structural_tiles(floor)
            .map_or_else(Vec::new, |t| t.to_vec());
        assert_eq!(tiles, walked_tiles(tower, floor), "floor {floor}");
        for seed in SEEDS {
            assert_eq!(
                pick_x(tower, floor, seed),
                walked_pick_x(tower, floor, seed)
            );
            for anchor in 95..=150 {
                assert_eq!(
                    pick_x_in_segment(tower, floor, seed, anchor),
                    walked_pick_x_in_segment(tower, floor, seed, anchor),
                    "floor {floor}, seed {seed}, anchor {anchor}"
                );
            }
        }
    }
}

fn must(placed: crate::tower::PlaceResult) -> i64 {
    assert!(placed.ok, "{:?}", placed.reason);
    placed.unit_id.unwrap_or(-1)
}

/// A lobby on floor 1 and floor tiles on floors 2 to 4, x 100 to 139.
fn stacked() -> Tower {
    let mut tower = Tower::new();
    let lobby = Kind::Lobby.facility().width;
    for x in (100..140).step_by(lobby as usize) {
        must(tower.place(Kind::Lobby, 1, x));
    }
    for floor in 2..=4 {
        for x in 100..140 {
            must(tower.place(Kind::Floor, floor, x));
        }
    }
    tower
}

#[test]
fn the_indexes_follow_every_layout_edit() {
    let mut tower = stacked();
    assert_matches_walks(&tower);
    // Rooms join the room index, and a shaft moves the revision alone.
    let office = must(tower.place(Kind::Office, 2, 104));
    let food = must(tower.place(Kind::FastFood, 3, 110));
    assert_matches_walks(&tower);
    must(tower.place_transport(Kind::ElevatorStandard, 130, 1, 4));
    assert_matches_walks(&tower);
    // A tile pulled from the top floor splits its run into two segments,
    // and laying it again puts it last in the unit list, out of x order.
    let gap = tower.unit_at(4, 120).map(|u| u.id).unwrap();
    assert!(tower.remove_unit(gap).is_some());
    assert_matches_walks(&tower);
    must(tower.place(Kind::Floor, 4, 120));
    assert_eq!(tower.structural_tiles(4).unwrap().last(), Some(&120));
    assert_matches_walks(&tower);
    // Removing a room, or the first unit, shifts every later position.
    assert!(tower.remove_unit(office).is_some());
    assert_matches_walks(&tower);
    // A swap leaves the unit count as it was: only the revision tells.
    let tile = tower.unit_at(2, 135).map(|u| u.id).unwrap();
    assert!(tower.remove_unit(tile).is_some());
    let office = must(tower.place(Kind::Office, 2, 100));
    assert_matches_walks(&tower);
    assert!(tower.remove_unit(office).is_some());
    assert!(tower.remove_unit(food).is_some());
    let first = tower.units[0].id;
    assert!(tower.remove_unit(first).is_some());
    assert_matches_walks(&tower);
}

#[test]
fn a_reload_rebuilds_the_indexes() {
    let mut tower = stacked();
    must(tower.place(Kind::Office, 3, 120));
    assert_matches_walks(&tower);
    // A load assigns the unit list wholesale and reindexes, which resets
    // every memo, so nothing from the old list can answer for the new one.
    let mut units = tower.units.clone();
    units.retain(|u| u.floor != 3 || u.x < 130);
    tower.units = units;
    tower.reindex();
    assert_matches_walks(&tower);
    // Pin the reset itself: with the memo full, a list that keeps its count
    // but reorders a room and a tile only reads right after `reindex`.
    let room = tower.room_index()[0];
    let tile = (0..tower.units.len())
        .find(|&i| tower.units[i].kind.is_structural() && tower.units[i].floor == 3)
        .unwrap();
    let (count, revision) = (tower.units.len(), tower.revision);
    tower.units.swap(room, tile);
    assert_eq!((tower.units.len(), tower.revision), (count, revision));
    tower.reindex();
    assert_matches_walks(&tower);
    // The real save round trip answers like a fresh walk of what it loaded.
    let mut sim = Simulation::new_game(7, GameMode::Classic);
    sim.tower = tower;
    assert_matches_walks(&sim.tower);
    let loaded = crate::load::deserialize(&sim.serialize()).expect("the save loads");
    assert_eq!(loaded.tower.units.len(), sim.tower.units.len());
    assert_matches_walks(&loaded.tower);
}

#[test]
fn a_list_changed_behind_the_revision_rebuilds_rather_than_overruns() {
    // `units` is public: a list cut without a bump or a reindex must not
    // index past its end. The unit count in the key catches it, as it does
    // for `roomUnits` in TypeScript.
    let mut tower = stacked();
    must(tower.place(Kind::Office, 2, 104));
    assert_matches_walks(&tower);
    let revision = tower.revision;
    tower.units.truncate(tower.units.len() - 1);
    assert_eq!(tower.revision, revision);
    assert_matches_walks(&tower);
    // A cut structural tile: the tile index must drop it too, which only
    // the count in its key can tell.
    let last = tower.units.last().unwrap();
    assert!(last.kind.is_structural());
    let floor = last.floor;
    assert!(tower.structural_tiles(floor).unwrap().contains(&last.x));
    tower.units.truncate(tower.units.len() - 1);
    assert_eq!(tower.revision, revision);
    assert_matches_walks(&tower);
}

/// `maxStaffFor` as the walk over every unit counted it.
fn walked_staff_ceiling(tower: &Tower) -> i64 {
    let crews = tower
        .units
        .iter()
        .filter(|u| u.kind == Kind::Housekeeping)
        .count() as i64;
    crews * HK_MAIDS_PER_UNIT
}

fn assert_ceiling(tower: &Tower, crews: i64) {
    assert_eq!(walked_staff_ceiling(tower), crews * HK_MAIDS_PER_UNIT);
    assert_eq!(max_staff_for(tower), crews * HK_MAIDS_PER_UNIT);
    // The second read is a memo hit and must give the same answer.
    assert_eq!(max_staff_for(tower), crews * HK_MAIDS_PER_UNIT);
}

#[test]
fn the_staff_ceiling_follows_every_crew_edit() {
    let mut tower = stacked();
    assert_ceiling(&tower, 0);
    let first = must(tower.place(Kind::Housekeeping, 2, 100));
    assert_ceiling(&tower, 1);
    let second = must(tower.place(Kind::Housekeeping, 3, 100));
    assert_ceiling(&tower, 2);
    // Other edits move the revision and leave the count as it is.
    must(tower.place(Kind::Office, 2, 120));
    must(tower.place_transport(Kind::ElevatorStandard, 130, 1, 4));
    assert_ceiling(&tower, 2);
    assert!(tower.remove_unit(first).is_some());
    assert_ceiling(&tower, 1);
    // A swap that keeps the unit count: a crew goes and a tile comes, with
    // no read in between, so only the revision tells.
    let count = tower.units.len();
    assert!(tower.remove_unit(second).is_some());
    must(tower.place(Kind::Floor, 5, 100));
    assert_eq!(tower.units.len(), count);
    assert_ceiling(&tower, 0);
    // Unit state is not an input: a crew under construction or gutted by a
    // fire still counts, as `maxStaffFor` counts every housekeeping unit. A
    // state change keeps the memo, and a rebuild in each state counts the
    // same.
    let crew = must(tower.place(Kind::Housekeeping, 4, 100));
    assert_ceiling(&tower, 1);
    for state in [UnitState::Construction, UnitState::Gutted, UnitState::Fire] {
        tower.get_unit_mut(crew).unwrap().state = state;
        assert_ceiling(&tower, 1);
        tower.reindex();
        assert_ceiling(&tower, 1);
    }
}

#[test]
fn a_reload_recounts_the_staff_ceiling() {
    let mut sim = Simulation::new_game(7, GameMode::Classic);
    sim.tower = stacked();
    must(sim.tower.place(Kind::Housekeeping, 2, 100));
    must(sim.tower.place(Kind::Housekeeping, 3, 100));
    assert_ceiling(&sim.tower, 2);
    let loaded = crate::load::deserialize(&sim.serialize()).expect("the save loads");
    assert_ceiling(&loaded.tower, 2);
    // Pin the reset itself: a list assigned wholesale, as a load does, with
    // one crew fewer but the same unit count and revision, still reads the
    // memo's old answer until `reindex` resets it.
    let mut units = sim.tower.units.clone();
    let floor_three = units
        .iter()
        .position(|u| u.kind == Kind::Housekeeping && u.floor == 3)
        .unwrap();
    units[floor_three].kind = Kind::Security;
    let (count, revision) = (sim.tower.units.len(), sim.tower.revision);
    sim.tower.units = units;
    assert_eq!(
        (sim.tower.units.len(), sim.tower.revision),
        (count, revision)
    );
    assert_eq!(walked_staff_ceiling(&sim.tower), HK_MAIDS_PER_UNIT);
    assert_eq!(max_staff_for(&sim.tower), 2 * HK_MAIDS_PER_UNIT);
    sim.tower.reindex();
    assert_ceiling(&sim.tower, 1);
}

/// Every unit's memoized noise answer equals a fresh scan.
fn assert_noise_parity(sim: &mut Simulation) {
    for i in 0..sim.tower.units.len() {
        let u = sim.tower.units[i].clone();
        let fresh = sim.noise_afflicted_fresh(&u);
        assert_eq!(sim.noise_afflicted(&u), fresh, "unit {}", u.id);
    }
}

fn afflicted(sim: &mut Simulation, id: i64) -> bool {
    let u = sim.tower.get_unit(id).unwrap().clone();
    sim.noise_afflicted(&u)
}

#[test]
fn the_noise_memo_matches_the_fresh_scan_after_every_edit() {
    let mut sim = Simulation::new_game(7, GameMode::Classic);
    sim.tower = stacked();
    let office = must(sim.tower.place(Kind::Office, 3, 100));
    let width = Kind::Office.facility().width;
    assert_noise_parity(&mut sim);
    assert!(!afflicted(&mut sim, office));
    // A shared wall with a commercial room is the harshest case.
    let food = must(sim.tower.place(Kind::FastFood, 3, 100 + width));
    assert_noise_parity(&mut sim);
    assert!(afflicted(&mut sim, office));
    // Demolition heals it with no manual invalidation: the removal moves
    // the revision and the next query refills from the scan.
    assert!(sim.tower.remove_unit(food).is_some());
    assert_noise_parity(&mut sim);
    assert!(!afflicted(&mut sim, office));
    // The other branch: a condo hears an office as well as a shop.
    let condo = must(sim.tower.place(Kind::Condo, 2, 100));
    assert_noise_parity(&mut sim);
    assert!(!afflicted(&mut sim, condo));
    let next = 100 + Kind::Condo.facility().width;
    must(sim.tower.place(Kind::Office, 2, next));
    assert_noise_parity(&mut sim);
    assert!(afflicted(&mut sim, condo));
}

#[test]
fn the_noise_memo_follows_a_swap_that_keeps_the_unit_count() {
    // The shop goes and a tile comes, with no query in between, so only the
    // revision moves. A memo keyed on the unit count would still hear it.
    let mut sim = Simulation::new_game(7, GameMode::Classic);
    sim.tower = stacked();
    let office = must(sim.tower.place(Kind::Office, 3, 100));
    let width = Kind::Office.facility().width;
    let food = must(sim.tower.place(Kind::FastFood, 3, 100 + width));
    assert!(afflicted(&mut sim, office));
    let count = sim.tower.units.len();
    assert!(sim.tower.remove_unit(food).is_some());
    must(sim.tower.place(Kind::Floor, 5, 100));
    assert_eq!(sim.tower.units.len(), count);
    assert!(!afflicted(&mut sim, office));
    assert_noise_parity(&mut sim);
}

#[test]
fn unit_state_is_not_an_input_to_the_noise_memo() {
    // The memo is filled first, then states change without moving the
    // revision. If the scan read state, the memo would now disagree with it.
    let mut sim = Simulation::new_game(7, GameMode::Classic);
    sim.tower = stacked();
    let office = must(sim.tower.place(Kind::Office, 3, 100));
    let width = Kind::Office.facility().width;
    let food = must(sim.tower.place(Kind::FastFood, 3, 100 + width));
    assert_noise_parity(&mut sim);
    assert!(afflicted(&mut sim, office));
    let revision = sim.tower.revision;
    for state in [UnitState::Empty, UnitState::Gutted, UnitState::Occupied] {
        sim.tower.get_unit_mut(food).unwrap().state = state;
        sim.tower.get_unit_mut(office).unwrap().state = state;
        assert_eq!(sim.tower.revision, revision);
        assert_noise_parity(&mut sim);
        assert!(afflicted(&mut sim, office), "{state:?}");
    }
}
