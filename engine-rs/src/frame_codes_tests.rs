//! What the numbers in the frame's slots mean (#1154). `identity_tests.rs`
//! pins where each slot sits; this pins the codes inside them: the person
//! and room state codes, the weather and routine codes, the car direction
//! values and the sentinels an absent value crosses as. Each code is read
//! back from [`frame_view`] itself, so swapping two codes in the frame fails
//! here even when every offset stays put. A change to the table needs a new
//! `FRAME_LAYOUT_VERSION`, since a host decodes the frame by these codes.
use super::*;
use crate::crowd::PState;
use crate::sim_loop::Weather;
use crate::tower::UnitState;
use sha2::{Digest, Sha256};

/// One pin per `FRAME_LAYOUT_VERSION` whose codes are pinned, oldest first:
/// the version and the hash of its code table. Versions before the first
/// entry predate the pin. A code change raises the version (with its slot
/// pin in `identity_tests.rs`) and appends an entry here.
const FRAME_CODE_PINS: &[(u32, &str)] = &[(1, "13f1a9a64003983e")];

/// Every person state. The match makes a new variant a compile error here,
/// so it cannot join the frame without joining the table.
fn person_states() -> [PState; 7] {
    let all = [
        PState::ToShaft,
        PState::Waiting,
        PState::Riding,
        PState::Climbing,
        PState::ToDest,
        PState::Dwelling,
        PState::Done,
    ];
    for s in all {
        match s {
            PState::ToShaft
            | PState::Waiting
            | PState::Riding
            | PState::Climbing
            | PState::ToDest
            | PState::Dwelling
            | PState::Done => {}
        }
    }
    all
}

/// Every room state, held to the enum the same way.
fn unit_states() -> [UnitState; 10] {
    let all = [
        UnitState::Construction,
        UnitState::Empty,
        UnitState::Occupied,
        UnitState::MovingIn,
        UnitState::Vacating,
        UnitState::Asleep,
        UnitState::Dirty,
        UnitState::Infested,
        UnitState::Fire,
        UnitState::Gutted,
    ];
    for s in all {
        match s {
            UnitState::Construction
            | UnitState::Empty
            | UnitState::Occupied
            | UnitState::MovingIn
            | UnitState::Vacating
            | UnitState::Asleep
            | UnitState::Dirty
            | UnitState::Infested
            | UnitState::Fire
            | UnitState::Gutted => {}
        }
    }
    all
}

/// Every weather, held to the enum the same way.
fn weathers() -> [Weather; 3] {
    let all = [Weather::Clear, Weather::Cloudy, Weather::Rain];
    for w in all {
        match w {
            Weather::Clear | Weather::Cloudy | Weather::Rain => {}
        }
    }
    all
}

/// Where the first unit record and the first car-bearing transport record
/// start in `v`, and that transport's index.
fn record_starts(sim: &Simulation) -> (usize, usize, usize) {
    let people: usize = sim
        .crowd
        .people
        .iter()
        .map(|p| PERSON_FIXED + p.floors.len() + p.shafts.len())
        .sum();
    let first_unit = FRAME_HEADER + people;
    let shaft = sim
        .tower
        .transports
        .iter()
        .position(|t| t.cars > 0)
        .expect("the tower has a shaft with cars");
    let before: usize = sim.tower.transports[..shaft]
        .iter()
        .map(transport_len)
        .sum();
    let first_car = first_unit + sim.tower.units.len() * UNIT_RECORD + before + TRANSPORT_FIXED;
    (first_unit, first_car, shaft)
}

/// A frame value as table text: a NaN is spelled out, since it is a sentinel.
fn code(v: f64) -> String {
    if v.is_nan() {
        "NaN".to_owned()
    } else {
        format!("{v}")
    }
}

