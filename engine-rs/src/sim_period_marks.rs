//! The marks the step loop keeps for the last hour, maintenance period and
//! quarter it handled (`last_hour`, `last_month`, `last_quarter`). A load
//! sets them from the clock, which is where any game that has played a day
//! has them. A new game starts them at -1, so its first day's end bills the
//! first maintenance and collects the first quarter's office rent (and its
//! first step runs the hour's work). A save from that first day carries the
//! marks that differ from the clock's (`periodMarks`), so the reloaded game
//! bills exactly as the unsaved one would.

use serde_json::{json, Map, Value};

use crate::charges::whole;
use crate::sim::Simulation;

/// The save's name for each mark.
const HOUR: &str = "hour";
const MONTH: &str = "month";
const QUARTER: &str = "quarter";

/// A mark as a save writes it: a whole number, -1 (not handled yet) or more.
fn mark(v: &Value) -> Option<i64> {
    v.as_f64().and_then(whole).filter(|&n| n >= -1)
}

impl Simulation {
    /// The maintenance period the clock is in: the mark `on_day` compares
    /// with `last_month`.
    pub(crate) fn maintenance_period(&self) -> i64 {
        (self.clock.day() as f64 / self.clock.calendar.maint_period_days as f64).floor() as i64
    }

    /// The marks as the clock gives them: (hour, maintenance period, quarter).
    fn clock_marks(&self) -> (i64, i64, i64) {
        (
            self.clock.hour(),
            self.maintenance_period(),
            self.clock.quarter(),
        )
    }

    /// Sets the marks from the clock, as a load does.
    pub(crate) fn set_marks_from_clock(&mut self) {
        (self.last_hour, self.last_month, self.last_quarter) = self.clock_marks();
    }

    /// The marks that differ from the clock's, as the save's `periodMarks`
    /// object, or `None` when the clock gives them all (every game past its
    /// first day).
    pub(crate) fn period_marks_json(&self) -> Option<Value> {
        let (hour, month, quarter) = self.clock_marks();
        let mut m = Map::new();
        for (key, kept, clock) in [
            (HOUR, self.last_hour, hour),
            (MONTH, self.last_month, month),
            (QUARTER, self.last_quarter, quarter),
        ] {
            if kept != clock {
                m.insert(key.into(), json!(kept));
            }
        }
        (!m.is_empty()).then_some(Value::Object(m))
    }

    /// Takes the marks a save's `periodMarks` object carries over the ones
    /// the clock gave. A mark that is missing or does not read keeps the
    /// clock's.
    pub(crate) fn restore_period_marks(&mut self, v: &Value) {
        if let Some(n) = v.get(HOUR).and_then(mark) {
            self.last_hour = n;
        }
        if let Some(n) = v.get(MONTH).and_then(mark) {
            self.last_month = n;
        }
        if let Some(n) = v.get(QUARTER).and_then(mark) {
            self.last_quarter = n;
        }
    }
}

#[cfg(test)]
#[path = "sim_period_marks_tests.rs"]
mod tests;
