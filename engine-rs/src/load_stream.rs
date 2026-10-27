//! Reading a current save without holding it as one `serde_json::Value` tree
//! (#1225, slice 13 of the facade plan).
//!
//! `parse_save_json` then `deserialize` hold the whole save as a `Value`, and
//! the version step copies it twice more on the way (`migrate_save` clones the
//! save, and the version 7 shaft widening clones it again), so loading the
//! large perf tower peaked near six times the memory the loaded game keeps. A
//! WASM memory never shrinks, so that peak stayed for the whole session.
//!
//! This reader takes the save's top-level object one key at a time. Each entry
//! of `units` is parsed on its own and converted at once by `unit_from_value`,
//! the conversion `deserialize` uses, into vectors reserved up front from a
//! count of the entries (`units_hint`), so on a save the game writes they
//! never regrow; every other key is kept as the small `Value` it is. The rest
//! of the load is `assemble`, which `deserialize` also ends with.
//!
//! It reads only the saves the game writes: a top-level object whose `version`
//! is 7 and whose `mode` is a game mode (or a mode the caller sets), both given
//! before `units`, with no `version` or `mode` key after it (a save's own mode
//! there declines even when the caller sets one), and one `units` array of at
//! most `UNIT_CAP` units. For those, `migrate_save` only widens narrow elevator
//! shafts, which reads and writes `transports` alone. Any other text, one that
//! does not parse included, goes to today's path, so its result and its
//! message are exactly what they were. `Engine.fromSave` and
//! `Engine.fromVctower` both load through it.

use std::fmt;

use serde::de::{self, DeserializeSeed, Deserializer as _, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Value};

use crate::clock::GameMode;
use crate::load::{
    assemble, deserialize, inflate_vctower, mark_founder_from_loaded_file, parse_save_json,
    repair_lone_surrogates, unit_from_value, widen_shafts, UNIT_CAP,
};
use crate::sim::Simulation;
use crate::tower::Unit;

/// The save version this reader takes. Its migration step is the one
/// `streamed` applies, so a new save version means a new review of this file
/// (the `streamed_version_is_the_save_version` test fails until then).
const STREAMED_VERSION: f64 = 7.0;

/// `Simulation.deserialize(JSON.parse(text))`: the same game, or the same
/// error message, as `deserialize(&parse_save_json(text)?)`.
pub fn load_save_text(text: &[u8]) -> Result<Simulation, String> {
    read_save(text).map(|(sim, _)| sim)
}

/// `load_save_text`, and whether the streamed reader took the text.
fn read_save(text: &[u8]) -> Result<(Simulation, bool), String> {
    if let Some((sim, _)) = streamed(text, None) {
        return Ok((sim, true));
    }
    let raw = parse_save_json(text).map_err(|e| e.to_string())?;
    Ok((deserialize(&raw)?, false))
}

/// `Engine.fromVctower`: the file decoded, its mode set to `mode` when one is
/// given (as a scenario start does), the save loaded, and a save from before
/// 2.0 marked as a founder's tower. The same game, or the same error message,
/// as `decode_vctower`, `override_mode`, `deserialize` and
/// `mark_founder_from_loaded_file` in turn.
pub fn load_vctower_text(text: &str, mode: Option<&str>) -> Result<Simulation, String> {
    read_vctower(text, mode).map(|(sim, _)| sim)
}

/// `load_vctower_text`, and whether the streamed reader took the file.
fn read_vctower(text: &str, mode: Option<&str>) -> Result<(Simulation, bool), String> {
    let json = inflate_vctower(text)?;
    if let Some((mut sim, data)) = streamed(&json, mode) {
        mark_founder_from_loaded_file(&mut sim, &data);
        return Ok((sim, true));
    }
    let mut raw = parse_save_json(&json).map_err(|e| format!("json: {e}"))?;
    if let Some(m) = mode {
        override_mode(&mut raw, m)?;
    }
    let mut sim = deserialize(&raw)?;
    mark_founder_from_loaded_file(&mut sim, &raw);
    Ok((sim, false))
}

/// A game mode by the name the binding takes, or the binding's message.
pub(crate) fn parse_mode(s: &str) -> Result<GameMode, String> {
    GameMode::parse(s).ok_or_else(|| format!("mode must be classic or modern, got {s}"))
}

/// `raw.mode = mode`, the override a scenario start applies before loading.
/// The TypeScript throws on a non-object; here that is an error rather than
/// a panic, which under WASM would trap and poison the module.
pub(crate) fn override_mode(raw: &mut Value, mode: &str) -> Result<(), String> {
    parse_mode(mode)?;
    let obj = raw
        .as_object_mut()
        .ok_or_else(|| "the file does not hold a saved game".to_string())?;
    obj.insert("mode".into(), Value::String(mode.to_string()));
    Ok(())
}

