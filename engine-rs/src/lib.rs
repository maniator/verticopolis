//! The Verticopolis engine in Rust: a port of the TypeScript engine that
//! used to live in `src/engine` (removed in #1875; its rules are Rust tests
//! now, `docs/architecture/ts-engine-retirement-map.md`). The conformance
//! suite in `conformance/` pins its answers. Comments that name a
//! `src/engine` file name the TypeScript original a function was ported from.
#![allow(
    clippy::too_many_arguments,
    clippy::type_complexity,
    clippy::needless_range_loop,
    clippy::manual_clamp,
    clippy::collapsible_match
)]

pub mod brush;
pub mod build;
pub mod canonical;
pub mod catalog;
pub mod charges;
pub mod churn;
pub mod clock;
pub mod crowd;
pub mod demand;
pub mod diagnostics;
pub mod dispatch;
pub mod econ;
pub mod economy;
pub mod events;
mod export_stream;
pub mod facilities;
pub mod fflate;
pub mod fixed_step;
pub mod frame;
pub mod gameplay;
pub mod housekeeping;
pub mod identity;
pub mod jsmath;
pub mod ledger;
pub mod load;
#[cfg(test)]
mod load_fidelity_tests;
#[cfg(test)]
mod load_newer_save_tests;
#[cfg(test)]
mod rule_tests;
#[cfg(test)]
mod wedding_hall_tests;
// The binding's save reader (#1225): `wasm.rs` loads through it, and the
// crate's tests check it against `load::deserialize`.
#[cfg(any(test, feature = "wasm"))]
mod load_stream;
mod noise;
pub mod panels;
pub mod presence;
pub mod render_reads;
pub mod rent;
pub mod rng;
pub mod rules;
pub mod satisfaction;
pub mod save_delta;
#[cfg(any(test, feature = "wasm"))]
mod vctower_import;
#[cfg(test)]
mod vctower_import_tests;
// The conformance harness reads the suite's files, so a host links it only
// with the `conformance` feature (tier 2 in API.md). The crate's unit tests
// always have it; a test under `tests/` needs the feature like any host.
#[cfg(any(test, feature = "conformance"))]
pub mod scenario;
#[cfg(any(test, feature = "conformance"))]
pub mod scenario_detail;
#[cfg(test)]
mod scenario_reason_tests;
#[cfg(test)]
mod scenario_star_tests;
#[cfg(test)]
mod scenario_tune_tests;
pub mod schedule;
pub mod schedule_authoring;
pub mod schedule_facts;
mod schedule_geometry;
pub mod schedule_presets;
pub mod services;
pub mod sim;
pub mod sim_loop;
mod sim_save;
pub mod snapshot;
pub mod star;
#[cfg(any(test, feature = "conformance"))]
pub mod suite;
pub mod tdt;
pub use tdt::{export_tdt, import_tdt};
mod sim_undo;
mod sim_undo_caps;
mod sim_undo_check;
mod sim_undo_ground;
pub mod telemetry;
pub mod tower;
mod tower_index;
pub mod tower_query;
mod tower_query_state;
mod tower_removal;
mod undo;
mod undo_journal;
pub mod view;
#[cfg(feature = "wasm")]
pub mod wasm;
