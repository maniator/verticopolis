//! The streamed reader (#1225) against today's path on edited saves: seeded
//! byte edits, numbers at the edges of what JSON and `f64` hold, nesting at
//! the parser's depth limit, and surrogate escapes in a label the game keeps.
use super::tests::{built, check, same};
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::rng::Rng;
use serde_json::Value;

/// Bytes an edit may insert: the ones that change how JSON reads.
const JSON_BYTES: &[u8] = b"{}[],:\"0-.e\\ ";

/// How many of the 400 seeded edits below stream. The edits and the saves
/// are fixed, so the count is too; a new count means an edit changed sides,
/// which wants a look at which one before the count is moved.
const STREAMED: usize = 151;

/// Seeded edits of engine saves, a few bytes each: dropped, inserted,
/// changed or copied, or the text cut short. Whatever comes out, both
/// readers give the same game or the same message.
#[test]
fn edited_saves_load_the_same() {
    let bases = [
        built(GameMode::Classic).to_string(),
        built(GameMode::Modern).to_string(),
    ];
    let mut rng = Rng::new(1225);
    let (mut streamed, mut tried) = (0, 0);
    for round in 0..400 {
        let mut t = bases[round % 2].as_bytes().to_vec();
        for _ in 0..rng.int(1, 3) {
            if t.is_empty() {
                break;
            }
            let at = rng.int(0, t.len() as i64 - 1) as usize;
            match rng.int(0, 4) {
                0 => {
                    t.remove(at);
                }
                1 => t.insert(
                    at,
                    JSON_BYTES[rng.int(0, JSON_BYTES.len() as i64 - 1) as usize],
                ),
                2 if t[at].is_ascii_digit() => t[at] = b'0' + rng.int(0, 9) as u8,
                3 => {
                    let end = (at + rng.int(1, 40) as usize).min(t.len());
                    let piece = t[at..end].to_vec();
                    t.splice(at..at, piece);
                }
                4 if rng.chance(0.2) => t.truncate(at),
                _ => {}
            }
        }
        // The saves are ASCII and so is every inserted byte, but a text
        // that is not UTF-8 never reaches the binding anyway.
        let Ok(text) = String::from_utf8(t) else {
            continue;
        };
        tried += 1;
        // Every tenth round's save is also played for an hour when it streams.
        let steps = if round % 10 == 0 { 30 } else { 0 };
        if check(&text, steps).is_some() {
            streamed += 1;
        }
    }
    // Many edits land in a value and still parse.
    assert_eq!(
        streamed, STREAMED,
        "{streamed} of {tried} edited saves streamed"
    );
}

/// Numbers past `f64`'s exact integers, past `i64` and `u64`, signed zero,
/// underflow and the other spellings of a number read the same both ways.
#[test]
fn numbers_read_the_same() {
    let text = built(GameMode::Classic).to_string();
    // The number stands in for the key's first value, which moves to a key
    // nothing reads; the unit keys are found inside `units`.
    let units_at = text.find("\"units\":[").unwrap();
    let swap = |key: &str, n: &str| {
        let pattern = format!("\"{key}\":");
        let from = if matches!(key, "money" | "minutes" | "nextId") {
            0
        } else {
            units_at
        };
        let at = from
            + text[from..]
                .find(&pattern)
                .unwrap_or_else(|| panic!("no {key} to replace"));
        let rest = &text[at + pattern.len()..];
        format!("{}{pattern}{n},\"was\":{rest}", &text[..at])
    };
    for n in [
        "9007199254740993",
        "-9007199254740993",
        "9223372036854775808",
        "-9223372036854775809",
        "18446744073709551616",
        "-0",
        "-0.0",
        "1e-400",
        "1.0",
        "1E2",
        "0.1e1",
        "5e-324",
        "1.7976931348623157e308",
    ] {
        for key in ["money", "minutes", "nextId", "rent", "x", "floor", "id"] {
            let edited = swap(key, n);
            // The number took the place it was meant to: its old value moved
            // to `was` at the top level, or in a unit for a unit's key.
            let v: Value = serde_json::from_str(&edited).unwrap();
            let landed = match key {
                "money" | "minutes" | "nextId" => v.get("was").is_some(),
                _ => v["units"]
                    .as_array()
                    .is_some_and(|us| us.iter().any(|u| u.get("was").is_some())),
            };
            assert!(landed, "{key} {n} landed elsewhere");
            assert!(same(&edited), "{key} {n} did not stream");
        }
    }
}

/// Arrays nested up to and past the parser's depth limit, inside a unit and
/// at the top level, give the same result both ways.
#[test]
fn nesting_at_the_depth_limit() {
    let text = built(GameMode::Classic).to_string();
    let mut took = 0;
    for depth in 120..=130 {
        let deep = format!("{}1{}", "[".repeat(depth), "]".repeat(depth));
        for edited in [
            text.replacen(
                "\"kind\":\"floor\"",
                &format!("\"kind\":\"floor\",\"deep\":{deep}"),
                1,
            ),
            text.replacen("\"money\":", &format!("\"deep\":{deep},\"money\":"), 1),
        ] {
            took += usize::from(check(&edited, 0).is_some());
        }
    }
    // serde_json's limit of 128 levels falls inside these depths, so both
    // sides of it ran; a change to where it falls changes the count.
    assert_eq!(took, 12, "{took} of 22 streamed");
}

/// The save with its first office labeled `escaped`, a JSON string body as
/// it would appear between the quotes. The game writes a label only when it
/// differs from the facility's name, so the office has none of its own.
pub(super) fn relabeled(text: &str, escaped: &str) -> String {
    let office = "\"kind\":\"office\"";
    assert!(text.contains(office), "no office to label");
    text.replacen(office, &format!("\"label\":\"{escaped}\",{office}"), 1)
}

/// A lone surrogate escape in a label the game keeps is repaired the way
/// today's path repairs it, and a paired one decodes, so the loaded office
/// carries the label both readers build.
#[test]
fn surrogate_escapes_reach_the_game() {
    let text = built(GameMode::Classic).to_string();
    for (escaped, label) in [
        ("x\\ud800y", "x\u{FFFD}y"),
        ("x\\udc00", "x\u{FFFD}"),
        ("\\ud83d\\ude00", "\u{1F600}"),
    ] {
        let sim = check(&relabeled(&text, escaped), 30).expect("the save streams");
        let office = sim.tower.units.iter().find(|u| u.kind == Kind::Office);
        assert_eq!(office.unwrap().label, label, "{escaped}");
    }
}
