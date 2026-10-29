//! Writing a `.vctower` from the save's text without holding the save as one
//! `serde_json::Value` tree (#1338).
//!
//! `parse_save_json`, `stamp_save` and `encode_vctower` hold the whole save as
//! a tree and then write it again as JavaScript's JSON. On the large perf
//! tower that tree took the engine's linear memory up by about 33 MiB, and a
//! WASM memory never shrinks. This writer reads the text one top-level key at
//! a time, the way `load_stream` reads a load. Each entry of `units` is parsed
//! on its own and written as JavaScript's JSON at once; every other key is the
//! small `Value` it is. The stamp's keys are placed by the rules `stamp_save`
//! follows: a key already in the save keeps its place, a new one goes last.
//!
//! It takes a top-level object in which no key repeats and `units` is one
//! array; the checks and the framing are `stamp_save`'s and `pack_json`'s own
//! (`check_stamp`, `detect_founder`). Any other text, one that does not parse
//! included, goes to today's path, so its result and its message are exactly
//! what they were.

use std::collections::HashSet;
use std::fmt;
use std::ops::Range;

use serde::de::{self, DeserializeSeed, Deserializer as _, MapAccess, SeqAccess, Visitor};
use serde_json::{json, Value};

use crate::canonical::{js_json, js_key_rank, write_js_json, write_js_string};
use crate::load::{
    check_stamp, encode_vctower, pack_json, parse_int, parse_save_json, repair_lone_surrogates,
    stamp_save,
};

/// `encodeVctower(saveJson, appVersion, savedAtMs)`: the `.vctower` file for
/// a serialized game, stamped as `SaveGame.export` stamps it. The same bytes,
/// or the same error message, as `parse_save_json`, `stamp_save` and
/// `encode_vctower` in turn.
#[cfg_attr(not(feature = "wasm"), allow(dead_code))]
pub fn encode_vctower_text(
    text: &[u8],
    app_version: &str,
    saved_at_ms: f64,
) -> Result<Vec<u8>, String> {
    match read_top(text) {
        Some(top) => write_file(top, app_version, saved_at_ms),
        None => tree_path(text, app_version, saved_at_ms),
    }
}

/// [`encode_vctower_text`] on text the caller is done with: the text is freed
/// as soon as it has been read, before the file is built, so the two are not
/// held together.
pub fn encode_vctower_string(
    text: String,
    app_version: &str,
    saved_at_ms: f64,
) -> Result<Vec<u8>, String> {
    match read_top(text.as_bytes()) {
        Some(top) => {
            drop(text);
            write_file(top, app_version, saved_at_ms)
        }
        None => tree_path(text.as_bytes(), app_version, saved_at_ms),
    }
}

/// Today's path: the whole save as a tree.
fn tree_path(text: &[u8], app_version: &str, saved_at_ms: f64) -> Result<Vec<u8>, String> {
    let mut save = parse_save_json(text).map_err(|e| format!("save: {e}"))?;
    stamp_save(&mut save, app_version, saved_at_ms)?;
    encode_vctower(&save)
}

/// Where a top-level value's text is.
enum Text {
    /// A range of the shared buffer.
    Buf(Range<usize>),
    /// A stamp value that replaced one, or was added.
    Own(String),
}

/// The save's top-level keys in the order they were read, each with its text,
/// and what the stamp's checks need to know about the save.
#[derive(Default)]
struct Top {
    buf: String,
    parts: Vec<(String, Text)>,
    units_listed: bool,
    minutes_is_number: bool,
    carries_founder: bool,
}

/// The text's length, which the buffer is reserved to: a save the game writes
/// is already compact, and its values take no more room than its text.
struct TopVisitor(usize);

