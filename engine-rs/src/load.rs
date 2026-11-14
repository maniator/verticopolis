//! Saves: writing a game to a `.vctower` file and reading one back.
//!
//! A `.vctower` file is the web game's save format: a first line naming the
//! format ([`TOWER_FILE_MAGIC`]), then the save JSON, compressed. A save from
//! any older version loads; the loader upgrades it first. A save from a newer
//! version is refused.
//!
//! ```
//! use verticopolis_engine::clock::GameMode;
//! use verticopolis_engine::load::{
//!     decode_vctower, deserialize, encode_simulation_vctower, mark_founder_from_loaded_file,
//! };
//! use verticopolis_engine::sim::Simulation;
//!
//! let sim = Simulation::new_game(5, GameMode::Classic);
//! let bytes = encode_simulation_vctower(&sim, "my-host 1.0.0", 1_791_849_600_000.0).unwrap();
//!
//! let text = String::from_utf8(bytes).unwrap();
//! let save = decode_vctower(&text).unwrap();
//! let mut loaded = deserialize(&save).unwrap();
//! mark_founder_from_loaded_file(&mut loaded, &save);
//! assert_eq!(loaded.money, sim.money);
//! ```
//!
//! A save holds the tower and leaves out the people walking around and the
//! elevators' dispatch state, so a loaded game restarts both and does not
//! track the game that wrote it. Two loads of the same save do track each
//! other exactly.
//!
//! The loader repairs: [`deserialize`] corrects damaged or edited fields the
//! way the web game's loader does. It refuses a file it cannot read, and a
//! save with no numeric `minutes` or no `units` list at its top level.
//! The JSON inside the file is what
//! [`Simulation::serialize`](crate::sim::Simulation::serialize) returns.

use std::collections::{HashMap, HashSet};

use base64::Engine;
use indexmap::IndexMap;
use serde_json::{json, Map, Value};

use crate::clock::{CalendarKind, Clock, GameMode};
use crate::econ::{classic_ladder, rent_config};
use crate::events::PendingChoice;
use crate::facilities::*;
use crate::jsmath::{number_to_string, round};
use crate::ledger::Ledger;
use crate::rent::snap_to_ladder;
use crate::rng::Rng;
use crate::schedule::Schedule;
use crate::sim::{LogEntry, LogKind, Simulation, LOG_RING_CAP, SAVE_VERSION};
use crate::sim_loop::weather_for;
use crate::tower::{unit_list_headroom, Transport, Unit, UnitState};

const SOLD_CONDO_MIN_PRICE: f64 = 60_000.0;
const SOLD_CONDO_MAX_PRICE: f64 = 240_000.0;
const VIP_VISITS_CAP: f64 = 1_000_000.0;
const LOG_TEXT_CAP: usize = 400;
const LEGACY_CONDO_DEFAULT_PRICE: f64 = 120_000.0;
/// `Number.MAX_SAFE_INTEGER`: saved whole numbers clamp to it in both loaders,
/// so a value past `i64` reads the same in both. Without the clamp `as i64`
/// saturates here to 2^63 - 1, which a double cannot hold exactly (#858).
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;
pub(crate) const OLDEST_SAVE_VERSION: i64 = 1;
/// `MAX_SAVE_INFLATED_BYTES` (saveCompression.ts).
const MAX_SAVE_INFLATED_BYTES: u64 = 32 * 1024 * 1024;
pub(crate) const UNIT_CAP: usize =
    2 * (LOT_WIDTH as usize) * ((MAX_FLOOR - MIN_FLOOR + 1) as usize);
const LOT: i64 = LOT_WIDTH;

mod assemble;
mod coerce;
mod container;
mod founder;
mod guards;
mod helpers;
mod migrate;
mod migrate_v1;
mod migrate_v4;
mod migrate_v5;
mod reader;

pub(crate) use assemble::*;
use coerce::*;
pub use container::*;
pub use founder::*;
use guards::*;
pub(crate) use helpers::*;
pub use migrate::*;
pub use migrate_v1::*;
pub use migrate_v4::*;
pub use migrate_v5::*;
pub use reader::*;

#[cfg(test)]
#[path = "load_assemble_tests.rs"]
mod assemble_tests;
#[cfg(test)]
mod loader_cases;
#[cfg(test)]
mod save_json_tests;
#[cfg(test)]
mod text_tests;
#[cfg(test)]
mod vctower_encode_tests;
