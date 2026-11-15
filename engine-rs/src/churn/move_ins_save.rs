//! The day's move-ins a save carries (`moveIns`): the offices, condos, hotel
//! rooms and other rentals let since the last daily report. Without them a
//! reload mid-day started the count at zero, so that evening's "New tenants:"
//! line undercounted, or was not logged at all when every move-in came
//! before the save (#2256).

use serde_json::{json, Map, Value};

use crate::charges::whole;
use crate::sim::MoveIns;

/// The save's name for each count, in the order the report lists them.
const KEYS: [&str; 6] = ["offices", "condos", "rooms", "fitness", "clinic", "rentals"];

/// A count as a save writes it: a whole number, never below zero.
fn count(v: &Value) -> Option<i64> {
    v.as_f64().and_then(whole).filter(|&n| n >= 0)
}

impl MoveIns {
    fn counts(&self) -> [i64; 6] {
        [
            self.offices,
            self.condos,
            self.rooms,
            self.fitness,
            self.clinic,
            self.rentals,
        ]
    }

    fn count_mut(&mut self, key: &str) -> Option<&mut i64> {
        match key {
            "offices" => Some(&mut self.offices),
            "condos" => Some(&mut self.condos),
            "rooms" => Some(&mut self.rooms),
            "fitness" => Some(&mut self.fitness),
            "clinic" => Some(&mut self.clinic),
            "rentals" => Some(&mut self.rentals),
            _ => None,
        }
    }

    /// The counts as the save's `moveIns` object, or `None` while nothing
    /// has moved in since the last report. Only the counts above zero are
    /// written.
    pub(crate) fn save_json(&self) -> Option<Value> {
        let mut m = Map::new();
        for (key, n) in KEYS.iter().zip(self.counts()) {
            if n > 0 {
                m.insert((*key).into(), json!(n));
            }
        }
        (!m.is_empty()).then_some(Value::Object(m))
    }

    /// The counts a save's `moveIns` object carries. A count that is missing
    /// or does not read starts at zero, as a fresh load does.
    pub(crate) fn from_save(v: &Value) -> MoveIns {
        let mut m = MoveIns::default();
        for key in KEYS {
            if let (Some(n), Some(slot)) = (v.get(key).and_then(count), m.count_mut(key)) {
                *slot = n;
            }
        }
        m
    }
}

#[cfg(test)]
#[path = "move_ins_save_tests.rs"]
mod tests;
