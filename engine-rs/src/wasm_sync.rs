//! The engine handle's constructor, with the save mirror the worker host's
//! hourly delta is taken against (#1045, see `crate::save_delta`). The
//! binding itself stays in `wasm.rs`.
use crate::save_delta::SaveMirror;
use crate::sim::Simulation;

use super::Engine;

impl Engine {
    pub(crate) fn of(sim: Simulation) -> Engine {
        Engine {
            sim,
            mirror: SaveMirror::default(),
        }
    }
}
