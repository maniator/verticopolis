//! The hashed snapshot: the state view the conformance lock pins at every
//! checkpoint (`conformance/expected.json`), and what a host hashes with
//! `canonical::digest` to compare two games. The scenario runner and the
//! JavaScript binding read it from here.
use serde_json::Value;

use crate::sim::Simulation;

/// The saved game minus prose: log `text` and the pending choice's `message`.
pub fn state_view(sim: &Simulation) -> Value {
    let mut v = sim.serialize();
    if let Some(log) = v.get_mut("log").and_then(Value::as_array_mut) {
        for e in log {
            if let Some(o) = e.as_object_mut() {
                o.remove("text");
            }
        }
    }
    if let Some(p) = v
        .get_mut("events")
        .and_then(|e| e.get_mut("pending"))
        .and_then(Value::as_object_mut)
    {
        p.remove("message");
    }
    v
}
