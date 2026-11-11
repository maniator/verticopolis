//! A shop's, fast food's or restaurant's daily visitors, the head count
//! SimTower's population shows for those rooms (#1500).
//!
//! The 1994 game gives each of these venues an expected visitor count for
//! the day, fixed when it opens: a new venue starts at 10, and each day the
//! count rises from yesterday's served visitors by 5, 10 or 15, kept to a
//! multiple of 5, until it reaches a cap: 25 on weekdays and 30 on weekends
//! for a shop, 35 and 50 for fast food and restaurants. The room's census is
//! yesterday's served count. Observation saves of the original (issue
//! #1500) pin the caps, the start and the multiples of 5; no saved byte
//! predicts the step, so it is a roll seeded by the tower's founding seed,
//! the day and the room (`climb_steps`). It draws nothing from the tower's
//! own generator, so random events keep their timing.

use crate::facilities::Kind;
use crate::rng::Rng;

/// What a venue expects on its first day open.
pub const FIRST_DAY_VISITORS: i64 = 10;
/// The expected count moves in multiples of this, and each day's climb
/// above yesterday's served visitors is one to three of them.
pub const VISITOR_STEP: i64 = 5;
/// The most steps one day's climb takes.
pub const MAX_VISITOR_STEPS: i64 = 3;

/// The most visitors `kind` expects in one day, or `None` for a room whose
/// census does not follow daily visitors.
pub fn daily_visitor_cap(kind: Kind, weekend: bool) -> Option<i64> {
    match (kind, weekend) {
        (Kind::Shop, false) => Some(25),
        (Kind::Shop, true) => Some(30),
        (Kind::FastFood | Kind::Restaurant, false) => Some(35),
        (Kind::FastFood | Kind::Restaurant, true) => Some(50),
        _ => None,
    }
}

/// Whether `kind`'s census is its daily visitors.
pub fn counts_daily_visitors(kind: Kind) -> bool {
    daily_visitor_cap(kind, false).is_some()
}

/// The visitors `kind` expects on a day, from the visitors it served the
/// day before (`None` before its first day) and the day's climb in steps of
/// `VISITOR_STEP` (1 to `MAX_VISITOR_STEPS`, rolled by the caller).
pub fn expected_visitors(
    kind: Kind,
    weekend: bool,
    served_before: Option<i64>,
    steps: i64,
) -> Option<i64> {
    let cap = daily_visitor_cap(kind, weekend)?;
    let ramp = match served_before {
        None => FIRST_DAY_VISITORS,
        Some(served) => {
            let climbed = served.max(0) + VISITOR_STEP * steps.clamp(1, MAX_VISITOR_STEPS);
            climbed - climbed % VISITOR_STEP
        }
    };
    Some(ramp.min(cap))
}

/// The steps (1 to `MAX_VISITOR_STEPS`) venue `unit_id` climbs on `day`, in a
/// tower founded with `tower_seed`: the same in every replay and across a
/// save and load, since all three are saved.
pub fn climb_steps(tower_seed: u32, day: i64, unit_id: i64) -> i64 {
    let day_bits = (day as u32).wrapping_mul(0x9e37_79b1);
    let unit_bits = (unit_id as u32).wrapping_mul(0x85eb_ca77);
    Rng::new(tower_seed ^ day_bits ^ unit_bits).int(1, MAX_VISITOR_STEPS)
}

/// The visitors a venue served on a day: what it expected, unless the
/// tower's demand reached it for fewer (the day's patronage tally).
pub fn served_visitors(expected: i64, patronage: f64) -> i64 {
    let drawn = if patronage.is_finite() {
        patronage.max(0.0).floor()
    } else {
        0.0
    };
    expected.min(drawn as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_caps_follow_the_original_by_kind_and_weekend() {
        assert_eq!(daily_visitor_cap(Kind::Shop, false), Some(25));
        assert_eq!(daily_visitor_cap(Kind::Shop, true), Some(30));
        for kind in [Kind::FastFood, Kind::Restaurant] {
            assert_eq!(daily_visitor_cap(kind, false), Some(35));
            assert_eq!(daily_visitor_cap(kind, true), Some(50));
        }
        for kind in [Kind::Cinema, Kind::PartyHall, Kind::FoodHall, Kind::Office] {
            assert!(!counts_daily_visitors(kind));
        }
    }

    #[test]
    fn a_new_venue_ramps_from_ten_by_five_to_its_cap() {
        // The fresh restaurant in the #1500 run: 10, then +10, +15, capped.
        let mut served = None;
        let mut seen = vec![];
        for steps in [1, 2, 3, 1, 1] {
            let expected = expected_visitors(Kind::Restaurant, false, served, steps).unwrap();
            seen.push(expected);
            served = Some(served_visitors(expected, 1_000.0));
        }
        assert_eq!(seen, [10, 20, 35, 35, 35]);
        // A shop that missed one visitor (19 of 20) stays at 20 on one step.
        assert_eq!(expected_visitors(Kind::Shop, false, Some(19), 1), Some(20));
        assert_eq!(expected_visitors(Kind::Shop, false, Some(20), 3), Some(25));
        // Out-of-range rolls are held to one to three steps.
        assert_eq!(expected_visitors(Kind::Shop, false, Some(0), 0), Some(5));
        assert_eq!(expected_visitors(Kind::Shop, false, Some(0), 9), Some(15));
        assert_eq!(
            expected_visitors(Kind::Restaurant, true, Some(35), 1),
            Some(40)
        );
        assert_eq!(
            expected_visitors(Kind::Restaurant, true, Some(48), 1),
            Some(50)
        );
    }

    #[test]
    fn a_climb_is_one_to_three_steps_and_repeats_for_the_same_day_and_room() {
        let mut seen = [false; 4];
        for day in 0..60 {
            for id in 1..20 {
                let steps = climb_steps(7, day, id);
                assert!((1..=MAX_VISITOR_STEPS).contains(&steps));
                assert_eq!(steps, climb_steps(7, day, id));
                seen[steps as usize] = true;
            }
        }
        assert_eq!(seen, [false, true, true, true], "every step size comes up");
    }

    #[test]
    fn served_visitors_stop_at_the_demand_that_reached_the_venue() {
        assert_eq!(served_visitors(25, 1_000.0), 25);
        assert_eq!(served_visitors(25, 19.7), 19);
        assert_eq!(served_visitors(25, 0.0), 0);
        assert_eq!(served_visitors(25, f64::NAN), 0);
    }
}
