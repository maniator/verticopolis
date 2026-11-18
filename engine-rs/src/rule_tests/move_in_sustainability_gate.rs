//! The move-in sustainability gate: an office, condo, lease amenity or
//! rental never leases into a spot whose own placement would wear a fresh
//! tenant back under the leave bar, so a doomed spot stays empty instead of
//! churning. The gate runs the hourly satisfaction step on the tenant the
//! lease would produce, draws no random numbers and judges congestion as
//! neutral. Its rentals half is in `rule_tests::move_in_gate_rentals`, its
//! card lines and buy-back notes in `rule_tests::move_in_gate_legibility`;
//! cinema seats in the probe's demand by
//! `demand_tests::the_move_in_probe_judges_attendance_against_its_extra_demand`.
use crate::clock::GameMode;
use crate::demand::compute_demand_map;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{gated, lay_row, lot_tower, put, unit, MID as C};

const DAY: f64 = 24.0 * 60.0;

/// Ticks hourly until `id` has been occupied, at most `limit` hours.
pub(super) fn fills_within(sim: &mut Simulation, id: i64, limit: usize) -> bool {
    for _ in 0..limit {
        if unit(sim, id).ever_occupied {
            return true;
        }
        sim.tick(60.0);
    }
    unit(sim, id).ever_occupied
}

pub(super) fn never_filled(sim: &Simulation, id: i64) -> bool {
    let u = unit(sim, id);
    u.state == UnitState::Empty && !u.ever_occupied
}

/// A sold, satisfied owner or tenant, as the TypeScript suite seats one.
pub(super) fn seat_sold(sim: &mut Simulation, id: i64) {
    let u = sim.tower.get_unit_mut(id).unwrap();
    u.state = UnitState::Occupied;
    u.ever_occupied = true;
    u.satisfaction = 1.0;
    if u.kind == Kind::Condo {
        u.residents = Some(3);
        u.rent = Some(160_000.0);
    }
}

fn afflicted(sim: &mut Simulation, id: i64) -> bool {
    let u = unit(sim, id).clone();
    sim.noise_afflicted(&u)
}

#[test]
fn a_modern_noisy_condo_never_sells_and_a_far_walk_office_never_leases() {
    let mut sim = lot_tower(1, GameMode::Modern, 6);
    put(&mut sim, Kind::Office, 2, C - 9);
    let condo = put(&mut sim, Kind::Condo, 2, C);
    sim.tick(30.0 * DAY);
    assert!(afflicted(&mut sim, condo));
    assert!(never_filled(&sim, condo));
    let sold = |t: &str| t.contains("Condominium") && t.contains("sold");
    assert!(!sim.log.iter().any(|e| sold(&e.text)));
    let mut sim = lot_tower(2, GameMode::Modern, 6);
    let office = put(&mut sim, Kind::Office, 2, 0);
    sim.tick(14.0 * DAY);
    assert!(never_filled(&sim, office));
}

#[test]
fn a_well_placed_modern_condo_or_office_still_fills() {
    let mut sim = lot_tower(3, GameMode::Modern, 6);
    let condo = put(&mut sim, Kind::Condo, 2, C);
    assert!(!gated(&mut sim, condo));
    assert!(fills_within(&mut sim, condo, 400));
    let mut sim = lot_tower(4, GameMode::Modern, 6);
    let office = put(&mut sim, Kind::Office, 2, C + 12);
    assert!(!gated(&mut sim, office));
    assert!(fills_within(&mut sim, office, 2000));
}

#[test]
fn a_classic_noisy_office_still_leases_and_an_isolated_condo_is_gated_in_both_modes() {
    let mut sim = lot_tower(5, GameMode::Classic, 6);
    put(&mut sim, Kind::FastFood, 2, C - 20);
    let office = put(&mut sim, Kind::Office, 2, C);
    assert!(afflicted(&mut sim, office));
    assert!(
        !gated(&mut sim, office),
        "Classic noise caps at 0.6, over the 0.4 bar"
    );
    assert!(fills_within(&mut sim, office, 2000));
    for mode in [GameMode::Classic, GameMode::Modern] {
        let mut sim = lot_tower(6, mode, 22);
        let condo = put(&mut sim, Kind::Condo, 20, C);
        assert!(gated(&mut sim, condo), "{mode:?}: very far from any lobby");
    }
}

#[test]
fn a_spot_that_reaches_no_retail_is_gated_until_the_retail_is_reachable() {
    let mut sim = Simulation::new_game(30, GameMode::Modern);
    sim.money = 1e12;
    sim.star = 1;
    lay_row(&mut sim, Kind::Lobby, 1);
    for floor in 2..=10 {
        lay_row(&mut sim, Kind::Floor, floor);
    }
    assert!(sim.build_transport(Kind::ElevatorStandard, C, 1, 6).ok);
    assert!(sim.tower.set_cars(sim.tower.transports[0].id, 8));
    put(&mut sim, Kind::FastFood, 10, C);
    let condo = put(&mut sim, Kind::Condo, 2, C);
    assert!(sim.floor_reachable(2) && !sim.floor_reachable(10));
    assert!(gated(&mut sim, condo));
    assert!(
        sim.build_transport(Kind::ElevatorStandard, C + 20, 1, 10)
            .ok
    );
    assert!(sim.floor_reachable(10));
    assert!(!gated(&mut sim, condo));
}

