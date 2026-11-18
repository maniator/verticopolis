//! The golden-master scenario: a fixed build of offices, fast food and an
//! elevator on the centered starter lobby, run three days in hourly steps.
//! Its save is the same text run to run, comes back unchanged through a load,
//! and differs between Classic and Modern.
//!
//! The TypeScript suite also pinned a hash of each mode's save. That role is
//! the conformance lock's: `conformance/scenarios/starter-classic.json` and
//! `starter-modern.json` found the same seed on the same footprint and
//! `conformance/expected.json` pins their state digests at every checkpoint,
//! replayed by `src/bin/conformance.rs` in `engine-rs.yml`. The save text
//! itself is pinned by `sim_save_tests::engine_games_write_the_trees_text`.
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::load::deserialize;
use crate::sim::Simulation;

use super::seeded_game;

const SEED: u32 = 20260713;
const SLAB_LEFT: i64 = 168;
const SLAB_RIGHT: i64 = 205;
const ROOM_FLOORS: std::ops::RangeInclusive<i64> = 2..=6;

fn must_build(sim: &mut Simulation, kind: Kind, floor: i64, x: i64) {
    let r = sim.build(kind, floor, x);
    assert!(r.ok, "{kind:?} at {floor}/{x}: {:?}", r.reason);
}

/// The fixed scenario, run three days and rated.
fn run(mode: GameMode) -> Simulation {
    let mut sim = seeded_game(SEED, mode);
    sim.money = 500_000_000.0;
    for floor in ROOM_FLOORS {
        for x in SLAB_LEFT..=SLAB_RIGHT {
            must_build(&mut sim, Kind::Floor, floor, x);
        }
    }
    for floor in ROOM_FLOORS {
        must_build(&mut sim, Kind::Office, floor, SLAB_LEFT + 2);
        must_build(&mut sim, Kind::Office, floor, SLAB_LEFT + 12);
    }
    must_build(&mut sim, Kind::FastFood, 2, SLAB_LEFT + 22);
    must_build(&mut sim, Kind::FastFood, 3, SLAB_LEFT + 22);
    let shaft = sim.build_transport(Kind::ElevatorStandard, SLAB_LEFT, 1, 6);
    assert!(shaft.ok, "{:?}", shaft.reason);
    for _ in 0..24 * 3 {
        sim.tick(60.0);
    }
    sim.evaluate_star();
    sim
}

fn save_text(sim: &Simulation) -> String {
    sim.serialize().to_string()
}

#[test]
fn each_mode_is_the_same_run_to_run_and_through_a_load() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let once = run(mode);
        let text = save_text(&once);
        assert!(text == save_text(&run(mode)), "{mode:?} drifted run to run");
        let reloaded = deserialize(&once.serialize()).expect("the save loads");
        // Compared as values: key order is free, as the TypeScript's sorted
        // stringify left it.
        assert!(
            once.serialize() == reloaded.serialize(),
            "{mode:?} drifted through a load"
        );
    }
}

#[test]
fn classic_and_modern_end_in_different_states() {
    assert!(save_text(&run(GameMode::Classic)) != save_text(&run(GameMode::Modern)));
}
