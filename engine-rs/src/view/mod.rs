//! The engine's renderer-facing view (facade slice 6a, #1213; AD-9 in the
//! cutover spine). A host that keeps no TypeScript `Simulation` reads the
//! engine through these:
//!
//! - [`structure_view`]: the structural snapshot, rebuilt when
//!   `tower.revision` moves;
//! - [`ViewReader::frame`]: the dynamic frame, every rendered frame, with the
//!   rooms that changed since the reader's last frame;
//! - [`meta_since`]: unit labels and subtypes changed since a meta revision,
//!   read when `tower.meta_revision` moves;
//! - [`layout_json`]: every slot and width by name, and the codes;
//! - `Simulation::tower_signature`: undo's per-command fingerprint.
//!
//! None of them changes the simulation, the save, the state view or a hash.
//! Three keep state between reads, in [`ViewState`] on the tower, outside
//! the save, the state view and the digest, which a load starts fresh (every
//! load builds a new `Tower`): the metadata log and the frame mark log the
//! setters write, and the binding's frame reader, which remembers what it
//! last sent and how far it has read the mark log. A native host can hold
//! its own [`ViewReader`] instead; the JavaScript binding uses the one on the
//! tower, since its `Engine` holds nothing but the simulation.
//!
//! A host that starts on an engine (a load, or an attach after undo, redo or
//! a fault restore) reads the structure, a full frame and a full metadata
//! listing before it reads anything incremental.
pub mod layout;
mod marks;
mod meta;
mod reader;
mod signature;
mod structure;

use std::cell::RefCell;

pub use layout::{layout_json, VIEW_LAYOUT_VERSION};
pub use marks::{FrameMarks, Mark};
pub(crate) use meta::FIRST_META_REVISION;
pub use meta::{meta_since, whole_revision, MetaLog};
pub use reader::ViewReader;
pub use structure::structure_view;

use crate::sim::Simulation;

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

/// The dynamic frame from the tower's own reader (the binding's): one
/// reader per engine, so a second caller sees only what changed since the
/// first one's read. `full` asks for every room.
pub fn view_frame(sim: &Simulation, full: bool) -> Vec<f64> {
    sim.tower.view.reader.borrow_mut().frame(sim, full)
}

#[cfg(test)]
#[path = "frame_tests.rs"]
mod frame_tests;
#[cfg(test)]
#[path = "layout_tests.rs"]
mod layout_tests;
#[cfg(test)]
#[path = "marks_tests.rs"]
mod marks_tests;
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
