//! Tests for `frame.rs`: every named slot of the frame against the value it
//! holds.
use super::*;
use crate::sim_loop::Weather;

/// A scenario of the lock run up to one of its checkpoints.
fn at(id: &str, label: &str) -> Simulation {
    let suite = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../conformance");
    let text = std::fs::read_to_string(suite.join(format!("scenarios/{id}.json"))).unwrap();
    let s = crate::scenario::Scenario::parse(&text).unwrap();
    crate::scenario::run_scenario_until(&s, &suite, label).unwrap()
}

/// A tower with guests in it and shafts.
fn busy() -> Simulation {
    at("hotel-exterminator-modern", "booked")
}

/// Each named slot holds the value its name says. Values are set apart
/// from one another first, so a swapped name fails (two flags that hold
/// the same 0 or 1 can still trade places unseen); the records are then
/// walked against the people, rooms and shafts they came from. One test,
/// since replaying the scenario is the slow part.
#[test]
fn the_named_slots_read_their_values() {
    let mut sim = busy();
    assert!(sim.events.pending.is_none());
    set_apart(&mut sim);
    walk_records(&sim, &frame_view(&sim));
    sim.clock.minutes = 1001.0;
    sim.tower.revision = 1002;
    sim.tower.meal_overlay_revision = 1003;
    sim.log_seq = 1004;
    sim.money = 1005.0;
    sim.star = 4;
    sim.weather = Weather::Rain;
    sim.fx.santa_seq = 1007;
    sim.fx.explosion.seq = 1008;
    sim.fx.explosion.floor = 1009;
    sim.fx.explosion.x = 1010.0;
    sim.fx.thief.seq = 1011;
    sim.fx.thief.caught = true;
    sim.fx.thief.floor = 1013;
    sim.fx.treasure.seq = 1014;
    sim.fx.treasure.floor = 1015;
    sim.fx.treasure.x = 1016.0;
    sim.fx.vip_seq = 1017;
    sim.events.fires_started = 1018;
    sim.events.fires_gut_rooms = 1019;
    sim.events.bombs_detonated = 1020;
    sim.on_hour_runs = 1022;
    let v = frame_view(&sim);
    use header::*;
    let want = [
        (MINUTES, 1001.0),
        (TOWER_REVISION, 1002.0),
        (MEAL_OVERLAY_REVISION, 1003.0),
        (LOG_SEQ, 1004.0),
        (MONEY, 1005.0),
        (STAR, 4.0),
        (WEATHER, 2.0),
        (SANTA_FX_SEQ, 1007.0),
        (EXPLOSION_FX, 1008.0),
        (EXPLOSION_FX + 1, 1009.0),
        (EXPLOSION_FX + 2, 1010.0),
        (THIEF_FX, 1011.0),
        (THIEF_FX + 1, 1.0),
        (THIEF_FX + 2, 1013.0),
        (TREASURE_FX, 1014.0),
        (TREASURE_FX + 1, 1015.0),
        (TREASURE_FX + 2, 1016.0),
        (VIP_FX_SEQ, 1017.0),
        (EVENT_COUNTS, 1018.0),
        (EVENT_COUNTS + 1, 1019.0),
        (EVENT_COUNTS + 2, 1020.0),
        (PENDING_CHOICE, 0.0),
        (ON_HOUR_RUNS, 1022.0),
        (PEOPLE, sim.crowd.people.len() as f64),
        (UNITS, sim.tower.units.len() as f64),
        (TRANSPORTS, sim.tower.transports.len() as f64),
    ];
    assert_eq!(want.len(), FRAME_HEADER, "every header slot is checked");
    let counts = [v[PEOPLE], v[UNITS], v[TRANSPORTS], v[STAR]];
    assert!(
        (0..4).all(|i| (i + 1..4).all(|j| counts[i] != counts[j])),
        "the counts and the star rating must differ to tell their slots apart: {counts:?}"
    );
    for (slot, value) in want {
        assert_eq!(v[slot], value, "header slot {slot}");
    }
}

