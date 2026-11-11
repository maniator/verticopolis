//! The `.vctower` container: base64 and compression framing, the stamp, encode and decode.

use super::*;

/// The reason a `.vctower` is refused for inflating past the size cap.
pub(crate) const EXPANDS_TOO_FAR: &str =
    "this .vctower expands to more data than we will hold; it looks crafted rather than saved";

/// Reads a `.vctower` file's text into its save JSON, ready for
/// [`deserialize`]. Refuses text that is not a `.vctower` file, and one that
/// would inflate past 32 MiB.
pub fn decode_vctower(text: &str) -> Result<Value, String> {
    parse_save_json(&inflate_vctower(text)?).map_err(|e| format!("json: {e}"))
}

/// Why the save text could not be taken out of a `.vctower` container.
pub(crate) enum InflateError {
    /// The text does not start with the `VCTOWER1` stamp.
    NotAContainer,
    /// The text inflates past the size cap.
    ExpandsTooFar,
    /// The packed data is not valid deflate.
    Damaged(String),
}

/// The save text inside a VCTOWER1 container, as `decode_vctower` parses it.
pub(crate) fn inflate_vctower(text: &str) -> Result<Vec<u8>, String> {
    inflate_container(text).map_err(|e| match e {
        InflateError::NotAContainer => "not a VCTOWER1 file".to_string(),
        InflateError::ExpandsTooFar => EXPANDS_TOO_FAR.to_string(),
        InflateError::Damaged(why) => why,
    })
}

/// `inflate_vctower` with the reason as a variant, for a caller that words
/// each refusal itself.
pub(crate) fn inflate_container(text: &str) -> Result<Vec<u8>, InflateError> {
    let trimmed = js_trim(text);
    if !trimmed.starts_with(TOWER_FILE_MAGIC) {
        return Err(InflateError::NotAContainer);
    }
    let packed = lenient_base64(&trimmed[TOWER_FILE_MAGIC.len()..]);
    use std::io::Read;
    let mut out = Vec::new();
    flate2::read::DeflateDecoder::new(&packed[..])
        .take(MAX_SAVE_INFLATED_BYTES + 1)
        .read_to_end(&mut out)
        .map_err(|e| InflateError::Damaged(format!("inflate: {e}")))?;
    if out.len() as u64 > MAX_SAVE_INFLATED_BYTES {
        return Err(InflateError::ExpandsTooFar);
    }
    // `TextDecoder` drops a leading byte order mark before `JSON.parse` sees it.
    if out.starts_with(b"\xEF\xBB\xBF") {
        out.drain(..3);
    }
    Ok(out)
}

#[doc(hidden)]
/// `JSON.parse` for save text that a JavaScript host wrote. A JavaScript
/// string can hold half of a surrogate pair (a name cut at a UTF-16 length,
/// for one), and `JSON.stringify` writes it as a `\udxxx` escape that
/// `serde_json` refuses, since a Rust string cannot hold it. Each such escape
/// becomes U+FFFD, the character `TextEncoder` substitutes for an unpaired
/// surrogate, so the save
/// loads with a replacement character where the half character was. Paired
/// escapes, every other escape and every byte outside a string pass through
/// unchanged; text with no lone surrogate escape is parsed as given.
pub fn parse_save_json(text: &[u8]) -> Result<Value, serde_json::Error> {
    match repair_lone_surrogates(text) {
        Some(fixed) => serde_json::from_slice(&fixed),
        None => serde_json::from_slice(text),
    }
}

/// The value of the four hex digits at `at`, if they are four hex digits.
pub(super) fn hex4(text: &[u8], at: usize) -> Option<u16> {
    let digits = text.get(at..at + 4)?;
    let s = std::str::from_utf8(digits).ok()?;
    if !s.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    u16::from_str_radix(s, 16).ok()
}

/// The text with every lone surrogate escape inside a string rewritten to
/// `\ufffd`, or `None` when there is none (the common case, which then
/// costs one scan and no copy).
pub(crate) fn repair_lone_surrogates(text: &[u8]) -> Option<Vec<u8>> {
    let mut out: Option<Vec<u8>> = None;
    let mut copied = 0;
    let mut in_string = false;
    let mut i = 0;
    while i < text.len() {
        let b = text[i];
        if !in_string {
            in_string = b == b'"';
            i += 1;
            continue;
        }
        match b {
            b'"' => {
                in_string = false;
                i += 1;
            }
            b'\\' if text.get(i + 1) == Some(&b'u') => {
                let Some(unit) = hex4(text, i + 2) else {
                    // A malformed escape: leave it for the parser to refuse.
                    i += 2;
                    continue;
                };
                let paired_low = || {
                    text.get(i + 6) == Some(&b'\\')
                        && text.get(i + 7) == Some(&b'u')
                        && hex4(text, i + 8).is_some_and(|u| (0xDC00..=0xDFFF).contains(&u))
                };
                if (0xD800..=0xDBFF).contains(&unit) && paired_low() {
                    i += 12;
                } else if (0xD800..=0xDFFF).contains(&unit) {
                    let buf = out.get_or_insert_with(|| Vec::with_capacity(text.len()));
                    buf.extend_from_slice(&text[copied..i]);
                    buf.extend_from_slice(b"\\ufffd");
                    i += 6;
                    copied = i;
                } else {
                    i += 6;
                }
            }
            // Any other escape is two bytes; skipping both keeps an escaped
            // quote or backslash from being read as the end of the string.
            b'\\' => i += 2,
            _ => i += 1,
        }
    }
    out.map(|mut buf| {
        buf.extend_from_slice(&text[copied..]);
        buf
    })
}