/// The save read key by key, with its mode set to `mode` when one is given,
/// and the migrated save without `units` that `assemble` read; `None` when
/// this reader does not take the save (or it does not parse) and today's
/// path reads it instead.
fn streamed(text: &[u8], mode: Option<&str>) -> Option<(Simulation, Value)> {
    // A mode the binding refuses goes to today's path, which refuses it once
    // the text has parsed. The game reads Modern off the string, so the
    // units do too.
    let forced = match mode {
        Some(m) => {
            parse_mode(m).ok()?;
            Some(m == "modern")
        }
        None => None,
    };
    // The repaired copy of the text, when there is one, is freed before the
    // game is built.
    let Top { mut rest, units } = {
        let repaired = repair_lone_surrogates(text);
        let text = repaired.as_deref().unwrap_or(text);
        let mut de = serde_json::Deserializer::from_slice(text);
        let top = de.deserialize_map(TopVisitor { forced, text }).ok()?;
        de.end().ok()?;
        top
    };
    // A save with no `units` must still be one this reader takes.
    current_mode(&rest, forced)?;
    if let Some(m) = mode {
        rest.insert("mode".into(), Value::String(m.to_string()));
    }
    // `migrate_save` on a version 7 save: the shaft widening, nothing else.
    let widened = rest
        .get("transports")
        .and_then(Value::as_array)
        .and_then(|t| widen_shafts(t));
    if let Some(transports) = widened {
        rest.insert("transports".into(), Value::Array(transports));
    }
    // `deserialize` reads the founder flag from the save as written, which
    // the widening leaves alone, so the migrated keys serve for both.
    let data = Value::Object(rest);
    let (units, ids) = units.unwrap_or_default();
    let sim = assemble(&data, units, ids, &data);
    Some((sim, data))
}

/// Whether the save loads as Modern, when its version and mode (or the mode
/// the caller sets, `forced`) are ones this reader takes; `None` otherwise.
fn current_mode(rest: &Map<String, Value>, forced: Option<bool>) -> Option<bool> {
    if rest.get("version").and_then(Value::as_f64) != Some(STREAMED_VERSION) {
        return None;
    }
    if forced.is_some() {
        return forced;
    }
    match rest.get("mode").and_then(Value::as_str) {
        Some("classic") => Some(false),
        Some("modern") => Some(true),
        _ => None,
    }
}

/// Stops the read, so that today's path reads the save.
fn decline<E: de::Error>() -> E {
    E::custom("not a save the streamed reader takes")
}

/// The top-level object: every key but `units` as its `Value` (a repeated
/// key keeps its last value, as `JSON.parse` does), and the units converted
/// as they are read.
struct Top {
    rest: Map<String, Value>,
    units: Option<(Vec<Unit>, Vec<Option<i64>>)>,
}

struct TopVisitor<'t> {
    forced: Option<bool>,
    /// The text being read, which the units' reservation is counted off.
    text: &'t [u8],
}

impl<'de> Visitor<'de> for TopVisitor<'_> {
    type Value = Top;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a saved game")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Top, A::Error> {
        let mut rest = Map::new();
        let mut units = None;
        while let Some(key) = map.next_key::<String>()? {
            // serde_json's own `Value` reads a first key of this spelling as
            // a raw value or a number under its `raw_value` and
            // `arbitrary_precision` features. Neither is on, but such a save
            // goes to today's path, so turning one on cannot split the two.
            if key.starts_with("$serde_json::private::") {
                return Err(decline());
            }
            if key == "units" {
                // How a unit reads depends on the version and the mode, so
                // both must be known by now.
                let modern = match (&units, current_mode(&rest, self.forced)) {
                    (None, Some(modern)) => modern,
                    _ => return Err(decline()),
                };
                units = Some(map.next_value_seed(Units {
                    modern,
                    hint: units_hint(self.text),
                })?);
            } else if units.is_some() && (key == "version" || key == "mode") {
                return Err(decline());
            } else {
                let value = map.next_value::<Value>()?;
                rest.insert(key, value);
            }
        }
        Ok(Top { rest, units })
    }
}

/// The `units` array, each entry parsed and converted on its own, with the
/// units and their saved ids in two vectors as `assemble` takes them.
struct Units {
    modern: bool,
    hint: usize,
}

impl<'de> DeserializeSeed<'de> for Units {
    type Value = (Vec<Unit>, Vec<Option<i64>>);

