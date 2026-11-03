//! A `.vctower` file the player opens, read into a game or refused in the
//! player's words (#1498). The checks that used to run in the page's
//! TypeScript run here, in front of the same loader every save goes through,
//! so the engine alone decides what a tower file is.

use std::fmt;

use serde::de::{self, Deserializer as _, IgnoredAny, MapAccess, SeqAccess, Visitor};

use crate::load::{inflate_vctower, js_trim, repair_lone_surrogates, TOWER_FILE_MAGIC};
use crate::sim::Simulation;

/// Not a `VCTOWER` file at all.
pub const NOT_A_TOWER_FILE: &str = "Not a Verticopolis tower file.";
/// A container from a later format version (`VCTOWER2` and up).
pub const NEWER_FILE_REFUSAL: &str =
    "This tower file was made by a newer version of Verticopolis. Update the game to load it.";
/// The container is ours but its contents cannot be read.
pub const DAMAGED_FILE: &str = "This tower file is damaged and can't be read.";
/// The file inflates past the size cap.
pub const TOO_LARGE_FILE: &str = "This tower file is too large to open safely.";
/// The most file text the engine takes: the inflate cap (32 MiB) as base64
/// is under 43 MiB, so a longer text cannot be a tower this game saved. The
/// check keeps a huge pick from growing the engine's memory.
const MAX_FILE_TEXT_BYTES: usize = 48 * 1024 * 1024;
/// The contents are JSON but have no clock or no units list.
pub const NOT_A_TOWER_SAVE: &str = "Not a valid tower save file.";

/// The `.vctower` text the player opened, read into a game. Every refusal is
/// a sentence for the player: the container checks first, then the shape of
/// the save, then the loader's own refusals (a save from a newer build, a
/// `null` save, too many units), which are passed through unchanged.
pub fn import_vctower(text: &str) -> Result<Simulation, String> {
    if text.len() > MAX_FILE_TEXT_BYTES {
        return Err(TOO_LARGE_FILE.into());
    }
    let trimmed = js_trim(text);
    let family = container_family(trimmed).ok_or(NOT_A_TOWER_FILE)?;
    if family != TOWER_FILE_MAGIC {
        return Err(NEWER_FILE_REFUSAL.into());
    }
    let json = inflate_vctower(trimmed).map_err(|e| {
        if e == crate::load::EXPANDS_TOO_FAR {
            TOO_LARGE_FILE.to_string()
        } else {
            DAMAGED_FILE.to_string()
        }
    })?;
    match save_shape(&json) {
        None => return Err(DAMAGED_FILE.into()),
        Some(false) => return Err(NOT_A_TOWER_SAVE.into()),
        Some(true) => {}
    }
    crate::load_stream::read_vctower_json(&json, None)
        .map(|(sim, _)| sim)
        .map_err(|e| {
            if e.starts_with("json:") {
                DAMAGED_FILE.to_string()
            } else {
                e
            }
        })
}

/// `VCTOWER` and the digits after it, as the file starts with them.
fn container_family(trimmed: &str) -> Option<&str> {
    let rest = trimmed.strip_prefix("VCTOWER")?;
    let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
    (digits > 0).then(|| &trimmed[.."VCTOWER".len() + digits])
}

/// Whether the text is a JSON object with a numeric `minutes` and a `units`
/// list (the last of a repeated key counts, as in a parse); `None` when it
/// is no JSON at all. Reads the text once and keeps none of it.
fn save_shape(json: &[u8]) -> Option<bool> {
    let repaired = repair_lone_surrogates(json);
    let text = repaired.as_deref().unwrap_or(json);
    let mut de = serde_json::Deserializer::from_slice(text);
    match de.deserialize_map(ShapeVisitor) {
        Ok(shape) => {
            de.end().ok()?;
            Some(shape.minutes && shape.units)
        }
        // Valid JSON that is no object (`null`, a number, a list) is no save.
        Err(_) => serde_json::from_slice::<IgnoredAny>(text)
            .is_ok()
            .then_some(false),
    }
}

#[derive(Default)]
struct Shape {
    minutes: bool,
    units: bool,
}

struct ShapeVisitor;

impl<'de> Visitor<'de> for ShapeVisitor {
    type Value = Shape;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a saved game")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Shape, A::Error> {
        let mut shape = Shape::default();
        while let Some(key) = map.next_key::<String>()? {
            match key.as_str() {
                "minutes" => shape.minutes = map.next_value::<ValueKind>()? == ValueKind::Number,
                "units" => shape.units = map.next_value::<ValueKind>()? == ValueKind::List,
                _ => {
                    map.next_value::<IgnoredAny>()?;
                }
            }
        }
        Ok(shape)
    }
}

/// What a JSON value is, for the two keys the shape check looks at.
#[derive(PartialEq)]
enum ValueKind {
    Number,
    List,
    Other,
}

impl<'de> de::Deserialize<'de> for ValueKind {
    fn deserialize<D: de::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        d.deserialize_any(KindVisitor)
    }
}

struct KindVisitor;

impl<'de> Visitor<'de> for KindVisitor {
    type Value = ValueKind;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("any JSON value")
    }

    fn visit_i64<E>(self, _: i64) -> Result<ValueKind, E> {
        Ok(ValueKind::Number)
    }

    fn visit_u64<E>(self, _: u64) -> Result<ValueKind, E> {
        Ok(ValueKind::Number)
    }

    fn visit_f64<E>(self, _: f64) -> Result<ValueKind, E> {
        Ok(ValueKind::Number)
    }

    fn visit_bool<E>(self, _: bool) -> Result<ValueKind, E> {
        Ok(ValueKind::Other)
    }

    fn visit_str<E>(self, _: &str) -> Result<ValueKind, E> {
        Ok(ValueKind::Other)
    }

    fn visit_unit<E>(self) -> Result<ValueKind, E> {
        Ok(ValueKind::Other)
    }

    fn visit_none<E>(self) -> Result<ValueKind, E> {
        Ok(ValueKind::Other)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<ValueKind, A::Error> {
        while seq.next_element::<IgnoredAny>()?.is_some() {}
        Ok(ValueKind::List)
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<ValueKind, A::Error> {
        while map.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
        Ok(ValueKind::Other)
    }
}
