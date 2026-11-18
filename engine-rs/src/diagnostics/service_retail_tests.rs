//! The business verdict and the demand line on a venue's card (#549): a
//! weekend day reads against a weekend baseline, and the demand percent
//! shown agrees with the advice beside it.

use super::*;
use crate::sim::Simulation;

#[test]
fn a_weekend_verdict_reads_against_a_weekend_day() {
    // A Modern restaurant sells 1.35 times as much on a weekend: 110
    // customers against a typical 100 is booming on a Tuesday and only
    // average on a Saturday.
    let weekday = yesterdays_baseline(GameMode::Modern, Kind::Restaurant, 100.0, false);
    let weekend = yesterdays_baseline(GameMode::Modern, Kind::Restaurant, 100.0, true);
    assert_eq!(weekday, 100.0);
    assert!((weekend - 135.0).abs() < 1e-9);
    assert_eq!(retail_tier(Some(110.0), weekday), RetailTier::Booming);
    assert_eq!(retail_tier(Some(110.0), weekend), RetailTier::Average);
    // A Modern fast food sells less on a weekend, so a quiet Sunday is
    // not called low.
    let quiet = yesterdays_baseline(GameMode::Modern, Kind::FastFood, 100.0, true);
    assert_eq!(retail_tier(Some(40.0), quiet), RetailTier::Average);
    assert_eq!(retail_tier(Some(40.0), 100.0), RetailTier::Low);
    // Classic has its own weekend lift.
    let classic = yesterdays_baseline(GameMode::Classic, Kind::Shop, 100.0, true);
    assert!((classic - 120.0).abs() < 1e-9);
}

#[test]
fn the_card_reads_yesterday_against_the_day_it_was() {
    use super::super::tenant_tests::{served_tower, tenant};
    use crate::tower::UnitState;
    let mode = GameMode::Modern;
    let mut sim = served_tower(mode, 4);
    let id = tenant(&mut sim, Kind::Restaurant, 3, 2, UnitState::Occupied, 100.0);
    let typical = daily_traffic_income(Kind::Restaurant).unwrap()
        / catalog_spend_per_customer(mode, Kind::Restaurant).unwrap()
        * TRAFFIC_FACTOR_MEAN;
    sim.tower
        .get_unit_mut(id)
        .unwrap()
        .extras_mut()
        .patronage_yest = Some(typical * 1.1);
    let tier_on = |sim: &mut Simulation, day: i64| {
        sim.clock.minutes = (day * 1440 + 600) as f64;
        sim.service_diagnostic_facts(id).unwrap().retail.tier
    };
    let week = sim.clock.calendar.week_days;
    let after_weekend = (1..=week)
        .find(|&d| sim.clock.is_weekend_on(d - 1))
        .unwrap();
    let after_weekday = (1..=week)
        .find(|&d| !sim.clock.is_weekend_on(d - 1))
        .unwrap();
    assert_eq!(tier_on(&mut sim, after_weekday), RetailTier::Booming);
    assert_eq!(tier_on(&mut sim, after_weekend), RetailTier::Average);
}

#[test]
fn a_venue_with_an_attendance_cap_keeps_one_baseline_all_week() {
    let capped = [Kind::Cinema, Kind::PartyHall]
        .into_iter()
        .find(|k| k.attendance_cap().is_some())
        .expect("a kind with an attendance cap");
    for mode in [GameMode::Classic, GameMode::Modern] {
        assert_eq!(yesterdays_baseline(mode, capped, 100.0, true), 100.0);
    }
}

#[test]
fn the_demand_shown_agrees_with_the_advice_at_both_edges() {
    assert_eq!(demand_percent(0.996), 99);
    assert_eq!(retail_advice(GameMode::Modern, 0.996), RetailAdvice::None);
    assert_eq!(demand_percent(1.0), 100);
    assert_eq!(
        retail_advice(GameMode::Modern, 1.0),
        RetailAdvice::UnderServed
    );
    assert_eq!(demand_percent(0.497), 49);
    assert_eq!(
        retail_advice(GameMode::Modern, 0.497),
        RetailAdvice::OverBuilt
    );
    assert_eq!(demand_percent(0.5), 50);
    assert_eq!(demand_percent(0.29), 29);
    assert_eq!(demand_percent(1.4), 100);
    assert_eq!(demand_percent(-0.1), 0);
}

#[test]
fn a_shop_before_ten_reads_the_day_its_count_closed_on() {
    // A shop's and a fast food's day ends at 10:00, so before then its
    // yesterday is the day before the calendar's.
    for kind in [Kind::Shop, Kind::FastFood] {
        assert_eq!(closed_venue_day(kind, 8, 7), 6, "{kind:?} at 9:00 on day 8");
        assert_eq!(
            closed_venue_day(kind, 8, 8),
            7,
            "{kind:?} at 11:00 on day 8"
        );
        assert!(
            closed_venue_day(kind, 0, -1) < 0,
            "{kind:?} before any 10:00"
        );
    }
    assert_eq!(closed_venue_day(Kind::Restaurant, 8, 7), 7);
    assert!(closed_venue_day(Kind::Restaurant, 0, -1) < 0);
}

#[test]
fn a_fast_food_card_read_before_ten_judges_the_day_its_count_covers() {
    use super::super::tenant_tests::{served_tower, tenant};
    use crate::tower::UnitState;
    let mode = GameMode::Modern;
    let mut sim = served_tower(mode, 4);
    let id = tenant(&mut sim, Kind::FastFood, 3, 2, UnitState::Occupied, 100.0);
    let typical = daily_traffic_income(Kind::FastFood).unwrap()
        / catalog_spend_per_customer(mode, Kind::FastFood).unwrap()
        * TRAFFIC_FACTOR_MEAN;
    // A Modern fast food sells 0.7 times as much on a weekend: 40% of a
    // weekday is very few customers, and an average weekend day.
    sim.tower
        .get_unit_mut(id)
        .unwrap()
        .extras_mut()
        .patronage_yest = Some(typical * 0.4);
    let week = sim.clock.calendar.week_days;
    // A day whose day before is a weekday and whose day before that is a
    // weekend, so 9:00 and 11:00 judge different days.
    let day = (2..2 + week)
        .find(|&d| !sim.clock.is_weekend_on(d - 1) && sim.clock.is_weekend_on(d - 2))
        .unwrap();
    let tier_at = |sim: &mut Simulation, hour: i64, rolled: i64| {
        sim.clock.minutes = (day * 1440 + hour * 60) as f64;
        sim.morning_venue_day = rolled;
        sim.service_diagnostic_facts(id).unwrap().retail.tier
    };
    assert_eq!(tier_at(&mut sim, 9, day - 1), RetailTier::Average);
    assert_eq!(tier_at(&mut sim, 11, day), RetailTier::Low);
}
