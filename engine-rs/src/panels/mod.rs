//! Read-only panel getters (facade slice 6b): the numbers the stats screen,
//! the HUD strip, the inspector and editor cards, the overlays and the
//! onboarding checklist read from the TypeScript `Simulation` today, answered
//! by the engine instead. One module per family.
//!
//! Every getter reads engine state and nothing else: no rng, no save, no hash,
//! no write. Each answers facts (counts, flags, ids, floors); the wording that
//! goes with them stays in TypeScript. Results are `serde_json::Value`s keyed
//! with the TypeScript field names, so the binding wraps each as one
//! `.to_string()` and the differential test compares them with the TypeScript
//! functions they replace.

pub mod coverage;
pub mod elevators;
pub mod heatmap;
pub mod income;
pub mod onboarding;
pub mod progress;
pub mod stats;
pub mod unit_detail;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_overlays;
