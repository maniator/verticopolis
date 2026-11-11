//! The simulation engine of [Verticopolis](https://verticopolis.com), a tower
//! building game inspired by SimTower (1994).
//!
//! This crate is the whole simulation: every rule, price, build limit, command,
//! save format and gameplay event. The web game runs the same engine compiled
//! to WebAssembly. Your code owns everything a player sees and hears; the
//! engine owns what happens in the tower.
//!
//! # Quick start
//!
//! ```
//! use verticopolis_engine::clock::GameMode;
//! use verticopolis_engine::facilities::Kind;
//! use verticopolis_engine::sim::Simulation;
//!
//! // A new Classic game from seed 42.
//! let mut sim = Simulation::new_game(42, GameMode::Classic);
//!
//! // A lobby along the ground floor, then an office above it.
//! let tiles: Vec<i64> = (100..124).collect();
//! sim.paint_brush(Kind::Lobby, 1, &tiles);
//! let quote = sim.can_build(Kind::Office, 2, 106);
//! assert!(quote.ok);
//! assert!(sim.build(Kind::Office, 2, 106).ok);
//!
//! // One game day, an hour at a time, draining the gameplay events.
//! for _ in 0..24 {
//!     sim.tick(60.0);
//!     for event in sim.gameplay.drain() {
//!         println!("{}", event.to_json());
//!     }
//! }
//! println!("population {}, money {}", sim.population(), sim.money);
//! ```
//!
//! # What a host calls
//!
//! | To | Call |
//! | --- | --- |
//! | Start a game | [`Simulation::new_game`](sim::Simulation::new_game), [`new_game_with`](sim::Simulation::new_game_with) |
//! | Run time | [`tick`](sim::Simulation::tick), or [`FrameStepper`](fixed_step::FrameStepper) to drive it from display frames |
//! | Build and sell | [`can_build`](sim::Simulation::can_build), [`build`](sim::Simulation::build), [`paint_brush`](sim::Simulation::paint_brush), [`can_build_transport`](sim::Simulation::can_build_transport), [`build_transport`](sim::Simulation::build_transport), [`sell_at`](sim::Simulation::sell_at), [`toggle_auto_bridge`](sim::Simulation::toggle_auto_bridge) |
//! | Change elevators and remove things | [`add_car`](sim::Simulation::add_car), [`remove_car`](sim::Simulation::remove_car), [`begin_extend`](sim::Simulation::begin_extend), [`extend_transport`](sim::Simulation::extend_transport), [`end_extend`](sim::Simulation::end_extend), [`remove_facility`](sim::Simulation::remove_facility) |
//! | Set prices | [`adjust_rent`](sim::Simulation::adjust_rent), [`price_unit`](sim::Simulation::price_unit), [`set_no_rate`](sim::Simulation::set_no_rate), [`apply_rent_batch`](sim::Simulation::apply_rent_batch) |
//! | Answer the game | [`resolve_choice`](sim::Simulation::resolve_choice), [`set_film_policy`](sim::Simulation::set_film_policy) |
//! | Draw the tower | [`view`]: [`structure_view`](view::structure_view), [`ViewReader`](view::ViewReader), [`meta_since`](view::meta_since); or the older flat [`frame`] |
//! | React to what happened | [`gameplay`]: drain `sim.gameplay` after each frame |
//! | Show prices and rules | [`catalog::catalog`] |
//! | Save and load | [`load`]: [`encode_simulation_vctower`](load::encode_simulation_vctower), [`decode_vctower`](load::decode_vctower), [`deserialize`](load::deserialize) |
//! | Open a 1994 save | [`import_tdt`], [`export_tdt`] |
//! | Name the engine | [`identity::identity`] |
//! | Compare two games | [`canonical::digest`] of [`snapshot::state_view`] |
//!
//! # How the engine behaves
//!
//! - **One [`Simulation`](sim::Simulation) is one game.** Its public fields
//!   are for reading; change a game only through its commands, which apply
//!   the rules and charge the money.
//! - **Commands answer instead of panicking.** A refused command changes
//!   nothing and returns a reason a player can read.
//! - **No I/O.** The engine reads no file, clock, environment or network and
//!   starts no thread. You pass in time, file contents and timestamps, and get
//!   bytes back to store where you like.
//! - **Deterministic.** The same seed, commands and sequence of `tick` calls
//!   give the same game on any machine, here and in the WebAssembly build.
//!   The conformance suite in the repository is how a host proves it.
//! - **Coordinates.** Floor 1 is the ground floor; 0 and below are basements,
//!   down to [`MIN_FLOOR`](facilities::MIN_FLOOR). A tile column `x` runs
//!   from 0 across the lot's [`LOT_WIDTH`](facilities::LOT_WIDTH).
//! - **Two modes.** [`GameMode::Classic`](clock::GameMode::Classic) follows
//!   the 1994 original; [`GameMode::Modern`](clock::GameMode::Modern) adds
//!   rooms and options. The catalog lists every difference a frontend shows.
//!
//! # Features
//!
//! None are on by default. `wasm` builds the JavaScript binding, and
//! `conformance` adds the harness that replays the conformance suite.
//!
//! The guides at [docs.verticopolis.com](https://docs.verticopolis.com) cover
//! adding the crate, saves, the conformance suite and the JavaScript package.
#![warn(missing_docs)]
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
#[doc(hidden)]
pub mod churn;
pub mod clock;
#[doc(hidden)]
pub mod crowd;
#[doc(hidden)]
pub mod demand;
#[doc(hidden)]
pub mod diagnostics;
#[doc(hidden)]
pub mod dispatch;
#[doc(hidden)]
pub mod econ;
#[doc(hidden)]
pub mod economy;
pub mod events;
mod export_stream;
pub mod facilities;
#[doc(hidden)]
pub mod fflate;
pub mod fixed_step;
pub mod frame;
pub mod gameplay;
#[doc(hidden)]
pub mod housekeeping;
pub mod identity;
#[doc(hidden)]
pub mod jsmath;
#[doc(hidden)]
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
#[doc(hidden)]
pub mod panels;
#[doc(hidden)]
pub mod presence;
#[doc(hidden)]
pub mod render_reads;
pub mod rent;
#[doc(hidden)]
pub mod rng;
#[doc(hidden)]
pub mod rules;
#[doc(hidden)]
pub mod satisfaction;
#[doc(hidden)]
pub mod save_delta;
#[cfg(any(test, feature = "wasm"))]
mod vctower_import;
#[cfg(test)]
mod vctower_import_tests;
// The conformance harness reads the suite's files, so a host links it only
// with the `conformance` feature (tier 2 in API.md). The crate's unit tests
// always have it; a test under `tests/` needs the feature like any host.
// The harness replays the suite's own command list, which
// `conformance/README.md` documents; its items are not host API.
#[allow(missing_docs)]
#[cfg(any(test, feature = "conformance"))]
pub mod scenario;
#[cfg(any(test, feature = "conformance"))]
#[doc(hidden)]
pub mod scenario_detail;
#[cfg(test)]
mod scenario_reason_tests;
#[cfg(test)]
mod scenario_star_tests;
#[cfg(test)]
mod scenario_tune_tests;
#[doc(hidden)]
pub mod schedule;
#[doc(hidden)]
pub mod schedule_authoring;
#[doc(hidden)]
pub mod schedule_facts;
mod schedule_geometry;
#[doc(hidden)]
pub mod schedule_presets;
#[doc(hidden)]
pub mod services;
pub mod sim;
#[doc(hidden)]
pub mod sim_loop;
mod sim_save;
pub mod snapshot;
#[doc(hidden)]
pub mod star;
#[cfg(any(test, feature = "conformance"))]
pub mod suite;
#[doc(hidden)]
pub mod tdt;
pub use tdt::{export_tdt, import_tdt};
mod sim_undo;
mod sim_undo_caps;
mod sim_undo_check;
mod sim_undo_ground;
#[doc(hidden)]
pub mod telemetry;
#[doc(hidden)]
pub mod tower;
mod tower_index;
#[doc(hidden)]
pub mod tower_query;
mod tower_query_state;
mod tower_removal;
mod undo;
mod undo_journal;
pub mod view;
// The JavaScript binding, documented by the package README.
#[doc(hidden)]
#[cfg(feature = "wasm")]
pub mod wasm;
