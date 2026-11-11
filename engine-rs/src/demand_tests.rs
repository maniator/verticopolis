//! Coverage for the unmet-demand drain (#705): attendance venues count as
//! amenities in Modern and not in Classic, and never join the income share.

use super::*;
use crate::clock::GameMode;

/// A tower with a lobby, an elevator to floor 4, one shop, `cinemas` cinemas
/// and a row of offices, every room open and tenanted.
fn tower(mode: GameMode, cinemas: i64) -> Simulation {
    let mut sim = Simulation::new_game(11, mode);
    sim.money = 1e12;
    sim.star = 5;
    for x in 100..300 {
        assert!(sim.build(Kind::Lobby, 1, x).ok);
    }
    for floor in 2..=4 {
        for x in 100..300 {
            assert!(sim.build(Kind::Floor, floor, x).ok);
        }
    }
    assert!(sim.build_transport(Kind::ElevatorStandard, 100, 1, 4).ok);
    assert!(sim.build(Kind::Shop, 2, 110).ok);
    let mut x = 130;
    for _ in 0..cinemas {
        assert!(sim.build(Kind::Cinema, 2, x).ok, "cinema at {x}");
        x += Kind::Cinema.facility().width;
    }
    let mut x = 110;
    while x + Kind::Office.facility().width <= 300 {
        assert!(sim.build(Kind::Office, 4, x).ok, "office at {x}");
        x += Kind::Office.facility().width;
    }
    for u in sim.tower.units.iter_mut() {
        if u.kind.facility().population > 0 || u.kind.attendance_cap().is_some() {
            u.state = UnitState::Occupied;
        }
    }
    sim
}

fn coverages(sim: &mut Simulation) -> (DemandMap, Vec<f64>) {
    let dm = compute_demand_map(sim);
    let offices: Vec<f64> = sim
        .tower
        .units
        .iter()
        .filter(|u| u.kind == Kind::Office)
        .map(|u| unmet_coverage(&dm, u).expect("an office is a demand origin"))
        .collect();
    (dm, offices)
}

#[test]
fn modern_counts_cinema_seats_toward_coverage_but_not_toward_the_share() {
    let (bare, bare_cov) = coverages(&mut tower(GameMode::Modern, 0));
    let (dm, cov) = coverages(&mut tower(GameMode::Modern, 3));
    assert!(dm.attendance_cap > 0.0, "the cinemas are counted");
    // The income share reads retail only, so the shop earns what it did.
    assert_eq!(dm.share, bare.share);
    assert_eq!(dm.total_cap, bare.total_cap);
    assert_eq!(dm.retail_venue_count, 1);
    for (with, without) in cov.iter().zip(&bare_cov) {
        assert!(with > without, "coverage rises: {with} against {without}");
        assert!(*with <= 1.0);
    }
    let expected = ((dm.total_cap + dm.attendance_cap) / dm.pool).min(1.0);
    assert!(
        (cov[0] - expected).abs() < 1e-12,
        "{} against {expected}",
        cov[0]
    );
}

#[test]
fn the_move_in_probe_judges_attendance_against_its_extra_demand() {
    let mut sim = tower(GameMode::Modern, 3);
    let mut dm = compute_demand_map(&mut sim);
    let office = sim
        .tower
        .units
        .iter()
        .find(|u| u.kind == Kind::Office)
        .unwrap()
        .clone();
    // `would_evict_fresh_tenant` adds the probed tenant's demand to the
    // share only, leaving `pool` as it was.
    let extra = dm.pool * 0.5;
    dm.share = (dm.pool + extra) / dm.total_cap;
    let expected = ((dm.total_cap + dm.attendance_cap) / (dm.pool + extra)).min(1.0);
    let got = unmet_coverage(&dm, &office).unwrap();
    assert!((got - expected).abs() < 1e-12, "{got} against {expected}");
}

#[test]
fn classic_keeps_reading_commerce_only() {
    let (bare, bare_cov) = coverages(&mut tower(GameMode::Classic, 0));
    let (dm, cov) = coverages(&mut tower(GameMode::Classic, 3));
    assert_eq!(dm.attendance_cap, 0.0);
    assert_eq!(dm.share, bare.share);
    assert_eq!(cov, bare_cov);
    assert_eq!(cov[0], (1.0 / dm.share).min(1.0));
}

#[test]
fn a_cinema_under_construction_or_out_of_reach_covers_nobody() {
    let mut sim = tower(GameMode::Modern, 1);
    for u in sim
        .tower
        .units
        .iter_mut()
        .filter(|u| u.kind == Kind::Cinema)
    {
        u.state = UnitState::Construction;
    }
    assert_eq!(compute_demand_map(&mut sim).attendance_cap, 0.0);

    let mut sim = tower(GameMode::Modern, 1);
    let shaft = sim
        .tower
        .transports
        .iter()
        .position(|t| t.kind == Kind::ElevatorStandard)
        .expect("the shaft");
    sim.tower.transports.remove(shaft);
    let dm = compute_demand_map(&mut sim);
    assert_eq!(dm.attendance_cap, 0.0, "nothing on floor 2 is reachable");
}

#[test]
fn a_tower_with_no_shop_stays_exempt_whatever_it_runs() {
    let mut sim = tower(GameMode::Modern, 2);
    let shop = sim
        .tower
        .units
        .iter()
        .position(|u| u.kind == Kind::Shop)
        .unwrap();
    sim.tower.units.remove(shop);
    let dm = compute_demand_map(&mut sim);
    let office = sim
        .tower
        .units
        .iter()
        .find(|u| u.kind == Kind::Office)
        .unwrap();
    assert_eq!(dm.retail_venue_count, 0);
    assert_eq!(unmet_coverage(&dm, office), None);
}
