//! The "Main gripe": `dominant_gripe` names an unhappy tenant's worst drain
//! before any notice, on the same ladder `vacate_cause` reads (which adds
//! only the "access" catch-all), so the two never disagree. The card gets
//! the cause and its facts; `src/ui/tenantDiagnosticCopy.ts` words them and
//! leaves access, the long walk and lobby distance to their own lines.
//! Already pinned: an office's rent gripe, silence for a content or leaving
//! tenant, and a noise gripe's sources by
//! `diagnostics::tenant_tests::{main_gripe_names_rent_and_stays_off_for_content_or_leaving_tenants,
//! a_noise_gripe_carries_its_sources}`; the long-walk flag for offices and
//! the Apartment by `the_long_walk_is_flagged_for_offices_and_apartments_only`;
//! the access states by `access_reads_each_connection_state`; an unserved
//! office printing no Main gripe by the card-text sweep's
//! "service rooms, unhappy" case (`cardTextParity.integration.test.ts`).
use std::collections::HashMap;

use crate::clock::GameMode;
use crate::demand::{unmet_coverage, DemandMap};
use crate::facilities::{Kind, LOT_WIDTH as W};
use crate::rules::UNMET_DEMAND_FLOOR;
use crate::satisfaction::StepResult;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{calm, lay_row, put, seat, unit, MID as C};

/// A lobby and floor 2 with a standard elevator at the middle.
fn floor_two(mode: GameMode, served: bool) -> Simulation {
    let mut sim = Simulation::new_game(1, mode);
    sim.money = 1e9;
    sim.star = 1;
    lay_row(&mut sim, Kind::Lobby, 1);
    lay_row(&mut sim, Kind::Floor, 2);
    if served {
        assert!(sim.build_transport(Kind::ElevatorStandard, C, 1, 2).ok);
    }
    sim
}

/// `kind` at `x` on floor `floor`, occupied at `satisfaction`.
fn tenant(sim: &mut Simulation, kind: Kind, floor: i64, x: i64, satisfaction: f64) -> i64 {
    let id = put(sim, kind, floor, x);
    seat(sim, id, UnitState::Occupied, satisfaction);
    id
}

fn cause(sim: &mut Simulation, id: i64) -> Option<&'static str> {
    sim.diagnostic_facts(id).unwrap().gripe.map(|g| g.cause)
}

#[test]
fn the_ladder_reads_nothing_access_rent_then_congestion_above_rent() {
    let mut sim = floor_two(GameMode::Classic, true);
    let office = tenant(&mut sim, Kind::Office, 2, C - 12, 1.0);
    let u = unit(&sim, office).clone();
    assert_eq!(sim.dominant_gripe(&u, &calm()), None);
    assert_eq!(sim.vacate_cause(&u, &calm()), "access", "the catch-all");
    let unserved = StepResult {
        served: false,
        ..calm()
    };
    let mut bare = floor_two(GameMode::Classic, false);
    let lone = tenant(&mut bare, Kind::Office, 2, C, 1.0);
    let lone = unit(&bare, lone).clone();
    assert!(!bare.tower.is_floor_served(2));
    assert_eq!(bare.dominant_gripe(&lone, &unserved), Some("access"));
    let mut gouged = u.clone();
    gouged.rent = Some(20_000.0);
    assert_eq!(sim.dominant_gripe(&gouged, &calm()), Some("rent"));
    assert_eq!(sim.vacate_cause(&gouged, &calm()), "rent");
    let crowded = StepResult {
        cong: 2.0,
        ..calm()
    };
    assert_eq!(sim.dominant_gripe(&gouged, &crowded), Some("congestion"));
    assert_eq!(sim.vacate_cause(&gouged, &crowded), "congestion");
}

#[test]
fn a_condo_beside_an_office_gripes_about_noise() {
    let mut sim = floor_two(GameMode::Classic, true);
    put(&mut sim, Kind::Office, 2, C - 12);
    let condo = tenant(&mut sim, Kind::Condo, 2, C + 4, 0.5);
    let u = unit(&sim, condo).clone();
    assert!(sim.noise_afflicted(&u));
    assert_eq!(cause(&mut sim, condo), Some("noise"));
}

#[test]
fn both_rentals_name_their_rent_before_the_notice() {
    for kind in [Kind::RentalApartment, Kind::RentalStudio] {
        let mut sim = floor_two(GameMode::Modern, true);
        let id = tenant(&mut sim, kind, 2, C + 6, 0.5);
        sim.tower.get_unit_mut(id).unwrap().rent = Some(20_000.0);
        assert_eq!(cause(&mut sim, id), Some("rent"), "{kind:?}");
    }
}

