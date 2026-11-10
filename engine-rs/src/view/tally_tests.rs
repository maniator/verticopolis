//! The census tally's ways through a read (`tally.rs`): the marked units
//! only, a compare of every room (for many marks, or for a log that dropped
//! some), and a full pass. A write that skips the setters tells the marked
//! path apart, since only a compare or a full pass sees it.
use super::marks::MARK_CAP;
use super::marks_tests::served;
use super::tally::{CensusTally, RecyclingCounts, TallyPasses};
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

fn counted(sim: &Simulation) -> RecyclingCounts {
    RecyclingCounts {
        centers: sim.recycling_centers(),
        population: sim.tower.total_population(),
    }
}

/// Two rooms with people in them: one for the setters to mark, and one to
/// empty behind their back.
fn two_present_rooms(sim: &Simulation) -> (usize, usize) {
    let mut present = sim
        .tower
        .room_index()
        .iter()
        .copied()
        .filter(|&i| sim.tower.units[i].census_share() > 0)
        .collect::<Vec<_>>()
        .into_iter();
    (present.next().unwrap(), present.next().unwrap())
}

/// Empty room `i` without its setter, so the mark log does not name it.
fn empty_unmarked(sim: &mut Simulation, i: usize) {
    sim.tower.units[i].state = UnitState::Empty;
}

/// Set room `i`'s state through its setter, which logs one mark when the
/// state changes.
fn set_marked(sim: &mut Simulation, i: usize, state: UnitState) {
    let (u, at) = sim.tower.marked(i);
    u.set_state(at, state);
}

/// Log `marks` marks on room `i`, toggling it between its state and another
/// one, so it ends in the state it started in when `marks` is even.
fn churn(sim: &mut Simulation, i: usize, marks: usize) {
    let start = sim.tower.units[i].state;
    let other = if start == UnitState::Empty {
        UnitState::Occupied
    } else {
        UnitState::Empty
    };
    for k in 0..marks {
        set_marked(sim, i, if k % 2 == 0 { other } else { start });
    }
}

fn passes(full: u32, compared: u32, dropped: u32, marked: u32) -> TallyPasses {
    TallyPasses {
        full,
        compared,
        dropped,
        marked,
    }
}

#[test]
fn a_read_with_a_few_marks_visits_only_the_marked_rooms() {
    let mut sim = served();
    let mut tally = CensusTally::default();
    assert_eq!(tally.counts(&sim.tower), counted(&sim));
    let (marked, hidden) = two_present_rooms(&sim);
    let kept = counted(&sim);
    let marked_share = sim.tower.units[marked].census_share();
    empty_unmarked(&mut sim, hidden);
    set_marked(&mut sim, marked, UnitState::Empty);
    let got = tally.counts(&sim.tower);
    assert_eq!(
        got.population,
        kept.population - marked_share,
        "the marked room left the count"
    );
    assert_ne!(
        got,
        counted(&sim),
        "the room emptied behind the setters is not seen"
    );
    assert_eq!(tally.passes(), passes(1, 0, 0, 1));
    // Nothing marked since: the read visits no room and answers the same.
    assert_eq!(tally.counts(&sim.tower), got);
    assert_eq!(tally.passes(), passes(1, 0, 0, 2));
}

#[test]
fn a_mark_on_a_floor_tile_changes_no_count() {
    let mut sim = served();
    let mut tally = CensusTally::default();
    let before = tally.counts(&sim.tower);
    let floor = sim
        .tower
        .units
        .iter()
        .position(|u| u.kind == Kind::Floor)
        .unwrap();
    assert!(!sim.tower.room_index().contains(&floor));
    set_marked(&mut sim, floor, UnitState::Fire);
    assert_eq!(tally.counts(&sim.tower), before);
    assert_eq!(tally.counts(&sim.tower), counted(&sim));
    assert_eq!(tally.passes(), passes(1, 0, 0, 2));
}

#[test]
fn marks_on_half_the_rooms_compare_every_room() {
    let mut sim = served();
    let mut tally = CensusTally::default();
    tally.counts(&sim.tower);
    let (marked, hidden) = two_present_rooms(&sim);
    let rooms = sim.tower.room_index().len();
    // The fewest marks that reach half the rooms, well inside the log.
    let half = rooms.div_ceil(2);
    assert!(half < MARK_CAP);
    // One mark short of it stays on the marked path.
    churn(&mut sim, marked, half - 1);
    assert_eq!(tally.counts(&sim.tower), counted(&sim));
    assert_eq!(tally.passes(), passes(1, 0, 0, 1));
    empty_unmarked(&mut sim, hidden);
    churn(&mut sim, marked, half);
    assert_eq!(
        tally.counts(&sim.tower),
        counted(&sim),
        "a compare sees every room"
    );
    assert_eq!(tally.passes(), passes(1, 1, 0, 1));
}

#[test]
fn a_log_that_dropped_unread_marks_compares_every_room() {
    let mut sim = served();
    let mut tally = CensusTally::default();
    tally.counts(&sim.tower);
    let (marked, hidden) = two_present_rooms(&sim);
    empty_unmarked(&mut sim, hidden);
    // More marks than the log holds push out the first ones unread.
    churn(&mut sim, marked, MARK_CAP + 2);
    set_marked(&mut sim, marked, UnitState::Empty);
    assert_eq!(tally.counts(&sim.tower), counted(&sim));
    assert_eq!(tally.passes(), passes(1, 0, 1, 0));
}

#[test]
fn another_towers_log_counts_afresh_at_the_same_revision_and_size() {
    let a = served();
    let mut b = served();
    assert_eq!(
        (a.tower.revision, a.tower.units.len()),
        (b.tower.revision, b.tower.units.len())
    );
    let (_, hidden) = two_present_rooms(&b);
    empty_unmarked(&mut b, hidden);
    let mut tally = CensusTally::default();
    assert_eq!(tally.counts(&a.tower), counted(&a));
    assert_ne!(counted(&a), counted(&b));
    assert_eq!(
        tally.counts(&b.tower),
        counted(&b),
        "the new log's id moves the key"
    );
    assert_eq!(tally.passes(), passes(2, 0, 0, 0));
}

#[test]
fn an_edit_counts_afresh() {
    let mut sim = served();
    let mut tally = CensusTally::default();
    tally.counts(&sim.tower);
    let (_, hidden) = two_present_rooms(&sim);
    empty_unmarked(&mut sim, hidden);
    sim.tower.revision += 1;
    assert_eq!(tally.counts(&sim.tower), counted(&sim));
    assert_eq!(tally.passes(), passes(2, 0, 0, 0));
}

/// A full pass clears only the slots the last one set. When a command moves
/// a room to another index at the same unit count, the old room's slot must
/// still come out empty, so a later mark on the tile now there changes no
/// count.
#[test]
fn a_room_moved_to_another_index_leaves_no_share_behind() {
    let mut sim = served();
    let mut tally = CensusTally::default();
    tally.counts(&sim.tower);
    let (room, _) = two_present_rooms(&sim);
    let floor = (0..sim.tower.units.len())
        .find(|&i| sim.tower.units[i].kind == Kind::Floor)
        .unwrap();
    sim.tower.units.swap(room, floor);
    sim.tower.revision += 1;
    assert!(!sim.tower.room_index().contains(&room));
    assert_eq!(tally.counts(&sim.tower), counted(&sim));
    set_marked(&mut sim, room, UnitState::Fire);
    assert_eq!(
        tally.counts(&sim.tower),
        counted(&sim),
        "the floor tile in the room's old slot has no share"
    );
    assert_eq!(tally.passes(), passes(2, 0, 0, 1));
}
