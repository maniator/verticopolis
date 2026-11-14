//! What a renderer reads, sized for a frame budget. Three reads cover it:
//!
//! - [`structure_view`]: the floors, lobbies, rooms and shafts, as flat
//!   records. Read it when you start, after a load, and whenever the frame
//!   header's tower revision moves (a build, a sale, a fire).
//! - [`ViewReader::frame`]: everything that moves, every frame: the clock,
//!   money and rating, the people, the cars, and only the rooms whose
//!   fields changed since this reader's last frame.
//! - [`meta_since`]: room names and subtypes that changed, read when the
//!   frame header's meta revision moves.
//!
//! [`layout`] names every slot, and [`layout_json`] hands the same tables
//! and every code over as JSON. None of these reads changes the game.
//!
//! ```
//! use verticopolis_engine::clock::GameMode;
//! use verticopolis_engine::facilities::Kind;
//! use verticopolis_engine::sim::Simulation;
//! use verticopolis_engine::view::{layout, structure_view, ViewReader};
//!
//! let mut sim = Simulation::new_game(1, GameMode::Classic);
//! let tiles: Vec<i64> = (100..124).collect();
//! sim.paint_brush(Kind::Lobby, 1, &tiles);
//!
//! let structure = structure_view(&sim);
//! assert_eq!(structure[layout::structure::LOWEST_FLOOR], 1.0);
//!
//! let mut reader = ViewReader::new();
//! let first = reader.frame(&sim, false);
//! assert_eq!(first[layout::header::FRAME_SEQ], 1.0);
//! sim.tick(1.0);
//! let next = reader.frame(&sim, false);
//! assert_eq!(next[layout::header::FRAME_SEQ], 2.0);
//! ```
pub mod layout;
mod marks;
mod meta;
mod reader;
mod signature;
mod structure;
#[cfg(any(feature = "wasm", test))]
mod tally;
mod window;

use std::cell::RefCell;

pub use layout::{layout_json, VIEW_LAYOUT_VERSION};
use marks::FrameMarks;
pub use meta::meta_since;
pub(crate) use meta::FIRST_META_REVISION;
#[doc(hidden)]
pub use meta::{meta_changed, whole_revision, MetaLog};
pub use reader::ViewReader;
pub use structure::structure_view;
#[cfg(all(feature = "wasm", test))]
pub(crate) use tally::TallyPasses;
#[cfg(any(feature = "wasm", test))]
pub(crate) use tally::{CensusTally, RecyclingCounts};
pub use window::{PeopleWindow, FLOOR_PAD};

use crate::sim::Simulation;

#[doc(hidden)]
/// What the view keeps on the tower between reads: the metadata log and the
/// frame mark log the setters write, and the binding's frame reader.
pub struct ViewState {
    pub(crate) meta_log: MetaLog,
    pub(crate) marks: FrameMarks,
    pub(crate) reader: RefCell<ViewReader>,
}

impl Default for ViewState {
    fn default() -> ViewState {
        ViewState {
            meta_log: MetaLog::new(),
            marks: FrameMarks::default(),
            reader: RefCell::new(ViewReader::new()),
        }
    }
}

#[doc(hidden)]
/// The dynamic frame from the tower's own reader (the binding's): one
/// reader per engine, so a second caller sees only what changed since the
/// first one's read. `full` asks for every room.
pub fn view_frame(sim: &Simulation, full: bool) -> Vec<f64> {
    sim.tower.view.reader.borrow_mut().frame(sim, full)
}

#[doc(hidden)]
/// Set the people window of the tower's own reader (the binding's), so its
/// frames carry only the people a view draws; `None` sends every person.
/// The window stays with the reader, so a new tower starts with none.
pub fn set_people_window(sim: &Simulation, window: Option<PeopleWindow>) {
    sim.tower.view.reader.borrow_mut().set_people_window(window);
}

#[cfg(test)]
#[path = "census_reads_tests.rs"]
mod census_reads_tests;
#[cfg(test)]
#[path = "frame_tests.rs"]
mod frame_tests;
#[cfg(test)]
#[path = "layout_tests.rs"]
mod layout_tests;
#[cfg(test)]
#[path = "lexer_tests.rs"]
mod lexer_tests;
#[cfg(test)]
#[path = "marks_guard_tests.rs"]
mod marks_guard_tests;
#[cfg(test)]
#[path = "marks_tests.rs"]
mod marks_tests;
#[cfg(test)]
#[path = "merge_guard_tests.rs"]
mod merge_guard_tests;
#[cfg(test)]
#[path = "meta_tests.rs"]
mod meta_tests;
#[cfg(test)]
#[path = "oracle_tests.rs"]
mod oracle_tests;
#[cfg(test)]
#[path = "session_tests.rs"]
mod session_tests;
#[cfg(test)]
#[path = "signature_tests.rs"]
mod signature_tests;
#[cfg(test)]
#[path = "source_scan_tests.rs"]
mod source_scan_tests;
#[cfg(test)]
#[path = "structure_tests.rs"]
mod structure_tests;
#[cfg(test)]
#[path = "tally_tests.rs"]
mod tally_tests;
#[cfg(test)]
#[path = "unit_scan_tests.rs"]
mod unit_scan_tests;
#[cfg(test)]
#[path = "write_cases_tests.rs"]
mod write_cases_tests;