#[test]
fn the_gate_reads_the_pass_demand_so_far_and_a_check_in_adds_to_it() {
    let mut sim = lot_tower(50, GameMode::Modern, 4);
    put(&mut sim, Kind::FastFood, 2, C - 30);
    let condo = put(&mut sim, Kind::Condo, 3, C);
    let u = unit(&sim, condo).clone();
    let mut ctx = sim.build_satisfaction_context(true);
    assert!(!sim.would_evict_fresh_tenant(&u, &mut ctx), "fine alone");
    let dm = ctx.demand_map.as_mut().expect("the probe filled the map");
    dm.pool += dm.total_cap * 100.0;
    assert!(
        sim.would_evict_fresh_tenant(&u, &mut ctx),
        "fills saturated the retail"
    );
    let mut sim = lot_tower(44, GameMode::Modern, 6);
    let room = put(&mut sim, Kind::HotelSingle, 2, C + 30);
    let before = compute_demand_map(&mut sim).pool;
    let u = sim.tower.get_unit_mut(room).unwrap();
    u.state = UnitState::Asleep;
    u.ever_occupied = true;
    assert!(
        compute_demand_map(&mut sim).pool > before,
        "an asleep guest is an origin"
    );
}

#[test]
fn classic_a_poor_access_office_waits_for_a_shaft_and_empties_when_it_goes() {
    let mut sim = lot_tower(31, GameMode::Classic, 6);
    let office = put(&mut sim, Kind::Office, 2, 0);
    assert!(gated(&mut sim, office));
    assert!(!fills_within(&mut sim, office, 300));
    assert!(sim.build_transport(Kind::ElevatorStandard, 0, 1, 6).ok);
    let near = sim.tower.transports[1].id;
    assert!(sim.tower.set_cars(near, 8));
    assert!(!gated(&mut sim, office));
    assert!(fills_within(&mut sim, office, 2000));
    assert!(sim.tower.remove_transport(near).is_some());
    assert!(sim.tower.is_floor_served(2));
    assert!(gated(&mut sim, office));
    let mut left = false;
    for _ in 0..4000 {
        sim.tick(60.0);
        if !unit(&sim, office).ever_occupied {
            left = true;
            break;
        }
    }
    assert!(left, "the tenant left and the gate holds the spot");
}

#[test]
fn the_gate_agrees_with_a_month_of_play() {
    type Build = fn(&mut Simulation) -> i64;
    let cases: [(&str, GameMode, i64, Build); 6] = [
        ("clean condo", GameMode::Modern, 6, |s| {
            put(s, Kind::Condo, 2, C)
        }),
        ("clean office", GameMode::Modern, 6, |s| {
            put(s, Kind::Office, 2, C + 12)
        }),
        ("noisy condo", GameMode::Modern, 6, |s| {
            put(s, Kind::Office, 2, C - 9);
            put(s, Kind::Condo, 2, C)
        }),
        ("far-walk office", GameMode::Modern, 6, |s| {
            put(s, Kind::Office, 2, 0)
        }),
        ("very-far condo", GameMode::Classic, 22, |s| {
            put(s, Kind::Condo, 20, C)
        }),
        ("noisy Classic office", GameMode::Classic, 6, |s| {
            put(s, Kind::FastFood, 2, C - 20);
            put(s, Kind::Office, 2, C)
        }),
    ];
    let (mut saw_gated, mut saw_open) = (false, false);
    for (name, mode, top, build) in cases {
        let mut sim = lot_tower(7, mode, top);
        let id = build(&mut sim);
        let gate = gated(&mut sim, id);
        saw_gated |= gate;
        saw_open |= !gate;
        seat_sold(&mut sim, id);
        sim.tick(30.0 * DAY);
        assert_eq!(never_filled(&sim, id), gate, "{name}");
    }
    assert!(saw_gated && saw_open, "cases on both sides of the gate");
}

#[test]
fn congestion_never_gates_a_spot() {
    let mut sim = lot_tower(12, GameMode::Modern, 6);
    let condo = put(&mut sim, Kind::Condo, 2, C + 30);
    let u = unit(&sim, condo).clone();
    let mut frozen = sim.build_satisfaction_context(false);
    frozen.global_cong = 2.0;
    frozen.cong_map = None;
    assert!(
        sim.would_evict_fresh_tenant(&u, &mut frozen),
        "a jam would doom it"
    );
    let gate = sim.build_satisfaction_context(true);
    assert_eq!((gate.global_cong, gate.cong_map.is_none()), (0.0, true));
    assert!(!gated(&mut sim, condo));
    assert!(fills_within(&mut sim, condo, 400));
    // The far band caps without eroding, so it does not gate either.
    let mut sim = lot_tower(15, GameMode::Modern, 12);
    let far = put(&mut sim, Kind::Condo, 9, C);
    assert!(!gated(&mut sim, far));
}

#[test]
fn the_gate_draws_no_random_numbers_and_changes_nothing() {
    let mut sim = lot_tower(13, GameMode::Modern, 6);
    put(&mut sim, Kind::Office, 2, C - 9);
    let condo = put(&mut sim, Kind::Condo, 2, C);
    let office = put(&mut sim, Kind::Office, 2, C + 30);
    sim.tick(5.0 * 60.0);
    let before = sim.serialize().to_string();
    for _ in 0..50 {
        gated(&mut sim, condo);
        gated(&mut sim, office);
        sim.diagnostic_facts(condo);
    }
    assert_eq!(sim.serialize().to_string(), before);
}
