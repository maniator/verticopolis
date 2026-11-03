//! A save written by a newer build is refused with one sentence, on every
//! route a save takes in (#1603). An older or current save still loads.
use crate::load::{decode_vctower, deserialize, NEWER_SAVE_REFUSAL};
use crate::load_stream::{load_save_text, load_stored_text, load_vctower_text, read_save};
use crate::sim::SAVE_VERSION;
use serde_json::{json, Value};

fn save_at(version: Value) -> Value {
    json!({ "version": version, "mode": "classic", "minutes": 0, "units": [] })
}

#[test]
fn a_save_from_a_newer_build_is_refused_on_every_route() {
    for newer in [
        json!(SAVE_VERSION + 1),
        json!(999),
        json!(999.5),
        json!(7.5),
    ] {
        let save = save_at(newer);
        let text = save.to_string();
        assert_eq!(
            deserialize(&save).err().as_deref(),
            Some(NEWER_SAVE_REFUSAL)
        );
        assert_eq!(
            load_save_text(text.as_bytes()).err().as_deref(),
            Some(NEWER_SAVE_REFUSAL)
        );
        assert_eq!(
            load_stored_text(text.as_bytes()).err().as_deref(),
            Some(NEWER_SAVE_REFUSAL)
        );
        assert_eq!(
            read_save(text.as_bytes()).err().as_deref(),
            Some(NEWER_SAVE_REFUSAL)
        );
        let file = crate::load::encode_vctower(&save).expect("packs");
        let file = String::from_utf8(file).expect("text");
        assert!(decode_vctower(&file).is_ok(), "the container itself reads");
        assert_eq!(
            load_vctower_text(&file, None).err().as_deref(),
            Some(NEWER_SAVE_REFUSAL)
        );
    }
}

#[test]
fn the_current_and_older_versions_and_odd_version_fields_still_load() {
    for version in [json!(1), json!(SAVE_VERSION), json!("999"), Value::Null] {
        assert!(deserialize(&save_at(version.clone())).is_ok(), "{version}");
    }
    let no_version = json!({ "mode": "classic", "minutes": 0, "units": [] });
    assert!(deserialize(&no_version).is_ok());
}
