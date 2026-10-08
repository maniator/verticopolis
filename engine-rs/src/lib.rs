//! The Verticopolis simulation engine in Rust.
//!
//! Every module here is a port of a file under `src/engine` in this repository.
//! The port is checked against `conformance/expected.json` by the `conformance`
//! binary, which must reproduce every checkpoint hash the TypeScript engine
//! produces. See `conformance/README.md` for the contract.

pub mod build;
pub mod canonical;
pub mod clock;
pub mod crowd;
pub mod econ;
pub mod events;
pub mod facilities;
pub mod jsmath;
pub mod ledger;
pub mod rng;
pub mod scenario;
pub mod sim;
pub mod tower;
