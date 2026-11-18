//! One shaft's hourly demand rings, the curve the daily Auto-tune
//! (`schedule_auto.rs`) re-tunes from and the schedule dialog draws.

/// `HourlyByDay`: one shaft's demand curve per day type, a 24-slot ring each,
/// with the hours each ring has sampled. A sampled hour can hold a measured
/// zero (a dead weekend), which a slot's value alone cannot tell from an hour
/// not yet sampled (#474).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct HourlyByDay {
    pub weekday: Vec<f64>,
    pub weekend: Vec<f64>,
    pub weekday_sampled: Vec<bool>,
    pub weekend_sampled: Vec<bool>,
}

impl HourlyByDay {
    pub(crate) fn empty() -> HourlyByDay {
        HourlyByDay {
            weekday: vec![0.0; 24],
            weekend: vec![0.0; 24],
            weekday_sampled: vec![false; 24],
            weekend_sampled: vec![false; 24],
        }
    }

    /// Rings from their values alone, as a seeded curve gives them: an hour
    /// with a load is a sampled hour.
    pub fn measured(weekday: Vec<f64>, weekend: Vec<f64>) -> HourlyByDay {
        let loaded = |ring: &[f64]| ring.iter().map(|v| *v > 0.0).collect();
        HourlyByDay {
            weekday_sampled: loaded(&weekday),
            weekend_sampled: loaded(&weekend),
            weekday,
            weekend,
        }
    }

    /// One day type's ring and the hours it has sampled.
    pub fn day(&self, weekend: bool) -> (&[f64], &[bool]) {
        if weekend {
            (&self.weekend, &self.weekend_sampled)
        } else {
            (&self.weekday, &self.weekday_sampled)
        }
    }
}
