use super::*;
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;

/// Two towers on a shared lobby (tiles 100 to 139 and 200 to 239, floors 2
/// to 6), built in Modern with the gap bridging off.
fn lot() -> Simulation {
    let mut sim = Simulation::new_game(11, GameMode::Modern);
    sim.money = 1e9;
    if sim.auto_bridge {
        sim.toggle_auto_bridge();
    }
    for x in 100..240 {
        assert!(sim.build(Kind::Lobby, 1, x).ok);
    }
    for f in 2..=6 {
        for left in [100, 200] {
            for x in left..left + 40 {
                assert!(sim.build(Kind::Floor, f, x).ok);
            }
        }
    }
    sim
}

#[test]
fn each_tower_on_a_lot_is_its_own_stretch_of_every_floor() {
    let sim = lot();
    let stairs = Stairs::of(&sim.tower);
    let a = stairs.at(4, 110).expect("the left tower");
    let b = stairs.at(4, 210).expect("the right tower");
    assert_ne!(a, b);
    assert_eq!(stairs.at(4, 170), None, "the gap between them");
    assert_eq!(stairs.at(1, 110), stairs.at(1, 210), "one lobby");
}

#[test]
fn the_stairs_climb_a_tower_floor_by_floor() {
    let sim = lot();
    let stairs = Stairs::of(&sim.tower);
    let start = stairs.at(2, 110).unwrap();
    let walk = stairs.walk_from(start);
    assert_eq!(walk.floors[stairs.at(6, 110).unwrap()], Some(4));
    let up = stairs.at(6, 110).unwrap();
    assert_eq!(stairs.turn_floor(&walk, start, up), 2, "straight up");
}

#[test]
fn the_other_tower_is_reached_down_to_the_lobby_and_back_up() {
    let sim = lot();
    let stairs = Stairs::of(&sim.tower);
    let start = stairs.at(4, 110).unwrap();
    let walk = stairs.walk_from(start);
    let other = stairs.at(5, 210).unwrap();
    // Down 3 floors to the lobby on 1, then up 4.
    assert_eq!(walk.floors[other], Some(7));
    assert_eq!(stairs.turn_floor(&walk, start, other), 1);
}

#[test]
fn a_tower_no_floor_joins_is_out_of_reach() {
    // The game keeps every floor joined to the tower; a lot whose lobby
    // was cut between its towers (a hand-edited save, say) leaves two.
    let mut sim = lot();
    let cut: Vec<i64> = sim
        .tower
        .units
        .iter()
        .filter(|u| u.floor == 1 && (140..200).contains(&u.x))
        .map(|u| u.id)
        .collect();
    sim.tower.remove_units(&cut);
    let stairs = Stairs::of(&sim.tower);
    let walk = stairs.walk_from(stairs.at(2, 105).unwrap());
    assert_eq!(walk.floors[stairs.at(3, 205).unwrap()], None);
    assert_eq!(walk.floors[stairs.at(3, 105).unwrap()], Some(1));
}
