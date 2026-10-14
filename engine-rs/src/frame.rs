//! The per-frame read model a host reads between structural syncs: the
//! flat frame (`frame_view`) and the log entries since a sequence number
//! (`log_since`). Both are plain reads of a `Simulation`, so a native host
//! calls them directly; the JavaScript binding (`wasm.rs`) re-exports them
//! and passes the frame across as one typed array.
use serde_json::Value;

use crate::sim::Simulation;

/// The header slots of the frame view by name, so a native decoder reads
/// `v[header::MONEY]` instead of a bare index. A group of values starts at
/// its named slot: `EXPLOSION_FX` is seq, floor, x; `THIEF_FX` is seq,
/// caught, floor; `TREASURE_FX` is seq, floor, x; `EVENT_COUNTS` is fires,
/// firesGutRooms, bombs. [`frame_view`] describes each value.
pub mod header {
    pub const MINUTES: usize = 0;
    pub const TOWER_REVISION: usize = 1;
    pub const MEAL_OVERLAY_REVISION: usize = 2;
    pub const LOG_SEQ: usize = 3;
    pub const MONEY: usize = 4;
    pub const STAR: usize = 5;
    pub const WEATHER: usize = 6;
    pub const SANTA_FX_SEQ: usize = 7;
    pub const EXPLOSION_FX: usize = 8;
    pub const THIEF_FX: usize = 11;
    pub const TREASURE_FX: usize = 14;
    pub const VIP_FX_SEQ: usize = 17;
    pub const EVENT_COUNTS: usize = 18;
    pub const PENDING_CHOICE: usize = 21;
    pub const ON_HOUR_RUNS: usize = 22;
    pub const PEOPLE: usize = 23;
    pub const UNITS: usize = 24;
    pub const TRANSPORTS: usize = 25;
}

/// The fixed slots of a person record by name, counted from the record's
/// start. The route follows them: `FLOOR_COUNT` floors, then `SHAFT_COUNT`
/// shafts.
pub mod person {
    pub const ID: usize = 0;
    pub const SEED: usize = 1;
    pub const STAFF: usize = 2;
    pub const STATE: usize = 3;
    pub const FLOOR: usize = 4;
    pub const X: usize = 5;
    pub const FY: usize = 6;
    pub const WAIT: usize = 7;
    pub const ORIGIN_FLOOR: usize = 8;
    pub const ORIGIN_UNIT_ID: usize = 9;
    pub const VENUE_UNIT_ID: usize = 10;
    pub const MEAL_VENUE_ID: usize = 11;
    pub const COUNTED_HOTEL_GUEST: usize = 12;
    pub const ROUTINE: usize = 13;
    pub const RETURNING: usize = 14;
    pub const DWELL_SECONDS_LEFT: usize = 15;
    pub const FLOOR_COUNT: usize = 16;
    pub const SHAFT_COUNT: usize = 17;
}

/// Fixed header slots of the frame view, before the three variable sections.
pub const FRAME_HEADER: usize = header::TRANSPORTS + 1;

/// Fixed slots of a person record, before its route (`floors` then `shafts`).
pub const PERSON_FIXED: usize = person::SHAFT_COUNT + 1;

/// Slots of a unit record: id, state, occupants, customersIn,
/// hotelCustomersIn, outForMeal.
pub const UNIT_RECORD: usize = 6;

/// Slots of a transport record before its cars: id, cars.
pub const TRANSPORT_FIXED: usize = 2;

/// Slots of each car in a transport record: position, load, direction.
pub const CAR_RECORD: usize = 3;

/// The routine code for a routine `frame_view` has no code for. The
/// TypeScript decoder rejects it, and a native decoder should too: it means
/// the engine gained a routine this layout has not named yet (the engine's
/// unit tests stop on it, and the consumer's frame check refuses it).
pub const UNKNOWN_ROUTINE: f64 = 255.0;

