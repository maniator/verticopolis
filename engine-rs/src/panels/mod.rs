//! Read-only panel getters (facade slice 6b): the numbers the stats screen,
//! the HUD strip, the inspector and editor cards, the overlays and the
//! onboarding checklist read from the TypeScript `Simulation` today, answered
//! by the engine instead. One module per family.
//!
//! Every getter reads engine state and nothing else: no rng, no save, no hash,
//! no change to anything the simulation or a save reads. The one write is the
//! engine's own reachability memo, which the getters that take `&mut self`
//! (`stats_report`, `unit_detail`) fill, keyed by tower revision as every
//! other reader does. Each answers facts (counts, flags, ids, floors); the wording that
//! goes with them stays in TypeScript. Results are `serde_json::Value`s keyed
//! with the TypeScript field names, so the binding wraps each as one
//! `.to_string()` and the differential test compares them with the TypeScript
//! functions they replace.
//!
//! JSON has no `undefined`. A field the TypeScript leaves `undefined` (a unit's
//! `rent`, `residents`, `customersIn`, `subtype`, `vacateReason`, `filmPolicy`,
//! the stats report's `exterminationDueDay`) answers `null`, and a consumer
//! tests for `null` where the TypeScript tested for `undefined`.

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
