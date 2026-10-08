//! Port of `src/engine/Ledger.ts`.

use indexmap::IndexMap;
use serde_json::{json, Map, Value};

pub const WINDOW: usize = 90;

pub type DayTotals = IndexMap<&'static str, f64>;

pub struct Ledger {
    pub today: DayTotals,
    pub history: Vec<DayTotals>,
}

fn totals_json(t: &DayTotals) -> Value {
    let mut m = Map::new();
    for (k, v) in t {
        m.insert((*k).into(), json!(v));
    }
    Value::Object(m)
}

impl Ledger {
    pub fn new() -> Ledger {
        Ledger {
            today: IndexMap::new(),
            history: Vec::new(),
        }
    }

    /// Ignores non-finite amounts and 0, so only categories that ever
    /// received money appear as keys.
    pub fn record(&mut self, cat: &'static str, amount: f64) {
        if !amount.is_finite() || amount == 0.0 {
            return;
        }
        let entry = self.today.entry(cat).or_insert(0.0);
        *entry += amount;
    }

    pub fn end_day(&mut self) {
        let today = std::mem::take(&mut self.today);
        self.history.push(today);
        if self.history.len() > WINDOW {
            self.history.remove(0);
        }
    }

    pub fn serialize(&self) -> Value {
        json!({ "today": totals_json(&self.today), "history": self.history.iter().map(totals_json).collect::<Vec<_>>() })
    }
}

impl Default for Ledger {
    fn default() -> Self {
        Ledger::new()
    }
}
