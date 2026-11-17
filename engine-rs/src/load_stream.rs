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
#[cfg(test)]
use crate::load::deserialize;
use crate::load::{
    assemble, deserialize_owned, each_listed_unit, founder_keys, has_save_shape, inflate_vctower,
    mark_founder_from_loaded_file, parse_save_json, reads_floor_runs, repair_lone_surrogates,
    unit_from_value, widen_shafts, UNIT_CAP,
};
use crate::sim::Simulation;
use crate::tower::{unit_list_headroom, Unit};

/// The save version this reader takes, with [`PLAIN_STREAMED_VERSION`]. Its
/// migration step is the one `streamed` applies, so a new save version means
/// a new review of this file (the `streamed_version_is_the_save_version` test
/// fails until then). Version 8 is version 7 with `lobbyHeights` (#308),
/// version 9 lists them per hall (#2068), and version 10 adds an elevator
/// schedule's `heldBack` hours (#1546); `assemble` reads every shape, so all
/// four take the same step. Version 11 folds floor tiles into runs, which
/// `Units` unfolds (`load::floor_runs`), and takes the same step too, as
/// does version 12, which adds a schedule's `autoTune` flag.
const STREAMED_VERSION: f64 = 12.0;
/// Version 11, still read here: floor runs, and no shaft on Auto.
const FLOOR_RUN_STREAMED_VERSION: f64 = 11.0;
/// Version 10, still read here: a schedule's held hours, and no floor run.
const HELD_HOURS_STREAMED_VERSION: f64 = 10.0;
/// Version 9, still read here: a tall lobby per hall, and no held hour.
const TALL_LOBBY_STREAMED_VERSION: f64 = 9.0;
/// Version 8, still read here: its whole-floor `lobbyHeights` entries are
/// the per-hall migration `assemble` applies.
const FLOOR_HEIGHTS_STREAMED_VERSION: f64 = 8.0;
/// The version a save with no tall lobby is still written at
/// ([`crate::sim::PLAIN_SAVE_VERSION`]).
const PLAIN_STREAMED_VERSION: f64 = 7.0;

/// `Simulation.deserialize(JSON.parse(text))`: the same game, or the same
/// error message, as `deserialize(&parse_save_json(text)?)`.
pub fn load_save_text(text: &[u8]) -> Result<Simulation, String> {
    read_save(text).map(|(sim, _)| sim)
}

/// A stored save as `SaveGame.loadResult` reads it: `load_save_text`, then a
/// save with no `appVersion` stamp (one from before 2.0) marked as a
/// founder's tower. An undo snapshot never comes this way. The port's
/// `loadSave` is its only caller, so a build without the binding skips it.
#[cfg_attr(not(feature = "wasm"), allow(dead_code))]
pub fn load_stored_text(text: &[u8]) -> Result<Simulation, String> {
    if let Some(Streamed { mut sim, data, .. }) = streamed(text, None) {
        mark_founder_from_loaded_file(&mut sim, &data);
        return Ok(sim);
    }
    let raw = parse_save_json(text).map_err(|e| e.to_string())?;
    let written = founder_keys(&raw);
    let mut sim = deserialize_owned(raw)?;
    mark_founder_from_loaded_file(&mut sim, &written);
    Ok(sim)
}

/// `load_save_text`, and whether the streamed reader took the text.
pub(crate) fn read_save(text: &[u8]) -> Result<(Simulation, bool), String> {
    if let Some(Streamed { sim, .. }) = streamed(text, None) {
        return Ok((sim, true));
    }
    let raw = parse_save_json(text).map_err(|e| e.to_string())?;
    Ok((deserialize_owned(raw)?, false))
}

/// `Engine.fromVctower`: the file decoded, its mode set to `mode` when one is
/// given (as a scenario start does), the save loaded, and a save from before
/// 2.0 marked as a founder's tower. The same game, or the same error message,
/// as `decode_vctower`, `override_mode`, `deserialize` and
/// `mark_founder_from_loaded_file` in turn.
pub fn load_vctower_text(text: &str, mode: Option<&str>) -> Result<Simulation, String> {
    read_vctower(text, mode).map(|(sim, _)| sim)
}

/// `Engine.fromVctowerBytes`: [`load_vctower_text`] for a file's bytes, which
/// reads the binary `VCTOWER2` file too. The same game, or the same error
/// message, as `decode_vctower_bytes`, `override_mode`, `deserialize` and
/// `mark_founder_from_loaded_file` in turn.
pub fn load_vctower_bytes(bytes: &[u8], mode: Option<&str>) -> Result<Simulation, String> {
    read_vctower_json(&crate::load::inflate_vctower_bytes(bytes)?, mode).map(|(sim, _)| sim)
}

