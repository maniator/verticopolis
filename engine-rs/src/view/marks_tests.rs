//! The frame mark log: the setters log what they change, and a reader
//! visits only what was logged. `marks_guard_tests.rs` keeps every engine
//! write inside the setters.
use super::layout::{header, unit, HEADER, PERSON_RECORD, UNIT_RECORD};
use super::marks::MARK_CAP;
use super::reader::compare_all;
use super::ViewReader;
use crate::frame::unit_fields;
use crate::sim::Simulation;
use crate::tower::UnitState;

/// A small tower half a day into play, with tenants and people.
pub(super) fn served() -> Simulation {
    super::session_tests::at("events-classic", "fire")
}

/// The room records of a frame, as (slot, fields).
fn rooms(frame: &[f64]) -> Vec<(usize, Vec<f64>)> {
    let at = HEADER + frame[header::PEOPLE] as usize * PERSON_RECORD;
    (0..frame[header::UNITS] as usize)
        .map(|k| {
            let r = &frame[at + k * UNIT_RECORD..at + (k + 1) * UNIT_RECORD];
            (r[unit::SLOT] as usize, r[unit::STATE..].to_vec())
        })
        .collect()
}

/// The slots a frame sent.
fn slots(frame: &[f64]) -> Vec<usize> {
    rooms(frame).into_iter().map(|(slot, _)| slot).collect()
}

/// Bump one occupant count through its setter.
fn bump(sim: &mut Simulation, i: usize) {
    let (u, at) = sim.tower.marked(i);
    u.set_occupants(at, u.occupants + 1);
}

#[test]
fn every_setter_logs_only_a_change() {
    let sim = served();
    let tower = &sim.tower;
    let i = tower.room_index()[0];
    let at = tower.view.marks.at(i);
    let mut u = tower.units[i].clone();
    let start = tower.view.marks.end();
    let (state, occupants) = (u.state, u.occupants);
    let (c, h, o, r) = (
        u.customers_in,
        u.hotel_customers_in,
        u.out_for_meal,
        u.residents,
    );
    u.set_state(at, state);
    u.set_occupants(at, occupants);
    u.set_customers_in(at, c);
    u.set_hotel_customers_in(at, h);
    u.set_out_for_meal(at, o);
    u.set_residents(at, r);
    assert_eq!(
        tower.view.marks.end(),
        start,
        "an unchanged value logs nothing"
    );
    let other = if state == UnitState::Dirty {
        UnitState::Empty
    } else {
        UnitState::Dirty
    };
    let more = |n: Option<i64>| Some(n.unwrap_or(0) + 1);
    let mut want = start;
    for change in 0..6 {
        match change {
            0 => u.set_state(at, other),
            1 => u.set_occupants(at, occupants + 1),
            2 => u.set_customers_in(at, more(c)),
            3 => u.set_hotel_customers_in(at, more(h)),
            4 => u.set_out_for_meal(at, more(o)),
            _ => u.set_residents(at, more(r)),
        }
        want += 1;
        assert_eq!(
            tower.view.marks.end(),
            want,
            "setter {change} logs its change"
        );
    }
}

/// Each frame field changed alone, through its setter, sends its room with
/// the new value.
#[test]
fn each_field_alone_reaches_the_frame() {
    let mut sim = served();
    let mut reader = ViewReader::new();
    reader.frame(&sim, false);
    let index = sim.tower.room_index();
    let more = |n: Option<i64>| Some(n.unwrap_or(0) + 1);
    for field in 0..5 {
        let slot = field;
        let (u, at) = sim.tower.marked(index[slot]);
        match field {
            0 => u.set_state(
                at,
                if u.state == UnitState::Dirty {
                    UnitState::Empty
                } else {
                    UnitState::Dirty
                },
            ),
            1 => u.set_occupants(at, u.occupants + 1),
            2 => u.set_customers_in(at, more(u.customers_in)),
            3 => u.set_hotel_customers_in(at, more(u.hotel_customers_in)),
            _ => u.set_out_for_meal(at, more(u.out_for_meal)),
        }
        let want = unit_fields(&sim.tower.units[index[slot]]).to_vec();
        let frame = reader.frame(&sim, false);
        assert_eq!(rooms(&frame), vec![(slot, want)], "field {field}");
        assert_eq!(frame[header::POPULATION], sim.population() as f64);
    }
}

/// Residents changed alone, through their setter, send no room (they are
/// not a frame field) and move the frame's population with the tower's.
#[test]
fn residents_alone_move_the_population() {
    let mut sim = super::session_tests::at("offshift-schedule-modern", "scheduled");
    let index = sim.tower.room_index();
    let home = index
        .iter()
        .copied()
        .find(|&i| sim.tower.units[i].kind.has_household())
        .expect("the scenario's condo");
    let (u, at) = sim.tower.marked(home);
    u.set_state(at, UnitState::Occupied);
    let mut reader = ViewReader::new();
    reader.frame(&sim, false);
    let before = sim.population();
    let (u, at) = sim.tower.marked(home);
    u.set_residents(at, Some(u.resident_count() + 2));
    assert_eq!(sim.population(), before + 2);
    let frame = reader.frame(&sim, false);
    assert_eq!(frame[header::UNITS], 0.0, "residents are not a frame field");
    assert_eq!(frame[header::POPULATION], sim.population() as f64);
}

