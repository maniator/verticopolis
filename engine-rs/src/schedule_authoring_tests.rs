//! The Auto-tune proposal: its statuses, warm-up gate, row math, staging and
//! the proof that asking changes nothing.

use serde_json::json;

use super::*;
use crate::clock::GameMode;
use crate::facilities::{Kind, LOT_WIDTH};

pub(crate) const TOP: i64 = 12;

/// A served tower with one standard elevator of `cars` cars from floor 1 to
/// [`TOP`]; returns the sim and the shaft's id.
pub(crate) fn tower(mode: GameMode, cars: i64) -> (Simulation, i64) {
    let mut sim = Simulation::new_game(7, mode);
    sim.money = 1e12;
    sim.star = 3;
    for x in 0..LOT_WIDTH {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    for f in 2..=TOP {
        for x in 0..LOT_WIDTH {
            assert!(sim.tower.place(Kind::Floor, f, x).ok);
        }
    }
    assert!(
        sim.build_transport(Kind::ElevatorStandard, LOT_WIDTH / 2, 1, TOP)
            .ok
    );
    let id = sim.tower.transports[0].id;
    // Setting the count a shaft already has is a refused no-op.
    sim.tower.set_cars(id, cars);
    assert_eq!(sim.tower.get_transport(id).unwrap().cars, cars);
    (sim, id)
}

/// A tower to [`SKY_TOP`] with a sky lobby at floor [`SKY`]: the shaft serves two
/// lobbies, and a stop edit on that floor changes the up-tower target.
pub(crate) const SKY: i64 = 15;
/// The top of [`sky_tower`]'s shaft.
pub(crate) const SKY_TOP: i64 = 20;

pub(crate) fn sky_tower(mode: GameMode, cars: i64) -> (Simulation, i64) {
    let mut sim = Simulation::new_game(7, mode);
    sim.money = 1e12;
    sim.star = 3;
    for x in 0..LOT_WIDTH {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    for f in 2..=SKY_TOP {
        let kind = if f == SKY { Kind::Lobby } else { Kind::Floor };
        for x in 0..LOT_WIDTH {
            assert!(sim.tower.place(kind, f, x).ok, "{kind:?} at {f},{x}");
        }
    }
    assert!(
        sim.build_transport(Kind::ElevatorStandard, LOT_WIDTH / 2, 1, SKY_TOP)
            .ok
    );
    let id = sim.tower.transports[0].id;
    sim.tower.set_cars(id, cars);
    (sim, id)
}

pub(crate) fn ring(hours: &[(usize, f64)]) -> Vec<f64> {
    let mut r = vec![0.0; 24];
    for &(h, v) in hours {
        r[h] = v;
    }
    r
}

pub(crate) fn warm_ring(v: f64) -> Vec<f64> {
    ring(&(8..14).map(|h| (h, v)).collect::<Vec<_>>())
}

/// Replace the shaft's curves (and origins, if given).
pub(crate) fn seed(
    sim: &mut Simulation,
    id: i64,
    weekday: Vec<f64>,
    weekend: Vec<f64>,
    origins: Option<serde_json::Value>,
) {
    let empty: Vec<serde_json::Value> = (0..24).map(|_| json!([])).collect();
    let doc = json!({
        "util": [],
        "hourly": [[id, { "weekday": weekday, "weekend": weekend }]],
        "origins": [[id, origins.unwrap_or(json!({ "weekday": empty, "weekend": empty }))]],
    });
    sim.seed_telemetry(&doc).expect("a telemetry document");
}

pub(crate) fn draft(
    weekday: Option<Vec<i64>>,
    weekend: Option<Vec<i64>>,
    homes: Option<Vec<i64>>,
) -> Schedule {
    Schedule {
        weekday,
        weekend,
        waiting_car_response: None,
        standard_floor_departure: None,
        home_floors: homes,
    }
}

#[test]
fn a_missing_shaft_a_stair_and_classic_get_their_own_status() {
    let (sim, id) = tower(GameMode::Modern, 4);
    assert_eq!(
        sim.auto_tune_proposal(id + 99, None, false).status,
        ProposalStatus::MissingShaft
    );
    let (mut sim, _) = tower(GameMode::Modern, 4);
    assert!(sim.build_transport(Kind::Stairs, 20, 1, 2).ok);
    let stairs = sim
        .tower
        .transports
        .iter()
        .find(|t| t.kind == Kind::Stairs)
        .unwrap()
        .id;
    assert_eq!(
        sim.auto_tune_proposal(stairs, None, false).status,
        ProposalStatus::NotAnElevator
    );
    let (mut classic, cid) = tower(GameMode::Classic, 4);
    seed(&mut classic, cid, warm_ring(0.5), warm_ring(0.5), None);
    let none = classic.auto_tune_proposal(cid, None, false);
    assert_eq!(none.status, ProposalStatus::UnavailableInMode);
    assert!(none.proposal.is_none());
    // Classic still reports what has been measured, for the grid's ghost curve.
    assert!(none.weekday.warm && none.weekend.warm);
}

#[test]
fn a_cold_shaft_reports_insufficient_data_with_each_days_hours() {
    let (mut sim, id) = tower(GameMode::Modern, 4);
    let fresh = sim.auto_tune_proposal(id, None, false);
    assert_eq!(fresh.status, ProposalStatus::InsufficientData);
    assert_eq!(
        (fresh.weekday.sampled_hours, fresh.weekend.sampled_hours),
        (0, 0)
    );
    // Five sampled hours is still cold; the sixth warms the day.
    seed(
        &mut sim,
        id,
        ring(&[(8, 0.5), (9, 0.5), (10, 0.5), (11, 0.5), (12, 0.5)]),
        ring(&[]),
        None,
    );
    let five = sim.auto_tune_proposal(id, None, false);
    assert_eq!(five.status, ProposalStatus::InsufficientData);
    assert_eq!(
        five.weekday,
        DayReadiness {
            warm: false,
            sampled_hours: 5,
            curve: None
        }
    );
    seed(&mut sim, id, warm_ring(0.5), ring(&[]), None);
    let six = sim.auto_tune_proposal(id, None, false);
    assert_eq!(six.status, ProposalStatus::Available);
    assert_eq!(
        six.weekday,
        DayReadiness {
            warm: true,
            sampled_hours: 6,
            curve: Some(warm_ring(0.5))
        },
        "a warm day hands back its ring"
    );
    assert!(!six.weekend.warm);
}

#[test]
fn each_hour_follows_its_load_with_a_one_car_floor_and_the_installed_cap() {
    let (mut sim, id) = tower(GameMode::Modern, 8);
    let mut curve = warm_ring(0.5);
    curve[10] = 1.0;
    curve[11] = 0.01;
    curve[12] = 3.0; // a reading past full never asks for cars that do not exist
    seed(&mut sim, id, curve, warm_ring(0.25), None);
    let p = sim.auto_tune_proposal(id, None, false).proposal.unwrap();
    let wd = p.weekday.unwrap();
    assert_eq!(wd[8], 4);
    assert_eq!(wd[10], 8);
    assert_eq!(wd[11], 1);
    assert_eq!(wd[12], 8);
    assert_eq!(wd[3], 1, "an unsampled hour still keeps one car");
    assert_eq!(p.weekend.unwrap()[8], 2);
    // A shaft that sold cars never gets rows above what it has.
    assert!(sim.tower.set_cars(id, 3), "selling down to three cars");
    let after = sim.auto_tune_proposal(id, None, false).proposal.unwrap();
    assert!(after.weekday.unwrap().iter().all(|&n| (1..=3).contains(&n)));
}

#[test]
fn an_unmeasured_day_keeps_its_own_authored_row_never_the_other_days() {
    let (mut sim, id) = tower(GameMode::Modern, 4);
    seed(&mut sim, id, warm_ring(0.5), ring(&[]), None);
    let mine = vec![3; 24];
    let p = sim
        .auto_tune_proposal(
            id,
            Some(&draft(Some(vec![2; 24]), Some(mine.clone()), None)),
            false,
        )
        .proposal
        .unwrap();
    assert_eq!(p.weekend, Some(mine));
    assert_ne!(p.weekday, p.weekend);
    let bare = sim.auto_tune_proposal(id, None, false).proposal.unwrap();
    assert_eq!(bare.weekend, None);
    // A draft written for a bigger fleet is held to the cars installed.
    let big = sim
        .auto_tune_proposal(id, Some(&draft(None, Some(vec![9; 24]), None)), false)
        .proposal
        .unwrap();
    assert_eq!(big.weekend, Some(vec![4; 24]));
}

#[test]
fn untouched_homes_are_seeded_and_hand_set_homes_are_kept() {
    let (mut sim, id) = tower(GameMode::Modern, 4);
    seed(&mut sim, id, warm_ring(0.5), warm_ring(0.5), None);
    let seeded = sim.auto_tune_proposal(id, None, false).proposal.unwrap();
    assert!(seeded.homes_seeded);
    // The one lobby is the base, so the up-tower half goes to the top floor.
    assert_eq!(seeded.home_floors, vec![1, 1, TOP, TOP]);
    let kept = sim
        .auto_tune_proposal(id, Some(&draft(None, None, Some(vec![5, 6, 7, 8]))), false)
        .proposal
        .unwrap();
    assert!(!kept.homes_seeded);
    assert_eq!(kept.home_floors, vec![5, 6, 7, 8]);
    // An empty homes list counts as untouched staging.
    let empty = sim
        .auto_tune_proposal(id, Some(&draft(None, None, Some(Vec::new()))), false)
        .proposal
        .unwrap();
    assert!(empty.homes_seeded);
}

#[test]
fn the_seed_keeps_a_one_car_shafts_only_car_at_the_lobby() {
    // A one-car shaft keeps its only car at the lobby; three cars split 1 and 2 (#1634).
    for (cars, want) in [(1, vec![1]), (2, vec![1, TOP]), (3, vec![1, TOP, TOP])] {
        let (mut sim, id) = tower(GameMode::Modern, cars);
        seed(&mut sim, id, warm_ring(0.5), warm_ring(0.5), None);
        let p = sim.auto_tune_proposal(id, None, false).proposal.unwrap();
        assert_eq!(p.home_floors, want, "{cars} cars");
    }
}

#[test]
fn a_home_on_a_skipped_floor_snaps_to_the_nearest_served_one() {
    let (mut sim, id) = tower(GameMode::Modern, 2);
    assert!(sim.tower.set_stop(id, 6, false));
    seed(&mut sim, id, warm_ring(0.5), warm_ring(0.5), None);
    let p = sim
        .auto_tune_proposal(id, Some(&draft(None, None, Some(vec![6, 6]))), false)
        .proposal
        .unwrap();
    // 5 and 7 are equally near; the lower floor wins the tie.
    assert_eq!(p.home_floors, vec![5, 5]);
}

#[test]
fn an_aimed_seed_still_keeps_a_one_car_shafts_only_car_at_the_lobby() {
    // The busiest boarding floor is up-tower, yet the one car stays at the lobby (#1634).
    let (mut sim, id) = tower(GameMode::Modern, 1);
    let at_seven: Vec<serde_json::Value> = (0..24)
        .map(|h| if h == 9 { json!([[7, 5.0]]) } else { json!([]) })
        .collect();
    let origins = json!({ "weekday": at_seven.clone(), "weekend": at_seven });
    seed(&mut sim, id, warm_ring(0.5), warm_ring(0.5), Some(origins));
    let p = sim.auto_tune_proposal(id, None, false).proposal.unwrap();
    assert_eq!(p.home_floors, vec![1]);
}

#[test]
fn the_up_tower_half_aims_at_the_busiest_served_boarding_floor() {
    let (mut sim, id) = tower(GameMode::Modern, 4);
    let slots = |floor: i64, n: f64| -> Vec<serde_json::Value> {
        (0..24)
            .map(|h| {
                if h == 9 {
                    json!([[floor, n]])
                } else {
                    json!([])
                }
            })
            .collect()
    };
    let origins = json!({ "weekday": slots(7, 5.0), "weekend": slots(9, 5.0) });
    seed(
        &mut sim,
        id,
        warm_ring(0.5),
        ring(&[]),
        Some(origins.clone()),
    );
    let wd = sim.auto_tune_proposal(id, None, false).proposal.unwrap();
    assert_eq!(wd.home_floors, vec![1, 1, 7, 7]);
    // The weekend tab prefers weekend geography only when that day is warm.
    let from_weekend_tab = sim.auto_tune_proposal(id, None, true).proposal.unwrap();
    assert_eq!(from_weekend_tab.home_floors, vec![1, 1, 7, 7]);
    seed(&mut sim, id, warm_ring(0.5), warm_ring(0.5), Some(origins));
    let we = sim.auto_tune_proposal(id, None, true).proposal.unwrap();
    assert_eq!(we.home_floors, vec![1, 1, 9, 9]);
    // The busiest floor being skipped, the busiest served floor aims instead.
    let beside = |floor: i64, n: f64| -> Vec<serde_json::Value> {
        (0..24)
            .map(|h| {
                if h == 9 {
                    json!([[9, 20.0], [floor, n]])
                } else {
                    json!([])
                }
            })
            .collect()
    };
    let both = json!({ "weekday": beside(4, 1.0), "weekend": beside(4, 1.0) });
    seed(&mut sim, id, warm_ring(0.5), warm_ring(0.5), Some(both));
    assert!(sim.tower.set_stop(id, 9, false));
    let skipped = sim.auto_tune_proposal(id, None, true).proposal.unwrap();
    assert_eq!(skipped.home_floors, vec![1, 1, 4, 4]);
}

#[test]
fn asking_changes_nothing() {
    let (mut sim, id) = tower(GameMode::Modern, 4);
    seed(&mut sim, id, warm_ring(0.5), warm_ring(0.5), None);
    let saved = sim.save_text();
    let telemetry = sim.telemetry.clone();
    let rng = sim.rng.clone();
    let money = sim.money;
    let a = sim.auto_tune_proposal(id, Some(&draft(Some(vec![1; 24]), None, None)), true);
    let b = sim.auto_tune_proposal(id, Some(&draft(Some(vec![1; 24]), None, None)), true);
    assert_eq!(a, b);
    assert_eq!(sim.save_text(), saved);
    assert_eq!(sim.telemetry, telemetry);
    assert_eq!(format!("{:?}", sim.rng), format!("{rng:?}"));
    assert_eq!(sim.money, money);
    assert!(sim.tower.get_transport(id).unwrap().schedule.is_none());
}

#[test]
fn the_answer_serializes_with_kebab_statuses_and_camel_keys() {
    let (mut sim, id) = tower(GameMode::Modern, 2);
    let cold = serde_json::to_value(sim.auto_tune_proposal(id, None, false)).unwrap();
    assert_eq!(cold["status"], "insufficient-data");
    assert!(cold["proposal"].is_null());
    assert_eq!(cold["weekday"]["sampledHours"], 0);
    seed(&mut sim, id, warm_ring(0.5), warm_ring(0.5), None);
    let on = serde_json::to_value(sim.auto_tune_proposal(id, None, false)).unwrap();
    assert_eq!(on["status"], "available");
    assert_eq!(on["proposal"]["homesSeeded"], true);
    assert_eq!(on["proposal"]["homeFloors"].as_array().unwrap().len(), 2);
    let none =
        serde_json::to_value(AutoTuneProposal::refused(ProposalStatus::InvalidDraft)).unwrap();
    assert_eq!(none["status"], "invalid-draft");
}

#[test]
fn a_shaft_with_no_cars_gets_its_own_status_with_readiness_filled_in() {
    let (mut sim, id) = tower(GameMode::Modern, 4);
    seed(&mut sim, id, warm_ring(0.5), warm_ring(0.5), None);
    sim.tower.transports[0].cars = 0;
    let p = sim.auto_tune_proposal(id, None, false);
    assert_eq!(p.status, ProposalStatus::NoCars);
    assert!(p.proposal.is_none() && p.weekday.warm);
    // The mode is the more basic reason, so Classic keeps its own status.
    sim.mode = GameMode::Classic;
    assert_eq!(
        sim.auto_tune_proposal(id, None, false).status,
        ProposalStatus::UnavailableInMode
    );
}
