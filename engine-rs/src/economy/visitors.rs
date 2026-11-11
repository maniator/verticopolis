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
//!
//! Party halls and theatres count a set audience instead (#1500). Saves the
//! original wrote over a week of play show a party hall counting 50 from the
//! morning after it opens, every day, whether or not a party was held, and a
//! theatre counting 40 for each step of its film's draw: 120 for a new film
//! (draw 2), then 80 and 40 as the film ages (draws 1 and 0). Byte 15 of a
//! theatre's TDT record holds that draw.
//!
//! A theatre's film ages one day each morning, and its draw follows the age
//! (#1932): a run of the original that showed a film from the day it was set
//! until it drew nothing, then changed it, shows the draw at 2 for the film's
//! first 6 days, at 1 for the next 3, and at 0 from its tenth day on. The
//! census the next morning counts that draw (`film_draw`).

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

/// What an open party hall counts in the census.
pub const PARTY_HALL_AUDIENCE: i64 = 50;
/// What a theatre counts for each step of its film's draw.
pub const THEATRE_AUDIENCE_PER_DRAW: i64 = 40;
/// The draw of a new film, the strongest the original saves show.
pub const NEW_FILM_DRAW: i64 = 2;

/// The days a new film keeps the draw of a new film.
pub const NEW_FILM_FULL_DRAW_DAYS: i64 = 6;
/// The age in days from which a film draws nothing more than a theatre's
/// least audience (draw 0).
pub const FILM_SPENT_DAYS: i64 = 9;
/// The draw of a film past its full draw and not yet spent.
pub const FADING_FILM_DRAW: i64 = 1;
/// The draw of a spent film.
pub const SPENT_FILM_DRAW: i64 = 0;

/// The draw of a film that has shown for `days_shown` days.
pub fn film_draw(days_shown: i64) -> i64 {
    if days_shown < NEW_FILM_FULL_DRAW_DAYS {
        NEW_FILM_DRAW
    } else if days_shown < FILM_SPENT_DAYS {
        FADING_FILM_DRAW
    } else {
        SPENT_FILM_DRAW
    }
}

/// Whether `kind`'s census is a set audience (party halls and theatres).
pub fn counts_set_audience(kind: Kind) -> bool {
    matches!(kind, Kind::PartyHall | Kind::Cinema)
}

/// Whether `kind`'s census is the count its room carries from the day
/// before (`visitors_yest`): daily visitors or a set audience.
pub fn census_follows_the_day(kind: Kind) -> bool {
    counts_daily_visitors(kind) || counts_set_audience(kind)
}

/// The audience `kind` counts, for a theatre at film draw `film_draw` (held to
/// 0 through `NEW_FILM_DRAW`), or `None` for a room without a set audience.
pub fn set_audience(kind: Kind, film_draw: i64) -> Option<i64> {
    match kind {
        Kind::PartyHall => Some(PARTY_HALL_AUDIENCE),
        Kind::Cinema => Some(THEATRE_AUDIENCE_PER_DRAW * (film_draw.clamp(0, NEW_FILM_DRAW) + 1)),
        _ => None,
    }
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
    fn a_film_draws_two_for_six_days_one_for_three_then_nothing() {
        let draws: Vec<i64> = (0..12).map(film_draw).collect();
        assert_eq!(draws, [2, 2, 2, 2, 2, 2, 1, 1, 1, 0, 0, 0]);
        assert_eq!(film_draw(255), SPENT_FILM_DRAW);
    }

    #[test]
    fn a_set_audience_is_fifty_for_a_hall_and_forty_per_film_draw_for_a_theatre() {
        assert_eq!(set_audience(Kind::PartyHall, 0), Some(50));
        assert_eq!(set_audience(Kind::PartyHall, NEW_FILM_DRAW), Some(50));
        assert_eq!(set_audience(Kind::Cinema, 2), Some(120));
        assert_eq!(set_audience(Kind::Cinema, 1), Some(80));
        assert_eq!(set_audience(Kind::Cinema, 0), Some(40));
        // A byte past the draws the saves show is held to them.
        assert_eq!(set_audience(Kind::Cinema, 3), Some(120));
        assert_eq!(set_audience(Kind::Cinema, -1), Some(40));
        for kind in [Kind::Shop, Kind::Restaurant, Kind::Office, Kind::FoodHall] {
            assert_eq!(set_audience(kind, NEW_FILM_DRAW), None);
            assert!(!counts_set_audience(kind));
        }
        for kind in [
            Kind::Shop,
            Kind::FastFood,
            Kind::Restaurant,
            Kind::PartyHall,
            Kind::Cinema,
        ] {
            assert!(census_follows_the_day(kind));
        }
        assert!(!census_follows_the_day(Kind::Office));
    }

    #[test]
    fn served_visitors_stop_at_the_demand_that_reached_the_venue() {
        assert_eq!(served_visitors(25, 1_000.0), 25);
        assert_eq!(served_visitors(25, 19.7), 19);
        assert_eq!(served_visitors(25, 0.0), 0);
        assert_eq!(served_visitors(25, f64::NAN), 0);
    }
}
