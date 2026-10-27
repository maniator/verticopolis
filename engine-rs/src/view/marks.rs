//! Write-site marks for the dynamic frame. The engine's own writes of a
//! room's frame fields (state, occupants, customersIn, hotelCustomersIn,
//! outForMeal) and its residents, which the census counts, go through the
//! setters below, the save loader and a new unit's construction aside; the
//! fields stay `pub`, so `marks_tests.rs` scans the sources to keep it so.
//! Each setter takes a [`Mark`], the tower's mark log and the unit's index,
//! and logs the index when it changes a value. A frame reader reads the log
//! from where its last frame stopped, so a frame visits the rooms that
//! changed instead of every room.
//!
//! The log holds unit indices. They move only with `tower.revision` (a
//! removal shifts the list, `reindex` rebuilds it), and a moved revision
//! makes every reader's next frame full, so no reader reads an index logged
//! before a move against the list after it. Each log has its own id, which a
//! reader keys its frames on, so a reader handed another tower's log starts
//! with a full frame.
use std::cell::RefCell;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::tower::{Unit, UnitState};

/// The most indices the log holds; each mark past it drops the oldest. A
/// reader more than this many marks behind compares every room once
/// instead. A frame sees a few steps' changes, a few thousand at the most
/// (the hourly head count can change every room), so a reader in play
/// stays well inside it.
pub(super) const MARK_CAP: usize = 16_384;

/// The next log's id: ids are never reused, so two towers' logs never share
/// one. It is outside the simulation and every hash.
static NEXT_LOG: AtomicU64 = AtomicU64::new(1);

/// The tower's mark log: the unit indices the setters changed, oldest first.
/// It sits in a `RefCell` so a setter can log through a shared borrow of the
/// tower's `view` while the unit itself is borrowed mutably from `units`.
pub struct FrameMarks {
    id: u64,
    log: RefCell<MarkLog>,
}

impl Default for FrameMarks {
    fn default() -> FrameMarks {
        FrameMarks {
            id: NEXT_LOG.fetch_add(1, Ordering::Relaxed),
            log: RefCell::default(),
        }
    }
}

/// `base` counts the marks dropped from the front, so `base + entries.len()`
/// is the number of marks ever made: a position a reader can keep.
#[derive(Default)]
struct MarkLog {
    entries: VecDeque<u32>,
    base: u64,
}

impl FrameMarks {
    /// The mark the setters of the unit at index `i` in `units` take.
    pub(crate) fn at(&self, i: usize) -> Mark<'_> {
        Mark { marks: self, i }
    }

    fn note(&self, i: usize) {
        // No check against the newest entry: a reader may have read it
        // already, so a repeat must be logged again. A reader drops repeats.
        let mut log = self.log.borrow_mut();
        if log.entries.len() >= MARK_CAP {
            log.entries.pop_front();
            log.base += 1;
        }
        debug_assert!(u32::try_from(i).is_ok(), "unit index {i}");
        log.entries.push_back(i as u32);
    }

    /// This log's id, which no other log shares.
    pub(super) fn id(&self) -> u64 {
        self.id
    }

    /// The position after the newest mark.
    pub(super) fn end(&self) -> u64 {
        let log = self.log.borrow();
        log.base + log.entries.len() as u64
    }

    /// Append the indices marked at position `from` and after to `out`,
    /// oldest first, and return true; or return false, appending nothing,
    /// when the log has dropped some of them or `from` is past its end (a
    /// position this log never gave).
    pub(super) fn read_since(&self, from: u64, out: &mut Vec<usize>) -> bool {
        let log = self.log.borrow();
        let end = log.base + log.entries.len() as u64;
        if from < log.base || from > end {
            return false;
        }
        let start = (from - log.base) as usize;
        out.extend(log.entries.range(start..).map(|&i| i as usize));
        true
    }
}

/// One unit's place in the mark log: what its setters log.
#[derive(Clone, Copy)]
pub struct Mark<'a> {
    marks: &'a FrameMarks,
    i: usize,
}

impl Unit {
    /// Set the state, logging the unit when it changes.
    pub(crate) fn set_state(&mut self, at: Mark<'_>, state: UnitState) {
        if self.state != state {
            self.state = state;
            at.marks.note(at.i);
        }
    }

    /// Set the head count, logging the unit when it changes.
    pub(crate) fn set_occupants(&mut self, at: Mark<'_>, occupants: i64) {
        if self.occupants != occupants {
            self.occupants = occupants;
            at.marks.note(at.i);
        }
    }

    /// Set the customers inside, logging the unit when they change.
    pub(crate) fn set_customers_in(&mut self, at: Mark<'_>, n: Option<i64>) {
        if self.customers_in != n {
            self.customers_in = n;
            at.marks.note(at.i);
        }
    }

    /// Set the hotel guests among the customers, logging the unit when they
    /// change.
    pub(crate) fn set_hotel_customers_in(&mut self, at: Mark<'_>, n: Option<i64>) {
        if self.hotel_customers_in != n {
            self.hotel_customers_in = n;
            at.marks.note(at.i);
        }
    }

    /// Set the occupants out for a meal, logging the unit when they change.
    pub(crate) fn set_out_for_meal(&mut self, at: Mark<'_>, n: Option<i64>) {
        if self.out_for_meal != n {
            self.out_for_meal = n;
            at.marks.note(at.i);
        }
    }

    /// Set the household size, logging the unit when it changes: the census,
    /// which the frame header's population sums, counts it.
    pub(crate) fn set_residents(&mut self, at: Mark<'_>, n: Option<i64>) {
        if self.residents != n {
            self.residents = n;
            at.marks.note(at.i);
        }
    }
}

impl crate::tower::Tower {
    /// The unit at index `i` in `units` and its mark, for its setters.
    pub(crate) fn marked(&mut self, i: usize) -> (&mut Unit, Mark<'_>) {
        (&mut self.units[i], self.view.marks.at(i))
    }

    /// Every unit in list order with its mark, for a loop over the units
    /// that calls their setters.
    pub(crate) fn marked_units(&mut self) -> impl Iterator<Item = (&mut Unit, Mark<'_>)> {
        let marks = &self.view.marks;
        self.units
            .iter_mut()
            .enumerate()
            .map(move |(i, u)| (u, marks.at(i)))
    }

    /// The unit with this id and its mark, for its setters; `None` for an
    /// unknown id.
    pub(crate) fn marked_by_id(&mut self, id: i64) -> Option<(&mut Unit, Mark<'_>)> {
        let &i = self.by_id.get(&id)?;
        Some(self.marked(i))
    }
}
