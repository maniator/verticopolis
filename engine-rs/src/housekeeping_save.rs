//! The housekeeping tallies a save carries (`housekeeping`): the rooms
//! cleaned so far today and yesterday's shift result. Without them a reload
//! mid-day started the count at zero, so that morning's checkout line
//! ("Housekeeping cleaned N hotel room(s).") undercounted, and the stats
//! sheet lost yesterday's shift until the next checkout (#2207). It also
//! carries the days the "can't reach" and "can't get in" nudges last fired,
//! so a reload does not log either a second time the same day.

use serde_json::{json, Map, Value};

use super::Housekeeping;
use crate::charges::whole;

/// A tally as a save writes it: a whole number, never below zero.
fn tally(v: &Value) -> Option<i64> {
    v.as_f64().and_then(whole).filter(|&n| n >= 0)
}

impl Housekeeping {
    /// The tallies as the save's `housekeeping` object, or `None` while
    /// there is nothing to keep (no room cleaned today, no shift latched,
    /// no nudge fired).
    pub(crate) fn save_json(&self) -> Option<Value> {
        let nudged = self.nudged_day >= 0 || self.commute_nudged_day >= 0;
        if self.cleaned_today == 0 && self.yesterday.is_none() && !nudged {
            return None;
        }
        let mut m = Map::new();
        m.insert("cleanedToday".into(), json!(self.cleaned_today));
        if let Some((cleaned, leftover)) = self.yesterday {
            m.insert("yesterday".into(), json!([cleaned, leftover]));
        }
        if self.nudged_day >= 0 {
            m.insert("nudgedDay".into(), json!(self.nudged_day));
        }
        if self.commute_nudged_day >= 0 {
            m.insert("commuteNudgedDay".into(), json!(self.commute_nudged_day));
        }
        Some(Value::Object(m))
    }

    /// Takes the tallies a save's `housekeeping` object carries. A value
    /// that does not read keeps what a fresh load starts with.
    pub(crate) fn restore_tallies(&mut self, v: &Value) {
        if let Some(n) = v.get("cleanedToday").and_then(tally) {
            self.cleaned_today = n;
        }
        let shift = v.get("yesterday").and_then(Value::as_array);
        if let Some([cleaned, leftover]) = shift.map(Vec::as_slice) {
            if let (Some(c), Some(l)) = (tally(cleaned), tally(leftover)) {
                self.yesterday = Some((c, l));
            }
        }
        if let Some(day) = v.get("nudgedDay").and_then(tally) {
            self.nudged_day = day;
        }
        if let Some(day) = v.get("commuteNudgedDay").and_then(tally) {
            self.commute_nudged_day = day;
        }
    }
}
