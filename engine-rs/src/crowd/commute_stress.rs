//! The commute-stress averages (#514, #1971): each finished tenant trip
//! folds its wait onto its tenant's floor, and the satisfaction step reads
//! that floor's average against the mode's limit
//! (`GameMode::commute_wait_congestion`).

use serde_json::{json, Value};

use super::{fasthash, Crowd, Person, COMMUTE_STRESS_ALPHA, COMMUTE_STRESS_PRIOR};
use crate::clock::GameMode;

/// The wait a finished tenant trip folds onto its floor: everything it
/// waited, and when the trip ran out of patience and turned back, at least
/// the over-limit wait the mode counts a give-up as
/// (`GameMode::given_up_commute_wait`, owner, 2026-11-17, #2019). A rider
/// runs out of patience at about the limit, and one who turns back stops
/// counting their wait, so without that a jam that strands a floor's
/// commuters would hardly lift its average past the limit, and its tenants
/// would stay.
pub(super) fn finished_trip_wait(p: &Person, mode: GameMode) -> f64 {
    let waited = p.trip_wait + p.wait;
    if p.gave_up {
        waited.max(mode.given_up_commute_wait())
    } else {
        waited
    }
}

impl Crowd {
    /// Folds a finished trip's wait onto its tenant floor's average: an
    /// exponential average by [`COMMUTE_STRESS_ALPHA`], starting from
    /// [`COMMUTE_STRESS_PRIOR`] on a floor with no average yet.
    pub fn record_commute(&mut self, origin_floor: i64, wait_seconds: f64) {
        self.commute_revision = self.commute_revision.wrapping_add(1);
        let prev = self
            .commute_wait_by_floor
            .get(&origin_floor)
            .copied()
            .unwrap_or(COMMUTE_STRESS_PRIOR);
        self.commute_wait_by_floor.insert(
            origin_floor,
            prev + (wait_seconds - prev) * COMMUTE_STRESS_ALPHA,
        );
    }

    /// Replace the commute-stress averages with `[[floor, seconds], ...]`
    /// rows, the shape [`Crowd::commute_stress_json`] writes: a save carries
    /// them in its crowd, and a host may seed them at attach (#1083). The revision is
    /// left alone. Refuses rows that are not whole floors with finite
    /// seconds, or that name a floor twice, and then changes nothing.
    pub fn seed_commute_stress(&mut self, rows: &Value) -> Result<(), String> {
        let bad =
            || "commuteStress must be [[floor, seconds], ...] with each floor once".to_string();
        let mut seeded = fasthash::FastMap::default();
        for row in rows.as_array().ok_or_else(bad)? {
            let pair = row.as_array().filter(|p| p.len() == 2).ok_or_else(bad)?;
            let floor = pair[0]
                .as_f64()
                .filter(|f| f.fract() == 0.0 && f.abs() < 9007199254740992.0)
                .ok_or_else(bad)?;
            let seconds = pair[1].as_f64().filter(|s| s.is_finite()).ok_or_else(bad)?;
            if seeded.insert(floor as i64, seconds).is_some() {
                return Err(bad());
            }
        }
        self.commute_wait_by_floor = seeded;
        Ok(())
    }

    /// The commute-stress averages as `[[floor, seconds], ...]`, by floor.
    pub fn commute_stress_json(&self) -> Value {
        let rows: Vec<(i64, f64)> = self
            .commute_wait_by_floor
            .sorted()
            .into_iter()
            .map(|(&f, &w)| (f, w))
            .collect();
        json!(rows)
    }
}