/// The named record slots and widths walk a real frame to its end. The
/// first person, unit and car carry values set apart from one another
/// (`set_apart`), so a swapped name fails there; every record is then
/// checked by name against the simulation it came from.
fn walk_records(sim: &Simulation, v: &[f64]) {
    use crate::crowd::PState;
    assert!(!sim.crowd.people.is_empty() && !sim.tower.units.is_empty());
    assert!(sim.tower.transports.iter().any(|t| t.cars > 0));
    let mut at = FRAME_HEADER;
    for (i, p) in sim.crowd.people.iter().enumerate() {
        let r = &v[at..at + PERSON_FIXED];
        assert_eq!(r[person::ID], p.id as f64);
        assert_eq!(r[person::SEED], p.seed as f64);
        assert_eq!(r[person::FLOOR], p.floor as f64);
        assert_eq!(r[person::X], p.x);
        assert_eq!(r[person::ORIGIN_FLOOR], p.origin_floor as f64);
        assert_eq!(r[person::FLOOR_COUNT], p.floors.len() as f64);
        assert_eq!(r[person::SHAFT_COUNT], p.shafts.len() as f64);
        if i == 0 {
            assert_eq!(p.state, PState::Dwelling);
            let want = [
                (person::STAFF, 1.0),
                (person::STATE, 5.0),
                (person::FY, 2001.0),
                (person::WAIT, 2002.0),
                (person::ORIGIN_UNIT_ID, 2003.0),
                (person::VENUE_UNIT_ID, 2004.0),
                (person::MEAL_VENUE_ID, 2005.0),
                (person::COUNTED_HOTEL_GUEST, 0.0),
                (person::ROUTINE, 2.0),
                (person::RETURNING, 1.0),
                (person::DWELL_SECONDS_LEFT, 2006.0),
            ];
            for (slot, value) in want {
                assert_eq!(r[slot], value, "person slot {slot}");
            }
        }
        at += PERSON_FIXED;
        let route: Vec<f64> = p
            .floors
            .iter()
            .chain(&p.shafts)
            .map(|n| *n as f64)
            .collect();
        assert_eq!(v[at..at + route.len()], route[..]);
        at += route.len();
    }
    for (i, u) in sim.tower.units.iter().enumerate() {
        let r = &v[at..at + UNIT_RECORD];
        assert_eq!(r[unit::ID], u.id as f64);
        assert_eq!(r[unit::OCCUPANTS], u.occupants as f64);
        if i == 0 {
            for (slot, value) in [
                (unit::OCCUPANTS, 3001.0),
                (unit::CUSTOMERS_IN, 3002.0),
                (unit::HOTEL_CUSTOMERS_IN, 3003.0),
                (unit::OUT_FOR_MEAL, 3004.0),
            ] {
                assert_eq!(r[slot], value, "unit slot {slot}");
            }
        }
        at += UNIT_RECORD;
    }
    let mut cars_seen = 0;
    for t in &sim.tower.transports {
        let r = &v[at..at + TRANSPORT_FIXED];
        assert_eq!(r[transport::ID], t.id as f64);
        assert_eq!(r[transport::CARS], t.cars as f64);
        at += TRANSPORT_FIXED;
        for c in 0..t.cars as usize {
            let r = &v[at..at + CAR_RECORD];
            if cars_seen == 0 {
                for (slot, value) in [
                    (car::POSITION, 4001.0),
                    (car::LOAD, 4002.0),
                    (car::DIRECTION, -1.0),
                ] {
                    assert_eq!(r[slot], value, "car slot {slot}");
                }
            } else {
                assert_eq!(r[car::POSITION], t.car_positions[c]);
            }
            cars_seen += 1;
            at += CAR_RECORD;
        }
    }
    assert_eq!(at, v.len());
}

/// Give the first person, unit and car values no other slot of their
/// record holds.
fn set_apart(sim: &mut Simulation) {
    use crate::crowd::PState;
    let p = &mut sim.crowd.people[0];
    p.staff = true;
    p.state = PState::Dwelling;
    p.fy = 2001.0;
    p.wait = 2002.0;
    p.origin_unit_id = Some(2003);
    p.venue_unit_id = Some(2004);
    p.meal_venue_id = Some(2005);
    p.counted_hotel_guest = false;
    p.routine = Some("salesCall");
    p.returning = true;
    p.dwell_seconds_left = Some(2006.0);
    let u = &mut sim.tower.units[0];
    u.occupants = 3001;
    u.customers_in = Some(3002);
    u.hotel_customers_in = Some(3003);
    u.out_for_meal = Some(3004);
    let t = sim
        .tower
        .transports
        .iter_mut()
        .find(|t| t.cars > 0)
        .unwrap();
    t.car_positions[0] = 4001.0;
    let cars = t.cars as usize;
    t.car_load = Some(vec![4002.0; cars]);
    t.car_dir[0] = -1;
}
