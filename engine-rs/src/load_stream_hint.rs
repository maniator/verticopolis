//! How many units a save's text lists, counted off the text before it is
//! parsed (`units_hint`), so `load_stream` can reserve the unit vectors once.

use crate::facilities::LOT_WIDTH;
use crate::load::UNIT_CAP;
use crate::save_floor_runs::FLOOR_RUN_KEY;

/// The shortest unit entry the game writes, `{"id":1,"kind":"floor","floor":1,"x":0}`
/// and its comma, is 40 bytes, so a save the game writes lists fewer units
/// than its length over this many bytes. The bound sits below 40 so that a
/// hand-made save of entries down to 24 bytes still gets all its room up
/// front; one of shorter entries (the shortest that loads, `{"kind":"spa"}`,
/// is 14 bytes) is counted low, and its vectors regrow as it loads.
pub(crate) const MIN_UNIT_BYTES: usize = 24;

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
pub(crate) fn units_hint(text: &[u8]) -> usize {
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
                        let (entries, run_tiles) = objects(text, open);
                        return (entries.min(text.len() / MIN_UNIT_BYTES) + run_tiles)
                            .min(UNIT_CAP);
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
/// at `open`, and the tiles the floor runs among them add past their first
/// (a `"run":N` key directly in an entry, N from 2 to the lot's width; see
/// `load::floor_runs`), both up to `UNIT_CAP`.
fn objects(text: &[u8], open: usize) -> (usize, usize) {
    let (mut depth, mut count, mut run_tiles) = (0usize, 0usize, 0usize);
    let mut i = open + 1;
    while i < text.len() && count + run_tiles < UNIT_CAP {
        match text[i] {
            b'"' => {
                let end = string_end(text, i);
                if depth == 1 && text.get(i + 1..end - 1) == Some(FLOOR_RUN_KEY.as_bytes()) {
                    run_tiles += run_tiles_after(text, end);
                }
                i = end;
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
    (count, run_tiles)
}

/// The tiles past the first that a `run` key's value adds, when the key
/// ends at `at` and its value is written as the game writes it: up to three
/// digits, from 2 to the lot's width. Anything else adds none here.
fn run_tiles_after(text: &[u8], at: usize) -> usize {
    let colon = skip_space(text, at);
    if text.get(colon) != Some(&b':') {
        return 0;
    }
    let start = skip_space(text, colon + 1);
    let digits = text[start.min(text.len())..]
        .iter()
        .take_while(|b| b.is_ascii_digit())
        .count();
    if digits == 0 || digits > 3 {
        return 0;
    }
    let tiles = text[start..start + digits]
        .iter()
        .fold(0usize, |n, &b| n * 10 + usize::from(b - b'0'));
    if (2..=LOT_WIDTH as usize).contains(&tiles) {
        tiles - 1
    } else {
        0
    }
}

/// The index just past the string that opens at `start`, or the text's end.
pub(crate) fn string_end(text: &[u8], start: usize) -> usize {
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
pub(crate) fn skip_space(text: &[u8], mut i: usize) -> usize {
    while matches!(text.get(i), Some(b' ' | b'\t' | b'\n' | b'\r')) {
        i += 1;
    }
    i
}

#[cfg(test)]
#[path = "load_stream_hint_tests.rs"]
mod tests;
