//! The hashed state view: the saved game without its prose, which the
//! conformance suite hashes at every checkpoint. Hash it with
//! [`crate::canonical::digest`] to tell whether two games are in the same
//! state.
//!
//! ```
//! use verticopolis_engine::canonical::digest;
//! use verticopolis_engine::clock::GameMode;
//! use verticopolis_engine::sim::Simulation;
//! use verticopolis_engine::snapshot::state_view;
//!
//! let mut a = Simulation::new_game(9, GameMode::Classic);
//! let mut b = Simulation::new_game(9, GameMode::Classic);
//! a.tick(120.0);
//! b.tick(60.0);
//! b.tick(60.0);
//! assert_eq!(digest(&state_view(&a)), digest(&state_view(&b)));
//! ```
use serde_json::Value;

use crate::sim::Simulation;

/// The saved game ([`Simulation::serialize`]) without the log messages' text
/// and the pending choice's message, so wording changes never move a hash.
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
