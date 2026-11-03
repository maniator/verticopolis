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
        "VCTOWER0\nabc",
        "  VCTOWER99",
    ] {
        assert_eq!(refusal(text), NEWER_FILE_REFUSAL, "{text:?}");
    }
}

#[test]
fn a_damaged_file_is_told_apart_from_a_crafted_or_wrong_one() {
    let truncated = file_of(br#"{"minutes":0,"units":["#);
    for text in [
        "VCTOWER1\nnot a tower this version can read".to_string(),
        "VCTOWER1\n!!!".to_string(),
        "VCTOWER1".to_string(),
        truncated,
        file_of(b"\xff\xfe not json"),
        file_of(br#"{"minutes":0,"units":[]} trailing"#),
        file_of(br#"{"minutes":0,"units":[}"#),
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
