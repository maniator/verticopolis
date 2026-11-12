//! Engine rules the TypeScript reference suites checked until #1875, one
//! file per retired suite. Each file's header names the Rust tests that
//! already covered the rest of its suite.
use crate::clock::{CalendarKind, Clock, GameMode};
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

// It reads the crowd's sources from disk, so it is declared by path: the
// independence guard (`tests/independence.rs`) then counts it as test code.
#[cfg(test)]
#[path = "attendance.rs"]
mod attendance;
mod calendar;
mod canon;
mod capacity;
mod commute;
mod condo_relocation;
mod condos;
mod congestion_gripe_copy;
mod crowd;
mod demand_pools;
mod demographic_routines;
mod diagnostics_towers;
mod dominant_gripe;
mod economy_depth;
mod elevator_dispatch_balancing;
mod elevator_schedule;
mod elevator_scheduling;
mod elevator_width_migration;
mod elevator_width_migration_load;
mod event_fx;
mod faq_complete;
mod faq_complete_mechanics;
mod fixed_step;
mod game_events;
mod golden_master;
mod heatmap;
mod hotel_late_checkout;
mod housekeeping_legibility;
mod housekeeping_maids;
mod housekeeping_triage;
mod infestation;
mod lease_amenity_gripe;
mod ledger;
mod legibility;
mod legibility_move_ins;
mod loader_cases;
mod lobby_distance;
mod meal_cadence;
mod mode_rules;
mod modern_economy;
mod move_in_gate_legibility;
mod move_in_gate_rentals;
mod move_in_sustainability_gate;
mod noise_memo;
mod party_hall_two_floor;
mod person_census;
mod person_round_trip;
mod phase2;
mod playthrough;
mod pricing_split;
mod pricing_split_snap;
mod reflow_migration;
mod rental_nightclub_gripe;
mod retail_yardstick;
mod review_fixes;
mod save_hardening;
mod save_log;
mod save_versions;
mod segment_routing;
mod segment_routing_reachable;
mod simulation_bridge;
mod simulation_economy;
mod simulation_events;
mod simulation_housekeeping;
mod simulation_retail;
mod simulation_sky_lobby;
mod simulation_transport;
mod skylobby_transfer;
mod sparse_save;
mod subsystems;
mod undo_signature;
mod unmet_demand;
mod venue_attendance;
mod venue_origins;
mod walking_penalties;
mod walkway_willingness;
mod waste_and_parking;
mod weather_crowd;
mod weather_events;
mod weekend_patronage;

/// The left edge of the test towers' lobby and floors.
pub const LEFT: i64 = 100;
/// One past their right edge.
pub const RIGHT: i64 = 180;

/// A lobby and floor tiles from `LEFT` to `RIGHT` up to `top`, one standard
/// elevator at `LEFT` serving every floor, five stars and money to spare.
pub fn served_tower(mode: GameMode, calendar: CalendarKind, top: i64) -> Simulation {
    let mut sim = Simulation::new_game_with(1, mode, calendar, false);
    sim.star = 5;
    sim.money = 1e9;
    for x in LEFT..RIGHT {
        assert!(sim.build(Kind::Lobby, 1, x).ok);
    }
    for floor in 2..=top {
        for x in LEFT..RIGHT {
            assert!(sim.build(Kind::Floor, floor, x).ok);
        }
    }
    let shaft = sim.build_transport(Kind::ElevatorStandard, LEFT, 1, top);
    assert!(shaft.ok, "{:?}", shaft.reason);
    sim
}

/// Builds `kind` at `x` on `floor`, leaves it in `state` and returns its id.
pub fn room(sim: &mut Simulation, kind: Kind, floor: i64, x: i64, state: UnitState) -> i64 {
    let placed = sim.build(kind, floor, x);
    assert!(placed.ok, "{kind:?} at {floor}/{x}: {:?}", placed.reason);
    let id = sim.tower.unit_at(floor, x).unwrap().id;
    sim.tower.get_unit_mut(id).unwrap().state = state;
    id
}

/// The middle column of the lot.
pub const MID: i64 = crate::facilities::LOT_WIDTH / 2;