#[test]
fn a_far_walk_is_its_own_line_and_only_the_apartment_feels_it() {
    let mut sim = floor_two(GameMode::Classic, true);
    let office = tenant(&mut sim, Kind::Office, 2, W - 12, 0.5);
    let facts = sim.diagnostic_facts(office).unwrap();
    assert!(facts.far_walk, "the dedicated long-walk line");
    // The cause the copy leaves unprinted, so the card does not say it twice.
    assert_eq!(facts.gripe.map(|g| g.cause), Some("transportFar"));
    let mut sim = floor_two(GameMode::Modern, true);
    let apt = tenant(&mut sim, Kind::RentalApartment, 2, W - 12, 0.5);
    let studio = tenant(&mut sim, Kind::RentalStudio, 2, W - 20, 0.5);
    assert!(sim.diagnostic_facts(apt).unwrap().far_walk);
    assert!(!sim.diagnostic_facts(studio).unwrap().far_walk);
}

#[test]
fn the_apartment_and_a_condo_take_an_unmet_demand_flag_and_the_studio_does_not() {
    let mut sim = floor_two(GameMode::Modern, true);
    let apt = tenant(&mut sim, Kind::RentalApartment, 2, C + 20, 1.0);
    let studio = tenant(&mut sim, Kind::RentalStudio, 2, C + 40, 1.0);
    let condo = tenant(&mut sim, Kind::Condo, 2, C + 60, 1.0);
    let unmet = StepResult {
        unmet_demand: true,
        ..calm()
    };
    let gripe = |sim: &Simulation, id| sim.dominant_gripe(unit(sim, id), &unmet);
    assert_eq!(gripe(&sim, apt), Some("unmetDemand"));
    assert_ne!(gripe(&sim, studio), Some("unmetDemand"));
    assert_eq!(gripe(&sim, condo), Some("unmetDemand"));
}

#[test]
fn a_unit_on_a_stranded_run_gets_neither_the_walk_nor_the_lobby_line() {
    let mut sim = Simulation::new_game(1, GameMode::Modern);
    sim.money = 1e12;
    lay_row(&mut sim, Kind::Lobby, 1);
    for floor in 2..=12 {
        for x in (0..=99).chain(200..=299) {
            put(&mut sim, Kind::Floor, floor, x);
        }
    }
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorStandard, 2, 1, 12)
            .ok
    );
    let stranded = tenant(&mut sim, Kind::RentalApartment, 12, 250, 1.0);
    let u = unit(&sim, stranded).clone();
    assert!(sim.tower.is_floor_served(12));
    assert!(!sim.position_reachable(12, u.x));
    assert!(sim.tower.nearest_transport_distance(&u).unwrap() > 79);
    let drain = sim
        .mode
        .lobby_distance_drain(sim.tower.nearest_lobby_floor_distance(12));
    assert!(drain.cap < 1.0, "the lobby drain band is live up here");
    let facts = sim.diagnostic_facts(stranded).unwrap();
    assert!(!facts.far_walk);
    assert_eq!(facts.lobby, None);
}

#[test]
fn the_apartment_gets_the_lobby_line_and_the_studio_never() {
    let mut sim = Simulation::new_game(1, GameMode::Modern);
    sim.money = 1e12;
    lay_row(&mut sim, Kind::Lobby, 1);
    for floor in 2..=12 {
        lay_row(&mut sim, Kind::Floor, floor);
    }
    assert!(sim.build_transport(Kind::ElevatorStandard, C, 1, 12).ok);
    let apt = tenant(&mut sim, Kind::RentalApartment, 12, C - 12, 1.0);
    let studio = tenant(&mut sim, Kind::RentalStudio, 12, C - 20, 1.0);
    assert!(sim.diagnostic_facts(apt).unwrap().lobby.is_some());
    assert_eq!(sim.diagnostic_facts(studio).unwrap().lobby, None);
}

