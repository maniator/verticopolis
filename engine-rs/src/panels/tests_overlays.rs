//! Native tests for the overlays, the traffic hotspot, the household mix and
//! the promise that no getter changes the game. Helpers are in `tests.rs`.

use serde_json::json;

use super::heatmap::{congestion_severity, HeatmapMode};
use super::tests::{founded, heat, id_at, put, settle, shaft};
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::tower::UnitState;

#[test]
fn heatmap_modes_cover_floors_tenants_and_the_ramp() {
    let mut sim = founded(GameMode::Modern, 3);
    put(&mut sim, Kind::Office, 2, 160);
    put(&mut sim, Kind::Office, 2, 170);
    shaft(&mut sim, Kind::ElevatorStandard, 152, 1, 3);
    settle(&mut sim, 24);
    let a = id_at(&sim, 2, 160);
    sim.tower.get_unit_mut(a).unwrap().state = UnitState::Occupied;
    sim.tower.get_unit_mut(a).unwrap().satisfaction = 0.25;
    let b = id_at(&sim, 2, 170);
    sim.tower.get_unit_mut(b).unwrap().state = UnitState::Empty;
    let occ = heat(&sim, HeatmapMode::Occupancy);
    let floor2 = occ
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["floor"] == 2)
        .unwrap();
    assert_eq!(floor2["severity"], 0.5, "one of two offices is empty");
    assert!(
        occ.as_array().unwrap().iter().all(|c| c["floor"] != 1),
        "a floor with nothing to rent is not tinted"
    );
    let sat = heat(&sim, HeatmapMode::Satisfaction);
    assert_eq!(sat.as_array().unwrap().len(), 1, "only the present tenant");
    assert_eq!(sat[0]["severity"], 0.75);
    let cong = heat(&sim, HeatmapMode::Congestion);
    assert!(cong.as_array().unwrap().iter().all(|c| c["tint"].is_null()));
}

#[test]
fn the_congestion_ramp_is_anchored_at_churn_and_gridlock() {
    assert_eq!(congestion_severity(0.0), 0.0);
    assert_eq!(congestion_severity(-3.0), 0.0);
    assert_eq!(congestion_severity(f64::NAN), 0.0);
    assert_eq!(
        congestion_severity(f64::INFINITY),
        0.0,
        "not finite reads green"
    );
    assert_eq!(congestion_severity(1.6), 1.0);
    assert_eq!(congestion_severity(9.0), 1.0);
    assert!((congestion_severity(1.0) - 2.0 / 3.0).abs() < 1e-15);
    let mid = congestion_severity(1.3);
    assert!(mid > 2.0 / 3.0 && mid < 1.0);
    assert!(congestion_severity(0.2) < congestion_severity(0.8));
}

#[test]
fn the_hotspot_names_the_lowest_floor_on_a_tie() {
    let mut sim = founded(GameMode::Modern, 4);
    put(&mut sim, Kind::Office, 3, 160);
    put(&mut sim, Kind::Office, 4, 160);
    shaft(&mut sim, Kind::ElevatorStandard, 152, 1, 4);
    settle(&mut sim, 6);
    for id in [id_at(&sim, 3, 160), id_at(&sim, 4, 160)] {
        sim.tower.get_unit_mut(id).unwrap().state = UnitState::Occupied;
    }
    // One shaft is the bottleneck for every floor it serves, so those floors
    // share its ratio: the tie the rule exists for.
    let by_floor = sim.spatial_congestion_by_floor();
    let peak = by_floor.values().copied().fold(0.0, f64::max);
    assert!(peak > 0.0, "a loaded shaft reads congested");
    let mut tied: Vec<i64> = by_floor
        .iter()
        .filter(|(_, c)| **c == peak)
        .map(|(f, _)| *f)
        .collect();
    tied.sort();
    assert!(
        tied.len() > 1,
        "the floors tie on the shaft's ratio: {tied:?}"
    );
    let spot = sim.peak_congestion_hotspot();
    assert_eq!(spot["ratio"].as_f64().unwrap(), peak);
    assert_eq!(spot["floor"], tied[0], "the lowest tied floor is named");
}

#[test]
fn households_group_the_homes_in_residence_by_size() {
    let mut sim = founded(GameMode::Modern, 3);
    put(&mut sim, Kind::Condo, 2, 160);
    put(&mut sim, Kind::Condo, 2, 190);
    put(&mut sim, Kind::Condo, 2, 210);
    let ids = [
        id_at(&sim, 2, 160),
        id_at(&sim, 2, 190),
        id_at(&sim, 2, 210),
    ];
    for (id, size) in ids.iter().zip([2, 2, 4]) {
        let u = sim.tower.get_unit_mut(*id).unwrap();
        u.state = UnitState::Occupied;
        u.residents = Some(size);
    }
    let h = sim.households_report();
    assert_eq!(h["households"], 3);
    assert_eq!(h["residents"], 8);
    assert_eq!(h["mix"], json!([[2, 2], [4, 1]]));
}

#[test]
fn getters_leave_the_game_unchanged() {
    let mut sim = founded(GameMode::Modern, 3);
    put(&mut sim, Kind::Office, 2, 160);
    shaft(&mut sim, Kind::ElevatorStandard, 152, 1, 3);
    settle(&mut sim, 30);
    let before = crate::canonical::digest(&crate::snapshot::state_view(&sim));
    let crowd = crate::canonical::digest(&sim.crowd.view());
    let id = id_at(&sim, 2, 160);
    let shaft = sim.tower.transports[0].id;
    let _ = (sim.tower_stats(), sim.stats_report(), sim.unit_detail(id));
    let _ = (
        sim.transport_detail(shaft),
        sim.elevator_stats(),
        sim.onboarding_facts(),
    );
    let _ = (sim.peak_congestion_hotspot(), sim.income_breakdown());
    let _ = (
        sim.housekeeping_coverage(),
        sim.next_star_requirements(),
        sim.milestone_progress(),
        sim.households_report(),
    );
    for mode in [
        HeatmapMode::Congestion,
        HeatmapMode::Occupancy,
        HeatmapMode::Satisfaction,
        HeatmapMode::Cleanliness,
    ] {
        let _ = sim.floor_heatmap(mode);
    }
    assert_eq!(
        before,
        crate::canonical::digest(&crate::snapshot::state_view(&sim))
    );
    assert_eq!(crowd, crate::canonical::digest(&sim.crowd.view()));
}

#[test]
fn the_milestone_id_table_matches_the_milestone_tests() {
    let sim = founded(GameMode::Modern, 2);
    let ids: Vec<&str> = sim.milestone_tests().iter().map(|(id, _, _)| *id).collect();
    assert_eq!(ids, super::progress::MILESTONE_IDS);
}