/// The code table, read from the frame: one `name=code` line per value.
fn code_table() -> String {
    let mut sim = super::tests::busy();
    let mut lines = Vec::new();
    let p0 = FRAME_HEADER;
    for s in person_states() {
        sim.crowd.people[0].state = s;
        let v = frame_view(&sim);
        lines.push(format!(
            "person.state.{}={}",
            s.as_str(),
            code(v[p0 + person::STATE])
        ));
    }
    for (name, routine) in [
        ("none", None),
        ("schoolRun", Some("schoolRun")),
        ("salesCall", Some("salesCall")),
    ] {
        sim.crowd.people[0].routine = routine;
        let v = frame_view(&sim);
        lines.push(format!(
            "person.routine.{name}={}",
            code(v[p0 + person::ROUTINE])
        ));
    }
    lines.push(format!("person.routine.unknown={}", code(UNKNOWN_ROUTINE)));
    {
        let p = &mut sim.crowd.people[0];
        p.origin_unit_id = None;
        p.venue_unit_id = None;
        p.meal_venue_id = None;
        p.dwell_seconds_left = None;
        p.staff = false;
        p.counted_hotel_guest = false;
        p.returning = false;
    }
    let v = frame_view(&sim);
    for (name, slot) in [
        ("originUnitId", person::ORIGIN_UNIT_ID),
        ("venueUnitId", person::VENUE_UNIT_ID),
        ("mealVenueId", person::MEAL_VENUE_ID),
        ("dwellSecondsLeft", person::DWELL_SECONDS_LEFT),
    ] {
        lines.push(format!("person.absent.{name}={}", code(v[p0 + slot])));
    }
    for (name, slot) in [
        ("staff", person::STAFF),
        ("countedHotelGuest", person::COUNTED_HOTEL_GUEST),
        ("returning", person::RETURNING),
    ] {
        lines.push(format!("person.clear.{name}={}", code(v[p0 + slot])));
    }
    {
        let p = &mut sim.crowd.people[0];
        p.staff = true;
        p.counted_hotel_guest = true;
        p.returning = true;
    }
    let v = frame_view(&sim);
    for (name, slot) in [
        ("staff", person::STAFF),
        ("countedHotelGuest", person::COUNTED_HOTEL_GUEST),
        ("returning", person::RETURNING),
    ] {
        lines.push(format!("person.set.{name}={}", code(v[p0 + slot])));
    }
    let (u0, c0, shaft) = record_starts(&sim);
    for s in unit_states() {
        sim.tower.units[0].state = s;
        let v = frame_view(&sim);
        lines.push(format!(
            "unit.state.{}={}",
            s.as_str(),
            code(v[u0 + unit::STATE])
        ));
    }
    {
        let u = &mut sim.tower.units[0];
        u.customers_in = None;
        u.hotel_customers_in = None;
        u.out_for_meal = None;
    }
    let v = frame_view(&sim);
    for (name, slot) in [
        ("customersIn", unit::CUSTOMERS_IN),
        ("hotelCustomersIn", unit::HOTEL_CUSTOMERS_IN),
        ("outForMeal", unit::OUT_FOR_MEAL),
    ] {
        lines.push(format!("unit.absent.{name}={}", code(v[u0 + slot])));
    }
    for w in weathers() {
        sim.weather = w;
        let v = frame_view(&sim);
        let name = crate::view::layout::WEATHER[weather_code(w) as usize];
        lines.push(format!(
            "header.weather.{name}={}",
            code(v[header::WEATHER])
        ));
    }
    for dir in [-1, 0, 1] {
        sim.tower.transports[shaft].car_dir[0] = dir;
        let v = frame_view(&sim);
        lines.push(format!(
            "car.direction.{dir}={}",
            code(v[c0 + car::DIRECTION])
        ));
    }
    sim.tower.transports[shaft].car_load = None;
    let v = frame_view(&sim);
    lines.push(format!("car.absent.load={}", code(v[c0 + car::LOAD])));
    lines.join("\n") + "\n"
}

#[test]
fn the_frame_codes_are_pinned() {
    let table = code_table();
    let hex: String = Sha256::digest(table.as_bytes())[..8]
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    let (version, pin) = *FRAME_CODE_PINS.last().unwrap();
    assert_eq!(
        version, FRAME_LAYOUT_VERSION,
        "the newest code pin belongs to an older FRAME_LAYOUT_VERSION: append a pin for the current one"
    );
    assert_eq!(
        pin, hex,
        "a frame code changed: raise FRAME_LAYOUT_VERSION, add its slot pin in identity_tests.rs and append a code pin here\n{table}"
    );
}

/// The table names what it pins: each state, weather and routine has its own
/// line, and the codes are the ones `frame_view` documents.
#[test]
fn the_code_table_reads_as_documented() {
    let table = code_table();
    for line in [
        "person.state.toShaft=0",
        "person.state.done=6",
        "person.routine.none=0",
        "person.routine.schoolRun=1",
        "person.routine.salesCall=2",
        "person.routine.unknown=255",
        "person.absent.originUnitId=-1",
        "person.absent.dwellSecondsLeft=NaN",
        "unit.state.construction=0",
        "unit.state.gutted=9",
        "unit.absent.outForMeal=-1",
        "header.weather.clear=0",
        "header.weather.cloudy=1",
        "header.weather.rain=2",
        "car.direction.-1=-1",
        "car.absent.load=-1",
    ] {
        assert!(table.lines().any(|l| l == line), "missing {line}\n{table}");
    }
}
