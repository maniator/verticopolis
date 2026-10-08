//! Port of the persisted part of `src/engine/EventSystem.ts`.

use serde_json::{json, Value};

use crate::rng::Rng;

#[derive(Clone, Debug)]
pub struct PendingChoice {
    pub kind: &'static str,
    pub cost: f64,
    pub message: String,
}

pub struct EventSystem {
    /// The seasonal and visitor stream, separate from the main one.
    pub extra: Rng,
    pub last_santa_year: i64,
    pub pending: Option<PendingChoice>,
}

impl EventSystem {
    pub fn new(seed: u32) -> EventSystem {
        EventSystem {
            extra: Rng::new(seed ^ 0x5a17a),
            last_santa_year: -1,
            pending: None,
        }
    }

    /// `saveState()`: `pending` is a literal null when there is no choice.
    pub fn save_state(&self) -> Value {
        let pending = match &self.pending {
            Some(p) => json!({ "kind": p.kind, "cost": p.cost, "message": p.message }),
            None => Value::Null,
        };
        json!({ "lastSantaYear": self.last_santa_year, "rngState": self.extra.seed(), "pending": pending })
    }
}
