//! The people window read through the crowd's floor index (#2151) sends
//! exactly the people a test of every person finds, in crowd order, after
//! every step of the seeded sessions; and the index matches a fresh build
//! after every one of them (the reader checks that too in a debug build,
//! before every windowed frame).
use super::layout::{header, person, HEADER, PERSON_RECORD};
use super::session_tests::{run as run_session, starts, Picker};
use super::*;

/// The ids a frame carries, in its order.
fn ids(frame: &[f64]) -> Vec<i64> {
    let n = frame[header::PEOPLE] as usize;
    (0..n)
        .map(|i| frame[HEADER + i * PERSON_RECORD + person::ID] as i64)
        .collect()
}

/// A window the session picks: the whole tower, a few floors anywhere on
/// it, a sliver between two floors, or one past the top.
fn pick_window(sim: &Simulation, p: &mut Picker) -> PeopleWindow {
    let units = &sim.tower.units;
    let lo = units.iter().map(|u| u.floor).min().unwrap_or(0) as f64;
    let hi = units.iter().map(|u| u.floor).max().unwrap_or(0) as f64;
    let at = lo + p.below((hi - lo) as usize + 1) as f64;
    let (a, b) = match p.below(4) {
        0 => (lo, hi),
        1 => (at, at + p.below(6) as f64),
        2 => (at + 0.25, at + 0.75),
        _ => (hi + 3.0, hi + 9.0),
    };
    let x = p.below(300) as f64;
    PeopleWindow::new(a, b, x - 200.0, x + p.below(400) as f64).unwrap()
}

#[test]
fn the_index_finds_the_people_a_full_test_finds() {
    let (mut windows_with_people, mut indexed) = (0, 0);
    let mut marks = Vec::new();
    for (n, (name, mut sim, steps)) in starts().into_iter().enumerate() {
        let mut p = Picker::new(40 + n as u64);
        let mut reader = ViewReader::new();
        // Today's crowds are under the size the step keeps the index from,
        // so the sessions keep it from any size.
        sim.crowd.by_floor.keep_from(0);
        let people = sim.crowd.people.clone();
        sim.crowd.by_floor.rebuild(&people);
        run_session(&mut sim, 90 + n as u64, steps, |sim, what| {
            let people = &sim.crowd.people;
            assert!(sim.crowd.by_floor.agrees(people), "{name} {what}: index");
            let w = pick_window(sim, &mut p);
            reader.set_people_window(Some(w));
            let frame = reader.frame(sim, false);
            let padded = w.padded(&sim.tower.transports);
            let found: Vec<i64> = (people.iter().filter(|q| padded.holds(q)))
                .map(|q| q.id)
                .collect();
            assert_eq!(ids(&frame), found, "{name} {what}: window {w:?}");
            windows_with_people += usize::from(!found.is_empty());
            let marked = padded.mark(&sim.crowd.by_floor, people.len(), &mut marks);
            indexed += usize::from(marked.is_some());
        });
    }
    assert!(
        windows_with_people > 50,
        "{windows_with_people} windows held anyone"
    );
}