/// The first line of every `.vctower` file, naming the format and its
/// version.
pub const TOWER_FILE_MAGIC: &str = "VCTOWER1";

/// Writes save JSON as `.vctower` file bytes, as given. To write a player's
/// tower, stamp it first with [`stamp_save`], or use
/// [`encode_simulation_vctower`], which does both: a save with no stamp loads
/// as a founder's tower. Refuses a save larger than a loader accepts.
pub fn encode_vctower(save: &Value) -> Result<Vec<u8>, String> {
    pack_json(&crate::canonical::js_json(save))
}

/// The container around a save's JSON text: the size check, the deflate and
/// the base64 framing of [`encode_vctower`], shared with the streamed writer
/// (`export_stream`) so the two cannot frame differently.
pub(crate) fn pack_json(json: &str) -> Result<Vec<u8>, String> {
    if json.len() as u64 > MAX_SAVE_INFLATED_BYTES {
        return Err(format!(
            "This tower's save data is larger than {} MB, the most a save can hold.",
            MAX_SAVE_INFLATED_BYTES / (1024 * 1024)
        ));
    }
    let packed = crate::fflate::deflate_level1(json.as_bytes());
    let b64 = base64::engine::general_purpose::STANDARD.encode(packed);
    let mut out = Vec::with_capacity(TOWER_FILE_MAGIC.len() + b64.len() + 2);
    out.extend_from_slice(TOWER_FILE_MAGIC.as_bytes());
    out.push(b'\n');
    out.extend_from_slice(b64.as_bytes());
    out.push(b'\n');
    Ok(out)
}

/// Stamps save JSON with the app that wrote it and when, as the web game does
/// before writing a file. `app_version` names your host and its version (it
/// must not read as a build older than 2.0, which the web game takes for a
/// founder's tower); `saved_at_ms` is the time in milliseconds since the Unix
/// epoch. Refuses JSON that is not a tower.
pub fn stamp_save(save: &mut Value, app_version: &str, saved_at_ms: f64) -> Result<(), String> {
    let carries_founder = detect_founder(save);
    let Value::Object(m) = save else {
        return Err("not a tower save (the save is not an object)".into());
    };
    if !m.get("minutes").is_some_and(Value::is_number)
        || !m.get("units").is_some_and(Value::is_array)
    {
        return Err("not a tower save (no numeric minutes or no units list)".into());
    }
    check_stamp(app_version, saved_at_ms)?;
    if carries_founder {
        m.insert("founder".into(), json!(true));
    }
    m.insert("savedAt".into(), json!(saved_at_ms));
    m.insert("appVersion".into(), json!(app_version));
    Ok(())
}

/// The two checks on a stamp's own values, which [`stamp_save`] runs after
/// the tower's: the time and the build name.
pub(crate) fn check_stamp(app_version: &str, saved_at_ms: f64) -> Result<(), String> {
    if !(saved_at_ms.is_finite() && saved_at_ms.abs() <= 8.64e15) {
        return Err(format!("savedAt {saved_at_ms} is not a time"));
    }
    if parse_int(app_version).is_some_and(|v| v < 2.0) {
        return Err(format!(
            "appVersion {app_version:?} reads as a build before 2.0, which marks the tower as a founder's"
        ));
    }
    Ok(())
}

/// Writes a game as `.vctower` file bytes: [`Simulation::serialize`],
/// [`stamp_save`] and [`encode_vctower`] in one call, without holding the
/// whole save in memory at once. The engine has no clock or version of its
/// own, so pass your host's name and version and the time in milliseconds
/// since the Unix epoch.
pub fn encode_simulation_vctower(
    sim: &Simulation,
    app_version: &str,
    saved_at_ms: f64,
) -> Result<Vec<u8>, String> {
    crate::export_stream::encode_vctower_string(sim.save_text(), app_version, saved_at_ms)
}

/// `Buffer.from(b64, "base64")`: decoding stops at the first `=`, every
/// character outside the alphabet (whitespace included) is skipped, the
/// URL-safe alphabet is taken alongside the standard one, padding is
/// optional, a dangling single symbol is dropped, and the last symbol's
/// unused bits are ignored.
pub(super) fn lenient_base64(text: &str) -> Vec<u8> {
    let body = text.split('=').next().unwrap_or("");
    let mut symbols: String = body
        .chars()
        .filter_map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '+' | '/' => Some(c),
            '-' => Some('+'),
            '_' => Some('/'),
            _ => None,
        })
        .collect();
    if symbols.len() % 4 == 1 {
        symbols.pop();
    }
    // With the alphabet filtered, the padding cut, the dangling symbol
    // dropped and trailing bits allowed, no input is left that the decoder
    // refuses; like `Buffer.from`, garbage simply inflates to garbage.
    base64::engine::GeneralPurpose::new(
        &base64::alphabet::STANDARD,
        base64::engine::GeneralPurposeConfig::new()
            .with_decode_padding_mode(base64::engine::DecodePaddingMode::RequireNone)
            .with_decode_allow_trailing_bits(true),
    )
    .decode(symbols.as_bytes())
    .unwrap_or_default()
}

#[doc(hidden)]
/// `String.prototype.trim`: strips WhiteSpace and LineTerminator. Compared
/// with Rust's `is_whitespace`, JavaScript also counts U+FEFF and does not
/// count U+0085 (NEL).
pub fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_whitespace)
}

/// Whether JavaScript's `trim` strips the character (see `js_trim`).
pub(crate) fn is_js_whitespace(c: char) -> bool {
    (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}'
}
