//! Tests for `layout.rs`: the layout is pinned per version, every constant
//! is in the tables `viewLayout()` hands over, and the codes are the ones
//! the frame writes.
use super::layout::*;
use super::structure::{calendar_code, mode_code};
use crate::clock::{CalendarKind, GameMode};
use crate::crowd::PState;
use crate::frame::{person_state_code, unit_state_code, weather_code};
use crate::sim_loop::Weather;
use crate::tower::UnitState;
use sha2::{Digest, Sha256};

/// One pin per `VIEW_LAYOUT_VERSION`, oldest first: entry `n - 1` is the hash
/// of version `n`'s layout (`layout_json` without the catalog names, which
/// the catalog version covers). A layout change appends an entry and raises
/// the version together; a diff that changes an old pin is a reviewer's
/// refusal, as for the frame's pins. Version 1 was pinned again before its
/// first merge (#1284 added the scene seed slot), which CONTRIBUTING allows
/// for a version that has not merged.
const VIEW_LAYOUT_PINS: &[&str] = &["147e0ae8ebe711f1", "0ac6f447cd1ea936"];

fn pinned_text() -> String {
    let mut v = layout_json();
    v.as_object_mut().unwrap().shift_remove("names");
    v.to_string()
}

#[test]
fn the_view_layout_is_pinned() {
    let text = pinned_text();
    let hex: String = Sha256::digest(text.as_bytes())[..8]
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    assert_eq!(
        VIEW_LAYOUT_PINS.len(),
        VIEW_LAYOUT_VERSION as usize,
        "VIEW_LAYOUT_VERSION and VIEW_LAYOUT_PINS must grow together: one pin per version"
    );
    assert_eq!(
        VIEW_LAYOUT_PINS.last().copied(),
        Some(hex.as_str()),
        "the view layout changed: raise VIEW_LAYOUT_VERSION and append the new pin\n{text}"
    );
}

/// `TOWER_REVISION` as `towerRevision`.
fn camel(name: &str) -> String {
    let mut out = String::new();
    for (i, word) in name.split('_').enumerate() {
        let lower = word.to_ascii_lowercase();
        if i == 0 {
            out.push_str(&lower);
        } else {
            out.push_str(&lower[..1].to_ascii_uppercase());
            out.push_str(&lower[1..]);
        }
    }
    out
}

/// Every slot constant `layout.rs` declares, read from the source, is in
/// `TABLES` under its camelCase name with its value, and every table slot
/// is a declared constant: a slot added to one and not the other fails
/// here. Each table's width is its last slot plus one, as the width
/// constants say, and a record's slots are its first `width` numbers.
#[test]
fn the_tables_hold_every_constant() {
    let source = include_str!("layout.rs");
    let mut module: Option<String> = None;
    let mut declared: Vec<(String, String, usize)> = Vec::new();
    for line in source.lines() {
        let t = line.trim_start();
        if let Some(rest) = t.strip_prefix("pub mod ") {
            module = Some(rest.trim_end_matches(" {").to_owned());
        } else if line.starts_with('}') {
            module = None;
        } else if let (Some(m), Some(rest)) = (&module, t.strip_prefix("pub const ")) {
            let (name, value) = rest.split_once(": usize = ").unwrap();
            let value: usize = value.trim_end_matches(';').parse().unwrap();
            declared.push((m.clone(), camel(name), value));
        }
    }
    let mut listed: Vec<(String, String, usize)> = TABLES
        .iter()
        .flat_map(|t| {
            t.slots
                .iter()
                .map(|(name, slot)| (t.name.to_owned(), (*name).to_owned(), *slot))
        })
        .collect();
    declared.sort();
    listed.sort();
    assert_eq!(declared, listed, "layout.rs and TABLES disagree");
    for t in TABLES {
        let last = t.slots.iter().map(|s| s.1).max().unwrap();
        assert_eq!(t.width, last + 1, "{}: width", t.name);
        let mut slots: Vec<usize> = t.slots.iter().map(|s| s.1).collect();
        slots.sort_unstable();
        slots.dedup();
        assert_eq!(
            slots.len(),
            t.slots.len(),
            "{}: two names on one slot",
            t.name
        );
        assert_eq!(slots, (0..t.width).collect::<Vec<_>>(), "{}: a gap", t.name);
    }
    let widths: Vec<(&str, usize)> = TABLES.iter().map(|t| (t.width_name, t.width)).collect();
    assert_eq!(
        widths,
        [
            ("headerWidth", HEADER),
            ("personWidth", PERSON_RECORD),
            ("unitWidth", UNIT_RECORD),
            ("transportFixed", TRANSPORT_FIXED),
            ("carWidth", CAR_RECORD),
            ("structureWidth", STRUCTURE_HEADER),
            ("roomWidth", ROOM_RECORD),
            ("runWidth", RUN_RECORD),
            ("shaftFixed", SHAFT_FIXED),
        ]
    );
}