/// A frame visits only the rooms the log names: a field written past the
/// setters stays unsent until a full frame, while a marked room is sent.
#[test]
fn a_frame_visits_only_the_marked_rooms() {
    let mut sim = served();
    let mut reader = ViewReader::new();
    reader.frame(&sim, false);
    let still = reader.frame(&sim, false);
    assert_eq!(still[header::UNITS], 0.0);
    assert_eq!(still[header::POPULATION], sim.population() as f64);
    let index = sim.tower.room_index();
    sim.tower.units[index[0]].occupants += 5;
    bump(&mut sim, index[1]);
    let frame = reader.frame(&sim, false);
    assert_eq!(frame[header::FULL], 0.0);
    assert_eq!(slots(&frame), vec![1], "only the marked room");
    let full = reader.frame(&sim, true);
    let sent = rooms(&full);
    assert_eq!(sent[0].1, unit_fields(&sim.tower.units[index[0]]).to_vec());
}

/// From half the rooms' worth of marks (repeats counted) a frame compares
/// every room, which sends what the marks would. A room written past the
/// setters shows which way the frame went, since only the compare sees it.
#[test]
fn marks_from_half_the_rooms_compare_every_room() {
    let mut sim = served();
    let mut reader = ViewReader::new();
    reader.frame(&sim, false);
    let index = sim.tower.room_index();
    assert!(index.len() >= 4, "{} rooms", index.len());
    let half = index.len().div_ceil(2);
    for (marks, want) in [(half - 1, vec![3]), (half, vec![0, 3])] {
        sim.tower.units[index[0]].occupants += 5;
        for _ in 0..marks {
            bump(&mut sim, index[3]);
        }
        let frame = reader.frame(&sim, false);
        assert_eq!(frame[header::FULL], 0.0);
        assert_eq!(slots(&frame), want, "{marks} marks, {} rooms", index.len());
    }
    let compared = reader.frame(&sim, false);
    assert_eq!(compared[header::UNITS], 0.0);
    assert_eq!(compared[header::POPULATION], sim.population() as f64);
    // The threshold itself, on an even and an odd room count, so `>` in
    // place of `>=` fails too.
    assert!(!compare_all(1, 4) && compare_all(2, 4));
    assert!(!compare_all(2, 5) && compare_all(3, 5));
}

/// Every frame moves the reader to the end of the log, the one that
/// compares every room too: the next frame with nothing marked visits no
/// room, so a room written past the setters after a frame stays unsent.
#[test]
fn a_frame_moves_the_reader_past_what_it_read() {
    let mut sim = served();
    let mut reader = ViewReader::new();
    reader.frame(&sim, false);
    let index = sim.tower.room_index();
    assert!(index.len() >= 4, "{} rooms", index.len());
    for marks in [1, index.len().div_ceil(2)] {
        for _ in 0..marks {
            bump(&mut sim, index[1]);
        }
        assert_eq!(slots(&reader.frame(&sim, false)), vec![1], "{marks} marks");
        sim.tower.units[index[1]].occupants += 5;
        let next = reader.frame(&sim, false);
        assert_eq!(next[header::UNITS], 0.0, "the frame after {marks} marks");
    }
}

/// A unit changed again after a reader read its first change is sent again:
/// the log keeps the repeat, since that reader has passed the first entry.
#[test]
fn a_change_after_a_read_is_sent() {
    let mut sim = served();
    let mut reader = ViewReader::new();
    reader.frame(&sim, false);
    let i = sim.tower.room_index()[1];
    for n in 1..=3 {
        bump(&mut sim, i);
        let occupants = sim.tower.units[i].occupants;
        let sent = rooms(&reader.frame(&sim, false));
        assert_eq!(sent.len(), 1, "change {n}: {sent:?}");
        assert_eq!(sent[0].1[unit::OCCUPANTS - unit::STATE], occupants as f64);
    }
}

