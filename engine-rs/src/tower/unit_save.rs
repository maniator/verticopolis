//! A unit's save entry (`serializeUnit` in the retired TypeScript
//! `src/engine/sim/coerce.ts`), walked once (`SaveEntries`) and read as a tree
//! ([`Unit::serialize`]), written straight to the save text ([`SavedUnit`],
//! [`Unit::save_text`], see `save_entry`), or counted
//! ([`Unit::saves_only_position`]), so the three never disagree on a key or the
//! rule that leaves it out.

use serde::ser::{Serialize, SerializeMap, Serializer};
use serde_json::Value;

use super::types::{Unit, UnitState};
use crate::save_entry::{entry_tree, EntryValue, SaveEntries, Written};
use crate::save_floor_runs::FLOOR_RUN_KEY;

impl SaveEntries for Unit {
    fn save_entries<E>(
        &self,
        mut put: impl FnMut(&'static str, EntryValue<'_>) -> Result<(), E>,
    ) -> Result<(), E> {
        let f = self.kind.facility();
        put("id", EntryValue::Int(self.id))?;
        put("kind", EntryValue::Text(self.kind.as_str()))?;
        put("floor", EntryValue::Int(self.floor))?;
        put("x", EntryValue::Int(self.x))?;
        if !(self.width == 1 && f.width == 1 && self.kind.is_structural()) {
            put("width", EntryValue::Int(self.width))?;
        }
        if self.state != UnitState::Empty {
            put("state", EntryValue::Text(self.state.as_str()))?;
        }
        if self.satisfaction != 1.0 {
            put("satisfaction", EntryValue::Float(self.satisfaction))?;
        }
        if self.occupants != 0 && !self.kind.counts_visitors() {
            put("occupants", EntryValue::Int(self.occupants))?;
        }
        if self.ever_occupied {
            put("everOccupied", EntryValue::True)?;
        }
        if self.pending_income != 0.0 {
            put("pendingIncome", EntryValue::Float(self.pending_income))?;
        }
        if self.label != f.name {
            put("label", EntryValue::Text(&self.label))?;
        }
        if let Some(r) = self.residents {
            put("residents", EntryValue::Int(r))?;
        }
        if let Some(v) = self.visitors_yest {
            put("visitorsYest", EntryValue::Int(i64::from(v)))?;
        }
        if let Some(r) = self.rent {
            put("rent", EntryValue::Float(r))?;
        }
        if self.no_rate {
            put("noRate", EntryValue::True)?;
        }
        let extras = self.extras();
        if let Some(v) = extras.vacate_reason {
            put("vacateReason", EntryValue::Text(v))?;
        }
        if let Some(v) = extras.vacate_at {
            put("vacateAt", EntryValue::Float(v))?;
        }
        if let Some(v) = extras.film_policy {
            put("filmPolicy", EntryValue::Text(v))?;
        }
        if let Some(v) = extras.film_days {
            put("filmDays", EntryValue::Int(i64::from(v)))?;
        }
        if extras.film_classic {
            put("filmClassic", EntryValue::True)?;
        }
        if extras.film_blockbuster {
            put("filmBlockbuster", EntryValue::True)?;
        }
        if let Some(v) = extras.ticket_price {
            put("ticketPrice", EntryValue::Text(v))?;
        }
        if let Some(screen) = extras.second_screen {
            put("screen2", EntryValue::Owned(screen.to_json()))?;
        }
        if let Some(v) = self.subtype {
            put("subtype", EntryValue::Text(v))?;
        }
        if self.kind.subtype_list().is_some() {
            if let Some(v) = extras.patronage_today {
                put("patronageToday", EntryValue::Float(v))?;
            }
            if let Some(v) = extras.patronage_yest {
                put("patronageYest", EntryValue::Float(v))?;
            }
            if let Some(v) = extras.profit_today {
                put("profitToday", EntryValue::Float(v))?;
            }
            if let Some(v) = extras.profit_yest {
                put("profitYest", EntryValue::Float(v))?;
            }
        }
        if let Some(v) = extras.complete_at {
            put("completeAt", EntryValue::Float(v))?;
        } else if let Some(raw) = &extras.complete_at_raw {
            put("completeAt", EntryValue::Raw(raw))?;
        }
        if let Some(d) = extras.dirty_days {
            if d != 0 && self.state == UnitState::Dirty {
                put("dirtyDays", EntryValue::Int(d))?;
            }
        }
        Ok(())
    }
}

impl Unit {
    /// `serializeUnit` (the retired TypeScript `src/engine/sim/coerce.ts`): the
    /// unit's save entry as a tree.
    pub fn serialize(&self) -> Value {
        entry_tree(self)
    }

    /// The unit's save entry as JSON text, the text [`Unit::serialize`]'s
    /// tree writes, with no tree built. For the callers that only send the
    /// text on (`unitAt`, the tooling reads, the save delta).
    pub fn save_text(&self) -> String {
        serde_json::to_string(&Written(self)).expect("a save entry writes to a string")
    }

    /// Whether the unit's save entry holds nothing but `id`, `kind`, `floor`
    /// and `x`, the only keys every entry has. The walk stops at a fifth key,
    /// and builds nothing on the way unless the unit is a theater showing a
    /// second film.
    pub(crate) fn saves_only_position(&self) -> bool {
        let mut keys = 0;
        self.save_entries(|_, _| {
            keys += 1;
            if keys > 4 {
                Err(())
            } else {
                Ok(())
            }
        })
        .is_ok()
    }
}

/// A unit's save entry written straight to the save, as [`Unit::serialize`]'s
/// tree writes, with `run` last on the first tile of a floor run
/// (`save_floor_runs`).
pub(crate) struct SavedUnit<'a> {
    pub(crate) unit: &'a Unit,
    pub(crate) run: Option<usize>,
}

impl SavedUnit<'_> {
    /// The entry as a tree, for the save's tree (`Simulation::serialize`).
    pub(crate) fn to_value(&self) -> Value {
        let mut entry = self.unit.serialize();
        if let (Some(tiles), Some(m)) = (self.run, entry.as_object_mut()) {
            m.insert(FLOOR_RUN_KEY.into(), Value::from(tiles));
        }
        entry
    }
}

impl Serialize for SavedUnit<'_> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        // As `save_entry::Written` writes, with the run after the entry.
        let mut m = s.serialize_map(None)?;
        self.unit.save_entries(|k, v| m.serialize_entry(k, &v))?;
        if let Some(tiles) = self.run {
            m.serialize_entry(FLOOR_RUN_KEY, &Value::from(tiles))?;
        }
        m.end()
    }
}

#[cfg(test)]
#[path = "unit_save_tests.rs"]
mod tests;
