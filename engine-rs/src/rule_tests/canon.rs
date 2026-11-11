//! The 1994 star ladder, from the retired TypeScript half of
//! `canon.integration.test.ts`: the population thresholds for stars 2 to 5
//! and the 15,000 occupants of the TOWER rating. The catalog carries neither,
//! so the TypeScript tripwire keeps the catalog's canon (pools, cars, spans,
//! car capacities, the lot, tenant populations, starting money, subtypes) and
//! this file holds the ladder. Walkway willingness is
//! `crowd::graph::tests::{the_classic_walk_budget_bounds_the_reach,
//! a_walk_keeps_the_lowest_budget_it_has_met}`.
use crate::star::{STAR_THRESHOLDS, TOWER_POPULATION};

/// The population each star from 2 to 5 needs, in the 1994 ladder.
const CANON_LADDER: [(usize, i64); 4] = [(2, 300), (3, 1000), (4, 5000), (5, 10000)];
/// The occupants the TOWER rating (level 6) needs.
const CANON_TOWER: i64 = 15000;

#[test]
fn the_star_ladder_is_the_1994_ladder() {
    for (star, population) in CANON_LADDER {
        assert_eq!(STAR_THRESHOLDS[star], population, "star {star}");
    }
    assert_eq!(TOWER_POPULATION, CANON_TOWER);
}