/// `newSeededGame`: a new game with the centered 40-tile starter lobby the
/// TypeScript suites stood their towers on.
pub fn seeded_game(seed: u32, mode: GameMode) -> Simulation {
    let mut sim = Simulation::new_game(seed, mode);
    for x in MID - 20..MID + 20 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    sim
}

/// `servedTower` (moveInGateHelpers.ts): a full-width lobby, floor slabs on
/// 2..=top and a centered standard elevator with eight cars up to floor 30,
/// one star (no random events) and money to spare.
pub fn lot_tower(seed: u32, mode: GameMode, top: i64) -> Simulation {
    let mut sim = Simulation::new_game(seed, mode);
    sim.money = 1e12;
    sim.star = 1;
    lay_row(&mut sim, Kind::Lobby, 1);
    for floor in 2..=top {
        lay_row(&mut sim, Kind::Floor, floor);
    }
    let shaft = sim.build_transport(Kind::ElevatorStandard, MID, 1, top.min(30));
    assert!(shaft.ok, "{:?}", shaft.reason);
    let id = sim.tower.transports[0].id;
    assert!(sim.tower.set_cars(id, 8));
    sim
}

/// Lays `kind` across the whole lot on `floor`, skipping tiles that are
/// already that kind.
pub fn lay_row(sim: &mut Simulation, kind: Kind, floor: i64) {
    for x in 0..crate::facilities::LOT_WIDTH {
        if sim.tower.unit_at(floor, x).is_some_and(|u| u.kind == kind) {
            continue;
        }
        let r = sim.tower.place(kind, floor, x);
        assert!(r.ok, "{kind:?} at {floor}/{x}: {:?}", r.reason);
    }
}

/// Places `kind` at `x` on `floor` and returns its id.
pub fn put(sim: &mut Simulation, kind: Kind, floor: i64, x: i64) -> i64 {
    let r = sim.tower.place(kind, floor, x);
    assert!(r.ok, "{kind:?} at {floor}/{x}: {:?}", r.reason);
    r.unit_id.unwrap()
}

/// A unit by id.
pub fn unit(sim: &Simulation, id: i64) -> &crate::tower::Unit {
    sim.tower.get_unit(id).unwrap()
}

/// Sets a unit's state and satisfaction; a tenanted state also marks it
/// as ever occupied.
pub fn seat(sim: &mut Simulation, id: i64, state: UnitState, satisfaction: f64) {
    let u = sim.tower.get_unit_mut(id).unwrap();
    u.state = state;
    u.satisfaction = satisfaction;
    if state != UnitState::Empty {
        u.ever_occupied = true;
    }
}

/// `wouldEvictFreshTenant` against the gate's own context (congestion
/// neutralized), as the move-in pass builds it.
pub fn gated(sim: &mut Simulation, id: i64) -> bool {
    let u = unit(sim, id).clone();
    let mut ctx = sim.build_satisfaction_context(true);
    sim.would_evict_fresh_tenant(&u, &mut ctx)
}

/// The ladder's flags for a served, uncongested tenant with no placement
/// drain; a test turns on what it is about.
pub fn calm() -> crate::satisfaction::StepResult {
    crate::satisfaction::StepResult {
        next: 1.0,
        served: true,
        cong: 0.0,
        far_walk: false,
        noisy: false,
        lobby_far: false,
        unmet_demand: false,
        unmet_cov: None,
    }
}

/// `new Simulation(seed, mode, "realWorld")` with a ground lobby and floor
/// slabs 2 to `top` over columns 0 to `width - 1`, no transport, star 1 (so
/// random fires stay gated) and money to spare: the strip the crowd suites
/// stood their towers on.
pub fn strip_tower(seed: u32, mode: GameMode, width: i64, top: i64) -> Simulation {
    let mut sim = Simulation::new(seed, mode, CalendarKind::RealWorld, false);
    sim.money = 1e9;
    sim.star = 1;
    for x in 0..width {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok, "lobby at {x}");
    }
    for floor in 2..=top {
        for x in 0..width {
            assert!(
                sim.tower.place(Kind::Floor, floor, x).ok,
                "floor {floor} at {x}"
            );
        }
    }
    sim
}

