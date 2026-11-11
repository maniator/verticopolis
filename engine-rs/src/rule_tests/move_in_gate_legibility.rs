//! What the move-in gate tells the player: the card's "Won't lease" facts
//! (the cause the gate held the spot for and what holding it costs), the
//! buy-back note that says a doomed spot stays empty, and silence wherever
//! the access line owns the story. The engine supplies the cause, its
//! remedy facts and the cost; `src/ui/tenantDiagnosticCopy.ts` words them.
//! Already pinned: the cost per mode by
//! `diagnostics::tenant_tests::{wont_lease_names_the_gate_cause_and_the_carrying_cost,
//! the_carrying_cost_is_overhead_plus_a_condos_hold_tax}`; the buy-back note
//! for a congestion eviction on a doomed or clean spot, a clean relocation
//! and a No Rate condo by `churn::tests::the_buy_back_note_follows_the_gate_verdict`;
//! the stairs-only (#699) and cross-loaded (#701) congestion notes by
//! `churn::tests::the_congestion_note_names_the_binding_transport`.
use crate::clock::{CalendarKind, GameMode};
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::move_in_sustainability_gate::{fills_within, never_filled, seat_sold};
use super::{gated, lay_row, lot_tower, put, unit, MID as C};

const DAY: f64 = 24.0 * 60.0;

/// The gate's facts for an empty spot: its cause (if one) and the cost.
fn wont_lease(sim: &mut Simulation, id: i64) -> Option<(Option<&'static str>, f64)> {
    let w = sim.diagnostic_facts(id).unwrap().wont_lease?;
    Some((w.gripe.map(|g| g.cause), w.carry))
}

/// The noise remedies the card offers: (a same-floor source, a club).
fn remedies(sim: &mut Simulation, id: i64) -> (Option<bool>, Option<bool>) {
    let g = sim
        .diagnostic_facts(id)
        .unwrap()
        .wont_lease
        .unwrap()
        .gripe
        .unwrap();
    assert_eq!(g.cause, "noise");
    (g.adjacent, g.club)
}

fn occupied_club(sim: &mut Simulation, floor: i64, x: i64) {
    let id = put(sim, Kind::Nightclub, floor, x);
    sim.tower.get_unit_mut(id).unwrap().state = UnitState::Occupied;
}

#[test]
fn a_gated_noisy_condo_names_noise_and_what_holding_it_costs() {
    let mut sim = lot_tower(8, GameMode::Modern, 6);
    put(&mut sim, Kind::Office, 2, C - 9);
    let condo = put(&mut sim, Kind::Condo, 2, C);
    let (cause, carry) = wont_lease(&mut sim, condo).expect("held empty");
    assert_eq!(cause, Some("noise"));
    assert!(carry > 0.0, "the Modern overhead and hold tax");
    let mut classic = lot_tower(41, GameMode::Classic, 6);
    let office = put(&mut classic, Kind::Office, 2, 0);
    let (_, carry) = wont_lease(&mut classic, office).expect("held empty");
    assert_eq!(carry, 0.0, "Classic has neither cost");
}

#[test]
fn a_club_gated_condo_gets_the_cross_floor_remedy_and_a_doubly_noisy_one_both() {
    let mut sim = lot_tower(40, GameMode::Modern, 4);
    occupied_club(&mut sim, 2, C);
    let condo = put(&mut sim, Kind::Condo, 3, C);
    let u = unit(&sim, condo).clone();
    assert!(!sim.noise_afflicted(&u), "cross-floor only");
    assert_eq!(remedies(&mut sim, condo), (Some(false), Some(true)));
    let mut sim = lot_tower(43, GameMode::Modern, 6);
    occupied_club(&mut sim, 2, C - 40);
    put(&mut sim, Kind::FastFood, 4, C - 20);
    let condo = put(&mut sim, Kind::Condo, 4, C);
    assert_eq!(remedies(&mut sim, condo), (Some(true), Some(true)));
}

#[test]
fn a_spot_held_only_for_unmet_demand_names_the_retail() {
    let mut sim = Simulation::new_game(42, GameMode::Modern);
    sim.money = 1e12;
    sim.star = 1;
    lay_row(&mut sim, Kind::Lobby, 1);
    for floor in 2..=10 {
        lay_row(&mut sim, Kind::Floor, floor);
    }
    assert!(sim.build_transport(Kind::ElevatorStandard, C, 1, 6).ok);
    assert!(sim.tower.set_cars(sim.tower.transports[0].id, 8));
    assert!(sim.floor_reachable(2) && !sim.floor_reachable(10));
    put(&mut sim, Kind::FastFood, 10, C);
    let condo = put(&mut sim, Kind::Condo, 2, C);
    let (cause, _) = wont_lease(&mut sim, condo).expect("held empty");
    assert_eq!(
        cause,
        Some("unmetDemand"),
        "the cause, not the generic line"
    );
}