/// `load_vctower_text`, and whether the streamed reader took the file.
fn read_vctower(text: &str, mode: Option<&str>) -> Result<(Simulation, bool), String> {
    read_vctower_json(&inflate_vctower(text)?, mode)
}

/// `read_vctower` on the save text a file holds, already inflated.
pub(crate) fn read_vctower_json(
    json: &[u8],
    mode: Option<&str>,
) -> Result<(Simulation, bool), String> {
    read_vctower_text(json, mode, false).map_err(|e| match e {
        TowerReadError::Unparseable(why) => format!("json: {why}"),
        TowerReadError::NotASave => "the file does not hold a saved game".to_string(),
        TowerReadError::Refused(why) => why,
    })
}

/// Why the save text in a tower file did not load, for the import to word.
pub(crate) enum TowerReadError {
    /// The text is not JSON the loader can hold.
    Unparseable(String),
    /// JSON, but with no numeric `minutes` or no `units` list.
    NotASave,
    /// The loader's own refusal, in its own words.
    Refused(String),
}

/// `read_vctower_json` for a file the player opened: the same game, or a
/// typed reason. The shape of the save (a numeric `minutes` and a `units`
/// list, the last of a repeated key counting) is read off the same pass the
/// load makes, so the text is not scanned twice.
pub(crate) fn read_tower_file_json(json: &[u8]) -> Result<Simulation, TowerReadError> {
    read_vctower_text(json, None, true).map(|(sim, _)| sim)
}

fn read_vctower_text(
    json: &[u8],
    mode: Option<&str>,
    need_shape: bool,
) -> Result<(Simulation, bool), TowerReadError> {
    if let Some(Streamed { mut sim, data }) = streamed(json, mode) {
        mark_founder_from_loaded_file(&mut sim, &data);
        return Ok((sim, true));
    }
    let mut raw = parse_save_json(json).map_err(|e| TowerReadError::Unparseable(e.to_string()))?;
    if need_shape && !has_save_shape(&raw) {
        return Err(TowerReadError::NotASave);
    }
    if let Some(m) = mode {
        override_mode(&mut raw, m).map_err(TowerReadError::Refused)?;
    }
    let written = founder_keys(&raw);
    let mut sim = deserialize_owned(raw).map_err(TowerReadError::Refused)?;
    mark_founder_from_loaded_file(&mut sim, &written);
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
fn streamed(text: &[u8], mode: Option<&str>) -> Option<Streamed> {
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
    // `migrate_save` on a version 7 to 11 save: the shaft widening, nothing else.
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
    // A save with no `units` list or no numeric `minutes` goes to today's
    // path, which refuses it (#1418).
    let (units, ids) = units?;
    if !data.get("minutes").is_some_and(Value::is_number) {
        return None;
    }
    let sim = assemble(&data, units, ids, &data);
    Some(Streamed { sim, data })
}

/// A save `streamed` took: the game, and the migrated save without `units`.
struct Streamed {
    sim: Simulation,
    data: Value,
}

/// Whether the save loads as Modern, when its version and mode (or the mode
/// the caller sets, `forced`) are ones this reader takes; `None` otherwise.
fn current_mode(rest: &Map<String, Value>, forced: Option<bool>) -> Option<bool> {
    let version = rest.get("version").and_then(Value::as_f64);
    let taken = [
        STREAMED_VERSION,
        FLOOR_RUN_STREAMED_VERSION,
        HELD_HOURS_STREAMED_VERSION,
        TALL_LOBBY_STREAMED_VERSION,
        FLOOR_HEIGHTS_STREAMED_VERSION,
        PLAIN_STREAMED_VERSION,
    ];
    if !version.is_some_and(|v| taken.contains(&v)) {
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
                    runs: reads_floor_runs(rest.get("version").and_then(Value::as_f64)),
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
    /// Whether the save's version writes floor runs, which are unfolded here.
    runs: bool,
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
        let mut units = Vec::with_capacity(self.hint + unit_list_headroom(self.hint));
        let mut ids = Vec::with_capacity(self.hint);
        let mut past_cap = false;
        while let Some(entry) = seq.next_element::<Value>()? {
            each_listed_unit(&entry, self.runs, |tile| {
                let Some((unit, id)) = unit_from_value(tile, self.modern) else {
                    return true;
                };
                // One more and `deserialize` refuses the save, in its own words.
                if units.len() == UNIT_CAP {
                    past_cap = true;
                    return false;
                }
                units.push(unit);
                ids.push(id);
                true
            });
            if past_cap {
                return Err(decline());
            }
        }
        Ok((units, ids))
    }
}

#[path = "load_stream_hint.rs"]
mod hint;
pub(crate) use hint::*;

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
pub(crate) mod memory;
