//! What the dispatch hands out after a step: the boarding tally, the closed
//! and open cars, and the waiting estimate at a floor.

use std::collections::HashMap;

use indexmap::IndexMap;

use super::{ElevatorDispatch, OpenCar};

impl ElevatorDispatch {
    /// `drainBoardings()`: hand over the tally and clear it.
    pub fn drain_boardings(&mut self) -> HashMap<i64, IndexMap<i64, f64>> {
        std::mem::take(&mut self.board_tally)
    }

    /// The cars a waiting person may not board: stood down by the schedule.
    /// Ascending, as (shaft id, car index), so a binary search finds a car:
    /// `move_cars` puts the shafts' runs in id order once it has walked them
    /// (`DoorRuns`), since a save may list its shafts out of id order.
    pub fn closed_cars(&self) -> &[(i64, i64)] {
        &self.closed_cars
    }

    /// Hands the crowd this step's closed cars by swapping the two lists, so
    /// no step allocates. `move_cars` clears the list it gets back.
    pub fn swap_closed_cars(&mut self, crowd_list: &mut Vec<(i64, i64)>) {
        std::mem::swap(&mut self.closed_cars, crowd_list);
    }

    /// The cars standing at a stop with their doors open, as (shaft id, car
    /// index, floor, the way it leaves), ascending, so a binary search finds a
    /// car at a floor.
    pub fn open_cars(&self) -> &[OpenCar] {
        &self.open_cars
    }

    /// Hands the crowd this step's open cars by swapping the two lists, as
    /// `swap_closed_cars` does. `move_cars` clears the list it gets back.
    pub fn swap_open_cars(&mut self, crowd_list: &mut Vec<OpenCar>) {
        std::mem::swap(&mut self.open_cars, crowd_list);
    }

    pub fn waiting_at(&self, floor: i64) -> f64 {
        self.waiting.get(&floor).copied().unwrap_or(0.0)
    }
}

/// Where each shaft's cars start in the two door lists, in the order
/// `move_cars` walks the shafts, and scratch to put the lists in shaft id
/// order (#2060). A shaft adds its cars to each list in car order, so each
/// shaft's run is already in order, and only the runs need putting in id
/// order: a copy per chunk, never a sort, and nothing at all when the
/// shafts come in id order.
#[derive(Default)]
pub(super) struct DoorRuns {
    closed_starts: Vec<usize>,
    open_starts: Vec<usize>,
    closed_scratch: Vec<(i64, i64)>,
    open_scratch: Vec<OpenCar>,
}

impl DoorRuns {
    /// A new chunk: no shaft walked yet.
    pub(super) fn clear(&mut self) {
        self.closed_starts.clear();
        self.open_starts.clear();
    }

    /// The next shaft in the walk starts its runs at the lists' ends.
    pub(super) fn start_shaft(&mut self, closed: &[(i64, i64)], open: &[OpenCar]) {
        self.closed_starts.push(closed.len());
        self.open_starts.push(open.len());
    }

    /// Puts both lists in shaft id order: `by_id` lists the walk's places in
    /// id order (`DispatchFloors::elevators_by_id`), empty when the walk
    /// already was.
    pub(super) fn put_in_id_order(
        &mut self,
        by_id: &[usize],
        closed: &mut Vec<(i64, i64)>,
        open: &mut Vec<OpenCar>,
    ) {
        if !by_id.is_empty() {
            in_order(by_id, &self.closed_starts, closed, &mut self.closed_scratch);
            in_order(by_id, &self.open_starts, open, &mut self.open_scratch);
        }
        debug_assert!(
            closed.is_sorted() && open.is_sorted(),
            "a door list is out of order"
        );
    }
}

/// Copies the runs of `list` (shaft `k`'s from `starts[k]` to the next
/// shaft's start) in the order `by_id` gives, then swaps the copy in.
fn in_order<T: Copy>(by_id: &[usize], starts: &[usize], list: &mut Vec<T>, scratch: &mut Vec<T>) {
    scratch.clear();
    for &k in by_id {
        let end = starts.get(k + 1).copied().unwrap_or(list.len());
        scratch.extend_from_slice(&list[starts[k]..end]);
    }
    std::mem::swap(list, scratch);
}
