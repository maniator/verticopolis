use super::*;
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

/// Opens everything still under construction, with tenants in every
/// office (a thief prowls where people are).
fn open_all(sim: &mut Simulation) {
    for u in sim.tower.units.iter_mut() {
        if u.state == UnitState::Construction {
            u.state = UnitState::Empty;
        }
        if u.kind == Kind::Office {
            u.state = UnitState::Occupied;
        }
    }
}

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

/// The lot with a Security office in the left tower only.
fn guarded() -> Simulation {
    let mut sim = lot();
    sim.star = 4;
    let r = sim.build(Kind::Security, 3, 110);
    assert!(r.ok, "{:?}", r.reason);
    open_all(&mut sim);
    sim
}

#[test]
fn security_catches_a_thief_in_a_tower_it_can_walk_to() {
    let sim = guarded();
    let stairs = Stairs::of(&sim.tower);
    assert!(sim.security_reaches(&stairs, 5, 110), "its own tower");
    assert!(
        sim.security_reaches(&stairs, 5, 210),
        "the other, through the lobby"
    );
}

#[test]
fn security_cannot_reach_a_thief_in_a_tower_no_floor_joins() {
    let mut sim = guarded();
    let cut: Vec<i64> = sim
        .tower
        .units
        .iter()
        .filter(|u| u.floor == 1 && (140..200).contains(&u.x))
        .map(|u| u.id)
        .collect();
    sim.tower.remove_units(&cut);
    let stairs = Stairs::of(&sim.tower);
    assert!(sim.security_reaches(&stairs, 5, 110));
    assert!(!sim.security_reaches(&stairs, 5, 210), "no guard teleports");
}

#[test]
fn with_no_security_nobody_catches_the_thief() {
    let sim = lot();
    let stairs = Stairs::of(&sim.tower);
    assert!(!sim.security_reaches(&stairs, 5, 110));
}

#[test]
fn the_thief_prowls_one_tower_of_a_floor() {
    let mut sim = guarded();
    for f in 2..=6 {
        for left in [100, 200] {
            assert!(sim.build(Kind::Office, f, left + 28).ok, "office on {f}");
        }
    }
    open_all(&mut sim);
    let stairs = Stairs::of(&sim.tower);
    let mut towers = std::collections::BTreeSet::new();
    for _ in 0..40 {
        let (floor, x) = sim.thief_spot(&stairs);
        let at = stairs.at(floor, x).expect("a stretch of his floor");
        assert_eq!(stairs.stretch(at).first, x, "named by its first tile");
        assert!(x == 100 || x == 200, "one tower or the other: {x}");
        towers.insert(x);
    }
    assert_eq!(towers.len(), 2, "both towers get thieves");
}

#[test]
fn a_tower_that_fills_its_floors_draws_the_thief_floor_as_before() {
    // One stretch a floor: the draw is over the floors alone, in the order
    // the units first name them, the list the floor-only draw used.
    let mut sim = Simulation::new_game(11, GameMode::Classic);
    sim.money = 1e9;
    for x in 100..140 {
        assert!(sim.build(Kind::Lobby, 1, x).ok);
    }
    for f in 2..=5 {
        for x in 100..140 {
            assert!(sim.build(Kind::Floor, f, x).ok);
        }
        assert!(sim.build(Kind::Office, f, 110).ok);
    }
    open_all(&mut sim);
    let stairs = Stairs::of(&sim.tower);
    let mut old_draw = sim.events.extra.clone();
    let mut floors = indexmap::IndexSet::new();
    for u in &sim.tower.units {
        if u.is_present() {
            floors.insert(u.floor);
        }
    }
    let floors: Vec<i64> = floors.into_iter().collect();
    for _ in 0..20 {
        let (floor, x) = sim.thief_spot(&stairs);
        let old = *old_draw.pick(&floors);
        assert_eq!((floor, x), (old, 100));
    }
}
