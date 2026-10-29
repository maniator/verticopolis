//! The saved game, as a JSON tree (`Simulation::serialize`) and as JSON text
//! (`Simulation::save_text`, behind `Engine.serialize`). Both read one list
//! of fields, so they write the same keys in the same order (the tree keeps
//! that order because the crate builds `serde_json` with `preserve_order`);
//! each value's bytes rest on `serde_json` writing a borrowed value as it
//! writes that value's `Value`, which the tests pin. The ledger's and the
//! events' objects are the two shapes written twice. The text is written as
//! it goes: each unit, transport, log line and ledger day becomes its own
//! `Value` that is written and dropped before the next, and the tower's name,
//! the pending choice's message and each excavated tile, room id, blockbuster
//! cinema and milestone are written from their own values, so a save never
//! holds the whole game as a tree beside the game (#1242).

use serde::ser::{Serialize, SerializeMap, Serializer};
use serde_json::{json, Map, Value};

use crate::events::{EventSystem, PendingChoice};
use crate::ledger::{totals_json, Ledger};
use crate::sim::{LogEntry, Simulation, LOG_SAVE_CAP, SAVE_VERSION};
use crate::tower::{Transport, Unit};

/// One top-level value of the save. The lists stay borrowed until they are
/// written, one entry at a time.
enum Field<'a> {
    Owned(Value),
    Borrowed(&'a Value),
    Text(&'a str),
    Units(&'a [Unit]),
    Transports(&'a [Transport]),
    Strings(&'a [String]),
    Ids(&'a [i64]),
    Floats(&'a [f64]),
    Ledger(&'a Ledger),
    Events(&'a EventSystem),
    Log(&'a [LogEntry]),
}

fn log_entry(e: &LogEntry) -> Value {
    json!({ "minute": e.minute, "text": e.text, "kind": e.kind.as_str() })
}

/// A list written as `Value::Array` writes its elements, each element's
/// `Value` built in turn: the same sequence calls with the same length.
struct Each<'a, T, F>(&'a [T], F);

impl<T, F: Fn(&T) -> Value> Serialize for Each<'_, T, F> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_seq(self.0.iter().map(&self.1))
    }
}

impl Field<'_> {
    fn into_value(self) -> Value {
        match self {
            Field::Owned(v) => v,
            Field::Borrowed(v) => v.clone(),
            Field::Text(t) => json!(t),
            Field::Units(us) => Value::Array(us.iter().map(Unit::serialize).collect()),
            Field::Transports(ts) => Value::Array(ts.iter().map(Transport::serialize).collect()),
            Field::Strings(ss) => json!(ss),
            Field::Ids(ids) => json!(ids),
            Field::Floats(fs) => json!(fs),
            Field::Ledger(l) => l.serialize(),
            Field::Events(e) => e.save_state(),
            Field::Log(es) => Value::Array(es.iter().map(log_entry).collect()),
        }
    }
}

impl Serialize for Field<'_> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Field::Owned(v) => v.serialize(s),
            Field::Borrowed(v) => v.serialize(s),
            Field::Units(us) => Each(us, Unit::serialize).serialize(s),
            Field::Transports(ts) => Each(ts, Transport::serialize).serialize(s),
            // A `Value::String` writes as its string does, a
            // `Value::Number` holding an integer as its digits do, and one
            // holding a float, or the null a non-finite float becomes, as
            // `serialize_f64` writes that float.
            Field::Text(t) => t.serialize(s),
            Field::Strings(ss) => ss.serialize(s),
            Field::Ids(ids) => ids.serialize(s),
            Field::Floats(fs) => fs.serialize(s),
            // `Ledger::serialize`'s object, `today` then `history`.
            Field::Ledger(l) => {
                let mut m = s.serialize_map(Some(2))?;
                m.serialize_entry("today", &totals_json(&l.today))?;
                m.serialize_entry("history", &Each(&l.history, totals_json))?;
                m.end()
            }
            // `EventSystem::save_state`'s object; `pending` is a literal null
            // when there is no choice.
            Field::Events(e) => {
                let mut m = s.serialize_map(Some(3))?;
                m.serialize_entry("lastSantaYear", &json!(e.last_santa_year))?;
                m.serialize_entry("rngState", &json!(e.extra.seed()))?;
                match &e.pending {
                    Some(p) => m.serialize_entry("pending", &Pending(p))?,
                    None => m.serialize_entry("pending", &Value::Null)?,
                }
                m.end()
            }
            Field::Log(es) => Each(es, log_entry).serialize(s),
        }
    }
}

/// A pending choice, written as `save_state` builds it, with its message
/// from the borrow.
struct Pending<'a>(&'a PendingChoice);

impl Serialize for Pending<'_> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut m = s.serialize_map(Some(3))?;
        m.serialize_entry("kind", self.0.kind)?;
        m.serialize_entry("cost", &json!(self.0.cost))?;
        m.serialize_entry("message", self.0.message.as_str())?;
        m.end()
    }
}

/// The save's top-level object, written as `Value::Object` writes a map.
struct Fields<'a>(Vec<(&'static str, Field<'a>)>);

impl Serialize for Fields<'_> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut m = s.serialize_map(Some(self.0.len()))?;
        for (k, v) in &self.0 {
            m.serialize_entry(k, v)?;
        }
        m.end()
    }
}

