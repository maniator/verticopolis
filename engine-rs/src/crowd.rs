//! Port of `src/engine/Crowd.ts`: the live people, which saves never carry.

use serde_json::{json, Value};

use crate::rng::Rng;

pub struct Crowd {
    pub rng: Rng,
    /// Monotonic person-id source.
    pub next_id: i64,
    pub people: Vec<Value>,
}

impl Crowd {
    pub fn new(seed: u32) -> Crowd {
        Crowd {
            rng: Rng::new(seed),
            next_id: 1,
            people: Vec::new(),
        }
    }

    /// The conformance suite's crowd channel.
    pub fn view(&self) -> Value {
        json!({ "nextId": self.next_id, "rng": self.rng.seed(), "people": self.people })
    }
}
