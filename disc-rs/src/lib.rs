//! Reads a player's own legacy disc image under hard budgets: the ISO9660
//! walk, Microsoft KWAJ expansion, and a normalized, versioned result every
//! host receives in the same shape.
//!
//! The crate stops at bytes. It lists files and expands them; deciding what a
//! tower is stays with the game's own importer. Its input is attacker-
//! controlled, and every host runs it inside a confined process or worker;
//! the memory safety here is an extra layer inside that boundary.
pub mod disc;
pub mod iso;
pub mod kwaj;
pub mod limits;
pub mod refusal;
pub mod source;

#[cfg(any(test, feature = "testkit"))]
pub mod testkit;

#[cfg(feature = "wasm")]
pub mod wasm;

pub use disc::{Disc, Entry, Opened, ReadInfo, SCHEMA};
pub use limits::{Limits, DEFAULT_LIMITS};
pub use refusal::{Code, Refusal};
