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
pub mod churn;
pub mod clock;
pub mod crowd;
pub mod demand;
pub mod dispatch;
pub mod econ;
pub mod economy;
pub mod events;
pub mod facilities;
pub mod housekeeping;
pub mod jsmath;
pub mod ledger;
pub mod load;
pub mod presence;
pub mod rent;
pub mod rng;
pub mod rules;
pub mod satisfaction;
pub mod scenario;
pub mod schedule;
pub mod services;
pub mod sim;
pub mod sim_loop;
pub mod star;
pub mod tower;
pub mod tower_query;
#[cfg(feature = "wasm")]
pub mod wasm;
