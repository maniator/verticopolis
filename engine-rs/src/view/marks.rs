//! Write-site marks for the dynamic frame. A room's frame fields (state,
//! occupants, customersIn, hotelCustomersIn, outForMeal) and its residents,
//! which the census counts, change only through the setters below, the save
//! loader and a new unit's construction aside. Each setter takes a [`Mark`],
//! the tower's mark log and the unit's index, and logs the index when it
//! changes a value. A frame reader reads the log from where its last frame
//! stopped, so a frame visits the rooms that changed instead of every room.
//!
//! The log holds unit indices. They move only with `tower.revision` (a
//! removal shifts the list, `reindex` rebuilds it), and a moved revision
//! makes every reader's next frame full, so no reader reads an index logged
//! before a move against the list after it.
use std::cell::RefCell;

use crate::tower::{Unit, UnitState};

/// The most indices the log holds before it drops its older half. A reader
/// that falls further behind than that compares every room once instead.
/// A frame sees a few steps' changes, a few thousand at the most (the hourly
/// head count can change every room), so a reader in play never falls this
/// far behind.
pub(super) const MARK_CAP: usize = 16_384;

/// The tower's mark log: the unit indices the setters changed, oldest first.
/// It sits in a `RefCell` so a setter can log through a shared borrow of the
/// tower's `view` while the unit itself is borrowed mutably from `units`.
#[derive(Default)]
pub struct FrameMarks(RefCell<MarkLog>);

/// `base` counts the marks dropped from the front, so `base + entries.len()`
/// is the number of marks ever made: a position a reader can keep.
#[derive(Default)]
struct MarkLog {
    entries: Vec<usize>,
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
        let mut log = self.0.borrow_mut();
        if log.entries.len() >= MARK_CAP {
            let drop = log.entries.len() / 2;
            log.entries.drain(..drop);
            log.base += drop as u64;
        }
        log.entries.push(i);
    }

    /// The position after the newest mark.
    pub(super) fn end(&self) -> u64 {
        let log = self.0.borrow();
        log.base + log.entries.len() as u64
    }

    /// Append the indices marked at position `from` and after to `out`,
    /// oldest first, and return true; or return false, appending nothing,
    /// when the log has dropped some of them.
    pub(super) fn read_since(&self, from: u64, out: &mut Vec<usize>) -> bool {
        let log = self.0.borrow();
        if from < log.base {
            return false;
        }
        let start = usize::try_from(from - log.base)
            .unwrap_or(usize::MAX)
            .min(log.entries.len());
        out.extend_from_slice(&log.entries[start..]);
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

    /// The unit with this id and its mark, for its setters; `None` for an
    /// unknown id.
    pub(crate) fn marked_by_id(&mut self, id: i64) -> Option<(&mut Unit, Mark<'_>)> {
        let &i = self.by_id.get(&id)?;
        Some(self.marked(i))
    }
}
