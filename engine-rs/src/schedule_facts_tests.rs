//! The advice comparison and the Simulate staging summary: their statuses,
//! the warm gate, the over and short hours, the staging counts and the proof
//! that asking changes nothing.

use super::*;
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::schedule_authoring::tests::{
    draft, ring, seed, sky_tower, tower, warm_ring, SKY, SKY_TOP,
};

/// One hot hour at 08:00 (a full fleet wanted), a quiet hour at 09:00 and a
/// half-load plateau after it: six sampled hours, so the day is warm.
fn curve() -> Vec<f64> {
    ring(&[
        (8, 1.0),
        (9, 0.25),
        (10, 0.5),
        (11, 0.5),
        (12, 0.5),
        (13, 0.5),
    ])
}

/// The floor a car homed up-tower waits at: the top of the test tower.
const TOP_HOME: i64 = 12;

fn row(cars: i64) -> Option<Vec<i64>> {
    Some(vec![cars; 24])
}

#[test]
fn a_missing_shaft_and_a_stair_get_their_own_status() {
    let (mut sim, id) = tower(GameMode::Modern, 4);
    assert_eq!(
        sim.schedule_facts(id + 99, None, false).status,
        FactsStatus::MissingShaft
    );
    assert!(sim.build_transport(Kind::Stairs, 20, 1, 2).ok);
    let stairs = sim
        .tower
        .transports
        .iter()
        .find(|t| t.kind == Kind::Stairs)
        .unwrap()
        .id;
    let f = sim.schedule_facts(stairs, None, false);
    assert_eq!(f.status, FactsStatus::NotAnElevator);
    assert!(f.staging.is_none() && f.recommended.is_none());
}

#[test]
fn a_cold_day_gives_no_advice_and_the_assumed_down_rush_peak() {
    let (mut sim, id) = tower(GameMode::Modern, 4);
    // Five sampled hours is still cold.
    seed(
        &mut sim,
        id,
        ring(&[(8, 1.0), (9, 1.0), (10, 1.0), (11, 1.0), (12, 1.0)]),
        ring(&[]),
        None,
    );
    let d = draft(Some(vec![1; 24]), None, None);
    let f = sim.schedule_facts(id, Some(&d), false);
    assert_eq!(f.advice.status, AdviceStatus::InsufficientData);
    assert!(f.advice.over.is_empty() && f.advice.short.is_empty());
    let s = f.staging.unwrap();
    assert!(!s.measured);
    assert_eq!((s.peak_hour, s.active_at_peak), (17, 1));
}

#[test]
fn a_warm_day_names_the_over_and_short_hours() {
    let (mut sim, id) = tower(GameMode::Modern, 4);
    seed(&mut sim, id, curve(), ring(&[]), None);
    // Two cars every hour: short at the 08:00 rush (wants four), not over at
    // the quiet 09:00 (wants one, margin is two).
    let two = draft(row(2), None, None);
    let f = sim.schedule_facts(id, Some(&two), false);
    assert_eq!(f.advice.status, AdviceStatus::Ready);
    assert_eq!(f.advice.short, vec![8]);
    assert!(f.advice.over.is_empty());
    // Three cars every hour: over at 09:00 and every unmeasured hour (want one).
    let three = draft(row(3), None, None);
    let f = sim.schedule_facts(id, Some(&three), false);
    assert!(f.advice.over.contains(&9) && f.advice.over.contains(&0));
    assert!(!f.advice.over.contains(&8));
    // The measured hours that ask for two cars are neither over nor short.
    assert!(!f.advice.over.contains(&10) && !f.advice.short.contains(&10));
}

#[test]
fn a_full_fleet_hour_is_never_called_short() {
    let (mut sim, id) = tower(GameMode::Modern, 4);
    seed(&mut sim, id, curve(), ring(&[]), None);
    // No draft row means every car runs every hour.
    let f = sim.schedule_facts(id, None, false);
    assert!(f.advice.short.is_empty());
    // A row at the full fleet is the same.
    let full = draft(row(4), None, None);
    assert!(sim
        .schedule_facts(id, Some(&full), false)
        .advice
        .short
        .is_empty());
}

