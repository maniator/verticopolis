//! The congestion overlay's color ramp and its cells, from the retired TS
//! half of `heatmap.integration.test.ts` (the rest of that suite already ran
//! on the Rust engine and stays). The ramp's anchors (green at 0, amber at
//! churn, red at gridlock and past it, green for a non-finite ratio) are
//! `panels::tests_overlays::the_congestion_ramp_is_anchored_at_churn_and_gridlock`;
//! the tests here hold its shape between the anchors and the cells built
//! from it.
use crate::clock::GameMode;
use crate::facilities::{Kind, LOT_WIDTH};
use crate::panels::heatmap::{congestion_severity, HeatmapMode};
use crate::sim::Simulation;
use crate::tower::UnitState;

/// The ramp's amber stop (green 0, chartreuse 1/3, amber 2/3, red 1).
const AMBER: f64 = 2.0 / 3.0;
/// The ratio where tenants start leaving, where the ramp reaches amber.
const CHURN: f64 = 1.0;
/// A severity the overlay's color ramp shows as distinct from green.
const VISIBLE_TINT: f64 = 0.1;

#[test]
fn the_ramp_rises_through_the_churn_join_without_a_seam() {
    // A dense grid that straddles the churn join, so a step or a slope flip
    // at the branch boundary shows.
    let grid = [
        0.0, 0.05, 0.1, 0.24, 0.5, 0.8, 0.99, 1.0, 1.01, 1.2, 1.4, 1.59, 1.6,
    ];
    let mut prev = -1.0;
    for c in grid {
        let s = congestion_severity(c);
        assert!(s > prev, "{c}: {s} after {prev}");
        assert!((0.0..=1.0).contains(&s), "{c}: {s}");
        prev = s;
    }
    assert!((congestion_severity(CHURN - 1e-6) - AMBER).abs() < 1e-3);
    assert!((congestion_severity(CHURN + 1e-6) - AMBER).abs() < 1e-3);
}

#[test]
fn the_ramp_spreads_the_healthy_range_below_churn() {
    // A comfortable tower sits well under churn; its floors must still read
    // apart, and still below amber.
    let low = congestion_severity(0.05);
    let busy_but_fine = congestion_severity(0.24);
    // The ramp rises fastest at the bottom: even 5% load shows a tint a tenth
    // of the way to red, where a straight line would leave it near green.
    assert!(low > VISIBLE_TINT, "not flat green: {low}");
    assert!(busy_but_fine - low > 0.1, "a visible gap");
    assert!(busy_but_fine < AMBER);
}

#[test]
fn each_congestion_cell_is_its_floors_congestion_through_the_ramp() {
    // Offices on 2..=8 over one weak car, run into the morning rush.
    let mut sim = Simulation::new_game(61, GameMode::Classic);
    sim.money = 1e12;
    sim.star = 5;
    let mid = LOT_WIDTH / 2;
    for x in 0..LOT_WIDTH {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        for f in 2..=8 {
            assert!(sim.tower.place(Kind::Floor, f, x).ok);
        }
    }
    assert!(sim.build_transport(Kind::ElevatorStandard, mid, 1, 8).ok);
    let shaft = sim.tower.transports[0].id;
    assert!(sim.tower.set_cars(shaft, 1));
    for f in 2..=8 {
        for x in (0..=mid - 9).step_by(9) {
            if let Some(id) = sim.tower.place(Kind::Office, f, x).unit_id {
                sim.tower.get_unit_mut(id).unwrap().state = UnitState::Occupied;
            }
        }
    }
    for _ in 0..24 {
        sim.tick(20.0);
    }
    let by_floor = sim.spatial_congestion_by_floor();
    assert!(
        by_floor.values().any(|&c| c > 0.0),
        "the rush loads a floor"
    );
    let cells = sim.floor_heatmap(HeatmapMode::Congestion);
    assert!(!cells.is_empty());
    for cell in cells {
        let raw = by_floor.get(&cell.floor).copied().unwrap_or(0.0);
        assert_eq!(
            cell.severity,
            congestion_severity(raw),
            "floor {}",
            cell.floor
        );
    }
}
