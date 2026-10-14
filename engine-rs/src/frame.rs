//! The per-frame read model a host reads between structural syncs: the
//! flat frame (`frame_view`) and the log entries since a sequence number
//! (`log_since`). Both are plain reads of a `Simulation`, so a native host
//! calls them directly; the JavaScript binding (`wasm.rs`) re-exports them
//! and passes the frame across as one typed array.
use serde_json::Value;

use crate::sim::Simulation;

/// Fixed header slots of the frame view, before the three variable sections.
pub const FRAME_HEADER: usize = 26;

/// Fixed slots of a person record, before its route (`floors` then `shafts`).
pub const PERSON_FIXED: usize = 18;

/// The routine code for a routine `frame_view` has no code for. The
/// TypeScript decoder rejects it, and a native decoder should too: it means
/// the engine gained a routine this layout has not named yet (a debug build
/// of the engine stops on it first).
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
            + units.len() * 6
            + transports
                .iter()
                .map(|t| 2 + 3 * t.cars as usize)
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
            // as a code the decoder rejects by name, so a release build
            // fails loudly where a debug build fails here.
            Some(other) => {
                debug_assert!(false, "routine {other} has no frame code");
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
