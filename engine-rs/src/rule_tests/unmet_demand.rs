//! Unmet local demand (#395): a served office, condo, guest room or
//! Apartment whose reachable shops cannot cover the tower's demand is capped
//! (Classic) or worn down (Modern), a tower with no retail at all is exempt,
//! and where unmet demand is the steeper drain it outranks noise (#548),
//! the nightclub halo included. The coverage arithmetic is in
//! `rule_tests::dominant_gripe`; cinema seats toward coverage in
//! `demand_tests`.
use crate::clock::GameMode;
use crate::demand::{compute_demand_map, unmet_coverage};
use crate::facilities::{Kind, LOT_WIDTH as W};
use crate::load::deserialize;
use crate::rules::{UNMET_DEMAND_CAP, UNMET_DEMAND_FLOOR};
use crate::satisfaction::{vacate_reason_text, StepResult};
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{calm, lay_row, put, seat, unit, MID as C};

fn coverage(sim: &mut Simulation, id: i64) -> Option<f64> {
    let u = unit(sim, id).clone();
    unmet_coverage(&compute_demand_map(sim), &u)
}

fn hours(sim: &mut Simulation, n: usize) {
    for _ in 0..n {
        sim.tick(60.0);
    }
}

/// Floors 2..=top of occupied offices with an elevator every 40 tiles (no
/// congestion, no far walk), and with `food` one fast food venue on floor 2
/// that their demand dwarfs. Returns the first office.
fn dense_offices(mode: GameMode, food: bool, top: i64) -> (Simulation, i64) {
    let mut sim = Simulation::new_game(30, mode);
    sim.money = 1e12;
    sim.star = 1;
    lay_row(&mut sim, Kind::Lobby, 1);
    for floor in 2..=top {
        lay_row(&mut sim, Kind::Floor, floor);
    }
    for x in (10..W - 10).step_by(40) {
        assert!(sim.build_transport(Kind::ElevatorStandard, x, 1, top).ok);
    }
    if food {
        let v = put(&mut sim, Kind::FastFood, 2, W - 30);
        sim.tower.get_unit_mut(v).unwrap().state = UnitState::Occupied;
    }
    let mut first = None;
    for floor in 2..=top {
        for x in (14..=W - 49).step_by(11) {
            let Some(id) = sim.tower.place(Kind::Office, floor, x).unit_id else {
                continue;
            };
            seat(&mut sim, id, UnitState::Occupied, 1.0);
            first.get_or_insert(id);
        }
    }
    (sim, first.expect("an office"))
}

#[test]
fn classic_caps_an_under_served_office_without_evicting_it() {
    let (mut sim, office) = dense_offices(GameMode::Classic, true, 4);
    let cov = coverage(&mut sim, office).unwrap();
    assert!(cov < UNMET_DEMAND_FLOOR, "under-served: {cov}");
    hours(&mut sim, 40);
    let u = unit(&sim, office).clone();
    assert!(u.satisfaction <= UNMET_DEMAND_CAP + 1e-9);
    assert!(u.satisfaction > 0.0, "capped, not worn away");
    assert_eq!(u.state, UnitState::Occupied);
    let g = sim.diagnostic_facts(office).unwrap().gripe.unwrap();
    assert_eq!(g.cause, "unmetDemand");
    // Classic's cap does not erode, so it never outranks a noise drain.
    let noisy = StepResult {
        noisy: true,
        unmet_demand: true,
        unmet_cov: Some(cov),
        ..calm()
    };
    assert_eq!(sim.dominant_gripe(&u, &noisy), Some("noise"));
}

#[test]
fn a_tower_with_no_retail_is_exempt() {
    let (mut sim, office) = dense_offices(GameMode::Modern, false, 3);
    assert_eq!(coverage(&mut sim, office), None);
    hours(&mut sim, 20);
    assert!(unit(&sim, office).satisfaction > 0.9);
    assert_eq!(unit(&sim, office).state, UnitState::Occupied);
}

