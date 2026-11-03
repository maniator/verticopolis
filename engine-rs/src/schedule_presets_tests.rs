//! The Modern presets: each one's rows and homes, the mode gate, the refusals,
//! and the proof that asking changes nothing.

use super::*;
use crate::schedule_authoring::tests::{sky_tower, tower, SKY, SKY_TOP, TOP};

fn ask(sim: &Simulation, id: i64, name: &str) -> PresetProposal {
    sim.schedule_preset(id, name)
}

#[test]
fn rush_fills_the_peaks_halves_the_shoulders_and_caps_the_night() {
    let (sim, id) = tower(GameMode::Modern, 6);
    let p = ask(&sim, id, "rush");
    assert_eq!(p.status, PresetStatus::Available);
    let wd = p.weekday.unwrap();
    for h in [7, 8, 9, 17, 18, 19] {
        assert_eq!(wd[h], 6, "peak hour {h}");
    }
    for h in [6, 10, 12, 16, 20, 21] {
        assert_eq!(wd[h], 3, "shoulder hour {h}");
    }
    for h in [0, 3, 5, 22, 23] {
        assert_eq!(wd[h], 2, "overnight hour {h}");
    }
    // The weekend is the midday-half curve all day.
    assert_eq!(p.weekend.unwrap(), vec![3; 24]);
    // Split staging: the lower half at the lobby, the rest at the top floor.
    assert_eq!(p.home_floors, vec![1, 1, 1, TOP, TOP, TOP]);
}

#[test]
fn balanced_runs_a_daytime_hump_with_every_car_at_the_lobby() {
    let (sim, id) = tower(GameMode::Modern, 5);
    let p = ask(&sim, id, "balanced");
    let wd = p.weekday.unwrap();
    assert_eq!(wd[8], 5);
    assert_eq!(wd[17], 5);
    assert_eq!(wd[18], 3); // half of five rounds up
    assert_eq!(wd[7], 3);
    assert_eq!(wd[2], 2);
    assert_eq!(p.weekend.unwrap(), wd);
    assert_eq!(p.home_floors, vec![1; 5]);
}

#[test]
fn feeder_is_a_steady_half_fleet_homed_up_tower() {
    let (sim, id) = tower(GameMode::Modern, 4);
    let p = ask(&sim, id, "feeder");
    assert_eq!(p.weekday.as_ref().unwrap(), &vec![2; 24]);
    assert_eq!(p.weekend.as_ref().unwrap(), &vec![2; 24]);
    assert_eq!(p.home_floors, vec![TOP; 4]);
}

#[test]
fn a_small_fleet_keeps_one_car_and_the_overnight_cap_never_exceeds_it() {
    let (sim, id) = tower(GameMode::Modern, 1);
    let p = ask(&sim, id, "rush");
    assert_eq!(p.weekday.unwrap(), vec![1; 24]);
    // The one car homes up-tower, the rule the dialog has always used (#1634).
    assert_eq!(p.home_floors, vec![TOP]);
    let (sim, id) = tower(GameMode::Modern, 2);
    let night = ask(&sim, id, "rush").weekday.unwrap();
    assert_eq!((night[2], night[12], night[8]), (2, 1, 2));
}

#[test]
fn staging_up_tower_carries_homes_only_and_works_in_classic() {
    let (sim, id) = tower(GameMode::Classic, 4);
    let p = ask(&sim, id, "stage-up-tower");
    assert_eq!(p.status, PresetStatus::Available);
    assert!(p.weekday.is_none() && p.weekend.is_none());
    assert_eq!(p.home_floors, vec![1, 1, TOP, TOP]);
}

#[test]
fn classic_gets_no_assisted_preset() {
    let (sim, id) = tower(GameMode::Classic, 4);
    for name in ["rush", "balanced", "feeder"] {
        assert_eq!(
            ask(&sim, id, name),
            PresetProposal::refused(PresetStatus::UnavailableInMode),
            "{name}"
        );
    }
}

