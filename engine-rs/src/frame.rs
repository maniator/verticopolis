//! The per-frame read model a host reads between structural syncs: the
//! flat frame (`frame_view`) and the log entries since a sequence number
//! (`log_since`). Both are plain reads of a `Simulation`, so a native host
//! calls them directly; the JavaScript binding (`wasm.rs`) re-exports them
//! and passes the frame across as one typed array.
use serde_json::Value;

use crate::sim::Simulation;

/// The version of the frame view's layout, reported by `engineIdentity()`.
/// Raise it, in the same commit, when a slot's offset or a record's width
/// changes (`identity_tests.rs` pins every offset and width, and fails with
/// the table) or when a slot's meaning or a state, routine or weather code
/// changes (no test sees that; it is a review item). The compat record pins
/// this number, so raising it also asks for a crate version bump.
pub const FRAME_LAYOUT_VERSION: u32 = 1;

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

/// The slots of a unit record by name.
pub mod unit {
    pub const ID: usize = 0;
    pub const STATE: usize = 1;
    pub const OCCUPANTS: usize = 2;
    pub const CUSTOMERS_IN: usize = 3;
    pub const HOTEL_CUSTOMERS_IN: usize = 4;
    pub const OUT_FOR_MEAL: usize = 5;
}

/// The slots of a transport record by name: `ID` and `CARS`, then `CARS`
/// car records of [`CAR_RECORD`] slots, each laid out as [`car`].
pub mod transport {
    pub const ID: usize = 0;
    pub const CARS: usize = 1;
}

/// The slots of one car in a transport record, counted from the car's start.
pub mod car {
    pub const POSITION: usize = 0;
    pub const LOAD: usize = 1;
    pub const DIRECTION: usize = 2;
}

/// Slots of a unit record.
pub const UNIT_RECORD: usize = unit::OUT_FOR_MEAL + 1;

/// Slots of a transport record before its cars.
pub const TRANSPORT_FIXED: usize = transport::CARS + 1;

/// Slots of each car in a transport record.
pub const CAR_RECORD: usize = car::DIRECTION + 1;

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

// The encoders below write what `frame_view` writes, for the engine view
// (`view/`), which shares the codes and the transport records. `frame_view`
// keeps its own copies; `view/frame_tests.rs` and `view/layout_tests.rs`
// check that the two agree.

/// The `PersonState` index a frame carries for a person's state.
pub(crate) fn person_state_code(state: crate::crowd::PState) -> f64 {
    use crate::crowd::PState;
    match state {
        PState::ToShaft => 0.0,
        PState::Waiting => 1.0,
        PState::Riding => 2.0,
        PState::Climbing => 3.0,
        PState::ToDest => 4.0,
        PState::Dwelling => 5.0,
        PState::Done => 6.0,
    }
}

/// The `UnitState` index a frame carries for a unit's state.
pub(crate) fn unit_state_code(state: crate::tower::UnitState) -> f64 {
    use crate::tower::UnitState;
    match state {
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
    }
}

/// The weather code a frame carries: 0 clear, 1 cloudy, 2 rain.
pub(crate) fn weather_code(weather: crate::sim_loop::Weather) -> f64 {
    use crate::sim_loop::Weather;
    match weather {
        Weather::Clear => 0.0,
        Weather::Cloudy => 1.0,
        Weather::Rain => 2.0,
    }
}

/// A unit's frame fields after its id: state, occupants, customersIn,
/// hotelCustomersIn, outForMeal (an absent counter is -1).
pub(crate) fn unit_fields(u: &crate::tower::Unit) -> [f64; 5] {
    let counter = |c: Option<i64>| c.map_or(-1.0, |n| n as f64);
    [
        unit_state_code(u.state),
        u.occupants as f64,
        counter(u.customers_in),
        counter(u.hotel_customers_in),
        counter(u.out_for_meal),
    ]
}

/// The slots `push_transports` writes for these transports.
pub(crate) fn transports_len(transports: &[crate::tower::Transport]) -> usize {
    transports
        .iter()
        .map(|t| TRANSPORT_FIXED + CAR_RECORD * t.cars as usize)
        .sum()
}

/// Every transport's record: id, cars, then per car position, load (-1 when
/// the shaft keeps none) and direction.
pub(crate) fn push_transports(v: &mut Vec<f64>, transports: &[crate::tower::Transport]) {
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
#[path = "frame_tests.rs"]
mod tests;