    fn deserialize<D: de::Deserializer<'de>>(self, d: D) -> Result<Self::Value, D::Error> {
        d.deserialize_seq(self)
    }
}

impl<'de> Visitor<'de> for Units {
    type Value = (Vec<Unit>, Vec<Option<i64>>);

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a list of units")
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
        let mut units = Vec::with_capacity(self.hint);
        let mut ids = Vec::with_capacity(self.hint);
        while let Some(entry) = seq.next_element::<Value>()? {
            let Some((unit, id)) = unit_from_value(&entry, self.modern) else {
                continue;
            };
            // One more and `deserialize` refuses the save, in its own words.
            if units.len() == UNIT_CAP {
                return Err(decline());
            }
            units.push(unit);
            ids.push(id);
        }
        Ok((units, ids))
    }
}

/// The shortest unit entry the game writes, `{"id":1,"kind":"floor","floor":1,"x":0}`
/// and its comma, is 40 bytes, so a save the game writes lists fewer units
/// than its length over this many bytes. The bound sits below 40 so that a
/// hand-made save of entries down to 24 bytes still gets all its room up
/// front; one of shorter entries (the shortest that loads, `{"kind":"spa"}`,
/// is 14 bytes) is counted low, and its vectors regrow as it loads.
const MIN_UNIT_BYTES: usize = 24;

/// How many objects with at least one key the save's top-level `units` array
/// lists (only such an object can become a unit), counted off the text
/// without parsing it, capped at `UNIT_CAP` and at the text's length over
/// `MIN_UNIT_BYTES`. The unit vectors get that much room up front, since a
/// regrowing vector holds its old and new buffers at once, so on a save the
/// game writes they never regrow. The room is at most one unit and its id per
/// `MIN_UNIT_BYTES` bytes of text, and at most `UNIT_CAP` of them, whatever
/// the text holds: a hand-made text whose `units` lists objects that do not
/// become units still reserves it, and so does one that turns out malformed
/// before the reader declines it (#1243). Only that capacity depends on the
/// count: a text it miscounts (a hand-made one, or one that spells `units`
/// with an escape) loads the same game, with more or less spare room while it
/// loads.
fn units_hint(text: &[u8]) -> usize {
    let mut depth = 0usize;
    let mut i = 0;
    while i < text.len() {
        match text[i] {
            b'"' => {
                let end = string_end(text, i);
                if depth == 1 && text.get(i + 1..end - 1) == Some(&b"units"[..]) {
                    let colon = skip_space(text, end);
                    let open = skip_space(text, colon + 1);
                    if text.get(colon) == Some(&b':') && text.get(open) == Some(&b'[') {
                        return objects(text, open).min(text.len() / MIN_UNIT_BYTES);
                    }
                }
                i = end;
                continue;
            }
            b'{' | b'[' => depth += 1,
            b'}' | b']' => depth = depth.saturating_sub(1),
            _ => {}
        }
        i += 1;
    }
    0
}

/// The objects with at least one key listed directly in the array that opens
/// at `open`, up to `UNIT_CAP`.
fn objects(text: &[u8], open: usize) -> usize {
    let (mut depth, mut count) = (0usize, 0usize);
    let mut i = open + 1;
    while i < text.len() && count < UNIT_CAP {
        match text[i] {
            b'"' => {
                i = string_end(text, i);
                continue;
            }
            b'{' if depth == 0 => {
                count += usize::from(text.get(skip_space(text, i + 1)) != Some(&b'}'));
                depth += 1;
            }
            b'{' | b'[' => depth += 1,
            b']' | b'}' if depth == 0 => break,
            b']' | b'}' => depth -= 1,
            _ => {}
        }
        i += 1;
    }
    count
}

/// The index just past the string that opens at `start`, or the text's end.
fn string_end(text: &[u8], start: usize) -> usize {
    let mut i = start + 1;
    while i < text.len() {
        match text[i] {
            b'\\' => i += 2,
            b'"' => return i + 1,
            _ => i += 1,
        }
    }
    text.len()
}

/// The first index at or after `i` that is not JSON whitespace.
fn skip_space(text: &[u8], mut i: usize) -> usize {
    while matches!(text.get(i), Some(b' ' | b'\t' | b'\n' | b'\r')) {
        i += 1;
    }
    i
}

#[cfg(test)]
#[path = "load_stream_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "load_stream_edit_tests.rs"]
mod edits;

#[cfg(test)]
#[path = "load_vctower_tests.rs"]
mod vctower;

#[cfg(test)]
#[path = "load_memory_tests.rs"]
mod memory;
