//! Tests for `tower_index.rs` and the noise memo: every revision-keyed
//! answer equals the walk it replaced, after each kind of layout edit.

use crate::clock::GameMode;
use crate::crowd::spawn::{pick_x, pick_x_in_segment};
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::Tower;

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
        let tiles = tower.structural_tiles(floor).to_vec();
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
    assert_eq!(tower.structural_tiles(4).last(), Some(&120));
    assert_matches_walks(&tower);
    // Removing a room, or the first unit, shifts every later position.
    assert!(tower.remove_unit(office).is_some());
    assert_matches_walks(&tower);
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
}

#[test]
fn the_noise_memo_matches_the_fresh_scan_after_every_edit() {
    let mut sim = Simulation::new_game(7, GameMode::Classic);
    sim.tower = stacked();
    let parity = |sim: &mut Simulation| {
        for i in 0..sim.tower.units.len() {
            let u = sim.tower.units[i].clone();
            let fresh = sim.noise_afflicted_fresh(&u);
            assert_eq!(sim.noise_afflicted(&u), fresh, "unit {}", u.id);
        }
    };
    let office = must(sim.tower.place(Kind::Office, 3, 100));
    let width = Kind::Office.facility().width;
    parity(&mut sim);
    let afflicted = |sim: &mut Simulation, id: i64| {
        let u = sim.tower.get_unit(id).unwrap().clone();
        sim.noise_afflicted(&u)
    };
    assert!(!afflicted(&mut sim, office));
    // A shared wall with a commercial room is the harshest case.
    let food = must(sim.tower.place(Kind::FastFood, 3, 100 + width));
    parity(&mut sim);
    assert!(afflicted(&mut sim, office));
    // Demolition heals it with no manual invalidation: the removal moves
    // the revision and the next query refills from the scan.
    assert!(sim.tower.remove_unit(food).is_some());
    parity(&mut sim);
    assert!(!afflicted(&mut sim, office));
    // State is not an input: an empty or gutted source still radiates.
    let food = must(sim.tower.place(Kind::FastFood, 3, 100 + width));
    sim.tower.get_unit_mut(food).unwrap().state = crate::tower::UnitState::Gutted;
    parity(&mut sim);
    assert!(afflicted(&mut sim, office));
}