impl<'de> Visitor<'de> for TopVisitor {
    type Value = Top;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a saved game")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Top, A::Error> {
        let mut top = Top {
            buf: String::with_capacity(self.0),
            ..Top::default()
        };
        // The keys read so far, so that a repeated one is found in constant
        // time however many keys a crafted text lists.
        let mut seen = HashSet::new();
        while let Some(key) = map.next_key::<String>()? {
            // `load_stream` declines these spellings too: a `Value` reads them
            // as something else under serde_json's raw-value features.
            if key.starts_with("$serde_json::private::") || !seen.insert(key.clone()) {
                return Err(decline());
            }
            let start = top.buf.len();
            if key == "units" {
                map.next_value_seed(UnitsText(&mut top.buf))?;
                top.units_listed = true;
            } else {
                let value = map.next_value::<Value>()?;
                match key.as_str() {
                    "minutes" => top.minutes_is_number = value.is_number(),
                    "founder" => top.carries_founder |= value == Value::Bool(true),
                    "appVersion" => {
                        top.carries_founder |=
                            value.as_str().and_then(parse_int).is_some_and(|v| v < 2.0)
                    }
                    _ => {}
                }
                write_js_json(&mut top.buf, &value);
            }
            let range = start..top.buf.len();
            top.parts.push((key, Text::Buf(range)));
        }
        Ok(top)
    }
}

/// Stops the read, so that today's path reads the save.
fn decline<E: de::Error>() -> E {
    E::custom("not a save the streamed writer takes")
}

/// The `units` array, each entry parsed and written on its own.
struct UnitsText<'a>(&'a mut String);

impl<'de> DeserializeSeed<'de> for UnitsText<'_> {
    type Value = ();

    fn deserialize<D: de::Deserializer<'de>>(self, d: D) -> Result<(), D::Error> {
        d.deserialize_seq(self)
    }
}

impl<'de> Visitor<'de> for UnitsText<'_> {
    type Value = ();

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a list of units")
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<(), A::Error> {
        self.0.push('[');
        let mut first = true;
        while let Some(entry) = seq.next_element::<Value>()? {
            if !first {
                self.0.push(',');
            }
            first = false;
            write_js_json(self.0, &entry);
        }
        self.0.push(']');
        Ok(())
    }
}

/// Set a top-level value: in place when the key is there, last when it is not.
fn put(parts: &mut Vec<(String, Text)>, key: &str, value: Value) {
    let text = Text::Own(js_json(&value));
    match parts.iter_mut().find(|(k, _)| k == key) {
        Some((_, slot)) => *slot = text,
        None => parts.push((key.to_string(), text)),
    }
}

/// The text read key by key; `None` when this writer does not take it and
/// today's path reads it instead. The repaired copy of the text, when there
/// is one, is freed before this returns.
fn read_top(text: &[u8]) -> Option<Top> {
    let repaired = repair_lone_surrogates(text);
    let text = repaired.as_deref().unwrap_or(text);
    let mut de = serde_json::Deserializer::from_slice(text);
    let top = de.deserialize_map(TopVisitor(text.len())).ok()?;
    de.end().ok()?;
    Some(top)
}

/// The stamped file from a text that was read: `stamp_save`'s checks, its
/// stamp, and the container.
fn write_file(mut top: Top, app_version: &str, saved_at_ms: f64) -> Result<Vec<u8>, String> {
    // `stamp_save`'s checks, in its order. The text parsed, so a save that is
    // not an object never gets here.
    if !top.minutes_is_number || !top.units_listed {
        return Err("not a tower save (no numeric minutes or no units list)".into());
    }
    check_stamp(app_version, saved_at_ms)?;
    if top.carries_founder {
        put(&mut top.parts, "founder", json!(true));
    }
    put(&mut top.parts, "savedAt", json!(saved_at_ms));
    put(&mut top.parts, "appVersion", json!(app_version));
    // JavaScript visits array-index keys first; the sort is stable.
    top.parts.sort_by_key(|(k, _)| js_key_rank(k));
    // Room for the values, the stamp's and each key with its quotes, colon and
    // comma, so the text is written once and never regrows.
    let room: usize = top
        .parts
        .iter()
        .map(|(key, part)| {
            key.len()
                + 4
                + match part {
                    Text::Buf(range) => range.len(),
                    Text::Own(own) => own.len(),
                }
        })
        .sum();
    let mut json = String::with_capacity(room + 2);
    json.push('{');
    for (i, (key, part)) in top.parts.iter().enumerate() {
        if i > 0 {
            json.push(',');
        }
        write_js_string(&mut json, key);
        json.push(':');
        match part {
            Text::Buf(range) => json.push_str(&top.buf[range.clone()]),
            Text::Own(own) => json.push_str(own),
        }
    }
    json.push('}');
    drop(top);
    pack_json(&json)
}

#[cfg(test)]
#[path = "export_stream_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "export_stream_memory_tests.rs"]
mod memory;
