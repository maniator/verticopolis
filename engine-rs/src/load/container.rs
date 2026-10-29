//! The `.vctower` container: base64 and compression framing, the stamp, encode and decode.

use super::*;

/// `decodeVctower(text)`: the VCTOWER1 container (base64 of raw deflate).
pub fn decode_vctower(text: &str) -> Result<Value, String> {
    parse_save_json(&inflate_vctower(text)?).map_err(|e| format!("json: {e}"))
}

/// The save text inside a VCTOWER1 container, as `decode_vctower` parses it.
pub(crate) fn inflate_vctower(text: &str) -> Result<Vec<u8>, String> {
    let trimmed = js_trim(text);
    if !trimmed.starts_with(TOWER_FILE_MAGIC) {
        return Err("not a VCTOWER1 file".into());
    }
    let packed = lenient_base64(&trimmed[TOWER_FILE_MAGIC.len()..]);
    use std::io::Read;
    let mut out = Vec::new();
    flate2::read::DeflateDecoder::new(&packed[..])
        .take(MAX_SAVE_INFLATED_BYTES + 1)
        .read_to_end(&mut out)
        .map_err(|e| format!("inflate: {e}"))?;
    if out.len() as u64 > MAX_SAVE_INFLATED_BYTES {
        return Err(
            "this .vctower expands to more data than we will hold; it looks crafted rather than saved"
                .into(),
        );
    }
    // `TextDecoder` drops a leading byte order mark before `JSON.parse` sees it.
    if out.starts_with(b"\xEF\xBB\xBF") {
        out.drain(..3);
    }
    Ok(out)
}

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

/// The `.vctower` magic: the first line of every file, naming the format and
/// its version (`TOWER_FILE_MAGIC` in saveCompression.ts).
pub const TOWER_FILE_MAGIC: &str = "VCTOWER1";

/// The inverse of [`decode_vctower`]: a serialized save in the `.vctower`
/// container, as bytes. The framing and the base64 alphabet match the
/// TypeScript writers (`SaveGame.export`, and `toTowerFile` for the desktop
/// store) byte for byte: the magic, a newline, one line of standard base64
/// with `=` padding, and a closing newline. The payload is raw DEFLATE (no
/// zlib or gzip framing) of the save's JSON text in UTF-8.
///
/// The bytes are the web game's own: for the same save, stamp and time, the
/// file equals the one `SaveGame.export` (or `toTowerFile`) writes. The JSON
/// text is what `JSON.stringify` writes for the save as JavaScript holds it
/// ([`js_json`]: every map in insertion order, array-index keys first), so a
/// save parsed from the web game's JSON keeps the web game's key order. (A
/// save built by [`Simulation::serialize`] has the engine's own key order,
/// which every reader takes; the web game's order for a loaded tower follows
/// the file it was loaded from, which the engine does not keep. A string
/// holding half a surrogate pair is written as U+FFFD, where `JSON.stringify`
/// writes the escape; the web game repairs such strings on load and on input,
/// so its saves hold none.) The
/// payload is compressed by a port of the web's compressor, fflate's
/// `deflateSync` at level 1 ([`crate::fflate`]), which is the level
/// `SaveGame.saveTo` chose: within 0.8% of level 6 on a sparse save at a
/// third of the cost.
///
/// The save is written as given, the way `toTowerFile` carries a stored
/// value. A save written as a player's tower needs the stamp
/// [`encode_simulation_vctower`] and [`stamp_save`] add: one without
/// `appVersion` loads as a founder's tower.
///
/// A save whose JSON text is longer than the strictest reader holds
/// (`MAX_SAVE_INFLATED_BYTES`, 32 MiB, the cap of `inflateCapped` and of
/// [`decode_vctower`]) is refused: written, it would only fail to load as a
/// file that looks crafted. A real tower is about 2 MB.
///
/// [`js_json`]: crate::canonical::js_json
pub fn encode_vctower(save: &Value) -> Result<Vec<u8>, String> {
    let json = crate::canonical::js_json(save);
    if json.len() as u64 > MAX_SAVE_INFLATED_BYTES {
        return Err(format!(
            "this save is {} bytes of JSON, more than the {MAX_SAVE_INFLATED_BYTES} a .vctower reader will hold",
            json.len()
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

/// `stamp(data)` in SaveGame.ts: set `savedAt` (milliseconds since the
/// epoch) and `appVersion` (the build that wrote the save) on a serialized
/// game, after the checks `SaveGame.import` and the Founder rule need. The
/// save must be a tower (an object with a numeric `minutes` and a `units`
/// array, the shape the web import accepts), `saved_at_ms` must be a time
/// a JavaScript `Date` holds, and `app_version` must not read as a build
/// before 2.0, since the web game takes such a stamp as a founder's tower
/// (`detectFounder`). A non-numeric name such as `"dev"` is fine.
///
/// One step goes past the TypeScript `stamp`, which only ever sees a loaded
/// tower's serialization. The save is meant to be what `serialize` returns,
/// which carries Founder status as `founder: true`. A save that instead
/// still holds an older stamp reading as a founder's (a `.vctower` decoded
/// but never loaded) keeps that status as `founder: true` before the new
/// stamp replaces the old one. A save with no stamp at all cannot be told
/// apart from a fresh serialization, so load an unstamped file
/// (`mark_founder_from_loaded_file`) before writing it again.
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
    if !(saved_at_ms.is_finite() && saved_at_ms.abs() <= 8.64e15) {
        return Err(format!("savedAt {saved_at_ms} is not a time"));
    }
    if parse_int(app_version).is_some_and(|v| v < 2.0) {
        return Err(format!(
            "appVersion {app_version:?} reads as a build before 2.0, which marks the tower as a founder's"
        ));
    }
    if carries_founder {
        m.insert("founder".into(), json!(true));
    }
    m.insert("savedAt".into(), json!(saved_at_ms));
    m.insert("appVersion".into(), json!(app_version));
    Ok(())
}

/// `SaveGame.export(sim)`: serialize the game, stamp it ([`stamp_save`]) and
/// encode it ([`encode_vctower`]). The engine has no clock and no build
/// identity of its own, so the host passes both.
pub fn encode_simulation_vctower(
    sim: &Simulation,
    app_version: &str,
    saved_at_ms: f64,
) -> Result<Vec<u8>, String> {
    let mut save = sim.serialize();
    stamp_save(&mut save, app_version, saved_at_ms)?;
    encode_vctower(&save)
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

/// `String.prototype.trim`: strips WhiteSpace and LineTerminator. Compared
/// with Rust's `is_whitespace`, JavaScript also counts U+FEFF and does not
/// count U+0085 (NEL).
pub fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}')
}