/// A 61-tile Modern strip to floor 40: an elevator 1..30 and another 35..40
/// leave floor 40 an island; the only retail stands there.
fn island_retail(seed: u32) -> Simulation {
    let mut sim = Simulation::new_game(seed, GameMode::Modern);
    sim.money = 1e12;
    sim.star = 1;
    for floor in 1..=40 {
        let kind = if floor == 1 { Kind::Lobby } else { Kind::Floor };
        for x in C - 15..=C + 45 {
            put(&mut sim, kind, floor, x);
        }
    }
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorStandard, C, 1, 30)
            .ok
    );
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorStandard, C + 12, 35, 40)
            .ok
    );
    let food = put(&mut sim, Kind::FastFood, 40, C + 30);
    sim.tower.get_unit_mut(food).unwrap().state = UnitState::Occupied;
    assert!(!sim.floor_reachable(40));
    sim
}

#[test]
fn a_reachable_tenant_whose_retail_is_all_on_an_island_gripes_about_it() {
    let mut sim = island_retail(21);
    let tenant = put(&mut sim, Kind::Office, 2, C - 15);
    seat(&mut sim, tenant, UnitState::Occupied, 0.5);
    put(&mut sim, Kind::Office, 2, C + 18);
    assert!(sim.floor_reachable(2));
    assert_eq!(coverage(&mut sim, tenant), Some(0.0));
    let g = sim.diagnostic_facts(tenant).unwrap().gripe.unwrap();
    assert_eq!((g.cause, g.floor_reachable), ("unmetDemand", Some(true)));
}

#[test]
fn unmet_demand_outranks_noise_while_steeper_and_noise_returns_once_covered() {
    let mut sim = island_retail(22);
    let tenant = put(&mut sim, Kind::Office, 2, C - 15);
    seat(&mut sim, tenant, UnitState::Occupied, 0.5);
    let cinema = put(&mut sim, Kind::Cinema, 2, C - 6);
    sim.tower.get_unit_mut(cinema).unwrap().state = UnitState::Occupied;
    let u = unit(&sim, tenant).clone();
    assert!(sim.noise_afflicted(&u));
    assert_eq!(coverage(&mut sim, tenant), Some(0.0));
    let cause = |sim: &mut Simulation| sim.diagnostic_facts(tenant).unwrap().gripe.unwrap().cause;
    assert_eq!(cause(&mut sim), "unmetDemand");
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorStandard, C + 24, 30, 35)
            .ok
    );
    assert!(sim.floor_reachable(40));
    assert_eq!(coverage(&mut sim, tenant), Some(1.0));
    assert_eq!(cause(&mut sim), "noise");
}

#[test]
fn the_wont_lease_line_names_the_retail_shortage_on_an_empty_noisy_spot() {
    let mut sim = island_retail(23);
    let neighbor = put(&mut sim, Kind::Office, 3, C - 15);
    sim.tower.get_unit_mut(neighbor).unwrap().state = UnitState::Occupied;
    let spot = put(&mut sim, Kind::Office, 2, C - 15);
    let cinema = put(&mut sim, Kind::Cinema, 2, C - 6);
    sim.tower.get_unit_mut(cinema).unwrap().state = UnitState::Occupied;
    let u = unit(&sim, spot).clone();
    assert!(sim.noise_afflicted(&u));
    let w = sim
        .diagnostic_facts(spot)
        .unwrap()
        .wont_lease
        .expect("held empty");
    assert_eq!(w.gripe.map(|g| g.cause), Some("unmetDemand"));
}

