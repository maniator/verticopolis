//! Tests for `identity.rs`: the record's every field, and the facts it
//! repeats from elsewhere against their sources.
use super::*;
use crate::frame::{car, header, person, transport, unit};
use crate::frame::{CAR_RECORD, FRAME_HEADER, PERSON_FIXED, TRANSPORT_FIXED, UNIT_RECORD};
use sha2::{Digest, Sha256};
use std::path::Path;

fn crate_dir() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
}

fn compat() -> Value {
    serde_json::from_str(
        &std::fs::read_to_string(crate_dir().join("src/compat-record.json")).unwrap(),
    )
    .unwrap()
}

fn is_hex16(s: &str) -> bool {
    s.len() == 16
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// The record, field by field. A change to any value here is a change to the
/// contract a host reads, so it is written out rather than derived.
#[test]
fn the_record_holds_every_field() {
    let v = identity();
    assert_eq!(v["schema"], 1);
    assert_eq!(v["crate"]["name"], env!("CARGO_PKG_NAME"));
    assert_eq!(CRATE_NAME, env!("CARGO_PKG_NAME"));
    assert_eq!(v["crate"]["version"], env!("CARGO_PKG_VERSION"));
    assert_eq!(v["saveVersion"], 7);
    assert_eq!(v["oldestSaveVersion"], 1);
    assert_eq!(v["frameLayoutVersion"], 1);
    assert_eq!(v["catalogVersion"], 1);
    assert_eq!(
        v["catalogDigests"]["classic"],
        catalog_digest(GameMode::Classic)
    );
    assert_eq!(
        v["catalogDigests"]["modern"],
        catalog_digest(GameMode::Modern)
    );
    assert!(is_hex16(v["lockDigest"].as_str().unwrap()), "{v}");
    for nested in ["crate", "catalogDigests"] {
        let mut inner: Vec<&str> = v[nested]
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        inner.sort_unstable();
        let want: &[&str] = if nested == "crate" {
            &["name", "version"]
        } else {
            &["classic", "modern"]
        };
        assert_eq!(inner, want, "{nested}");
    }
    let mut keys: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "catalogDigests",
            "catalogVersion",
            "crate",
            "frameLayoutVersion",
            "lockDigest",
            "oldestSaveVersion",
            "saveVersion",
            "schema"
        ]
    );
}

#[test]
fn the_json_is_canonical_and_round_trips() {
    let text = identity_json();
    assert_eq!(
        text,
        canonical_json(&serde_json::from_str::<Value>(&text).unwrap())
    );
    assert_eq!(serde_json::from_str::<Value>(&text).unwrap(), identity());
}

/// The compiled-in record is the crate's own: its version is `Cargo.toml`'s,
/// its save version is the engine's, and a digest never reads "unreadable".
#[test]
fn the_compat_record_agrees_with_the_crate() {
    let rec = compat();
    assert_eq!(rec["crateVersion"], env!("CARGO_PKG_VERSION"));
    assert_eq!(rec["saveVersion"], SAVE_VERSION);
    assert_eq!(rec["oldestSaveVersion"], OLDEST_SAVE_VERSION);
    assert_eq!(rec["frameLayoutVersion"], FRAME_LAYOUT_VERSION);
    assert_eq!(rec["catalogVersion"], CATALOG_VERSION);
    assert_eq!(rec["identitySchema"], IDENTITY_SCHEMA);
    assert_ne!(crate_version(), UNREADABLE);
    assert!(is_hex16(rec["interfaceDigest"].as_str().unwrap()));
}

/// The lock digest of the five conformance lock files: for each, its name, a
/// newline, its byte length, a newline, then its bytes (line endings as LF).
/// `src/build/engineCompat.ts` computes the same digest.
#[test]
fn the_lock_digest_is_the_digest_of_the_lock_files() {
    let dir = crate_dir().join("../conformance");
    let mut h = Sha256::new();
    for name in [
        "catalog-digests.json",
        "events/catalog.json",
        "expected.json",
        "loader-cases.json",
        "tdt-cases.json",
    ] {
        let text = std::fs::read_to_string(dir.join(name))
            .unwrap()
            .replace("\r\n", "\n");
        h.update(format!("{name}\n{}\n", text.len()).as_bytes());
        h.update(text.as_bytes());
    }
    let hex: String = h.finalize()[..8]
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    assert_eq!(
        compat()["lockDigest"],
        hex.as_str(),
        "run `npm run engine:compat` after a change to the lock"
    );
}

