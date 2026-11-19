//! Epic 7's star half (#680): the Modern rentals feed the census the star
//! rating reads, so a tower that loses an Apartment floor dips below the next
//! rung and climbs once the floor re-leases, and a Studio-only tower keeps its
//! population, and so its stars, through conditions that empty Apartments.
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::star::STAR_THRESHOLDS;
use crate::tower::UnitState;

use super::{lot_tower, put, seat};

const DAY: f64 = 24.0 * 60.0;

/// Fills `floor` with `kind` from the left edge and returns the ids.
fn fill_floor(sim: &mut Simulation, kind: Kind, floor: i64) -> Vec<i64> {
    let width = kind.facility().width;
    (0..crate::facilities::LOT_WIDTH / width)
        .map(|i| put(sim, kind, floor, i * width))
        .collect()
}

/// Leases every unit to a household of `residents`.
fn lease(sim: &mut Simulation, ids: &[i64], residents: i64) {
    for &id in ids {
        seat(sim, id, UnitState::Occupied, 1.0);
        sim.tower.get_unit_mut(id).unwrap().residents = Some(residents);
    }
}

/// Empties every unit, as a lost lease leaves it.
fn lose(sim: &mut Simulation, ids: &[i64]) {
    for &id in ids {
        let u = sim.tower.get_unit_mut(id).unwrap();
        u.state = UnitState::Empty;
        u.residents = None;
    }
}

#[test]
fn a_lost_apartment_floor_dips_the_rating_and_its_re_lease_earns_the_star() {
    let mut sim = lot_tower(680, GameMode::Modern, 4);
    let floors: Vec<Vec<i64>> = (2..=4)
        .map(|f| fill_floor(&mut sim, Kind::RentalApartment, f))
        .collect();
    for ids in &floors {
        lease(&mut sim, ids, 3);
    }
    let full = sim.rating_population();
    let rung = STAR_THRESHOLDS[2];
    assert!(full >= rung, "three leased floors reach two stars: {full}");
    // The top floor's leases end before the evaluation: the census dips
    // under the rung and the tower stays at one star.
    lose(&mut sim, &floors[2]);
    let dipped = sim.rating_population();
    assert_eq!(dipped, full - 3 * floors[2].len() as i64);
    assert!(dipped < rung, "{dipped}");
    sim.evaluate_star();
    assert_eq!(sim.star, 1, "the dip holds the tower at one star");
    // The floor re-leases and the next evaluation climbs.
    lease(&mut sim, &floors[2], 3);
    assert_eq!(sim.rating_population(), full);
    sim.evaluate_star();
    assert_eq!(sim.star, 2, "the re-lease earns the second star");
    // A rating never falls: losing the floor again dips the census only.
    lose(&mut sim, &floors[2]);
    assert_eq!(sim.rating_population(), dipped);
    sim.evaluate_star();
    assert_eq!(sim.star, 2);
}

/// A tower whose only rooms are `kind` rentals on floor 2, each leased far
/// from the elevator with no shop anywhere, at two stars: the rating
/// population before and after `days` of play.
fn scrappy(kind: Kind, days: f64) -> (Simulation, i64, i64) {
    let mut sim = lot_tower(681, GameMode::Modern, 6);
    sim.star = 2;
    let width = kind.facility().width;
    let far_edge = crate::rule_tests::MID - 40;
    let ids: Vec<i64> = (0..far_edge / width)
        .map(|i| put(&mut sim, kind, 2, i * width))
        .collect();
    lease(&mut sim, &ids, kind.facility().population);
    let before = sim.rating_population();
    sim.tick(days * DAY);
    let after = sim.rating_population();
    (sim, before, after)
}

#[test]
fn a_studio_only_tower_keeps_its_census_and_stars_where_apartments_empty() {
    let (studios, before, after) = scrappy(Kind::RentalStudio, 14.0);
    assert!(before > 0);
    assert_eq!(after, before, "the forgiving Studio keeps every tenant");
    assert_eq!(studios.star, 2);
    // The same spots empty Apartments, so the conditions are scrappy.
    let (_, before, after) = scrappy(Kind::RentalApartment, 14.0);
    assert!(
        after < before,
        "Apartments leave the same spots: {before} -> {after}"
    );
}