#[test]
fn each_day_tab_reads_its_own_curve() {
    let (mut sim, id) = tower(GameMode::Modern, 4);
    seed(&mut sim, id, curve(), ring(&[]), None);
    let weekday = sim.schedule_facts(id, None, false);
    let weekend = sim.schedule_facts(id, None, true);
    assert_eq!(weekday.advice.status, AdviceStatus::Ready);
    // The weekend has no samples: no advice, and no measured peak claimed.
    assert_eq!(weekend.advice.status, AdviceStatus::InsufficientData);
    assert!(weekday.staging.as_ref().unwrap().measured);
    assert!(!weekend.staging.as_ref().unwrap().measured);
    assert_eq!(weekday.staging.unwrap().peak_hour, 8);
}

#[test]
fn classic_gets_staging_but_no_advice_or_recommendation() {
    let (mut sim, id) = tower(GameMode::Classic, 4);
    seed(&mut sim, id, curve(), curve(), None);
    let f = sim.schedule_facts(id, None, false);
    assert_eq!(f.status, FactsStatus::Available);
    assert_eq!(f.advice.status, AdviceStatus::UnavailableInMode);
    assert!(f.recommended.is_none());
    // The measured peak still shows: Classic gets no advice but keeps the readout.
    let s = f.staging.unwrap();
    assert!(s.measured);
    assert_eq!(s.peak_hour, 8);
}

#[test]
fn the_staging_summary_counts_cars_homed_above_the_base() {
    let (mut sim, id) = tower(GameMode::Modern, 4);
    seed(&mut sim, id, curve(), ring(&[]), None);
    // Three cars on shift at the 08:00 peak; their homes are lobby, 9, lobby.
    let mut d = draft(None, None, Some(vec![1, 9, 1, TOP_HOME]));
    d.weekday = Some((0..24).map(|h| if h == 8 { 3 } else { 4 }).collect());
    let s = sim.schedule_facts(id, Some(&d), false).staging.unwrap();
    assert_eq!(s.peak_hour, 8);
    assert_eq!(s.active_at_peak, 3);
    assert_eq!((s.up_tower_cars, s.lobby_cars), (1, 2));
    assert_eq!((s.base_lobby, s.top_lobby), (1, 12));
}

#[test]
fn a_car_with_no_home_idles_at_the_base() {
    let (sim, id) = tower(GameMode::Modern, 4);
    let s = sim.schedule_facts(id, None, false).staging.unwrap();
    assert_eq!((s.active_at_peak, s.up_tower_cars, s.lobby_cars), (4, 0, 4));
    // Homes shorter than the fleet: the unlisted cars idle at the base.
    let d = draft(None, None, Some(vec![TOP_HOME]));
    let s = sim.schedule_facts(id, Some(&d), false).staging.unwrap();
    assert_eq!((s.up_tower_cars, s.lobby_cars), (1, 3));
}

#[test]
fn the_recommendation_follows_the_shaft_in_modern() {
    let (sim, id) = tower(GameMode::Modern, 4);
    assert_eq!(
        sim.schedule_facts(id, None, false).recommended,
        Some(AssistedPreset::Rush)
    );
}

#[test]
fn asking_changes_nothing() {
    let (mut sim, id) = tower(GameMode::Modern, 4);
    seed(&mut sim, id, warm_ring(0.5), warm_ring(0.5), None);
    let before = serde_json::to_string(&sim.serialize()).unwrap();
    let d = draft(row(2), row(2), Some(vec![1, 1, 12, 12]));
    let first = sim.schedule_facts(id, Some(&d), true);
    assert_eq!(sim.schedule_facts(id, Some(&d), true), first);
    assert_eq!(serde_json::to_string(&sim.serialize()).unwrap(), before);
}

#[test]
fn the_answer_serializes_with_kebab_names_and_camel_keys() {
    let (mut sim, id) = tower(GameMode::Modern, 4);
    seed(&mut sim, id, curve(), ring(&[]), None);
    let v = serde_json::to_value(sim.schedule_facts(id, None, false)).unwrap();
    assert_eq!(v["status"], "available");
    assert_eq!(v["recommended"], "rush");
    assert_eq!(v["advice"]["status"], "ready");
    assert_eq!(v["staging"]["peakHour"], 8);
    assert_eq!(v["staging"]["upTowerCars"], 0);
    let gone = serde_json::to_value(sim.schedule_facts(id + 9, None, false)).unwrap();
    assert_eq!(gone["status"], "missing-shaft");
    assert!(gone["staging"].is_null() && gone["recommended"].is_null());
}

