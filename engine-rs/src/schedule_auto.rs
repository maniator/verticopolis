//! The daily Auto-tune (Modern; owner, 2026-11-17). Every game morning the
//! engine re-tunes the active-car rows of each elevator whose schedule has
//! Auto on, from the same proposal the dialog's Auto-tune button applies
//! (`schedule_authoring.rs`). A schedule tuned once goes stale as the tower
//! grows; this keeps it following the traffic the shaft measures.
//!
//! The pass owns the weekday and weekend rows and nothing else: staging
//! homes, the door time and the waiting-car response stay the player's. A day
//! type with too little measured traffic keeps its row. The pass draws no
//! rng, logs nothing and opens no undo journal; an older undo step on the
//! shaft still applies, since `Transport::config_eq` leaves the rows Auto
//! owns out of its comparison (`Schedule::same_but_auto_rows`).

use crate::sim::Simulation;

/// The save version a tower with an elevator on Auto is written at: an older
/// build would drop the flag and stop re-tuning the shaft without a word, so
/// it refuses the save instead.
pub const AUTO_TUNE_SAVE_VERSION: i64 = 12;

/// The hour the pass runs: after the night is measured and before offices
/// start arriving at 7 (`crowd::workplace::ARRIVE_FROM`), so no car leaves
/// service in the middle of a rush.
pub const AUTO_TUNE_HOUR: i64 = 5;

/// The rows the pass writes to one shaft, by its index in the tower.
type Retune = (usize, Option<Vec<i64>>, Option<Vec<i64>>);

#[doc(hidden)]
impl Simulation {
    /// Re-tune every Auto schedule's rows, once a day at [`AUTO_TUNE_HOUR`],
    /// in Modern only. Called from the hourly pass.
    pub(crate) fn retune_auto_schedules(&mut self) {
        if self.clock.hour() != AUTO_TUNE_HOUR || !self.mode.schedule_assist() {
            return;
        }
        let weekend = self.clock.is_weekend();
        let mut retunes: Vec<Retune> = Vec::new();
        for (i, t) in self.tower.transports.iter().enumerate() {
            let Some(current) = t.schedule.as_ref().filter(|s| s.auto_tune) else {
                continue;
            };
            // The current schedule is the draft, so a cold day keeps its row;
            // the proposal's staging is left unread.
            let Some(rows) = self.auto_tune_proposal(t.id, Some(current), weekend).proposal else {
                continue;
            };
            let rings = self.telemetry.hourly.get(&t.id);
            let keep = |tuned: Option<Vec<i64>>, weekend: bool| {
                let sampled = rings.map(|r| r.day(weekend).1);
                let row = if weekend { &current.weekend } else { &current.weekday };
                keep_unmeasured_hours(tuned, row.as_deref(), sampled, t.cars)
            };
            let (weekday, weekend_row) = (keep(rows.weekday, false), keep(rows.weekend, true));
            let moved = weekday != current.weekday || weekend_row != current.weekend;
            if moved || current.held_back.is_some() {
                retunes.push((i, weekday, weekend_row));
            }
        }
        if retunes.is_empty() {
            return;
        }
        for (i, weekday, weekend) in retunes {
            if let Some(s) = self.tower.transports[i].schedule.as_mut() {
                s.weekday = weekday;
                s.weekend = weekend;
                // The rows are the engine's now, so no hour is the player's
                // to hold back (#1546).
                s.held_back = None;
            }
        }
        self.tower.revision += 1;
    }
}

/// A tuned row with every hour the shaft has not measured kept at the count
/// it runs now (every car, when the row is unset). A warm day can still
/// hold hours nobody has sampled, such as the hours before a reload or a
/// new shaft's first night, and a tune would read them as idle and cut them
/// to one car, the morning rush included.
fn keep_unmeasured_hours(
    tuned: Option<Vec<i64>>,
    current: Option<&[i64]>,
    sampled: Option<&[bool]>,
    cars: i64,
) -> Option<Vec<i64>> {
    let mut row = tuned?;
    for (h, n) in row.iter_mut().enumerate() {
        if !sampled.is_some_and(|s| s.get(h) == Some(&true)) {
            *n = current.and_then(|c| c.get(h)).copied().unwrap_or(cars).clamp(0, cars);
        }
    }
    Some(row)
}

#[cfg(test)]
#[path = "schedule_auto_tests.rs"]
mod tests;
