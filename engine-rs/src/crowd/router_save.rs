//! What the Modern router reads at the first step after a load, saved with
//! the crowd: the lines at each shaft (`lines`), the cars the schedule
//! stood down (`closedCars`) and the waits riders had at each stop
//! (`waitsSeen`). All are written by `save.rs`; a save without them loads
//! with none, as the router starts on a fresh crowd.

use serde_json::{json, Value};

use crate::charges::whole;
use crate::crowd::line_count::waits_seen::{Seen, MAX_SAVED_STOPS};
use crate::crowd::save::MAX_SAVED_PEOPLE;
use crate::crowd::Crowd;

/// The most stood-down cars a save restores: every car of a full elevator
/// pool (24 shafts of 8 cars), with room to spare.
const MAX_SAVED_CLOSED_CARS: usize = 256;

/// The whole numbers of a `[n, ...]` row of `len` entries, or `None`.
fn row_of(row: &Value, len: usize) -> Option<Vec<i64>> {
    let row = row.as_array().filter(|r| r.len() == len)?;
    row.iter().map(|v| v.as_f64().and_then(whole)).collect()
}

impl Crowd {
    /// The lines the Modern router reads at the next step (`shaft_lines`):
    /// `[[shaft, floor, riders], ...]`. A row that does not read, or names
    /// nobody, is skipped.
    pub(crate) fn restore_lines(&mut self, rows: Option<&Value>) {
        let Some(rows) = rows.and_then(Value::as_array) else {
            return;
        };
        for row in rows.iter().take(MAX_SAVED_PEOPLE) {
            if let Some(&[shaft, floor, riders]) = row_of(row, 3).as_deref() {
                if riders > 0 {
                    let line = crate::crowd::line_count::Line {
                        riders,
                        oldest: 0.0,
                    };
                    self.shaft_lines.insert((shaft, floor), line);
                }
            }
        }
    }

    /// The cars the schedule stood down, as the last step left them
    /// (`closed_cars`): the Modern router's first routes in a step read them
    /// before the step's cars move (#2229). `[[shaft, car], ...]`, kept
    /// ascending; a pair that does not read is skipped.
    pub(crate) fn restore_closed_cars(&mut self, rows: Option<&Value>) {
        let Some(rows) = rows.and_then(Value::as_array) else {
            return;
        };
        for row in rows.iter().take(MAX_SAVED_CLOSED_CARS) {
            if let Some(&[shaft, car]) = row_of(row, 2).as_deref() {
                self.closed_cars.push((shaft, car));
            }
        }
        self.closed_cars.sort_unstable();
        self.closed_cars.dedup();
    }

    /// The remembered waits as save rows, `[[shaft, floor, wait, fade],
    /// ...]`, ascending.
    pub(crate) fn waits_seen_json(&self) -> Value {
        let rows: Vec<Value> = (self.waits_seen.rows().into_iter())
            .map(|(shaft, floor, wait, fade)| json!([shaft, floor, wait, fade]))
            .collect();
        Value::Array(rows)
    }

    /// The waits riders had at each stop (`waits_seen`), as the last step
    /// left them. A row that does not read is skipped.
    pub(crate) fn restore_waits_seen(&mut self, rows: Option<&Value>) {
        let Some(rows) = rows.and_then(Value::as_array) else {
            return;
        };
        for row in rows.iter().take(MAX_SAVED_STOPS) {
            let Some(row) = row.as_array().filter(|r| r.len() == 4) else {
                continue;
            };
            let at = |i: usize| row[i].as_f64();
            let (Some(shaft), Some(floor)) = (at(0).and_then(whole), at(1).and_then(whole)) else {
                continue;
            };
            if let (Some(wait), Some(fade)) = (at(2), at(3)) {
                self.waits_seen.restore(shaft, floor, Seen { wait, fade });
            }
        }
    }
}
