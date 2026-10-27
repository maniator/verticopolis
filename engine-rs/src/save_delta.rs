//! The worker host's hourly save delta (#1045). A host that keeps its own
//! read model of the tower takes the full save once, then only what changed:
//! the room records whose save form differs from the last one it was sent,
//! and the save's other top-level keys (ledger, events state, RNG state,
//! milestones and the rest), which are small. The transports ride in that
//! remainder whole, since their car fields move every step.
//!
//! The mirror holds every room unit as last sent, in tower order: a copy of
//! the record and its save form. Floor and lobby tiles, which are about 93%
//! of a large tower's units, are left out: a tile has no field the step
//! moves, and anything that adds, removes, moves or retypes a unit bumps the
//! tower revision, so the mirror is keyed on the tower's index key (revision
//! and unit count) and the room positions come from the room index
//! (`room_units`), not from a walk over every unit. A room equal to its copy
//! cannot have a new save form, so only rooms that differ are serialized
//! again, and only those whose save form moved are sent (a field the save
//! leaves out, such as a venue's live customer count, can differ alone). A
//! delta is only possible while the tower holds the same units in the same
//! order; anything else (the key moved, a room moved, or no full save sent
//! yet) asks the caller for a full save, which primes the mirror again. The
//! simulation is never changed: the units are lent out of the tower only
//! while the rest of the save is written.
use serde_json::{Map, Value};

use crate::sim::Simulation;
use crate::tower::Unit;
use crate::tower_index::IndexKey;

/// Each room unit as last sent, in room order, with the tower's index key at
/// that save.
#[derive(Default)]
pub struct SaveMirror {
    rooms: Vec<(Unit, String)>,
    key: Option<IndexKey>,
}

impl SaveMirror {
    /// Forget everything sent: the next delta needs a full save first.
    pub fn clear(&mut self) {
        self.rooms.clear();
        self.key = None;
    }

    /// The full save as `serialize()` writes it, with the mirror primed from
    /// the same serialization.
    pub fn full(&mut self, sim: &Simulation) -> String {
        let save = sim.serialize();
        self.clear();
        // The save writes every unit in tower order; pair them only when the
        // counts agree, or leave the mirror unprimed (no delta, full saves).
        if let Some(saved) = save.get("units").and_then(Value::as_array) {
            let units = &sim.tower.units;
            if saved.len() == units.len() {
                let rooms = sim.tower.room_index();
                self.rooms.reserve(rooms.len());
                for &i in rooms.iter() {
                    self.rooms.push((units[i].clone(), saved[i].to_string()));
                }
                self.key = Some(sim.tower.index_key());
            }
        }
        save.to_string()
    }

    /// `{"units":[changed records],"rest":{every other key}}` as JSON text,
    /// with the mirror moved to the new records; `None` (and a cleared
    /// mirror) when no delta can describe the change.
    pub fn delta(&mut self, sim: &mut Simulation) -> Option<String> {
        let rooms = sim.tower.room_index();
        if self.key != Some(sim.tower.index_key()) || rooms.len() != self.rooms.len() {
            self.clear();
            return None;
        }
        let units = &sim.tower.units;
        let mut changed = Vec::new();
        let mut order_changed = false;
        // Check ids while comparing records, rather than walking all rooms
        // twice per hour. A late mismatch discards any provisional mirror
        // updates and requests a full save, just like an early mismatch.
        for (&i, (copy, sent)) in rooms.iter().zip(self.rooms.iter_mut()) {
            let unit = &units[i];
            if unit.id != copy.id {
                order_changed = true;
                break;
            }
            // `==` is the derived one: a saved float that moves between 0.0
            // and -0.0 compares equal, and a NaN never does (backlog #1138
            // items 5 and 6).
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