/// The per-frame read model: every value the web host reads from the
/// simulation between two structural syncs, flat so it crosses the WASM
/// boundary as one typed array.
///
/// Header (`FRAME_HEADER` slots): 0 minutes, 1 tower revision, 2 meal
/// overlay revision, 3 logSeq, 4 money, 5 star, 6 weather (0 clear, 1 cloudy,
/// 2 rain), 7 santaFxSeq, 8..10 explosionFx (seq, floor, x), 11..13 thiefFx
/// (seq, caught, floor), 14..16 treasureFx (seq, floor, x), 17 vipFxSeq,
/// 18..20 event counts (fires, firesGutRooms, bombs), 21 a pending choice
/// (0 or 1), 22 onHourRuns, 23 people count, 24 unit count, 25 transport
/// count.
///
/// Then `people count` records of `PERSON_FIXED + floors + shafts`: id, seed,
/// staff (0 or 1), state (the `PersonState` index), floor, x, fy, wait, then
/// the routing slice the suites read: originFloor (always present, so -1 is
/// a real basement floor), originUnitId, venueUnitId, mealVenueId (each -1
/// when absent), countedHotelGuest (0 or 1), routine
/// (0 none, 1 schoolRun, 2 salesCall, 255 a routine with no code yet, which
/// the decoder rejects), returning (0 or 1), dwellSecondsLeft
/// (NaN when absent: a drained timer stays negative on the person through
/// the return leg, so no number is free), the floors count, the shafts
/// count, then the route's floors and its shafts. Then `unit count` records
/// of 6: id, state (the `UnitState` index), occupants, customersIn,
/// hotelCustomersIn, outForMeal (an absent counter is -1). Then
/// `transport count` records of `2 + 3 * cars`: id, cars, then per car
/// position, load (-1 when the shaft keeps none), direction.
pub fn frame_view(sim: &Simulation) -> Vec<f64> {
    use crate::crowd::PState;
    use crate::sim_loop::Weather;
    use crate::tower::UnitState;
    let people = &sim.crowd.people;
    let units = &sim.tower.units;
    let transports = &sim.tower.transports;
    let mut v = Vec::with_capacity(
        FRAME_HEADER
            + people
                .iter()
                .map(|p| PERSON_FIXED + p.floors.len() + p.shafts.len())
                .sum::<usize>()
            + units.len() * UNIT_RECORD
            + transports
                .iter()
                .map(|t| TRANSPORT_FIXED + CAR_RECORD * t.cars as usize)
                .sum::<usize>(),
    );
    let fx = &sim.fx;
    v.extend_from_slice(&[
        sim.clock.minutes,
        sim.tower.revision as f64,
        sim.tower.meal_overlay_revision as f64,
        sim.log_seq as f64,
        sim.money,
        sim.star as f64,
        match sim.weather {
            Weather::Clear => 0.0,
            Weather::Cloudy => 1.0,
            Weather::Rain => 2.0,
        },
        fx.santa_seq as f64,
        fx.explosion.seq as f64,
        fx.explosion.floor as f64,
        fx.explosion.x,
        fx.thief.seq as f64,
        if fx.thief.caught { 1.0 } else { 0.0 },
        fx.thief.floor as f64,
        fx.treasure.seq as f64,
        fx.treasure.floor as f64,
        fx.treasure.x,
        fx.vip_seq as f64,
        sim.events.fires_started as f64,
        sim.events.fires_gut_rooms as f64,
        sim.events.bombs_detonated as f64,
        if sim.events.pending.is_some() {
            1.0
        } else {
            0.0
        },
        sim.on_hour_runs as f64,
        people.len() as f64,
        units.len() as f64,
        transports.len() as f64,
    ]);
    debug_assert_eq!(v.len(), FRAME_HEADER);
    for p in people {
        let state = match p.state {
            PState::ToShaft => 0.0,
            PState::Waiting => 1.0,
            PState::Riding => 2.0,
            PState::Climbing => 3.0,
            PState::ToDest => 4.0,
            PState::Dwelling => 5.0,
            PState::Done => 6.0,
        };
        let id = |v: Option<i64>| v.map_or(-1.0, |n| n as f64);
        let flag = |b: bool| if b { 1.0 } else { 0.0 };
        let routine = match p.routine {
            None => 0.0,
            Some("schoolRun") => 1.0,
            Some("salesCall") => 2.0,
            // The routines are engine-set literals; a new one must be added
            // here and to `ROUTINES` in frameView.ts. Until then it crosses
            // as a code the decoder rejects by name. The engine's unit tests
            // stop here first; a host's build never panics in this read.
            Some(other) => {
                if cfg!(test) {
                    panic!("routine {other} has no frame code");
                }
                UNKNOWN_ROUTINE
            }
        };
        v.extend_from_slice(&[
            p.id as f64,
            p.seed as f64,
            flag(p.staff),
            state,
            p.floor as f64,
            p.x,
            p.fy,
            p.wait,
            p.origin_floor as f64,
            id(p.origin_unit_id),
            id(p.venue_unit_id),
            id(p.meal_venue_id),
            flag(p.counted_hotel_guest),
            routine,
            flag(p.returning),
            p.dwell_seconds_left.unwrap_or(f64::NAN),
            p.floors.len() as f64,
            p.shafts.len() as f64,
        ]);
        v.extend(p.floors.iter().map(|f| *f as f64));
        v.extend(p.shafts.iter().map(|s| *s as f64));
    }
    let counter = |c: Option<i64>| c.map_or(-1.0, |n| n as f64);
    for u in units {
        let state = match u.state {
            UnitState::Construction => 0.0,
            UnitState::Empty => 1.0,
            UnitState::Occupied => 2.0,
            UnitState::MovingIn => 3.0,
            UnitState::Vacating => 4.0,
            UnitState::Asleep => 5.0,
            UnitState::Dirty => 6.0,
            UnitState::Infested => 7.0,
            UnitState::Fire => 8.0,
            UnitState::Gutted => 9.0,
        };
        v.extend_from_slice(&[
            u.id as f64,
            state,
            u.occupants as f64,
            counter(u.customers_in),
            counter(u.hotel_customers_in),
            counter(u.out_for_meal),
        ]);
    }
    for t in transports {
        v.push(t.id as f64);
        v.push(t.cars as f64);
        for i in 0..t.cars as usize {
            v.push(t.car_positions.get(i).copied().unwrap_or(0.0));
            v.push(
                t.car_load
                    .as_ref()
                    .and_then(|l| l.get(i).copied())
                    .unwrap_or(-1.0),
            );
            v.push(t.car_dir.get(i).copied().unwrap_or(0) as f64);
        }
    }
    v
}

