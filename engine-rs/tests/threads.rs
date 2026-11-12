//! What a host may do with threads. The engine starts no thread of its own,
//! but a native host may run a game on a worker thread: a `Simulation` can be
//! moved to another thread (`Send`). It is not `Sync`, because it keeps
//! `RefCell` caches it fills during reads, so one game is driven by one thread
//! at a time. These checks keep that promise from breaking unnoticed, and show
//! that a game run on another thread comes out the same as one run here.

use verticopolis_engine::canonical::digest;
use verticopolis_engine::clock::GameMode;
use verticopolis_engine::facilities::Kind;
use verticopolis_engine::fixed_step::FrameStepper;
use verticopolis_engine::sim::Simulation;
use verticopolis_engine::snapshot::state_view;
use verticopolis_engine::view::ViewReader;

/// Compiles only when `T` may move to another thread.
fn assert_send<T: Send + 'static>() {}

#[test]
fn a_host_can_move_a_game_and_its_readers_to_another_thread() {
    assert_send::<Simulation>();
    assert_send::<ViewReader>();
    assert_send::<FrameStepper>();
}

/// A small tower with people in it, so the crowd, the cars and the economy
/// all run.
fn small_tower() -> Simulation {
    let mut sim = Simulation::new_game(7, GameMode::Classic);
    let lobby: Vec<i64> = (100..124).collect();
    assert_eq!(
        sim.paint_brush(Kind::Lobby, 1, &lobby).placed,
        24,
        "the lobby is laid"
    );
    for floor in 2..=4 {
        for x in [100, 109] {
            assert!(
                sim.build(Kind::Office, floor, x).ok,
                "an office on {floor} at {x}"
            );
        }
    }
    let shaft_tiles: Vec<i64> = (118..124).collect();
    for floor in 2..=4 {
        assert_eq!(sim.paint_brush(Kind::Floor, floor, &shaft_tiles).placed, 6);
    }
    let shaft = sim.build_transport(Kind::ElevatorStandard, 119, 1, 4);
    assert!(
        shaft.ok,
        "an elevator serves the offices: {:?}",
        shaft.reason
    );
    sim
}

/// Two game days, a minute at a time, then the population and the canonical
/// digest of the state.
fn play(mut sim: Simulation) -> (i64, String) {
    for _ in 0..(2 * 24 * 60) {
        sim.tick(1.0);
    }
    (sim.population(), digest(&state_view(&sim)))
}

#[test]
fn a_game_run_on_another_thread_matches_the_same_game_run_here() {
    let here = play(small_tower());
    let tower = small_tower();
    let there = std::thread::spawn(move || play(tower))
        .join()
        .expect("the worker thread finishes");
    assert!(
        here.0 > 0,
        "the offices filled, so the crowd and the cars ran"
    );
    assert_eq!(here, there);
}