#[test]
fn the_nightclub_halo_also_yields_to_a_steeper_unmet_drain() {
    let mut sim = Simulation::new_game(24, GameMode::Modern);
    sim.money = 1e12;
    sim.star = 1;
    lay_row(&mut sim, Kind::Lobby, 1);
    for floor in 2..=4 {
        lay_row(&mut sim, Kind::Floor, floor);
    }
    assert!(sim.build_transport(Kind::ElevatorStandard, C, 1, 4).ok);
    let condo = put(&mut sim, Kind::Condo, 2, C + 12);
    seat(&mut sim, condo, UnitState::Occupied, 1.0);
    sim.tower.get_unit_mut(condo).unwrap().residents = Some(3);
    let club = put(&mut sim, Kind::Nightclub, 3, C + 12);
    sim.tower.get_unit_mut(club).unwrap().state = UnitState::Occupied;
    let u = unit(&sim, condo).clone();
    assert!(!sim.noise_afflicted(&u), "the halo alone");
    let with = |unmet_demand, cov| StepResult {
        unmet_demand,
        unmet_cov: Some(cov),
        ..calm()
    };
    assert_eq!(
        sim.dominant_gripe(&u, &with(true, 0.0)),
        Some("unmetDemand")
    );
    assert_eq!(sim.dominant_gripe(&u, &with(true, 0.34)), Some("noise"));
    assert_eq!(sim.dominant_gripe(&u, &with(false, 1.0)), Some("noise"));
}

#[test]
fn an_oversubscribed_tower_sheds_tenants_for_unmet_demand_then_settles() {
    let mut sim = Simulation::new_game(30, GameMode::Modern);
    sim.money = 1e12;
    sim.star = 1;
    lay_row(&mut sim, Kind::Lobby, 1);
    for floor in 2..=7 {
        lay_row(&mut sim, Kind::Floor, floor);
    }
    for x in (10..W - 10).step_by(40) {
        assert!(sim.build_transport(Kind::ElevatorStandard, x, 1, 7).ok);
    }
    let food = put(&mut sim, Kind::FastFood, 2, W - 30);
    sim.tower.get_unit_mut(food).unwrap().state = UnitState::Occupied;
    for x in [14, 32, 50] {
        let condo = put(&mut sim, Kind::Condo, 2, x);
        seat(&mut sim, condo, UnitState::Occupied, 1.0);
        let u = sim.tower.get_unit_mut(condo).unwrap();
        u.residents = Some(3);
    }
    for floor in 3..=7 {
        for x in (14..=W - 49).step_by(11) {
            let placed = sim.tower.place(Kind::Office, floor, x);
            assert!(placed.ok, "{:?}", placed.reason);
            let id = placed.unit_id.unwrap();
            seat(&mut sim, id, UnitState::Occupied, 1.0);
        }
    }
    let dm = compute_demand_map(&mut sim);
    assert!(dm.share > 10.0, "deep in the shed region: {}", dm.share);
    let office0 = sim
        .tower
        .units
        .iter()
        .find(|u| u.kind == Kind::Office)
        .unwrap()
        .clone();
    let start = unmet_coverage(&dm, &office0).unwrap();
    let mut sim = deserialize(&sim.serialize()).unwrap();
    hours(&mut sim, 5 * 24);
    let left: Vec<&str> = sim
        .log
        .iter()
        .map(|e| e.text.as_str())
        .filter(|t| t.starts_with("A tenant left ") || t.starts_with("The owner left "))
        .collect();
    assert!(left.len() > 20, "{} departures", left.len());
    let blamed = vacate_reason_text("unmetDemand");
    assert!(
        left.iter().all(|t| t.contains(blamed)),
        "every departure blames unmet demand"
    );
    assert!(sim
        .log
        .iter()
        .any(|e| e.text.contains("You bought it back for $")));
    let staying: Vec<_> = sim
        .tower
        .units
        .iter()
        .filter(|u| u.kind == Kind::Office && u.state == UnitState::Occupied)
        .cloned()
        .collect();
    assert!(staying.len() > 10, "the shed self-limits");
    let end = unmet_coverage(&compute_demand_map(&mut sim), &staying[0]).unwrap();
    assert!(
        end > start,
        "coverage recovers as the tower sheds: {start} to {end}"
    );
}