#[test]
fn refusals_name_their_own_status() {
    let (mut sim, id) = tower(GameMode::Modern, 4);
    assert_eq!(
        ask(&sim, id + 99, "rush").status,
        PresetStatus::MissingShaft
    );
    assert_eq!(ask(&sim, id, "RUSH").status, PresetStatus::UnknownPreset);
    assert_eq!(ask(&sim, id, "").status, PresetStatus::UnknownPreset);
    assert!(sim.build_transport(Kind::Stairs, 20, 1, 2).ok);
    let stairs = sim
        .tower
        .transports
        .iter()
        .find(|t| t.kind == Kind::Stairs)
        .unwrap()
        .id;
    assert_eq!(
        ask(&sim, stairs, "rush").status,
        PresetStatus::NotAnElevator
    );
}

#[test]
fn the_recommendation_is_feeder_for_an_express_and_rush_for_a_local() {
    assert_eq!(
        recommended_preset(Kind::ElevatorExpress),
        AssistedPreset::Feeder
    );
    assert_eq!(
        recommended_preset(Kind::ElevatorStandard),
        AssistedPreset::Rush
    );
    assert_eq!(
        recommended_preset(Kind::ElevatorService),
        AssistedPreset::Rush
    );
}

#[test]
fn asking_changes_nothing() {
    let (sim, id) = tower(GameMode::Modern, 4);
    let before = serde_json::to_string(&sim.serialize()).unwrap();
    let first = ask(&sim, id, "rush");
    assert_eq!(ask(&sim, id, "rush"), first);
    assert_eq!(serde_json::to_string(&sim.serialize()).unwrap(), before);
}

#[test]
fn the_answer_serializes_with_kebab_names_and_camel_keys() {
    let (sim, id) = tower(GameMode::Modern, 2);
    let v = serde_json::to_value(ask(&sim, id, "stage-up-tower")).unwrap();
    assert_eq!(v["status"], "available");
    assert!(v["weekday"].is_null());
    assert_eq!(v["homeFloors"], serde_json::json!([1, TOP]));
    assert_eq!(
        serde_json::to_value(Preset::StageUpTower).unwrap(),
        "stage-up-tower"
    );
    let off = serde_json::to_value(ask(&sim, id, "nope")).unwrap();
    assert_eq!(off["status"], "unknown-preset");
}

#[test]
fn a_sky_lobby_is_the_up_tower_target_until_its_stop_is_skipped() {
    let (mut sim, id) = sky_tower(GameMode::Modern, 4);
    let up = |sim: &Simulation, name: &str| ask(sim, id, name).home_floors;
    assert_eq!(up(&sim, "rush"), vec![1, 1, SKY, SKY]);
    assert_eq!(up(&sim, "feeder"), vec![SKY; 4]);
    assert_eq!(up(&sim, "stage-up-tower"), vec![1, 1, SKY, SKY]);
    // Skipping the sky lobby's stop leaves the shaft one lobby, so the target
    // falls back to the top floor, with no restart or reload.
    assert!(sim.tower.set_stop(id, SKY, false));
    assert_eq!(up(&sim, "rush"), vec![1, 1, SKY_TOP, SKY_TOP]);
    assert_eq!(up(&sim, "balanced"), vec![1; 4]);
}

#[test]
fn a_shaft_with_no_cars_gets_its_own_status_in_every_mode_that_offers_the_preset() {
    let (mut sim, id) = tower(GameMode::Modern, 4);
    sim.tower.transports[0].cars = 0;
    for name in ["rush", "balanced", "feeder", "stage-up-tower"] {
        assert_eq!(
            ask(&sim, id, name),
            PresetProposal::refused(PresetStatus::NoCars),
            "{name}"
        );
    }
    // Classic still says the assisted presets are not offered at all.
    sim.mode = GameMode::Classic;
    assert_eq!(
        ask(&sim, id, "rush").status,
        PresetStatus::UnavailableInMode
    );
    assert_eq!(ask(&sim, id, "stage-up-tower").status, PresetStatus::NoCars);
    assert_eq!(
        serde_json::to_value(PresetStatus::NoCars).unwrap(),
        "no-cars"
    );
}
