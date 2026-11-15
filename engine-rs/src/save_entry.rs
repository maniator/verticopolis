//! A save entry written straight to the save text, for the records a save
//! lists by the thousand: the units (`tower::unit_save`) and the people
//! (`crowd::save`). Each record walks its entry once, key by key
//! ([`SaveEntries::save_entries`]), and that one walk is read as a `Value`
//! ([`entry_tree`]), written straight to the text ([`Written`]), or counted.
//!
//! A save of a large tower writes about 45,000 units and up to several
//! thousand people. Building each entry as a `Value` (a map, a string per key
//! and per name) only to write it and drop it was most of the time a save
//! took. A [`Written`] entry writes the same bytes with nothing built: each
//! value is written as `serde_json` writes the `Value` the tree would hold
//! (`Value::from` makes a number or a null without allocating), and the
//! tests pin the text against the tree's (`sim_save_tests`).

use std::convert::Infallible;

use serde::ser::{Serialize, SerializeMap, Serializer};
use serde_json::{Map, Value};

/// One value of a save entry, borrowed from its record where it can be.
pub(crate) enum EntryValue<'a> {
    Int(i64),
    /// A float, written as `json!` writes it: a non-finite one as null.
    Float(f64),
    Text(&'a str),
    True,
    Ints(&'a [i64]),
    /// A two-key object: a person's errand (`place`, `inbound`) or commute
    /// (`officeId`, `inbound`).
    Pair(&'static str, Scalar<'a>, &'static str, Scalar<'a>),
    /// A value the record builds for the save, which only rare records carry
    /// (a Modern theater's second screen).
    Owned(Value),
    /// A value the record kept from the save it was loaded from.
    Raw(&'a Value),
}

/// A value inside an [`EntryValue::Pair`].
pub(crate) enum Scalar<'a> {
    Int(i64),
    Text(&'a str),
    Bool(bool),
}

impl Scalar<'_> {
    fn into_value(self) -> Value {
        match self {
            Scalar::Int(n) => Value::from(n),
            Scalar::Text(t) => Value::from(t),
            Scalar::Bool(b) => Value::Bool(b),
        }
    }
}

impl Serialize for Scalar<'_> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Scalar::Int(n) => Value::from(*n).serialize(s),
            Scalar::Text(t) => t.serialize(s),
            Scalar::Bool(b) => s.serialize_bool(*b),
        }
    }
}

impl EntryValue<'_> {
    fn into_value(self) -> Value {
        match self {
            EntryValue::Int(n) => Value::from(n),
            EntryValue::Float(f) => Value::from(f),
            EntryValue::Text(t) => Value::from(t),
            EntryValue::True => Value::Bool(true),
            EntryValue::Ints(ns) => Value::from(ns),
            EntryValue::Pair(k1, v1, k2, v2) => {
                let mut m = Map::new();
                m.insert(k1.into(), v1.into_value());
                m.insert(k2.into(), v2.into_value());
                Value::Object(m)
            }
            EntryValue::Owned(v) => v,
            EntryValue::Raw(v) => v.clone(),
        }
    }
}

impl Serialize for EntryValue<'_> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            // Numbers through `Value`, which holds them inline, so an integer
            // writes as its digits and a float, or the null a non-finite float
            // becomes, exactly as the tree's `Value` writes it.
            EntryValue::Int(n) => Value::from(*n).serialize(s),
            EntryValue::Float(f) => Value::from(*f).serialize(s),
            EntryValue::Text(t) => t.serialize(s),
            EntryValue::True => s.serialize_bool(true),
            EntryValue::Ints(ns) => ns.serialize(s),
            // A `Value::Object` writes its length, then its entries in order.
            EntryValue::Pair(k1, v1, k2, v2) => {
                let mut m = s.serialize_map(Some(2))?;
                m.serialize_entry(k1, v1)?;
                m.serialize_entry(k2, v2)?;
                m.end()
            }
            EntryValue::Owned(v) => v.serialize(s),
            EntryValue::Raw(v) => v.serialize(s),
        }
    }
}

/// A record the save lists as one JSON object.
pub(crate) trait SaveEntries {
    /// Each key of the record's save entry with its value, in the order the
    /// entry lists them, leaving out every key the save leaves out. The walk
    /// stops at `put`'s first error.
    fn save_entries<E>(
        &self,
        put: impl FnMut(&'static str, EntryValue<'_>) -> Result<(), E>,
    ) -> Result<(), E>;
}

/// The record's save entry as a tree.
pub(crate) fn entry_tree(record: &impl SaveEntries) -> Value {
    let mut m = Map::new();
    let _ = record.save_entries(|k, v| {
        m.insert(k.into(), v.into_value());
        Ok::<(), Infallible>(())
    });
    Value::Object(m)
}

/// The record's save entry written straight to the save, as its tree writes.
pub(crate) struct Written<'a, T>(pub(crate) &'a T);

impl<T: SaveEntries> Serialize for Written<'_, T> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        // Every record writes at least one key, so the map is never empty,
        // and `serde_json` writes a map of unknown length as it writes one
        // of known length.
        let mut m = s.serialize_map(None)?;
        self.0.save_entries(|k, v| m.serialize_entry(k, &v))?;
        m.end()
    }
}

/// Every record of a list, each written as [`Written`] writes it.
pub(crate) struct WrittenAll<'a, T>(pub(crate) &'a [T]);

impl<T: SaveEntries> Serialize for WrittenAll<'_, T> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_seq(self.0.iter().map(Written))
    }
}
