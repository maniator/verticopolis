//! The move-in gate covers the Modern rentals: the demanding Apartment is
//! held out of a far-walk or noisy spot, the forgiving Studio leases into the
//! same far-walk spot, a good spot still fills, the Apartment carries the
//! unmet-demand drain and the Studio does not (#661), and Classic cannot
//! build a rental at all. The rentals' card lines are in
//! `rule_tests::move_in_gate_legibility`.
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::move_in_sustainability_gate::{fills_within, never_filled};
use super::{gated, lay_row, lot_tower, put, unit, MID as C};

const DAY: f64 = 24.0 * 60.0;

#[test]
fn a_far_walk_apartment_is_gated_and_a_studio_leases_into_the_same_spot() {
    let mut sim = lot_tower(21, GameMode::Modern, 6);
    let apt = put(&mut sim, Kind::RentalApartment, 2, 0);
    assert!(gated(&mut sim, apt));
    sim.tick(14.0 * DAY);
    assert!(never_filled(&sim, apt));
    let mut sim = lot_tower(22, GameMode::Modern, 6);
    let studio = put(&mut sim, Kind::RentalStudio, 2, 0);
    // The hourly step itself gives the Studio no far-walk drain.
    let u = unit(&sim, studio).clone();
    let mut ctx = sim.build_satisfaction_context(true);
    assert!(!sim.satisfaction_step(&u, 1.0, &mut ctx).far_walk);
    assert!(!gated(&mut sim, studio));
    assert!(fills_within(&mut sim, studio, 2000));
}

#[test]
fn a_noisy_apartment_is_gated_and_a_quiet_one_by_the_shaft_leases() {
    let mut sim = lot_tower(23, GameMode::Modern, 6);
    put(&mut sim, Kind::Office, 2, C - 13);
    let apt = put(&mut sim, Kind::RentalApartment, 2, C);
    let u = unit(&sim, apt).clone();
    assert!(sim.noise_afflicted(&u));
    assert!(gated(&mut sim, apt));
    sim.tick(14.0 * DAY);
    assert!(!unit(&sim, apt).ever_occupied);
    let mut sim = lot_tower(24, GameMode::Modern, 6);
    let apt = put(&mut sim, Kind::RentalApartment, 2, C + 6);
    assert!(!gated(&mut sim, apt));
    assert!(fills_within(&mut sim, apt, 3000));
}

#[test]
fn the_apartment_is_gated_on_unreachable_retail_and_the_studio_is_not() {
    let mut sim = Simulation::new_game(31, GameMode::Modern);
    sim.money = 1e12;
    sim.star = 1;
    lay_row(&mut sim, Kind::Lobby, 1);
    for floor in 2..=10 {
        lay_row(&mut sim, Kind::Floor, floor);
    }
    assert!(sim.build_transport(Kind::ElevatorStandard, C, 1, 6).ok);
    assert!(sim.tower.set_cars(sim.tower.transports[0].id, 8));
    put(&mut sim, Kind::FastFood, 10, C);
    let condo = put(&mut sim, Kind::Condo, 2, C - 20);
    let apt = put(&mut sim, Kind::RentalApartment, 2, C + 4);
    let studio = put(&mut sim, Kind::RentalStudio, 2, C + 16);
    assert!(sim.floor_reachable(2) && !sim.floor_reachable(10));
    let u = |sim: &Simulation, id| unit(sim, id).clone();
    let mut ctx = sim.build_satisfaction_context(true);
    assert!(sim.would_evict_fresh_tenant(&u(&sim, condo), &mut ctx));
    assert!(sim.would_evict_fresh_tenant(&u(&sim, apt), &mut ctx));
    assert!(!sim.would_evict_fresh_tenant(&u(&sim, studio), &mut ctx));
    // Seated, the Apartment's cause is the retail it cannot reach.
    let tenant = sim.tower.get_unit_mut(apt).unwrap();
    tenant.state = UnitState::Occupied;
    tenant.residents = Some(3);
    tenant.ever_occupied = true;
    let seated = u(&sim, apt);
    let mut step_ctx = sim.build_satisfaction_context(true);
    let step = sim.satisfaction_step(&seated, 0.5, &mut step_ctx);
    assert_eq!(sim.dominant_gripe(&seated, &step), Some("unmetDemand"));
    assert_eq!(sim.vacate_cause(&seated, &step), "unmetDemand");
}

#[test]
fn classic_cannot_build_a_rental_and_still_seats_its_tenants() {
    let mut sim = lot_tower(25, GameMode::Classic, 6);
    sim.star = 5;
    for kind in [Kind::RentalStudio, Kind::RentalApartment] {
        assert!(!sim.build(kind, 2, C).ok, "{kind:?} built in Classic");
    }
    sim.star = 1;
    let office = put(&mut sim, Kind::Office, 2, C - 20);
    sim.tick(7.0 * DAY);
    assert!(unit(&sim, office).ever_occupied);
    let rental = |k: Kind| k.is_rental();
    assert!(!sim.tower.units.iter().any(|u| rental(u.kind)));
}
