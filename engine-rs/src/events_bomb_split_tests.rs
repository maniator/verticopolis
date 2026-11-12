//! The bomb search and blast on a lot with several towers standing apart:
//! each tower searched by its own stretches, reached only by the stairs, and
//! a blast that stays in its tower.

use super::tests::{decline, run, tower};
use super::*;
use crate::clock::GameMode;
use crate::tower::UnitState;

/// Two towers standing apart on one shared lobby (floors 2 to 8 at tiles
/// 100 to 139 and 200 to 239), an office on every floor of each, no Security.
/// Built in Modern with the gap bridging off, the way a player splits a lot.
fn split_tower() -> Simulation {
    let mut sim = Simulation::new_game(11, GameMode::Modern);
    sim.money = 1e9;
    if sim.auto_bridge {
        sim.toggle_auto_bridge();
    }
    for x in 100..240 {
        assert!(sim.build(Kind::Lobby, 1, x).ok);
    }
    for f in 2..=8 {
        for left in [100, 200] {
            for x in left..left + 40 {
                assert!(sim.build(Kind::Floor, f, x).ok);
            }
            assert!(sim.build(Kind::Office, f, left + 10).ok, "office on {f}");
        }
    }
    sim.star = 4;
    for u in sim.tower.units.iter_mut() {
        if u.state == UnitState::Construction {
            u.state = UnitState::Empty;
        }
    }
    sim
}

/// The floors gutted on the tower whose rooms start at or right of `left`.
fn gutted_floors(sim: &Simulation, left: i64, right: i64) -> Vec<i64> {
    let mut floors: Vec<i64> = sim
        .tower
        .units
        .iter()
        .filter(|u| u.state == UnitState::Gutted && u.x >= left && u.x < right)
        .map(|u| u.floor)
        .collect();
    floors.sort();
    floors
}

#[test]
fn a_bomb_in_one_of_two_towers_on_a_lot_leaves_the_other_standing() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let mut sim = split_tower();
        sim.mode = mode;
        decline(&mut sim);
        let b = sim.events.bomb.as_mut().expect("a search runs");
        (b.floor, b.x) = (5, 115.0);
        run(&mut sim, 1500);
        assert_eq!(sim.events.bombs_detonated, 1, "{mode:?}");
        assert_eq!(
            gutted_floors(&sim, 100, 140),
            vec![3, 4, 5, 6, 7],
            "{mode:?}: five floors of the bomb's tower"
        );
        assert!(
            gutted_floors(&sim, 200, 240).is_empty(),
            "{mode:?}: the tower next door is untouched"
        );
    }
}

#[test]
fn a_blast_with_no_security_stays_in_its_tower_too() {
    let mut sim = split_tower();
    assert_eq!(sim.tower.segments_of(5), vec![(100, 139), (200, 239)]);
    sim.blast(15_000.0, Some((5, 215.0)));
    assert_eq!(gutted_floors(&sim, 200, 240), vec![3, 4, 5, 6, 7]);
    assert!(gutted_floors(&sim, 100, 140).is_empty());
}

#[test]
fn a_tower_that_fills_its_floors_takes_the_blast_across_their_width() {
    // One tower, offices at both ends of every floor: the blast reaches
    // the far end of the floors around it, as it always has.
    let mut sim = tower(8, 0);
    for f in 2..=8 {
        assert!(sim.build(Kind::Office, f, 205).ok, "office on {f}");
    }
    for u in sim.tower.units.iter_mut() {
        if u.state == UnitState::Construction {
            u.state = UnitState::Empty;
        }
    }
    sim.blast(15_000.0, Some((5, 175.0)));
    assert_eq!(gutted_floors(&sim, 200, 220), vec![3, 4, 5, 6, 7]);
    assert_eq!(gutted_floors(&sim, 160, 200), vec![3, 4, 5, 6, 7]);
}

#[test]
fn a_tower_wider_below_the_bomb_takes_the_blast_across_its_wider_floors() {
    // A podium on floors 2 to 4 (tiles 100 to 239) under a narrower shaft on
    // 5 to 8 (150 to 189): a bomb on 6 still reaches both ends of floor 4.
    let mut sim = Simulation::new_game(11, GameMode::Classic);
    sim.money = 1e9;
    for x in 100..240 {
        assert!(sim.build(Kind::Lobby, 1, x).ok);
    }
    for f in 2..=8 {
        let (from, to) = if f <= 4 { (100, 240) } else { (150, 190) };
        for x in from..to {
            assert!(sim.build(Kind::Floor, f, x).ok);
        }
        assert!(sim.build(Kind::Office, f, 160).ok, "office on {f}");
        if f <= 4 {
            assert!(sim.build(Kind::Office, f, 105).ok);
            assert!(sim.build(Kind::Office, f, 225).ok);
        }
    }
    for u in sim.tower.units.iter_mut() {
        if u.state == UnitState::Construction {
            u.state = UnitState::Empty;
        }
    }
    sim.blast(15_000.0, Some((6, 165.0)));
    assert_eq!(gutted_floors(&sim, 100, 150), vec![4]);
    assert_eq!(gutted_floors(&sim, 220, 240), vec![4]);
    assert_eq!(gutted_floors(&sim, 150, 190), vec![4, 5, 6, 7, 8]);
}

/// The split lot with a Security office on floor 2 of the left tower.
fn guarded_split_tower() -> Simulation {
    let mut sim = split_tower();
    let r = sim.build(Kind::Security, 2, 120);
    assert!(r.ok, "{:?}", r.reason);
    for u in sim.tower.units.iter_mut() {
        if u.state == UnitState::Construction {
            u.state = UnitState::Empty;
        }
    }
    sim
}