/// The log entries numbered after `seq`, oldest first. The ring's entries
/// are numbered from `log_seq` backwards, so the last entry is `log_seq`.
pub fn log_since(sim: &Simulation, seq: i64) -> Value {
    let len = sim.log.len() as i64;
    let first = sim.log_seq - len + 1;
    Value::Array(
        sim.log
            .iter()
            .enumerate()
            .map(|(i, e)| (first + i as i64, e))
            .filter(|(n, _)| *n > seq)
            .map(|(n, e)| {
                serde_json::json!({ "seq": n, "minute": e.minute, "text": e.text, "kind": e.kind.as_str() })
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
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

    /// Each named slot holds the value its name says. The header's values
    /// are set apart from one another first, so a swapped name fails; the
    /// records are walked against the people, rooms and shafts they came
    /// from. One test, since replaying the scenario is the slow part.
    #[test]
    fn the_named_slots_read_their_values() {
        let mut sim = busy();
        assert!(sim.events.pending.is_none());
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
        for (slot, value) in want {
            assert_eq!(v[slot], value, "header slot {slot}");
        }
    }

    /// The named record slots and widths walk a real frame to its end.
    fn walk_records(sim: &Simulation, v: &[f64]) {
        assert!(!sim.crowd.people.is_empty() && !sim.tower.transports.is_empty());
        let mut at = FRAME_HEADER;
        for p in &sim.crowd.people {
            let r = &v[at..at + PERSON_FIXED];
            assert_eq!(r[person::ID], p.id as f64);
            assert_eq!(r[person::SEED], p.seed as f64);
            assert_eq!(r[person::FLOOR], p.floor as f64);
            assert_eq!(r[person::X], p.x);
            assert_eq!(r[person::ORIGIN_FLOOR], p.origin_floor as f64);
            assert_eq!(r[person::FLOOR_COUNT], p.floors.len() as f64);
            assert_eq!(r[person::SHAFT_COUNT], p.shafts.len() as f64);
            at += PERSON_FIXED;
            let floors: Vec<f64> = p.floors.iter().map(|f| *f as f64).collect();
            assert_eq!(v[at..at + floors.len()], floors[..]);
            at += p.floors.len() + p.shafts.len();
        }
        for u in &sim.tower.units {
            assert_eq!(v[at], u.id as f64);
            assert_eq!(v[at + 2], u.occupants as f64);
            at += UNIT_RECORD;
        }
        for t in &sim.tower.transports {
            assert_eq!(v[at..at + TRANSPORT_FIXED], [t.id as f64, t.cars as f64]);
            at += TRANSPORT_FIXED + CAR_RECORD * t.cars as usize;
        }
        assert_eq!(at, v.len());
    }
}
