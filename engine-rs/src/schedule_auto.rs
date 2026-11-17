//! The daily Auto-tune (Modern; owner, 2026-11-17). Every game morning the
//! engine re-tunes the active-car rows of each elevator whose schedule has
//! Auto on, from the same proposal the dialog's Auto-tune button applies
//! (`schedule_authoring.rs`). A schedule tuned once goes stale as the tower
//! grows; this keeps it following the traffic the shaft measures.
//!
//! The pass owns the weekday and weekend rows and nothing else: staging
//! homes, the door time and the waiting-car response stay the player's. A day
//! type with too little measured traffic keeps its row, and so does every
//! hour the shaft has not measured (the proposal keeps the draft's count). The pass draws no
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
        if !self.tower.runs_an_auto_schedule() {
            return;
        }
        // Each elevator's stops are read once, as a floor set, so finding a
        // shaft's twins is one set comparison per elevator.
        let stops = self.elevator_stop_sets();
        let mut retunes: Vec<Retune> = Vec::new();
        for (i, t) in self.tower.transports.iter().enumerate() {
            let Some(current) = t.schedule.as_ref().filter(|s| s.auto_tune) else {
                continue;
            };
            // The current schedule is the draft, so a cold day keeps its row.
            let twins = self.twins_of(i, &stops);
            let Some((weekday, weekend)) = self.tuned_rows(t, Some(current), &twins) else {
                continue;
            };
            let moved = weekday != current.weekday || weekend != current.weekend;
            if moved || current.held_back.is_some() {
                retunes.push((i, weekday, weekend));
            }
        }
        // No tower revision moves: the rows only pick the cars in service,
        // which every step reads live (they change on the hour anyway), and
        // nothing cached by revision reads them. A bump would rebuild the
        // routing graph and the stop lists every morning for nothing.
        for (i, weekday, weekend) in retunes {
            if let Some(s) = self.tower.transports[i].schedule.as_mut() {
                s.weekday = weekday;
                s.weekend = weekend;
                // The rows are the engine's now, so no hour is the player's
                // to hold back (#1546).
                s.held_back = None;
            }
        }
    }
}

#[cfg(test)]
#[path = "schedule_auto_tests.rs"]
mod tests;