#[test]
fn the_staging_summary_follows_a_live_stop_edit_on_a_lobby() {
    let (mut sim, id) = sky_tower(GameMode::Modern, 4);
    let top = |sim: &Simulation| {
        sim.schedule_facts(id, None, false)
            .staging
            .unwrap()
            .top_lobby
    };
    assert_eq!(top(&sim), SKY);
    assert!(sim.tower.set_stop(id, SKY, false));
    assert_eq!(top(&sim), SKY_TOP);
}

#[test]
fn a_shaft_with_no_cars_and_a_refused_query_say_so_in_their_advice_status() {
    let (mut sim, id) = tower(GameMode::Modern, 4);
    seed(&mut sim, id, curve(), ring(&[]), None);
    sim.tower.transports[0].cars = 0;
    let f = sim.schedule_facts(id, None, false);
    assert_eq!(f.status, FactsStatus::Available);
    assert_eq!(f.advice.status, AdviceStatus::NoCars);
    assert!(f.recommended.is_none());
    assert_eq!(f.staging.unwrap().active_at_peak, 0);
    // A refused query has no advice, and its status is the reason.
    let gone = sim.schedule_facts(id + 99, None, false);
    assert_eq!(gone.status, FactsStatus::MissingShaft);
    assert_eq!(gone.advice.status, AdviceStatus::Refused);
    assert_eq!(
        serde_json::to_value(AdviceStatus::NoCars).unwrap(),
        "no-cars"
    );
}

#[test]
fn the_homes_come_back_on_served_floors_with_the_base_for_unlisted_cars() {
    let (mut sim, id) = tower(GameMode::Modern, 4);
    // Floor 6 is skipped: a car homed there snaps to the nearer served floor,
    // the lower one on a tie; the two unlisted cars wait at the base lobby.
    assert!(sim.tower.set_stop(id, 6, false));
    let d = draft(None, None, Some(vec![6, 12]));
    let f = sim.schedule_facts(id, Some(&d), false);
    assert_eq!(f.home_floors, vec![5, 12, 1, 1]);
    // No draft homes at all: the whole fleet is at the base.
    assert_eq!(
        sim.schedule_facts(id, None, false).home_floors,
        vec![1, 1, 1, 1]
    );
    // A refusal has no homes.
    assert!(sim
        .schedule_facts(id + 9, None, false)
        .home_floors
        .is_empty());
}

#[test]
fn the_staging_counts_follow_the_homes_the_shaft_would_hold() {
    let (mut sim, id) = tower(GameMode::Modern, 4);
    // A car homed at floor 2 is up-tower while floor 2 is a stop.
    let d = draft(None, None, Some(vec![2, 1, 1, 1]));
    assert_eq!(
        sim.schedule_facts(id, Some(&d), false)
            .staging
            .unwrap()
            .up_tower_cars,
        1
    );
    // Skip floors 2 and 3: the home snaps down to the base lobby, so the
    // sentence must stop counting that car as staged up-tower.
    assert!(sim.tower.set_stop(id, 2, false));
    assert!(sim.tower.set_stop(id, 3, false));
    let f = sim.schedule_facts(id, Some(&d), false);
    assert_eq!(f.home_floors, vec![1, 1, 1, 1]);
    let s = f.staging.unwrap();
    assert_eq!((s.up_tower_cars, s.lobby_cars), (0, s.active_at_peak));
}

#[test]
fn homes_are_held_to_the_fleet_and_the_span() {
    let (sim, id) = tower(GameMode::Modern, 2);
    // A longer list is cut to the cars; a home above the span snaps to the top.
    let d = draft(None, None, Some(vec![999, 1, 7, 7]));
    let f = sim.schedule_facts(id, Some(&d), false);
    assert_eq!(f.home_floors.len(), 2);
    assert_eq!(f.home_floors[1], 1);
    let top = f.staging.as_ref().expect("staging").top_lobby;
    assert_eq!(f.home_floors[0], top);
}

#[test]
fn a_shaft_with_no_cars_has_no_homes() {
    let (mut sim, id) = tower(GameMode::Modern, 4);
    sim.tower.get_transport_mut(id).unwrap().cars = 0;
    let d = draft(None, None, Some(vec![3, 3]));
    assert!(sim
        .schedule_facts(id, Some(&d), false)
        .home_floors
        .is_empty());
}
