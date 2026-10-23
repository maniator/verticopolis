//! Tests for `reader.rs`: the dynamic frame's named slots, its people and
//! transports against `frameView`'s, and when a reader sends every room.
use super::layout::{header, person, unit, HEADER, PERSON_RECORD, UNIT_RECORD};
use super::session_tests::at;
use super::*;
use crate::facilities::FACILITIES;
use crate::frame::{self, frame_view, transports_len};
use crate::sim_loop::Weather;
use crate::tower::UnitState;

/// A small tower half a day into play, so it has tenants, people and
/// moving cars.
fn busy() -> Simulation {
    at("events-classic", "fire")
}

/// Each named header slot holds the value its name says. The values are
/// set apart first, so two swapped names fail; the flags (full, the thief
/// caught, a pending choice) can only be 0 or 1, so the test reads two
/// frames that set them in different patterns, and an incremental one, so
/// the room count and the record count differ.
#[test]
fn the_named_slots_read_their_values() {
    let mut sim = busy();
    sim.clock.minutes = 1001.0;
    sim.tower.revision = 1002;
    sim.tower.meta_revision = 1003;
    sim.tower.meal_overlay_revision = 1004;
    sim.log_seq = 1005;
    sim.money = 1006.0;
    sim.star = 4;
    sim.weather = Weather::Rain;
    sim.fx.santa_seq = 1008;
    sim.fx.explosion.seq = 1009;
    sim.fx.explosion.floor = 1010;
    sim.fx.explosion.x = 1011.0;
    sim.fx.thief.seq = 1012;
    sim.fx.thief.floor = 1014;
    sim.fx.treasure.seq = 1015;
    sim.fx.treasure.floor = 1016;
    sim.fx.treasure.x = 1017.0;
    sim.fx.vip_seq = 1018;
    sim.events.fires_started = 1019;
    sim.events.fires_gut_rooms = 1020;
    sim.events.bombs_detonated = 1021;
    sim.on_hour_runs = 1023;
    let mut reader = ViewReader::new();
    // Frame 1: full, no thief caught, a choice pending.
    sim.events.pending = Some(crate::events::PendingChoice {
        kind: "bomb",
        cost: 1.0,
        message: String::new(),
    });
    let full = reader.frame(&sim, false);
    let population = sim.population() as f64;
    // Frame 2: one room changed, the thief caught, nothing pending.
    sim.events.pending = None;
    sim.fx.thief.caught = true;
    let rooms = sim.tower.room_index();
    sim.tower.units[rooms[2]].occupants += 1;
    let delta = reader.frame(&sim, false);
    let mask = FACILITIES
        .iter()
        .enumerate()
        .filter(|(_, f)| sim.is_unlocked(f.kind))
        .fold(0u64, |m, (k, _)| m | 1 << k) as f64;
    let n = rooms.len() as f64;
    use header::*;
    let both = [
        (MINUTES, 1001.0),
        (TOWER_REVISION, 1002.0),
        (META_REVISION, 1003.0),
        (MEAL_OVERLAY_REVISION, 1004.0),
        (LOG_SEQ, 1005.0),
        (MONEY, 1006.0),
        (STAR, 4.0),
        (UNLOCKED, mask),
        (WEATHER, 2.0),
        (SANTA_FX_SEQ, 1008.0),
        (EXPLOSION_FX_SEQ, 1009.0),
        (EXPLOSION_FX_FLOOR, 1010.0),
        (EXPLOSION_FX_X, 1011.0),
        (THIEF_FX_SEQ, 1012.0),
        (THIEF_FX_FLOOR, 1014.0),
        (TREASURE_FX_SEQ, 1015.0),
        (TREASURE_FX_FLOOR, 1016.0),
        (TREASURE_FX_X, 1017.0),
        (VIP_FX_SEQ, 1018.0),
        (FIRES_STARTED, 1019.0),
        (FIRES_GUT_ROOMS, 1020.0),
        (BOMBS_DETONATED, 1021.0),
        (ON_HOUR_RUNS, 1023.0),
        (ROOMS, n),
        (PEOPLE, sim.crowd.people.len() as f64),
        (TRANSPORTS, sim.tower.transports.len() as f64),
    ];
    let first = [
        (POPULATION, population),
        (THIEF_FX_CAUGHT, 0.0),
        (PENDING_CHOICE, 1.0),
        (FULL, 1.0),
        (FRAME_SEQ, 1.0),
        (UNITS, n),
    ];
    let second = [
        (POPULATION, sim.population() as f64),
        (THIEF_FX_CAUGHT, 1.0),
        (PENDING_CHOICE, 0.0),
        (FULL, 0.0),
        (FRAME_SEQ, 2.0),
        (UNITS, 1.0),
    ];
    assert_eq!(both.len() + first.len(), HEADER);
    for (frame, own) in [(&full, first), (&delta, second)] {
        for (slot, value) in both.iter().chain(own.iter()) {
            assert_eq!(frame[*slot], *value, "slot {slot}");
        }
    }
    assert!(sim.population() > 0 && !sim.crowd.people.is_empty() && n > 3.0);
}

