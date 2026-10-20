//! `incomeBreakdown` (`src/engine/sim/stats.ts`) over the ledger
//! (`src/engine/Ledger.ts`): the average dollars per day for each report
//! category over the trailing quarter, for the stats screen.

use serde_json::{json, Map, Value};

use crate::ledger::Ledger;
use crate::sim::Simulation;

/// `LEDGER_CATS`: the report categories in display order.
pub const LEDGER_CATS: [&str; 7] = [
    "offices",
    "condos",
    "hotels",
    "retail",
    "food",
    "entertainment",
    "upkeep",
];

impl Ledger {
    /// `averagePerDay`: net dollars per day per category, summed day by day in
    /// the order the TypeScript adds them. Before any day completes it reports
    /// the running day's totals.
    pub fn average_per_day(&self) -> [f64; 7] {
        let mut out = [0.0; 7];
        let days = if self.history.is_empty() {
            1
        } else {
            self.history.len().max(1)
        };
        let mut add = |day: &crate::ledger::DayTotals| {
            for (i, cat) in LEDGER_CATS.iter().enumerate() {
                out[i] += day.get(cat).copied().unwrap_or(0.0);
            }
        };
        if self.history.is_empty() {
            add(&self.today);
        } else {
            for day in &self.history {
                add(day);
            }
        }
        for v in out.iter_mut() {
            *v /= days as f64;
        }
        out
    }

    /// `hasData`: any money recorded at all.
    pub fn has_data(&self) -> bool {
        !self.history.is_empty() || !self.today.is_empty()
    }
}

impl Simulation {
    /// `incomeBreakdown()`: `{ averages: { <category>: dollars/day }, hasData }`.
    pub fn income_breakdown(&self) -> Value {
        let avg = self.ledger.average_per_day();
        let mut averages = Map::new();
        for (i, cat) in LEDGER_CATS.iter().enumerate() {
            averages.insert((*cat).into(), json!(avg[i]));
        }
        json!({ "averages": averages, "hasData": self.ledger.has_data() })
    }
}
