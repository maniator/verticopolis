//! The recycling card's three engine reads answer from the census tally
//! (#1745, `view/tally.rs`). These follow them through the setters, the
//! clock, an edit, an undo and a redo, a bulldoze and a load, each checked
//! against a fresh count; `view/tally_tests.rs` covers each way through a
//! read on its own.
use super::tests::built;
use super::*;
use crate::demand::RECYCLING_POP_PER_CENTER;
use crate::facilities::Kind;
use crate::tower::UnitState;
use crate::view::RecyclingCounts;

/// The three reads, with the fill as its bits so two reads compare exactly.
#[derive(Debug, PartialEq)]
struct Reads {
    capacity: f64,
    fill: u64,
    met: bool,
}

impl Reads {
    fn fill(&self) -> f64 {
        f64::from_bits(self.fill)
    }
}

/// What a fresh count of the tower gives.
fn fresh(e: &Engine) -> Reads {
    Reads {
        capacity: e.sim.recycling_capacity(),
        fill: e.sim.recycling_fill().to_bits(),
        met: e.sim.recycling_demand_met(),
    }
}

/// What the card's reads give, from the kept counts.
fn read(e: &mut Engine) -> Reads {
    Reads {
        capacity: e.port_recycling_capacity(),
        fill: e.port_recycling_fill().to_bits(),
        met: e.port_recycling_demand_met(),
    }
}

fn counted(e: &Engine) -> RecyclingCounts {
    RecyclingCounts {
        centers: e.sim.recycling_centers(),
        population: e.sim.tower.total_population(),
    }
}

fn full_passes(e: &Engine) -> u32 {
    e.sim.inspector_recycling_passes().full
}