#[test]
fn guards_sweep_each_tower_of_a_floor_on_its_own() {
    let mut sim = guarded_split_tower();
    decline(&mut sim);
    let b = sim.events.bomb.as_mut().unwrap();
    (b.floor, b.x, b.deadline) = (8, 215.0, sim.clock.minutes + 2000.0);
    run(&mut sim, 1500);
    assert!(sim.log.iter().any(|e| e.text.contains("found the bomb")));
    // Before the find, floor 2 was swept tower by tower: two stretches.
    let mut sim = guarded_split_tower();
    decline(&mut sim);
    let b = sim.events.bomb.as_mut().unwrap();
    (b.floor, b.x, b.deadline) = (8, 215.0, sim.clock.minutes + 2000.0);
    for _ in 0..1500 {
        sim.clock.advance(1.0);
        sim.advance_bomb_search();
        let Some(b) = sim.events.bomb.as_ref() else {
            break;
        };
        if b.searched.iter().filter(|s| s.0 == 2).count() == 2 {
            let xs: Vec<Option<i64>> = b
                .searched
                .iter()
                .filter(|s| s.0 == 2)
                .map(|s| s.1)
                .collect();
            assert!(xs.contains(&Some(100)) && xs.contains(&Some(200)), "{xs:?}");
            return;
        }
    }
    panic!("floor 2 was never swept in both towers");
}

#[test]
fn a_guard_reaches_the_other_tower_down_to_the_lobby_and_back_up() {
    let mut sim = guarded_split_tower();
    decline(&mut sim);
    let start = sim.clock.minutes;
    let b = sim.events.bomb.as_ref().unwrap();
    // Six guards from floor 2 of the left tower: the nearest stretches are
    // the left tower's floors 2 to 6 and floor 1's lobby has no rooms, so
    // the sixth goes down to the lobby and up to floor 2 of the right tower.
    let across = b
        .guards
        .iter()
        .find(|g| g.x == Some(200))
        .expect("a guard crosses to the right tower");
    assert_eq!(across.floor, Some(2));
    assert_eq!(
        across.route,
        vec![(2, 100), (1, 100), (1, 200), (2, 200)],
        "down its own tower's stairs to the shared lobby, over and back up"
    );
    assert_eq!(across.arrive, start + 2.0 * STAIR_MINUTES_PER_FLOOR);
    let view = sim.bomb_search_view().unwrap();
    let drawn = view["sweeping"]
        .as_array()
        .unwrap()
        .iter()
        .find(|g| g["left"] == 210)
        .expect("the right tower's floor 2 is drawn");
    assert_eq!(drawn["right"], 219, "only that tower's rooms");
    assert_eq!(
        drawn["route"],
        serde_json::json!([[2, 100], [1, 100], [1, 200], [2, 200]])
    );
}

#[test]
fn a_tower_the_stairs_never_reach_is_never_searched() {
    let mut sim = guarded_split_tower();
    let cut: Vec<i64> = sim
        .tower
        .units
        .iter()
        .filter(|u| u.floor == 1 && (140..200).contains(&u.x))
        .map(|u| u.id)
        .collect();
    sim.tower.remove_units(&cut);
    decline(&mut sim);
    let b = sim.events.bomb.as_mut().unwrap();
    (b.floor, b.x, b.deadline) = (3, 215.0, sim.clock.minutes + 2000.0);
    run(&mut sim, 2500);
    assert_eq!(sim.events.bombs_detonated, 1, "nobody could reach it");
    assert!(sim.log.iter().any(|e| e.text.contains("ran out of time")));
}

#[test]
fn a_search_across_towers_survives_a_save_and_load() {
    let mut sim = guarded_split_tower();
    decline(&mut sim);
    let b = sim.events.bomb.as_mut().unwrap();
    (b.floor, b.x, b.deadline) = (8, 215.0, sim.clock.minutes + 2000.0);
    run(&mut sim, 8);
    let b = sim.events.bomb.as_ref().expect("still searching");
    assert!(
        b.searched.iter().any(|s| s.1.is_some()),
        "a stretch was swept"
    );
    let back = BombSearch::from_save(&b.save_state()).expect("reads back");
    assert_eq!(&back, b);
}

#[test]
fn a_guard_from_an_older_save_sweeps_its_whole_floor() {
    // Before towers were searched one by one a guard held a floor, with no
    // stretch, route or arrival.
    let old = serde_json::json!({
        "floor": 4, "x": 215.0, "deadline": 9000.0, "seq": 3,
        "guards": [{"floor": 4, "doneAt": 50.0, "from": 2, "start": 10.0}],
        "searched": [2, 3],
    });
    let b = BombSearch::from_save(&old).expect("reads back");
    assert_eq!(b.guards[0].x, None);
    assert!(b.guards[0].route.is_empty(), "it climbs straight");
    assert_eq!(b.guards[0].arrive, 10.0 + 2.0 * STAIR_MINUTES_PER_FLOOR);
    assert_eq!(b.searched, vec![(2, None), (3, None)]);
    let mut sim = guarded_split_tower();
    sim.clock.minutes = 0.0;
    sim.events.bomb = Some(b);
    sim.clock.advance(60.0);
    sim.advance_bomb_search();
    assert!(
        sim.log.iter().any(|e| e.text.contains("found the bomb")),
        "a whole floor's sweep covers the right tower's stretch too"
    );
}