/// The view's person, room, transport and car records are laid out as the
/// frame's: a person record is the first `PERSON_RECORD` slots of the
/// frame's, a room record is the frame's unit record with the room's slot
/// where the frame puts the unit id, and the transports and cars are
/// written as the frame writes them (`frame::push_transports`, which
/// `frame_tests::agrees_with_frame_view` holds to `frameView`'s own copy).
#[test]
fn records_are_laid_out_as_in_the_frame() {
    use crate::frame;
    assert_eq!(transport::ID, frame::transport::ID);
    assert_eq!(transport::CARS, frame::transport::CARS);
    assert_eq!(TRANSPORT_FIXED, frame::TRANSPORT_FIXED);
    assert_eq!(car::POSITION, frame::car::POSITION);
    assert_eq!(car::LOAD, frame::car::LOAD);
    assert_eq!(car::DIRECTION, frame::car::DIRECTION);
    assert_eq!(CAR_RECORD, frame::CAR_RECORD);
    assert_eq!(
        [unit::SLOT, unit::STATE, unit::OCCUPANTS, unit::CUSTOMERS_IN],
        [
            frame::unit::ID,
            frame::unit::STATE,
            frame::unit::OCCUPANTS,
            frame::unit::CUSTOMERS_IN
        ]
    );
    assert_eq!(unit::HOTEL_CUSTOMERS_IN, frame::unit::HOTEL_CUSTOMERS_IN);
    assert_eq!(unit::OUT_FOR_MEAL, frame::unit::OUT_FOR_MEAL);
    assert_eq!(UNIT_RECORD, frame::UNIT_RECORD);
    assert_eq!(
        [person::ID, person::SEED, person::STAFF, person::STATE],
        [
            frame::person::ID,
            frame::person::SEED,
            frame::person::STAFF,
            frame::person::STATE
        ]
    );
    assert_eq!(
        [person::FLOOR, person::X, person::FY, person::WAIT],
        [
            frame::person::FLOOR,
            frame::person::X,
            frame::person::FY,
            frame::person::WAIT
        ]
    );
    const { assert!(PERSON_RECORD <= frame::PERSON_FIXED) };
}

/// The code tables `viewLayout()` hands over name the codes the frame
/// writes: the state with code k is named `UNIT_STATES[k]` as a save names
/// it, and so on for people and weather, and a kind's code is its index in
/// the catalog.
#[test]
fn the_codes_are_the_frames_codes() {
    use UnitState::*;
    let states = [
        Construction,
        Empty,
        Occupied,
        MovingIn,
        Vacating,
        Asleep,
        Dirty,
        Infested,
        Fire,
        Gutted,
    ];
    assert_eq!(states.len(), UNIT_STATES.len());
    for s in states {
        assert_eq!(UNIT_STATES[unit_state_code(s) as usize], s.as_str());
    }
    use PState::*;
    let people = [ToShaft, Waiting, Riding, Climbing, ToDest, Dwelling, Done];
    assert_eq!(people.len(), PERSON_STATES.len());
    for s in people {
        assert_eq!(PERSON_STATES[person_state_code(s) as usize], s.as_str());
    }
    for (w, name) in [
        (Weather::Clear, "clear"),
        (Weather::Cloudy, "cloudy"),
        (Weather::Rain, "rain"),
    ] {
        assert_eq!(WEATHER[weather_code(w) as usize], name);
    }
    for m in [GameMode::Classic, GameMode::Modern] {
        assert_eq!(MODES[mode_code(m) as usize], m.as_str());
    }
    for c in [CalendarKind::Canon, CalendarKind::RealWorld] {
        assert_eq!(CALENDARS[calendar_code(c) as usize], c.as_str());
    }
    let v = layout_json();
    assert_eq!(v["metaRecord"], serde_json::json!(META_RECORD));
    for (k, f) in crate::facilities::FACILITIES.iter().enumerate() {
        assert_eq!(f.kind as usize, k, "{}: kind code", f.key);
        assert_eq!(v["kinds"][k], f.key);
        assert_eq!(v["names"][k], f.name);
    }
    assert!(
        crate::facilities::FACILITIES.len() <= 53,
        "the unlocked mask holds 53 kinds"
    );
}