/// A room whose only mark the log dropped is still sent: the reader that
/// fell behind compares every room once.
#[test]
fn a_reader_left_behind_compares_every_room_once() {
    let mut sim = served();
    let mut reader = ViewReader::new();
    reader.frame(&sim, false);
    let index = sim.tower.room_index();
    let (a, b, c) = (index[0], index[1], index[2]);
    let first = sim.tower.view.marks.end();
    bump(&mut sim, c);
    // Alternate `a` and `b` past the cap, so `c`'s mark is dropped; the
    // last write leaves `a` changed and `b` where it started.
    let (a0, b0) = (sim.tower.units[a].occupants, sim.tower.units[b].occupants);
    for n in 0..MARK_CAP + 1 {
        bump(&mut sim, if n % 2 == 0 { a } else { b });
    }
    let (u, at) = sim.tower.marked(b);
    u.set_occupants(at, b0);
    assert_eq!(sim.tower.view.marks.unread(first), None, "c's mark is gone");
    let frame = reader.frame(&sim, false);
    assert_eq!(
        frame[header::FULL],
        0.0,
        "a compare of every room, with no full frame"
    );
    let sent = rooms(&frame);
    assert_eq!(
        sent.iter().map(|r| r.0).collect::<Vec<_>>(),
        vec![0, 2],
        "{sent:?}"
    );
    let a_now = a0 + (MARK_CAP as i64 + 2) / 2;
    assert_eq!(sent[0].1[unit::OCCUPANTS - unit::STATE], a_now as f64);
    assert_eq!(frame[header::POPULATION], sim.population() as f64);
}

/// Two readers on one log each keep their own place: one that read nothing
/// for a while still ends with every room as a fresh read has it. The
/// early reader reads after each minute until the late one has marks to
/// read, few enough that the late frame reads them from the log.
#[test]
fn readers_keep_their_own_place_in_the_log() {
    let mut sim = served();
    let mut early = ViewReader::new();
    let mut late = ViewReader::new();
    early.frame(&sim, false);
    let mut kept = rooms(&late.frame(&sim, false));
    let start = kept.clone();
    let place = sim.tower.view.marks.end();
    for _ in 0..60 {
        sim.tick(1.0);
        let a = early.frame(&sim, false);
        assert_eq!(a[header::POPULATION], sim.population() as f64);
        if sim.tower.view.marks.unread(place) != Some(0) {
            break;
        }
    }
    let unread = sim.tower.view.marks.unread(place).unwrap();
    assert!(
        unread > 0 && !compare_all(unread, kept.len()),
        "{unread} marks, {} rooms",
        kept.len()
    );
    let b = late.frame(&sim, false);
    assert_eq!(b[header::FULL], 0.0);
    for (slot, fields) in rooms(&b) {
        kept[slot].1 = fields;
    }
    let fresh = rooms(&ViewReader::new().frame(&sim, true));
    assert_eq!(kept, fresh);
    assert_ne!(kept, start, "the ticks changed some room");
    assert_eq!(b[header::POPULATION], sim.population() as f64);
}

/// A reader handed another tower sends a full frame, even when the towers'
/// revision and unit count agree, since each tower's log has its own id.
/// The towers' logs part by a setter call, which moves neither.
#[test]
fn a_reader_on_another_tower_sends_a_full_frame() {
    let mut a = served();
    let b = served();
    let mut reader = ViewReader::new();
    reader.frame(&a, false);
    let i = a.tower.room_index()[1];
    bump(&mut a, i);
    reader.frame(&a, false);
    assert_eq!(
        (a.tower.revision, a.tower.units.len()),
        (b.tower.revision, b.tower.units.len())
    );
    let frame = reader.frame(&b, false);
    assert_eq!(frame[header::FULL], 1.0);
    assert_eq!(frame[header::POPULATION], b.population() as f64);
}

/// After the log has wrapped (it dropped its oldest marks), a reader that
/// kept up still reads it, and the log answers a reader exactly
/// `MARK_CAP` marks behind and no further.
#[test]
fn a_wrapped_log_still_answers_a_reader_in_step() {
    let mut sim = served();
    let mut reader = ViewReader::new();
    reader.frame(&sim, false);
    let index = sim.tower.room_index();
    let (a, b, c) = (index[0], index[1], index[2]);
    for _ in 0..MARK_CAP + 1 {
        bump(&mut sim, a);
    }
    reader.frame(&sim, false);
    assert_eq!(sim.tower.view.marks.unread(0), None, "the log wrapped");
    sim.tower.units[c].occupants += 5;
    bump(&mut sim, b);
    let frame = reader.frame(&sim, false);
    assert_eq!(slots(&frame), vec![1], "a wrapped log still names the room");
    let from = sim.tower.view.marks.end();
    for _ in 0..MARK_CAP {
        bump(&mut sim, a);
    }
    assert_eq!(sim.tower.view.marks.unread(from), Some(MARK_CAP));
    let mut read = Vec::new();
    assert!(sim.tower.view.marks.read_since(from, &mut read));
    assert_eq!(read, vec![a; MARK_CAP]);
    bump(&mut sim, a);
    assert_eq!(sim.tower.view.marks.unread(from), None, "one past the cap");
}

/// A position past the log's end is one this log never gave: the log
/// answers nothing for it.
#[test]
fn a_position_past_the_end_reads_nothing() {
    let sim = served();
    let marks = &sim.tower.view.marks;
    let mut out = Vec::new();
    assert_eq!(marks.unread(marks.end() + 1), None);
    assert!(!marks.read_since(marks.end() + 1, &mut out));
    assert!(out.is_empty());
    assert_eq!(marks.unread(marks.end()), Some(0));
    assert!(marks.read_since(marks.end(), &mut out));
}
