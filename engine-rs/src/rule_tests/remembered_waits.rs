//! A Modern elevator stop remembers the waits its riders really had, for
//! a few game minutes (`crowd::line_count::waits_seen`), and the router takes the
//! longer of its model and that memory. A stop the cars reach already full,
//! such as a Metro basement below a busy shaft, then costs what it really
//! costs, and riders find the escalators. The memory is saved with the tower
//! (`waitsSeen`), so a reload plays on as the game would have.

use crate::clock::GameMode;
use crate::crowd::fasthash::FastMap;
use crate::crowd::line_count::waits_seen::{note_boarding, WaitsSeen, FADE_SECONDS};
use crate::crowd::line_count::Line;
use crate::crowd::spawn::make_person;
use crate::crowd::{Crowd, Route};
use crate::load::encode_simulation_vctower_binary;
use crate::load_stream::load_save_text;
use crate::load_stream::load_vctower_bytes;
use crate::sim::Simulation;

use super::classic_elevator_dispatch::{schedule, shaft_tower, TOP};

#[test]
fn a_stop_remembers_its_riders_waits_and_forgets_them() {
    let mut seen = WaitsSeen::default();
    seen.boarded(7, -5, 80.0);
    // A rider who walked straight on pulls the memory halfway down: 80 to
    // 40.
    seen.boarded(7, -5, 0.0);
    // A stop where nobody has waited yet is not remembered.
    seen.boarded(7, 3, 0.0);
    let mut lines = FastMap::default();
    seen.fold(0.0, &mut lines);
    let line = |lines: &FastMap<(i64, i64), Line>, at| lines.get(&at).copied();
    let remembered = Line {
        riders: 0,
        oldest: 40.0,
    };
    assert_eq!(line(&lines, (7, -5)), Some(remembered));
    assert_eq!(line(&lines, (7, 3)), None);
    // A line whose own longest wait is longer keeps it, and its riders.
    let longer = Line {
        riders: 4,
        oldest: 90.0,
    };
    lines.insert((7, -5), longer);
    seen.fold(0.0, &mut lines);
    assert_eq!(line(&lines, (7, -5)), Some(longer));
    // Halfway through the fade, half the memory is left; at its end, none.
    let mut lines = FastMap::default();
    seen.fold(FADE_SECONDS / 2.0, &mut lines);
    assert_eq!(line(&lines, (7, -5)).map(|l| l.oldest), Some(20.0));
    let mut lines = FastMap::default();
    seen.fold(FADE_SECONDS / 2.0, &mut lines);
    assert_eq!(line(&lines, (7, -5)), None);
    assert!(seen.is_empty());
}

#[test]
fn only_a_modern_elevator_rider_leaves_a_wait_behind() {
    for (mode, remembers) in [(GameMode::Modern, true), (GameMode::Classic, false)] {
        let (tower, id) = shaft_tower(mode, 2, schedule(None));
        let mut crowd = Crowd::new(7);
        let route = Route {
            floors: vec![1, TOP],
            shafts: vec![id],
        };
        let i = make_person(&mut crowd, &tower, route, 120.0, None);
        crowd.people[i].wait = 50.0;
        note_boarding(&mut crowd, &tower, false, i);
        assert!(crowd.waits_seen.is_empty(), "{mode:?}: stairs");
        note_boarding(&mut crowd, &tower, true, i);
        assert_eq!(!crowd.waits_seen.is_empty(), remembers, "{mode:?}");
    }
}

/// The owner's split tower (`conformance/fixtures/regression/split-tower-26.vctower`,
/// Modern, 9 AM, its basements crowded below the Metro) played half an hour
/// of the morning rush in one-minute steps and saved as a binary `.vctower`
/// (`split-tower-26-remembered.vctower`), so it carries the memory as a save
/// from this build writes it, and a later build must still read it.
fn split_tower_mid_rush() -> Simulation {
    let bytes = include_bytes!(
        "../../../conformance/fixtures/regression/split-tower-26-remembered.vctower"
    );
    let sim = load_vctower_bytes(bytes, None).expect("the fixture loads");
    assert_eq!(sim.tower.mode, GameMode::Modern);
    assert!(
        !sim.crowd.waits_seen.is_empty(),
        "the save carries the memory"
    );
    sim
}

fn play(sim: &mut Simulation, minutes: usize) {
    for _ in 0..minutes {
        sim.tick(1.0);
    }
}

#[test]
fn a_reloaded_tower_remembers_the_waits_and_plays_on_as_it_would_have() {
    let mut sim = split_tower_mid_rush();
    let file = encode_simulation_vctower_binary(&sim, "test", 0.0).expect("it saves");
    let mut loaded = load_vctower_bytes(&file, None).expect("it loads");
    assert_eq!(loaded.crowd.waits_seen, sim.crowd.waits_seen);
    play(&mut sim, 30);
    play(&mut loaded, 30);
    assert_eq!(loaded.serialize(), sim.serialize());
}

#[test]
fn a_save_from_before_the_memory_loads_with_none_and_learns_again() {
    let sim = split_tower_mid_rush();
    let mut save = sim.serialize();
    let crowd = save["crowd"].as_object_mut().expect("a crowd");
    assert!(crowd.remove("waitsSeen").is_some(), "the save carries it");
    let forgot = load_save_text(save.to_string().as_bytes()).expect("it loads");
    assert!(forgot.crowd.waits_seen.is_empty());
    // With the memory kept, the loaded lines the router reads are raised to
    // it; with it gone, at least one stop reads shorter, by the model alone.
    let kept = load_save_text(sim.save_text().as_bytes()).expect("it loads");
    let oldest = |s: &Simulation, at| s.crowd.shaft_lines.get(&at).map_or(0.0, |l| l.oldest);
    let rows = kept.crowd.waits_seen.rows();
    assert!(!rows.is_empty(), "the kept save carries the memory");
    assert!(rows.iter().all(|&(s, f, w, _)| oldest(&kept, (s, f)) >= w));
    assert!(rows.iter().any(|&(s, f, w, _)| oldest(&forgot, (s, f)) < w));
    let mut forgot = forgot;
    play(&mut forgot, 30);
    assert!(!forgot.crowd.waits_seen.is_empty(), "it learns again");
}
