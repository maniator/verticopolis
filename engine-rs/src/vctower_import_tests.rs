//! The `.vctower` the player opens is read, or refused in the player's words
//! (#1498). Each refusal here is a sentence the page shows as it is.
use crate::load::{encode_vctower, TOWER_FILE_MAGIC};
use crate::vctower_import::{
    import_vctower, DAMAGED_FILE, NEWER_FILE_REFUSAL, NOT_A_TOWER_FILE, NOT_A_TOWER_SAVE,
    TOO_LARGE_FILE,
};
use base64::Engine as _;
use flate2::{write::DeflateEncoder, Compression};
use serde_json::{json, Value};
use std::io::Write;

/// A `.vctower` holding exactly `payload` as its save text.
fn file_of(payload: &[u8]) -> String {
    let mut z = DeflateEncoder::new(Vec::new(), Compression::fast());
    z.write_all(payload).expect("deflates");
    let packed = z.finish().expect("finishes");
    format!(
        "{TOWER_FILE_MAGIC}\n{}\n",
        base64::engine::general_purpose::STANDARD.encode(packed)
    )
}

fn refusal(text: &str) -> String {
    import_vctower(text).err().expect("refused")
}

fn tower() -> Value {
    json!({ "version": 7, "mode": "classic", "minutes": 0, "units": [] })
}

#[test]
fn a_real_file_loads_and_an_unstamped_one_is_a_founders_tower() {
    let bytes = encode_vctower(&tower()).expect("packs");
    let file = String::from_utf8(bytes).expect("text");
    let sim = import_vctower(&file).expect("loads");
    assert!(sim.founder, "no appVersion stamp: a founder's tower");
    // The page's trailing newline and an editor's re-wrapped lines are fine.
    // A version 6 file goes through the full reader, not the streamed one.
    let mut old = tower();
    old["version"] = json!(6);
    let old_file = String::from_utf8(encode_vctower(&old).expect("packs")).expect("text");
    assert!(import_vctower(&old_file).expect("loads").founder);
    let wrapped = file.replace('\n', "\r\n  ");
    assert!(import_vctower(&wrapped).is_ok());
}

#[test]
fn a_file_that_is_no_tower_file_is_refused() {
    for text in [
        "",
        "not a tower",
        "{\"minutes\":0}",
        "VCTOWE",
        "VCTOWER",
        "VCTOWERX\nabc",
    ] {
        assert_eq!(refusal(text), NOT_A_TOWER_FILE, "{text:?}");
    }
}

#[test]
fn a_later_container_version_asks_for_an_update() {
    for text in [
        "VCTOWER2\nabc",
        "VCTOWER10\n",
        "VCTOWER17\nnot a payload",
        "  VCTOWER99",
    ] {
        assert_eq!(refusal(text), NEWER_FILE_REFUSAL, "{text:?}");
    }
}

#[test]
fn any_javascript_white_space_after_the_digits_ends_the_claim() {
    // Not a version 1 payload, so the digits name the version when white
    // space (as `trim` counts it, U+FEFF included) follows them.
    for gap in [" ", "\t", "\r\n", "\u{feff}", "\u{a0}"] {
        let text = format!("VCTOWER12{gap}garbage");
        assert_eq!(refusal(&text), NEWER_FILE_REFUSAL, "{text:?}");
    }
    // The same stamp over a payload that inflates but is no JSON.
    let not_json = file_of(b"not json").replacen("VCTOWER1\n", "VCTOWER17\n", 1);
    assert_eq!(refusal(&not_json), NEWER_FILE_REFUSAL, "{not_json:?}");
}

#[test]
fn a_stamp_that_names_no_version_is_no_tower_file() {
    for text in ["VCTOWER0\nabc", "VCTOWER01\nabc", "VCTOWER00"] {
        assert_eq!(refusal(text), NOT_A_TOWER_FILE, "{text:?}");
    }
}

#[test]
fn a_version_1_file_whose_payload_starts_with_a_digit_loads_without_a_newline() {
    // The payload is read as version 1 first, so digits that run into the
    // stamp ("VCTOWER1" then "7...") do not name a version 17. Leading white
    // space is valid JSON and changes the first packed byte, which finds a
    // payload whose base64 starts with a digit.
    let digit_led = ["", " ", "\t", "\r", "  ", " \t", "\t\t", "   ", "    "]
        .iter()
        .flat_map(|lead| {
            (0..40).map(move |pad| {
                format!(
                    r#"{lead}{{"minutes":0,"units":[],"pad":"{}"}}"#,
                    "x".repeat(pad)
                )
            })
        })
        .map(|json| file_of(json.as_bytes()).replacen('\n', "", 1))
        .find(|f| f["VCTOWER1".len()..].starts_with(|c: char| c.is_ascii_digit()))
        .expect("a payload that starts with a digit");
    assert!(import_vctower(&digit_led).is_ok(), "{digit_led:?}");
}