/// A top-level value the save owns.
fn own(k: &'static str, v: Value) -> (&'static str, Field<'static>) {
    (k, Field::Owned(v))
}

impl Simulation {
    /// The save's fields, in the order `serialize` has always written them.
    /// Absent optional fields are left out, which is what the canonical
    /// writer expects. Each key appears once.
    fn save_fields(&self) -> Vec<(&'static str, Field<'_>)> {
        let mut m: Vec<(&'static str, Field<'_>)> = Vec::with_capacity(31);
        m.push(own("version", json!(SAVE_VERSION)));
        m.push(own("seed", json!(self.rng.seed())));
        m.push(own("initialSeed", json!(self.rng.initial_seed)));
        m.push(own("money", json!(self.money)));
        m.push(own("star", json!(self.star)));
        m.push(own("minutes", json!(self.clock.minutes)));
        m.push(own("mode", json!(self.mode.as_str())));
        m.push(own("modernCalendar", json!(self.modern_calendar.as_str())));
        if !self.auto_bridge {
            m.push(own("autoBridge", json!(false)));
        }
        if self.founder {
            m.push(own("founder", json!(true)));
        }
        m.push(own("lastQuarterMoney", json!(self.last_quarter_money)));
        m.push(("units", Field::Units(&self.tower.units)));
        m.push(("transports", Field::Transports(&self.tower.transports)));
        m.push(own("nextId", json!(self.tower.next_id)));
        if let Some(n) = &self.tower.tower_name {
            m.push(("towerName", Field::Text(n)));
        }
        if let Some(b) = self.tower.built_wedding_hall {
            m.push(own("builtWeddingHall", json!(b)));
        }
        if let Some(b) = self.evaluated_tower {
            m.push(own("evaluatedTower", json!(b)));
        }
        m.push(own("vipVisitDay", json!(self.vip_visit_day)));
        m.push(own("vipFavorable", json!(self.vip_favorable)));
        m.push(own("vipVisits", json!(self.vip_visits)));
        m.push(own("lastVipNagDay", json!(self.last_vip_nag_day)));
        m.push(own("treasuresFound", json!(self.treasures_found)));
        if let Some(d) = self.extermination_due_day {
            m.push(own("exterminationDueDay", json!(d)));
            if let Some(ids) = &self.extermination_room_ids {
                m.push(("exterminationRoomIds", Field::Ids(ids)));
            }
        }
        m.push(("events", Field::Events(&self.events)));
        m.push(("excavated", Field::Strings(&self.excavated)));
        m.push(("blockbusters", Field::Floats(&self.blockbusters)));
        m.push(("milestones", Field::Strings(&self.milestones)));
        m.push(("ledger", Field::Ledger(&self.ledger)));
        if let Some(v) = &self.view {
            m.push(("view", Field::Borrowed(v)));
        }
        if !self.log.is_empty() {
            let start = self.log.len().saturating_sub(LOG_SAVE_CAP);
            m.push(("log", Field::Log(&self.log[start..])));
        }
        m
    }

    /// `serialize()`: the saved game as a JSON tree, for the readers that
    /// edit, hash or walk it: the state view and its digest (the dual run's
    /// shadow and the tooling digest), the scenario runner and the TDT
    /// referee. The sync paths `serializeForSync` and `saveDelta`
    /// (`save_delta.rs`) read it too. The `.vctower` and `.TDT` exports do
    /// not: they read the text and the units one at a time (#1338, #1431).
    pub fn serialize(&self) -> Value {
        let mut m = Map::new();
        for (k, f) in self.save_fields() {
            m.insert(k.into(), f.into_value());
        }
        Value::Object(m)
    }

    /// The save as a tree without its `units`, and the units as `Value`s one
    /// at a time: the `.TDT` export reads the units as they come and the
    /// rest from the tree (`build_tdt_streamed`, #1431), so a save of
    /// thousands of units is never a tree beside the game. Each unit is the
    /// `Value` `serialize()` holds for it.
    #[cfg_attr(not(feature = "wasm"), allow(dead_code))]
    pub(crate) fn save_without_units(&self) -> (Value, impl Iterator<Item = Value> + '_) {
        let mut m = Map::new();
        for (k, f) in self.save_fields() {
            if k != "units" {
                m.insert(k.into(), f.into_value());
            }
        }
        (
            Value::Object(m),
            self.tower.units.iter().map(Unit::serialize),
        )
    }

    /// The saved game as `serde_json`'s compact text: the same bytes as
    /// `serialize().to_string()`, written without the tree. `Engine.serialize`
    /// returns it; that binding keeps its doc line, `serialize()` as JSON
    /// text, as `engine.d.ts` has it.
    pub fn save_text(&self) -> String {
        // Writing to memory fails only on a map key that is not a string or
        // a value that refuses to serialize; every key here is a string, and
        // every value a `Value`, a string, a number, or a map or list of
        // those, so the write cannot fail.
        serde_json::to_string(&Fields(self.save_fields())).expect("a save writes as JSON")
    }

    /// The same text, written into `buf`, so the memory tests can reserve the
    /// buffer first and count only what the write builds beside it.
    #[cfg(test)]
    pub(crate) fn write_save(&self, buf: &mut Vec<u8>) {
        serde_json::to_writer(buf, &Fields(self.save_fields())).expect("a save writes as JSON");
    }
}

#[cfg(test)]
#[path = "sim_save_tests.rs"]
mod tests;
