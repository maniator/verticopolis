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
    /// Ascending, as (shaft id, car index): `move_cars` sorts the list once it
    /// has walked every shaft, since a save may list its shafts out of id
    /// order, so a binary search finds a car.
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