#[test]
fn an_oversubscribed_venue_reads_a_shortfall_and_a_stranded_one_a_broken_connection() {
    // A floor of offices sharing one fast food venue, every office near a
    // shaft: the pool dwarfs the venue, so coverage sits under the floor.
    let mut sim = Simulation::new_game(1, GameMode::Modern);
    sim.money = 1e9;
    sim.star = 1;
    lay_row(&mut sim, Kind::Lobby, 1);
    lay_row(&mut sim, Kind::Floor, 2);
    for x in (10..W - 10).step_by(40) {
        assert!(sim.build_transport(Kind::ElevatorStandard, x, 1, 2).ok);
    }
    let food = put(&mut sim, Kind::FastFood, 2, W - 30);
    sim.tower.get_unit_mut(food).unwrap().state = UnitState::Occupied;
    let mut sample = None;
    for x in (14..=W - 49).step_by(11) {
        let Some(id) = sim.tower.place(Kind::Office, 2, x).unit_id else {
            continue;
        };
        sim.tower.get_unit_mut(id).unwrap().state = UnitState::Occupied;
        if sample.is_none() && x < W - 120 {
            sample = Some(id);
        }
    }
    let sample = sample.expect("a sample office");
    sim.tower.get_unit_mut(sample).unwrap().satisfaction = 0.5;
    let g = sim.diagnostic_facts(sample).unwrap().gripe.unwrap();
    assert_eq!(g.cause, "unmetDemand");
    let cov = g.coverage.unwrap();
    assert!(cov > 0.0 && cov < UNMET_DEMAND_FLOOR, "{cov}");
    // The venue moved to an unserved floor: built, but no one reaches it.
    let mut sim = floor_two(GameMode::Classic, true);
    let office = tenant(&mut sim, Kind::Office, 2, C - 12, 0.5);
    lay_row(&mut sim, Kind::Floor, 3);
    let food = put(&mut sim, Kind::FastFood, 3, C + 40);
    sim.tower.get_unit_mut(food).unwrap().state = UnitState::Occupied;
    assert!(!sim.tower.is_floor_served(3));
    let g = sim.diagnostic_facts(office).unwrap().gripe.unwrap();
    assert_eq!(
        (g.cause, g.coverage, g.floor_reachable),
        ("unmetDemand", Some(0.0), Some(true))
    );
}

#[test]
fn coverage_0_from_the_tenants_own_far_floor_reads_its_floor_unreachable() {
    // The retail is connected; the tenant's floor is served but only by a
    // ten-flight Classic stair climb, so the access line owns the story and
    // the copy prints no retail gripe for `floor_reachable: false`.
    let mut sim = Simulation::new_game(21, GameMode::Classic);
    sim.money = 1e9;
    sim.star = 5;
    let (x0, x1) = (C - 15, C + 45);
    for floor in 1..=40 {
        let kind = if floor == 1 { Kind::Lobby } else { Kind::Floor };
        for x in x0..=x1 {
            put(&mut sim, kind, floor, x);
        }
    }
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorStandard, C, 1, 30)
            .ok
    );
    for floor in 30..40 {
        assert!(
            sim.tower
                .place_transport(Kind::Stairs, C + 20, floor, floor + 1)
                .ok
        );
    }
    let near = tenant(&mut sim, Kind::Office, 2, x0, 1.0);
    tenant(&mut sim, Kind::FastFood, 2, C + 30, 1.0);
    let far = tenant(&mut sim, Kind::Office, 40, C + 30, 1.0);
    assert!(sim.tower.is_floor_served(40));
    assert!(!sim.floor_reachable(40));
    let facts = |sim: &mut Simulation, id| {
        let u = unit(sim, id).clone();
        let cov = sim.inspector_coverage(&u);
        let reachable = sim.floor_reachable(u.floor);
        (cov, reachable)
    };
    assert_eq!(facts(&mut sim, far), (Some(0.0), false));
    let (cov, reachable) = facts(&mut sim, near);
    assert!(
        cov.unwrap() > 0.0 && reachable,
        "the near office reads its shortfall"
    );
}

/// A demand map with `share`, `reachable` venues counted for unit 1 (or
/// none when it is not an origin), and `built` retail venues in the tower.
fn demand(share: f64, reachable: Option<i64>, built: i64) -> DemandMap {
    DemandMap {
        fraction_by_unit: HashMap::new(),
        delivered_by_unit: HashMap::new(),
        reachable_venues_by_origin: reachable.map(|n| (1, n)).into_iter().collect(),
        share,
        retail_venue_count: built,
        pool: share,
        total_cap: 1.0,
        attendance_cap: 0.0,
        bonus: 1.0,
    }
}

#[test]
fn coverage_exempts_non_origins_and_retail_free_towers_and_reads_the_shortfall() {
    let mut sim = Simulation::new_game(1, GameMode::Classic);
    let tile = put(&mut sim, Kind::Lobby, 1, C);
    let mut u = unit(&sim, tile).clone();
    u.id = 1;
    let cov = |dm: DemandMap| unmet_coverage(&dm, &u);
    assert_eq!(cov(demand(2.0, None, 1)), None, "not an origin this tick");
    assert_eq!(cov(demand(0.0, Some(0), 0)), None, "no retail built at all");
    assert_eq!(
        cov(demand(1.5, Some(0), 1)),
        Some(0.0),
        "built but out of reach"
    );
    assert_eq!(
        cov(demand(0.0, Some(0), 1)),
        Some(0.0),
        "an empty pool is no exemption"
    );
    assert_eq!(cov(demand(0.4, Some(2), 1)), Some(1.0), "capped at full");
    assert_eq!(cov(demand(1.0, Some(2), 1)), Some(1.0));
    assert_eq!(cov(demand(2.0, Some(3), 1)), Some(0.5), "1 / share");
    assert_eq!(cov(demand(4.0, Some(3), 1)), Some(0.25));
}