/// `built()` with two basement floors under it for recycling centers.
fn with_basement() -> Engine {
    let mut e = built();
    for floor in [0, -1] {
        for x in 150..230 {
            assert!(e.sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    e
}

fn set_state(e: &mut Engine, id: i64, state: UnitState) {
    let (u, at) = e.sim.tower.marked_by_id(id).unwrap();
    u.set_state(at, state);
}

/// The recycling reads answer from a running count: the setters' marks (a
/// state, the residents, the customers inside) move it to what a fresh
/// count says, an edit or a load counts afresh, and a write that skips the
/// setters is not seen until then. The clock moves the fill and no count.
#[test]
fn the_recycling_reads_follow_the_marked_rooms_an_edit_and_a_load() {
    let mut e = with_basement();
    let center = e.sim.tower.place(Kind::Recycling, -1, 160).unit_id.unwrap();
    let condo = e.sim.tower.place(Kind::Condo, 3, 160).unit_id.unwrap();
    let food = e.sim.tower.place(Kind::FastFood, 4, 160).unit_id.unwrap();
    let office = e
        .sim
        .tower
        .units
        .iter()
        .find(|u| u.kind == Kind::Office)
        .unwrap()
        .id;
    e.sim.clock.minutes += 12.0 * 60.0;
    for id in [office, condo, food] {
        set_state(&mut e, id, UnitState::Occupied);
    }
    let before = read(&mut e);
    assert_eq!(before, fresh(&e));
    assert_eq!(before.capacity, RECYCLING_POP_PER_CENTER);
    assert!(before.fill() > 0.0, "an occupied office fills the bins");
    // A write that skips the setters is not seen: the kept counts stand, so
    // a read between changes visits no room.
    let was = e.sim.tower.get_unit(center).unwrap().state;
    e.sim.tower.get_unit_mut(center).unwrap().state = UnitState::Fire;
    assert_eq!(read(&mut e), before);
    e.sim.tower.get_unit_mut(center).unwrap().state = was;
    // Each setter the census reads moves the count.
    set_state(&mut e, center, UnitState::Fire);
    let burning = fresh(&e);
    assert_eq!(burning.capacity, 0.0, "a burning center processes nothing");
    assert_eq!(read(&mut e), burning);
    set_state(&mut e, center, was);
    assert_eq!(read(&mut e), before);
    let then = counted(&e);
    let (u, at) = e.sim.tower.marked_by_id(condo).unwrap();
    u.set_residents(at, Some(1));
    assert_ne!(counted(&e), then, "a household's size is in the census");
    assert_eq!(e.sim.inspector_recycling(), counted(&e));
    let then = counted(&e);
    let (u, at) = e.sim.tower.marked_by_id(food).unwrap();
    u.set_visitors_yest(at, Some(30));
    assert_ne!(
        counted(&e),
        then,
        "a restaurant's visitors yesterday are in the census"
    );
    assert_eq!(e.sim.inspector_recycling(), counted(&e));
    assert_eq!(read(&mut e), fresh(&e));
    // The clock moves the fill and no count: a move-out the setters missed
    // is still not counted three hours on.
    let kept = counted(&e);
    e.sim.tower.get_unit_mut(office).unwrap().state = UnitState::Empty;
    e.sim.clock.minutes += 3.0 * 60.0;
    assert_eq!(e.sim.inspector_recycling(), kept);
    assert_ne!(counted(&e), kept, "the office's tenants are gone");
    let fill = e
        .sim
        .recycling_fill_of(kept.population, RECYCLING_POP_PER_CENTER);
    assert_eq!(e.port_recycling_fill(), fill, "the fill is the hour's");
    let passes = e.sim.inspector_recycling_passes();
    assert_eq!(
        (passes.full, passes.compared, passes.dropped),
        (1, 0, 0),
        "every read after the first took the marked units only"
    );
    assert!(passes.marked > 0);
    // An edit counts afresh, the missed move-out with it.
    let second = e.sim.tower.place(Kind::Recycling, -1, 200);
    assert!(second.ok, "{:?}", second.reason);
    let more = fresh(&e);
    assert_eq!(more.capacity, 2.0 * RECYCLING_POP_PER_CENTER);
    assert_eq!(read(&mut e), more);
    assert_eq!(e.sim.inspector_recycling(), counted(&e));
    assert_eq!(full_passes(&e), 2);
    // So does a load, which brings a new tower and a new log.
    e.sim.tower.get_unit_mut(office).unwrap().state = UnitState::Occupied;
    assert_ne!(e.sim.inspector_recycling(), counted(&e));
    let text = e.sim.save_text();
    assert_eq!(e.port_load_save(&text)[0], 1.0);
    assert_eq!(e.sim.inspector_recycling(), counted(&e));
    assert_eq!(read(&mut e), fresh(&e));
}

/// A bulldoze removes a center, and an undo and a redo of it change the
/// units through their own path; each moves the tower revision, so the next
/// read counts afresh.
#[test]
fn a_bulldoze_its_undo_and_its_redo_count_afresh() {
    let mut e = with_basement();
    let office = e
        .sim
        .tower
        .units
        .iter()
        .find(|u| u.kind == Kind::Office)
        .unwrap()
        .id;
    set_state(&mut e, office, UnitState::Occupied);
    let center = e.sim.tower.place(Kind::Recycling, -1, 160).unit_id.unwrap();
    e.sim.clock.minutes += 12.0 * 60.0;
    let working = read(&mut e);
    assert_eq!(working, fresh(&e));
    assert_eq!(working.capacity, RECYCLING_POP_PER_CENTER);
    let passes = full_passes(&e);
    let mut revision = e.sim.tower.revision;
    let mut moved = |e: &Engine, what: &str| {
        assert_ne!(e.sim.tower.revision, revision, "{what} moves the revision");
        revision = e.sim.tower.revision;
    };
    e.port_undo_capture("Bulldoze Recycling");
    let r = e.port_demolish(center as f64, true);
    assert_eq!(r[0], 1.0, "{:?}", e.last_reason_text());
    assert!(e.port_undo_commit());
    moved(&e, "the bulldoze");
    let gone = read(&mut e);
    assert_eq!(gone, fresh(&e));
    assert_eq!(gone.capacity, 0.0, "the bulldozed center is gone");
    assert_eq!(full_passes(&e), passes + 1);
    assert_eq!(e.port_undo()[0], 1.0, "{:?}", e.port_undo_notice());
    moved(&e, "the undo");
    assert_eq!(read(&mut e), working, "the undo brought the center back");
    assert_eq!(read(&mut e), fresh(&e));
    assert_eq!(full_passes(&e), passes + 2);
    assert_eq!(e.port_redo()[0], 1.0, "{:?}", e.port_undo_notice());
    moved(&e, "the redo");
    assert_eq!(read(&mut e), gone, "the redo took it away again");
    assert_eq!(read(&mut e), fresh(&e));
    assert_eq!(full_passes(&e), passes + 3);
}