/// The frame layout, slot by slot. A host decodes the frame by these numbers,
/// so a change to any of them raises `FRAME_LAYOUT_VERSION` in the same
/// commit, and this table changes with it.
#[test]
fn the_frame_layout_is_pinned() {
    let slots: Vec<(&str, usize)> = vec![
        ("header::MINUTES", header::MINUTES),
        ("header::TOWER_REVISION", header::TOWER_REVISION),
        (
            "header::MEAL_OVERLAY_REVISION",
            header::MEAL_OVERLAY_REVISION,
        ),
        ("header::LOG_SEQ", header::LOG_SEQ),
        ("header::MONEY", header::MONEY),
        ("header::STAR", header::STAR),
        ("header::WEATHER", header::WEATHER),
        ("header::SANTA_FX_SEQ", header::SANTA_FX_SEQ),
        ("header::EXPLOSION_FX", header::EXPLOSION_FX),
        ("header::THIEF_FX", header::THIEF_FX),
        ("header::TREASURE_FX", header::TREASURE_FX),
        ("header::VIP_FX_SEQ", header::VIP_FX_SEQ),
        ("header::EVENT_COUNTS", header::EVENT_COUNTS),
        ("header::PENDING_CHOICE", header::PENDING_CHOICE),
        ("header::ON_HOUR_RUNS", header::ON_HOUR_RUNS),
        ("header::PEOPLE", header::PEOPLE),
        ("header::UNITS", header::UNITS),
        ("header::TRANSPORTS", header::TRANSPORTS),
        ("FRAME_HEADER", FRAME_HEADER),
        ("person::ID", person::ID),
        ("person::SEED", person::SEED),
        ("person::STAFF", person::STAFF),
        ("person::STATE", person::STATE),
        ("person::FLOOR", person::FLOOR),
        ("person::X", person::X),
        ("person::FY", person::FY),
        ("person::WAIT", person::WAIT),
        ("person::ORIGIN_FLOOR", person::ORIGIN_FLOOR),
        ("person::ORIGIN_UNIT_ID", person::ORIGIN_UNIT_ID),
        ("person::VENUE_UNIT_ID", person::VENUE_UNIT_ID),
        ("person::MEAL_VENUE_ID", person::MEAL_VENUE_ID),
        ("person::COUNTED_HOTEL_GUEST", person::COUNTED_HOTEL_GUEST),
        ("person::ROUTINE", person::ROUTINE),
        ("person::RETURNING", person::RETURNING),
        ("person::DWELL_SECONDS_LEFT", person::DWELL_SECONDS_LEFT),
        ("person::FLOOR_COUNT", person::FLOOR_COUNT),
        ("person::SHAFT_COUNT", person::SHAFT_COUNT),
        ("PERSON_FIXED", PERSON_FIXED),
        ("unit::ID", unit::ID),
        ("unit::STATE", unit::STATE),
        ("unit::OCCUPANTS", unit::OCCUPANTS),
        ("unit::CUSTOMERS_IN", unit::CUSTOMERS_IN),
        ("unit::HOTEL_CUSTOMERS_IN", unit::HOTEL_CUSTOMERS_IN),
        ("unit::OUT_FOR_MEAL", unit::OUT_FOR_MEAL),
        ("UNIT_RECORD", UNIT_RECORD),
        ("transport::ID", transport::ID),
        ("transport::CARS", transport::CARS),
        ("TRANSPORT_FIXED", TRANSPORT_FIXED),
        ("car::POSITION", car::POSITION),
        ("car::LOAD", car::LOAD),
        ("car::DIRECTION", car::DIRECTION),
        ("CAR_RECORD", CAR_RECORD),
        ("UNKNOWN_ROUTINE", crate::frame::UNKNOWN_ROUTINE as usize),
    ];
    let table: String = slots.iter().map(|(n, v)| format!("{n}={v}\n")).collect();
    let digest = Sha256::digest(table.as_bytes());
    let hex: String = digest[..8].iter().map(|b| format!("{b:02x}")).collect();
    assert_eq!(
        (FRAME_LAYOUT_VERSION, hex.as_str()),
        (1, "c62b6d031b60a0d3"),
        "the frame layout changed: raise FRAME_LAYOUT_VERSION and update this pin\n{table}"
    );
}