#[test]
fn a_damaged_file_is_told_apart_from_a_crafted_or_wrong_one() {
    let truncated = file_of(br#"{"minutes":0,"units":["#);
    for text in [
        "VCTOWER1\nnot a tower this version can read".to_string(),
        "VCTOWER1\n!!!".to_string(),
        // Digits that run into a tail are no version claim.
        "VCTOWER12garbage".to_string(),
        "VCTOWER1000x".to_string(),
        // U+0085 is not white space to JavaScript, so it does not end the digits.
        "VCTOWER12\u{85}garbage".to_string(),
        "VCTOWER1".to_string(),
        truncated,
        file_of(b"\xff\xfe not json"),
        file_of(br#"{"minutes":0,"units":[]} trailing"#),
        file_of(br#"{"minutes":0,"units":[}"#),
        file_of(br#"{"minutes":1e999,"units":[]}"#),
        // A number the loader cannot hold is damage wherever it sits, even in
        // a file that would otherwise be no save at all.
        file_of(b"[1e999]"),
        file_of(br#"{"a":1e999}"#),
        file_of(br#"{"units":[1e999]}"#),
        file_of(b""),
    ] {
        assert_eq!(refusal(&text), DAMAGED_FILE, "{text:?}");
    }
}

#[test]
fn a_file_that_inflates_past_the_cap_is_too_large() {
    let bomb = vec![b' '; 33 * 1024 * 1024];
    assert_eq!(refusal(&file_of(&bomb)), TOO_LARGE_FILE);
}

#[test]
fn json_without_a_clock_and_a_units_list_is_no_tower_save() {
    for payload in [
        "{}",
        r#"{"units":[]}"#,
        r#"{"minutes":0}"#,
        r#"{"minutes":"0","units":[]}"#,
        r#"{"minutes":0,"units":{}}"#,
        r#"{"minutes":0,"units":null}"#,
        r#"{"minutes":0,"units":[],"minutes":null}"#,
    ] {
        assert_eq!(
            refusal(&file_of(payload.as_bytes())),
            NOT_A_TOWER_SAVE,
            "{payload}"
        );
    }
    // The same facts in a save the streamed reader takes (version 7, a mode
    // before `units`) are refused too, whatever mode it names.
    for mode in ["classic", "modern"] {
        for tail in [
            r#""minutes":0"#,
            r#""minutes":0,"units":null"#,
            r#""minutes":0,"units":{}"#,
            r#""minutes":"1","units":[]"#,
            r#""minutes":null,"units":[]"#,
            r#""units":[]"#,
            r#""minutes":1,"units":[],"minutes":"x""#,
            r#""minutes":1,"units":[],"units":{}"#,
        ] {
            let payload = format!(r#"{{"version":7,"mode":"{mode}",{tail}}}"#);
            assert_eq!(
                refusal(&file_of(payload.as_bytes())),
                NOT_A_TOWER_SAVE,
                "{payload}"
            );
        }
    }
    // A scalar, a list or `null` is JSON but no save object.
    for payload in ["null", "5", "[]", "\"hi\""] {
        assert_eq!(
            refusal(&file_of(payload.as_bytes())),
            NOT_A_TOWER_SAVE,
            "{payload}"
        );
    }
    // The last of a repeated key counts, as in a parse.
    let repeated = br#"{"minutes":null,"units":[],"minutes":3}"#;
    assert!(import_vctower(&file_of(repeated)).is_ok());
}

#[test]
fn the_loaders_own_refusals_pass_through() {
    let mut newer = tower();
    newer["version"] = json!(999);
    let file = String::from_utf8(encode_vctower(&newer).expect("packs")).expect("text");
    assert_eq!(refusal(&file), crate::load::NEWER_SAVE_REFUSAL);
}

#[test]
fn a_file_text_past_the_cap_is_refused_before_it_is_read() {
    let huge = format!("{TOWER_FILE_MAGIC}\n{}", "A".repeat(49 * 1024 * 1024));
    assert_eq!(refusal(&huge), TOO_LARGE_FILE);
}

#[test]
fn a_byte_order_mark_and_loose_base64_still_load_and_bad_text_in_a_string_is_damaged() {
    let json = br#"{"version":7,"mode":"classic","minutes":0,"units":[]}"#;
    let mut with_bom = b"\xEF\xBB\xBF".to_vec();
    with_bom.extend_from_slice(json);
    assert!(import_vctower(&file_of(&with_bom)).is_ok(), "a leading BOM");
    // The reader skips characters outside the alphabet and takes the URL-safe one.
    let file = file_of(json);
    let (magic, body) = file.trim().split_once('\n').expect("two lines");
    let stray = format!("{magic}\n{}!{}\n", &body[..10], &body[10..]);
    assert!(import_vctower(&stray).is_ok(), "a stray character");
    let url_safe = format!("{magic}\n{}\n", body.replace('+', "-").replace('/', "_"));
    assert!(import_vctower(&url_safe).is_ok(), "the URL-safe alphabet");
    let bad_string = b"{\"minutes\":0,\"units\":[],\"name\":\"\xff\"}";
    assert_eq!(refusal(&file_of(bad_string)), DAMAGED_FILE);
}
