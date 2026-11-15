//! Two Modern towers on one lot played for days, as a player gets them:
//! each lobby laid apart with bridging off, or one bridged lobby parted by
//! the bulldozer (`GameMode::lays_ground_lobbies_apart`,
//! `GameMode::removes_lobby_tiles`), with or without a basement joining
//! them. Either way both towers fill, and people from one go to lunch in the
//! other: along the street, or through the basement when it is quicker.
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::gameplay::RemovalMethod;
use crate::sim::Simulation;
use crate::tower::UnitState;

/// The left edges of the two towers, each `W` tiles wide.
const A: i64 = 60;
const B: i64 = 200;
const W: i64 = 40;
const TOP: i64 = 7;

/// Lays `kind` on `tiles` of `floor` with the brush, as a drag does, and
/// answers how many tiles it laid.
fn paint(sim: &mut Simulation, kind: Kind, floor: i64, tiles: &[i64]) -> i64 {
    tiles
        .chunks(16)
        .map(|c| sim.paint_brush(kind, floor, c).placed)
        .sum()
}

fn tower_of(x: f64) -> Option<usize> {
    [A, B]
        .iter()
        .position(|&left| x >= left as f64 && x < (left + W) as f64)
}

/// How the two lobbies come apart.
#[derive(Clone, Copy)]
enum Parted {
    /// Each laid on its own with bridging off.
    LaidApart,
    /// One lobby bridged across, its middle bulldozed.
    Bulldozed,
}

/// Two towers with offices and condos, an elevator in each, and fast food
/// only in the right one, built through the player's own commands. With
/// `basement`, a B1 runs under both and each elevator goes down to it.
fn split(parted: Parted, basement: bool) -> Simulation {
    let mut sim = Simulation::new_game(5, GameMode::Modern);
    sim.money = 1e12;
    sim.star = 3;
    match parted {
        Parted::Bulldozed => {
            if !sim.auto_bridge {
                sim.toggle_auto_bridge();
            }
            let tiles: Vec<i64> = (A..B + W).collect();
            assert_eq!(paint(&mut sim, Kind::Lobby, 1, &tiles), B + W - A);
            for x in A + W..B {
                let id = sim.tower.unit_at(1, x).expect("bridged lobby").id;
                let r = sim.remove_facility(id, RemovalMethod::Bulldoze);
                assert!(r.ok, "bulldoze {x}: {:?}", r.reason);
            }
            sim.toggle_auto_bridge();
        }
        Parted::LaidApart => {
            if sim.auto_bridge {
                sim.toggle_auto_bridge();
            }
            for left in [A, B] {
                let tiles: Vec<i64> = (left..left + W).collect();
                assert_eq!(
                    paint(&mut sim, Kind::Lobby, 1, &tiles),
                    W,
                    "lobby at {left}"
                );
            }
        }
    }
    let runs = sim.tower.segment_runs(1).to_vec();
    assert_eq!(runs, vec![(A, A + W - 1), (B, B + W - 1)]);
    for left in [A, B] {
        let tiles: Vec<i64> = (left..left + W).collect();
        for f in 2..=TOP {
            assert_eq!(
                paint(&mut sim, Kind::Floor, f, &tiles),
                W,
                "floor {f} at {left}"
            );
        }
    }
    if basement {
        let tiles: Vec<i64> = (A..B + W).collect();
        assert_eq!(
            paint(&mut sim, Kind::Floor, 0, &tiles),
            B + W - A,
            "B1 across"
        );
    }
    let bottom = if basement { 0 } else { 1 };
    for left in [A, B] {
        let r = sim.build_transport(Kind::ElevatorStandard, left + 18, bottom, TOP);
        assert!(r.ok, "elevator at {left}: {:?}", r.reason);
        for f in 2..=4 {
            for k in 0..2 {
                let r = sim.build(Kind::Office, f, left + 1 + k * 9);
                assert!(r.ok, "office {f}/{}: {:?}", left + 1 + k * 9, r.reason);
            }
        }
        for f in 5..=TOP {
            for k in 0..2 {
                let r = sim.build(Kind::Condo, f, left + 1 + k * 16);
                assert!(r.ok, "condo {f}: {:?}", r.reason);
            }
        }
    }
    let r = sim.build(Kind::FastFood, 2, B + 24);
    assert!(r.ok, "fast food: {:?}", r.reason);
    sim
}

/// Plays `split` for three days, checks that both towers fill and that a
/// route joins them, and answers how many person-steps were on a trip from
/// one tower to the other.
fn plays(parted: Parted, basement: bool) -> usize {
    let mut sim = split(parted, basement);
    let mut crossings = 0;
    for _ in 0..(3 * 24 * 4) {
        sim.tick(15.0);
        crossings += sim
            .crowd
            .people
            .iter()
            .filter(|p| {
                let (s, d) = (tower_of(p.start_x), tower_of(p.dest_x));
                s.is_some() && d.is_some() && s != d
            })
            .count();
    }
    let in_use = |left: i64| {
        sim.tower
            .units
            .iter()
            .filter(|u| u.x >= left && u.x < left + W)
            .filter(|u| matches!(u.kind, Kind::Office | Kind::Condo))
            .filter(|u| !matches!(u.state, UnitState::Empty | UnitState::Construction))
            .count()
    };
    assert!(in_use(A) > 0, "the left tower fills");
    assert!(in_use(B) > 0, "the right tower fills");
    let route = sim
        .crowd
        .route(&sim.tower, 3, 3, Some((A + 5) as f64), Some((B + 5) as f64));
    let r = route.expect("a way from one tower to the other");
    let through = if basement {
        [1, 0].as_slice()
    } else {
        [1].as_slice()
    };
    assert!(
        r.floors.len() == 3 && through.contains(&r.floors[1]),
        "{:?}",
        r.floors
    );
    crossings
}

#[test]
fn towers_laid_apart_fill_and_trade_lunch_along_the_street() {
    let crossings = plays(Parted::LaidApart, false);
    assert!(crossings > 0, "people go from one tower to the other");
}

#[test]
fn towers_parted_by_the_bulldozer_fill_and_trade_lunch_along_the_street() {
    let crossings = plays(Parted::Bulldozed, false);
    assert!(crossings > 0, "people go from one tower to the other");
}

#[test]
fn towers_parted_by_the_bulldozer_over_a_basement_fill_and_trade_lunch() {
    let crossings = plays(Parted::Bulldozed, true);
    assert!(crossings > 0, "people go from one tower to the other");
}