/// Places a transport with `tower.place_transport` and returns its id.
pub fn shaft(sim: &mut Simulation, kind: Kind, x: i64, bottom: i64, top: i64) -> i64 {
    let r = sim.tower.place_transport(kind, x, bottom, top);
    assert!(r.ok, "{kind:?} at {x} ({bottom}-{top}): {:?}", r.reason);
    r.unit_id.unwrap()
}

/// Places `kind` with `tower.place` (no charge, no construction), leaves it
/// in `state` with `occupants` people and returns its id.
pub fn place_seated(
    sim: &mut Simulation,
    kind: Kind,
    floor: i64,
    x: i64,
    state: UnitState,
    occupants: i64,
) -> i64 {
    let r = sim.tower.place(kind, floor, x);
    assert!(r.ok, "{kind:?} at {floor}/{x}: {:?}", r.reason);
    let id = r.unit_id.unwrap();
    let u = sim.tower.get_unit_mut(id).unwrap();
    u.state = state;
    u.occupants = occupants;
    id
}

/// Puts the clock at `hour` on `day` without ticking (day 0 is a Monday on
/// the real-world calendar, day 5 a Saturday).
pub fn at_time(sim: &mut Simulation, day: i64, hour: i64) {
    sim.clock = Clock::new(((day * 24 + hour) * 60) as f64, sim.clock.calendar);
}

/// The decoded save of `conformance/fixtures/<name>.vctower`.
/// The fixtures are compiled in, so the tests read no file at run time.
pub fn fixture_save(name: &str) -> serde_json::Value {
    let text = match name {
        "sixseven_2" => include_str!("../../../conformance/fixtures/sixseven_2.vctower"),
        "split-tower" => include_str!("../../../conformance/fixtures/split-tower.vctower"),
        "towerone_6" => include_str!("../../../conformance/fixtures/towerone_6.vctower"),
        _ => panic!("no fixture named {name}"),
    };
    crate::load::decode_vctower(text).expect("the fixture decodes")
}

/// A minimal Classic save at `version`: star 3, ids from 1 in list order.
/// A unit missing a field gets the TypeScript fixtures' defaults (occupied,
/// width 1, nobody in).
pub fn legacy_save(
    version: i64,
    units: Vec<serde_json::Value>,
    transports: Vec<serde_json::Value>,
) -> serde_json::Value {
    use serde_json::json;
    let n = units.len() + transports.len();
    let defaults =
        json!({ "state": "occupied", "occupants": 0, "everOccupied": false, "width": 1 });
    let units: Vec<serde_json::Value> = units
        .into_iter()
        .enumerate()
        .map(|(i, mut u)| {
            let m = u.as_object_mut().expect("a unit object");
            m.entry("id").or_insert(json!(i + 1));
            for (k, v) in defaults.as_object().unwrap() {
                m.entry(k.clone()).or_insert(v.clone());
            }
            u
        })
        .collect();
    json!({
        "version": version, "seed": 1, "money": 1e9, "star": 3, "minutes": 0,
        "mode": "classic", "units": units, "transports": transports, "nextId": n + 1,
        "towerName": "Legacy", "builtWeddingHall": false, "evaluatedTower": false,
    })
}

/// Width-1 `kind` tiles over `from..to` on `floor`, as save units.
pub fn pave(kind: &str, floor: i64, from: i64, to: i64) -> Vec<serde_json::Value> {
    (from..to)
        .map(|x| serde_json::json!({ "kind": kind, "floor": floor, "x": x, "width": 1 }))
        .collect()
}

/// The first stream state whose next draws pass `script`, to put a random
/// stream where a test needs its next rolls (`Rng::restore`). This scripts
/// the daily rolls the TypeScript suites queued by hand.
pub fn rng_state_where(script: impl Fn(&mut crate::rng::Rng) -> bool) -> u32 {
    (1..=u32::MAX)
        .find(|&state| {
            let mut rng = crate::rng::Rng::new(1);
            rng.restore(state);
            script(&mut rng)
        })
        .unwrap()
}
