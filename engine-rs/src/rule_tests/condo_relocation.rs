//! The monthly chance that a sold condo's household relocates: Classic
//! condos never relocate, and a Modern household's chance scales with its
//! size around the three-person mean (a missing household reads as three).
//! The departures themselves run in `condoRelocationEngine.integration.test.ts`
//! on the Rust engine.
use crate::clock::GameMode;
use crate::rules::CONDO_RELOCATION_CHANCE_MONTHLY;

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-12
}

#[test]
fn classic_never_relocates_a_condo() {
    for residents in [None, Some(2), Some(3), Some(4), Some(5)] {
        assert_eq!(GameMode::Classic.condo_relocation_chance(residents), 0.0);
    }
}

#[test]
fn modern_scales_the_chance_with_the_household_size() {
    let chance = |r| GameMode::Modern.condo_relocation_chance(r);
    let base = CONDO_RELOCATION_CHANCE_MONTHLY;
    assert!(
        close(chance(Some(3)), base),
        "the mean household is neutral"
    );
    assert!(close(chance(None), base), "no household reads as three");
    assert!(chance(Some(2)) < chance(Some(3)));
    assert!(chance(Some(5)) > chance(Some(3)));
    assert!(close(chance(Some(5)), base * 5.0 / 3.0));
}
