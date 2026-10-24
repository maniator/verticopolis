//! The worker host's hourly save delta (#1045). A host that keeps its own
//! read model of the tower takes the full save once, then only what changed:
//! the unit records whose save form differs from the last one it was sent,
//! and the save's other top-level keys (ledger, events state, RNG state,
//! milestones and the rest), which are small. The transports ride in that
//! remainder whole, since their car fields move every step.
//!
//! The mirror holds every unit as last sent, in tower order: a copy of the
//! record and its save form. A unit equal to its copy cannot have a new save
//! form, so only units that differ are serialized again, and only those
//! whose save form moved are sent (a field the save leaves out, such as a
//! venue's live customer count, can differ alone). A delta is only possible
//! while the tower holds the same units in the same order; anything else (a
//! unit added, removed or moved, or no full save sent yet) asks the caller
//! for a full save, which primes the mirror again. The simulation is never
//! changed: the units are lent out of the tower only while the rest of the
//! save is written.
use serde_json::{Map, Value};

use crate::sim::Simulation;
use crate::tower::Unit;

/// Each unit as last sent, keyed by position.
#[derive(Default)]
pub struct SaveMirror {
    units: Vec<(Unit, String)>,
    primed: bool,
}

impl SaveMirror {
    /// Forget everything sent: the next delta needs a full save first.
    pub fn clear(&mut self) {
        self.units.clear();
        self.primed = false;
    }

    /// The full save as `serialize()` writes it, with the mirror primed from
    /// the same serialization.
    pub fn full(&mut self, sim: &Simulation) -> String {
        let save = sim.serialize();
        self.clear();
        // The save writes every unit in tower order; pair them only when the
        // counts agree, or leave the mirror unprimed (no delta, full saves).
        if let Some(units) = save.get("units").and_then(Value::as_array) {
            if units.len() == sim.tower.units.len() {
                self.units.reserve(units.len());
                for (unit, saved) in sim.tower.units.iter().zip(units) {
                    self.units.push((unit.clone(), saved.to_string()));
                }
                self.primed = true;
            }
        }
        save.to_string()
    }

    /// `{"units":[changed records],"rest":{every other key}}` as JSON text,
    /// with the mirror moved to the new records; `None` (and a cleared
    /// mirror) when no delta can describe the change.
    pub fn delta(&mut self, sim: &mut Simulation) -> Option<String> {
        let units = &sim.tower.units;
        if !self.primed || units.len() != self.units.len() {
            self.clear();
            return None;
        }
        let mut changed = Vec::new();
        let mut order_changed = false;
        // Check ids while comparing records, rather than walking all units
        // twice per hour. A late mismatch discards any provisional mirror
        // updates and requests a full save, just like an early mismatch.
        for (unit, (copy, sent)) in units.iter().zip(self.units.iter_mut()) {
            if unit.id != copy.id {
                order_changed = true;
                break;
            }
            if unit == copy {
                continue;
            }
            let saved = unit.serialize();
            let text = saved.to_string();
            *copy = unit.clone();
            if text != *sent {
                *sent = text;
                changed.push(saved);
            }
        }
        if order_changed {
            self.clear();
            return None;
        }
        // The rest of the save, written with the units lent out of the tower
        // so they are not serialized a second time, and put straight back.
        let units = std::mem::take(&mut sim.tower.units);
        let rest = sim.serialize();
        sim.tower.units = units;
        let Value::Object(mut rest) = rest else {
            self.clear();
            return None;
        };
        rest.remove("units");
        let mut out = Map::new();
        out.insert("units".into(), Value::Array(changed));
        out.insert("rest".into(), Value::Object(rest));
        Some(Value::Object(out).to_string())
    }
}

#[cfg(test)]
#[path = "save_delta_tests.rs"]
mod tests;
