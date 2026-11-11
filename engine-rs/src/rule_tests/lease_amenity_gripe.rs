//! The lease amenities (fitness club, clinic) on the card and at the gate
//! (#667): a gouged amenity names its rent before any notice, a gate-held
//! empty one explains itself with the Won't-lease line, the move-in pass
//! itself refuses a max-rent amenity and leases it at the going rate, and a
//! club that leases partway through a pass lifts a noise-gated condo later
//! in that same pass. The Won't-lease line's carrying cost is pinned by
//! `diagnostics::tenant_tests::the_carrying_cost_is_overhead_plus_a_condos_hold_tax`.
use crate::clock::GameMode;
use crate::econ::rent_config;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{gated, lay_row, put, seat, unit, MID as C};

/// A Modern lobby and floor 2 with a standard elevator at the middle.
fn floor_two(seed: u32) -> Simulation {
    let mut sim = Simulation::new_game(seed, GameMode::Modern);
    sim.money = 1e9;
    sim.star = 1;
    lay_row(&mut sim, Kind::Lobby, 1);
    lay_row(&mut sim, Kind::Floor, 2);
    assert!(sim.build_transport(Kind::ElevatorStandard, C, 1, 2).ok);
    sim
}

fn max_rent(kind: Kind) -> Option<f64> {
    Some(rent_config(kind).unwrap().max)
}

#[test]
fn a_gouged_fitness_club_names_its_rent_before_any_notice() {
    let mut sim = floor_two(1);
    let club = put(&mut sim, Kind::FitnessClub, 2, C + 4);
    seat(&mut sim, club, UnitState::Occupied, 0.5);
    sim.tower.get_unit_mut(club).unwrap().rent = max_rent(Kind::FitnessClub);
    let g = sim
        .diagnostic_facts(club)
        .unwrap()
        .gripe
        .expect("a Main gripe");
    assert_eq!(g.cause, "rent");
}

#[test]
fn a_gate_held_clinic_explains_itself_with_its_rent() {
    let mut sim = floor_two(1);
    let clinic = put(&mut sim, Kind::Clinic, 2, C + 4);
    sim.tower.get_unit_mut(clinic).unwrap().rent = max_rent(Kind::Clinic);
    let w = sim
        .diagnostic_facts(clinic)
        .unwrap()
        .wont_lease
        .expect("held empty");
    assert_eq!(w.gripe.map(|g| g.cause), Some("rent"));
}

#[test]
fn the_move_in_pass_refuses_a_max_rent_clinic_and_leases_it_at_the_going_rate() {
    let mut sim = floor_two(1);
    let clinic = put(&mut sim, Kind::Clinic, 2, C + 4);
    seat(&mut sim, clinic, UnitState::Empty, 1.0);
    sim.tower.get_unit_mut(clinic).unwrap().rent = max_rent(Kind::Clinic);
    for _ in 0..60 {
        sim.attempt_move_ins();
    }
    assert_eq!(
        unit(&sim, clinic).state,
        UnitState::Empty,
        "gated every pass"
    );
    sim.tower.get_unit_mut(clinic).unwrap().rent = Some(rent_config(Kind::Clinic).unwrap().default);
    let leased = (0..400).any(|_| {
        sim.attempt_move_ins();
        unit(&sim, clinic).state != UnitState::Empty
    });
    assert!(leased, "the going rate fills");
    // Relisted and gouged again, the spot is held just like a fresh one.
    let u = sim.tower.get_unit_mut(clinic).unwrap();
    u.state = UnitState::Empty;
    u.ever_occupied = false;
    u.occupants = 0;
    u.rent = max_rent(Kind::Clinic);
    for _ in 0..60 {
        sim.attempt_move_ins();
    }
    assert_eq!(unit(&sim, clinic).state, UnitState::Empty);
}

#[test]
fn a_club_leasing_mid_pass_lifts_a_noise_gated_condo_in_the_same_pass() {
    // The club comes before the condo in the pass, and the pass reads the
    // club's halo from a context built while it stood empty. Its floor must
    // join that context as it leases, or the condo stays gated this pass.
    // Rolls are seeded, so the check runs over seeds: the condo never leases
    // in a pass where the club did not, and does in some pass where it did.
    let mut lifted = 0;
    for seed in 1..=200 {
        let mut sim = floor_two(seed);
        put(&mut sim, Kind::FastFood, 2, C - 20);
        let club = put(&mut sim, Kind::FitnessClub, 2, C + 20);
        let condo = put(&mut sim, Kind::Condo, 2, C);
        let u = unit(&sim, condo).clone();
        assert!(sim.noise_afflicted(&u));
        assert!(
            gated(&mut sim, condo),
            "seed {seed}: gated with the club empty"
        );
        sim.attempt_move_ins();
        let club_leased = unit(&sim, club).state == UnitState::Occupied;
        let condo_leased = unit(&sim, condo).state != UnitState::Empty;
        assert!(
            club_leased || !condo_leased,
            "seed {seed}: leased past the gate"
        );
        if club_leased && condo_leased {
            lifted += 1;
        }
    }
    assert!(
        lifted > 0,
        "no pass lifted the condo with the club it had just leased"
    );
}