/// The unlocked mask moves with the star: a one-star Classic tower has
/// kinds locked that a four-star one has open.
#[test]
fn the_unlocked_mask_follows_the_star() {
    let mut sim = busy();
    let mut masks = Vec::new();
    for star in [1, 4] {
        sim.star = star;
        let v = ViewReader::new().frame(&sim, false);
        let mask = v[header::UNLOCKED] as u64;
        for (k, f) in FACILITIES.iter().enumerate() {
            assert_eq!(
                mask >> k & 1 == 1,
                sim.is_unlocked(f.kind),
                "{} at {star}",
                f.key
            );
        }
        masks.push(mask);
    }
    assert!(
        masks[0] != masks[1] && masks[0] & !masks[1] == 0,
        "{masks:?}"
    );
}

/// The people, the rooms and the transports are `frameView`'s: each person
/// record is the first `PERSON_RECORD` slots of `frameView`'s, each room's
/// fields are its unit record's, and the transports close both frames slot
/// for slot. `frameView` keeps its own encoders, so this holds the view's
/// copies to them.
#[test]
fn people_and_transports_are_the_frames() {
    let sim = busy();
    let v = ViewReader::new().frame(&sim, true);
    let f = frame_view(&sim);
    let people = sim.crowd.people.len();
    assert!(people > 0);
    let mut at = frame::FRAME_HEADER;
    for k in 0..people {
        let mine = &v[HEADER + k * PERSON_RECORD..HEADER + (k + 1) * PERSON_RECORD];
        let theirs = &f[at..at + PERSON_RECORD];
        assert_eq!(mine[person::ID], theirs[frame::person::ID]);
        assert!(super::oracle_tests::same(mine, theirs), "person {k}");
        let route = f[at + frame::person::FLOOR_COUNT] + f[at + frame::person::SHAFT_COUNT];
        at += frame::PERSON_FIXED + route as usize;
    }
    // Each room's fields are `frameView`'s record for that unit, after the
    // slot that stands where `frameView` puts the id.
    let units_at = at;
    let rooms = sim.tower.room_index();
    let room_at = HEADER + people * PERSON_RECORD;
    for (slot, &i) in rooms.iter().enumerate() {
        let mine = &v[room_at + slot * UNIT_RECORD..room_at + (slot + 1) * UNIT_RECORD];
        let theirs = &f[units_at + i * frame::UNIT_RECORD..units_at + (i + 1) * frame::UNIT_RECORD];
        assert_eq!(theirs[frame::unit::ID], sim.tower.units[i].id as f64);
        assert_eq!(mine[unit::SLOT], slot as f64);
        assert!(
            super::oracle_tests::same(&mine[1..], &theirs[1..]),
            "room {slot}"
        );
    }
    let tail = transports_len(&sim.tower.transports);
    assert!(tail > 0);
    assert!(super::oracle_tests::same(
        &v[v.len() - tail..],
        &f[f.len() - tail..]
    ));
}

/// A reader's first frame is full; then a frame sends only the rooms that
/// changed, in slot order; `full` asks for every room again; and a move of
/// the revision or the unit count makes the next frame full, since the
/// slots then index a new structure.
#[test]
fn a_reader_sends_every_room_only_when_it_must() {
    let mut sim = busy();
    let mut r = ViewReader::new();
    let rooms = sim.tower.room_index();
    let first = r.frame(&sim, false);
    assert_eq!(first[header::FULL], 1.0);
    assert_eq!(first[header::UNITS] as usize, rooms.len());
    let again = r.frame(&sim, false);
    assert_eq!((again[header::FULL], again[header::UNITS]), (0.0, 0.0));
    let (a, b) = (rooms[3], rooms[1]);
    sim.tower.units[a].occupants += 7;
    sim.tower.units[b].state = UnitState::Fire;
    let changed = r.frame(&sim, false);
    assert_eq!((changed[header::FULL], changed[header::UNITS]), (0.0, 2.0));
    let at = HEADER + changed[header::PEOPLE] as usize * PERSON_RECORD;
    let records: Vec<&[f64]> = changed[at..at + 2 * UNIT_RECORD]
        .chunks(UNIT_RECORD)
        .collect();
    assert_eq!(records[0][unit::SLOT], 1.0);
    assert_eq!(
        records[0][unit::STATE],
        frame::unit_state_code(UnitState::Fire)
    );
    assert_eq!(records[1][unit::SLOT], 3.0);
    assert_eq!(
        records[1][unit::OCCUPANTS],
        sim.tower.units[a].occupants as f64
    );
    let forced = r.frame(&sim, true);
    assert_eq!(forced[header::FULL], 1.0);
    assert_eq!(forced[header::UNITS] as usize, rooms.len());
    sim.tower.revision += 1;
    assert_eq!(r.frame(&sim, false)[header::FULL], 1.0);
    assert_eq!(r.frame(&sim, false)[header::FULL], 0.0);
    let room = sim.tower.units[rooms[0]].id;
    sim.tower.remove_unit(room).unwrap();
    let after = r.frame(&sim, false);
    assert_eq!(after[header::FULL], 1.0);
    assert_eq!(after[header::UNITS] as usize, rooms.len() - 1);
}

/// The binding's reader lives on the tower: two reads through it share one
/// memory, and a fresh tower (any load) starts it over.
#[test]
fn the_towers_reader_is_one_per_engine() {
    let sim = busy();
    assert_eq!(view_frame(&sim, false)[header::FULL], 1.0);
    assert_eq!(view_frame(&sim, false)[header::FULL], 0.0);
    assert_eq!(view_frame(&sim, true)[header::FULL], 1.0);
    let reloaded = crate::load::deserialize(&sim.serialize()).unwrap();
    assert_eq!(view_frame(&reloaded, false)[header::FULL], 1.0);
}