#[test]
fn a_spot_that_would_fill_or_that_nothing_reaches_has_no_wont_lease_line() {
    let mut sim = lot_tower(9, GameMode::Modern, 6);
    let condo = put(&mut sim, Kind::Condo, 2, C);
    assert_eq!(wont_lease(&mut sim, condo), None);
    let mut bare = Simulation::new_game(10, GameMode::Modern);
    bare.money = 1e12;
    lay_row(&mut bare, Kind::Lobby, 1);
    lay_row(&mut bare, Kind::Floor, 2);
    let condo = put(&mut bare, Kind::Condo, 2, C);
    assert_eq!(wont_lease(&mut bare, condo), None, "the access line speaks");
}

#[test]
fn a_doomed_condo_is_bought_back_once_says_it_stays_empty_and_never_resells() {
    let mut sim = lot_tower(14, GameMode::Modern, 6);
    put(&mut sim, Kind::Office, 2, C - 9);
    let condo = put(&mut sim, Kind::Condo, 2, C);
    seat_sold(&mut sim, condo);
    sim.tick(60.0 * DAY);
    assert!(never_filled(&sim, condo));
    let backs: Vec<_> = sim
        .log
        .iter()
        .filter(|e| e.text.contains("bought it back"))
        .collect();
    assert_eq!(backs.len(), 1, "evicted exactly once");
    assert!(backs[0]
        .text
        .contains("stays empty until you fix the cause"));
    let sold = |t: &str| t.contains("Condominium") && t.contains("sold");
    assert!(!sim.log.iter().any(|e| sold(&e.text)));
}

#[test]
fn the_buy_back_note_follows_the_gate_for_noise_and_relocation_too() {
    let note = |seed, reason, noisy: bool| {
        let mut sim = lot_tower(seed, GameMode::Modern, 6);
        if noisy {
            put(&mut sim, Kind::Office, 2, C - 9);
        }
        let condo = put(&mut sim, Kind::Condo, 2, C);
        seat_sold(&mut sim, condo);
        let i = sim.tower.units.iter().position(|u| u.id == condo).unwrap();
        sim.vacate(i, reason);
        sim.log.last().unwrap().text.clone()
    };
    const STAYS: &str = "It stays empty until you fix the cause";
    assert!(note(21, "noise", true).contains(STAYS));
    assert!(note(24, "relocation", true).contains(STAYS));
    assert!(!note(23, "relocation", false).contains(STAYS));
}

#[test]
fn a_noisy_apartment_is_held_with_its_cause_and_a_far_walk_one_defers_to_the_walk_line() {
    let mut sim = lot_tower(61, GameMode::Modern, 6);
    put(&mut sim, Kind::Office, 2, C - 13);
    let apt = put(&mut sim, Kind::RentalApartment, 2, C);
    let (cause, carry) = wont_lease(&mut sim, apt).expect("held empty");
    assert_eq!(cause, Some("noise"));
    assert!(carry > 0.0);
    let mut sim = lot_tower(62, GameMode::Modern, 6);
    let apt = put(&mut sim, Kind::RentalApartment, 2, 0);
    assert!(gated(&mut sim, apt));
    // The far walk has its own card line, so the copy prints the generic
    // gate line for this cause.
    let (cause, _) = wont_lease(&mut sim, apt).expect("held empty");
    assert_eq!(cause, Some("transportFar"));
    assert!(sim.diagnostic_facts(apt).unwrap().far_walk);
}

#[test]
fn the_studio_is_never_held_far_or_noisy_and_stays_a_month_beside_the_noise() {
    let mut sim = lot_tower(63, GameMode::Modern, 6);
    let far = put(&mut sim, Kind::RentalStudio, 2, 0);
    assert!(!gated(&mut sim, far));
    assert_eq!(wont_lease(&mut sim, far), None);
    let mut sim = lot_tower(64, GameMode::Modern, 6);
    put(&mut sim, Kind::Office, 2, C - 13);
    let studio = put(&mut sim, Kind::RentalStudio, 2, C);
    let u = unit(&sim, studio).clone();
    assert!(sim.noise_afflicted(&u));
    assert!(!gated(&mut sim, studio));
    assert_eq!(wont_lease(&mut sim, studio), None);
    assert!(fills_within(&mut sim, studio, 4000));
    sim.tick(30.0 * DAY);
    assert_eq!(
        unit(&sim, studio).state,
        UnitState::Occupied,
        "capped, never evicted"
    );
}

#[test]
fn a_unit_on_the_stranded_run_of_a_split_floor_defers_to_its_access_line() {
    let mut sim = Simulation::new_game_with(4242, GameMode::Modern, CalendarKind::RealWorld, false);
    sim.money = 5_000_000.0;
    sim.star = 1;
    for x in 0..=59 {
        put(&mut sim, Kind::Lobby, 1, x);
    }
    for x in (0..=24).chain(35..=59) {
        put(&mut sim, Kind::Floor, 2, x);
    }
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorStandard, 0, 1, 2)
            .ok
    );
    let stranded = put(&mut sim, Kind::Condo, 2, 38);
    let twin = put(&mut sim, Kind::Condo, 2, 6);
    assert!(sim.tower.is_floor_served(2) && sim.floor_reachable(2));
    assert!(!sim.position_reachable(2, 38));
    assert!(sim.position_reachable(2, 6));
    assert_eq!(wont_lease(&mut sim, stranded), None);
    sim.tick(14.0 * DAY);
    assert!(!unit(&sim, stranded).ever_occupied);
    assert!(unit(&sim, twin).ever_occupied);
}
