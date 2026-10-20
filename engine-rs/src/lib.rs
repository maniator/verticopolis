//! The Verticopolis engine in Rust: a port of `src/engine` that the
//! conformance suite in `conformance/` holds to the TypeScript engine bit
//! for bit. Functions keep the shape of their TypeScript originals so the two
//! can be read side by side.
#![allow(
    clippy::too_many_arguments,
    clippy::type_complexity,
    clippy::needless_range_loop,
    clippy::manual_clamp,
    clippy::collapsible_match
)]

pub mod build;
pub mod canonical;
pub mod catalog;
pub mod charges;
pub mod churn;
pub mod clock;
pub mod crowd;
pub mod demand;
pub mod dispatch;
pub mod econ;
pub mod economy;
pub mod events;
pub mod facilities;
pub mod fflate;
pub mod frame;
pub mod gameplay;
pub mod housekeeping;
pub mod identity;
pub mod jsmath;
pub mod ledger;
pub mod load;
mod noise;
pub mod presence;
pub mod rent;
pub mod rng;
pub mod rules;
pub mod satisfaction;
// The conformance harness reads the suite's files, so a host links it only
// with the `conformance` feature (tier 2 in API.md). The crate's unit tests
// always have it; a test under `tests/` needs the feature like any host.
#[cfg(any(test, feature = "conformance"))]
pub mod scenario;
#[cfg(any(test, feature = "conformance"))]
pub mod scenario_detail;
pub mod schedule;
pub mod services;
pub mod sim;
pub mod sim_loop;
pub mod snapshot;
pub mod star;
#[cfg(any(test, feature = "conformance"))]
pub mod suite;
pub mod tdt;
pub use tdt::{export_tdt, import_tdt};
pub mod telemetry;
pub mod tower;
mod tower_index;
pub mod tower_query;
#[cfg(feature = "wasm")]
pub mod wasm;
