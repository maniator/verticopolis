//! The elevators' hourly load rings in a save (`elevatorLoad`). The daily
//! Auto-tune (`schedule_auto.rs`) re-tunes a shaft from them, so a tower
//! with a shaft on Auto carries them, and a reload re-tunes the next morning
//! as the game that saved would. A tower with no shaft on Auto leaves them
//! out, as every save did before: nothing else the game plays reads them.
//!
//! Each entry is `[id, { weekday, weekend, weekdayHours, weekendHours }]`:
//! the 24 loads of each day type and the hours of it the sampler has
//! measured, ascending. A load reads back the entries of shafts the tower
//! still has, and an entry that does not fit the shape is skipped, never
//! failing the load.

use serde_json::{json, Value};

use crate::schedule::SCHEDULE_HOURS;
use crate::sim::Simulation;
use crate::telemetry::HourlyByDay;

/// The save key.
pub(crate) const ELEVATOR_LOAD_KEY: &str = "elevatorLoad";

/// The hours a sampled list marks, ascending.
fn hours_of(sampled: &[bool]) -> Vec<usize> {
    (0..sampled.len()).filter(|&h| sampled[h]).collect()
}

/// The 24 sampled flags a list of hours names, or `None` when one is not an
/// hour of the day.
fn sampled_of(v: Option<&Value>) -> Option<Vec<bool>> {
    let mut sampled = vec![false; SCHEDULE_HOURS];
    for h in v?.as_array()? {
        let h = usize::try_from(h.as_u64()?).ok()?;
        *sampled.get_mut(h)? = true;
    }
    Some(sampled)
}

/// A day's 24 loads, each finite and from 0 to 1.
fn loads_of(v: Option<&Value>) -> Option<Vec<f64>> {
    let a = v?.as_array()?;
    if a.len() != SCHEDULE_HOURS {
        return None;
    }
    a.iter()
        .map(|x| x.as_f64().filter(|f| (0.0..=1.0).contains(f)))
        .collect()
}

fn rings_of(v: &Value) -> Option<HourlyByDay> {
    Some(HourlyByDay {
        weekday: loads_of(v.get("weekday"))?,
        weekend: loads_of(v.get("weekend"))?,
        weekday_sampled: sampled_of(v.get("weekdayHours"))?,
        weekend_sampled: sampled_of(v.get("weekendHours"))?,
    })
}

#[doc(hidden)]
impl Simulation {
    /// The rings a save carries: `Some` only when a shaft is on Auto and a
    /// shaft has been measured.
    pub(crate) fn elevator_load_json(&self) -> Option<Value> {
        if !self.tower.runs_an_auto_schedule() || self.telemetry.hourly.is_empty() {
            return None;
        }
        let entries = self.telemetry.hourly.iter().map(|(id, r)| {
            json!([id, {
                "weekday": r.weekday,
                "weekend": r.weekend,
                "weekdayHours": hours_of(&r.weekday_sampled),
                "weekendHours": hours_of(&r.weekend_sampled),
            }])
        });
        Some(Value::Array(entries.collect()))
    }

    /// Take the rings a save's `elevatorLoad` carries, for the elevators the
    /// tower has, in the save's order.
    pub(crate) fn restore_elevator_load(&mut self, v: &Value) {
        let Some(entries) = v.as_array() else {
            return;
        };
        for entry in entries {
            let Some([id, rings]) = entry.as_array().map(Vec::as_slice) else {
                continue;
            };
            let Some(id) = id.as_i64() else {
                continue;
            };
            let elevator = self
                .tower
                .get_transport(id)
                .is_some_and(|t| t.kind.is_elevator());
            if let (true, Some(rings)) = (elevator, rings_of(rings)) {
                self.telemetry.hourly.insert(id, rings);
            }
        }
    }
}

#[cfg(test)]
#[path = "telemetry_save_tests.rs"]
mod tests;
