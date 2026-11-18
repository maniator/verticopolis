//! The congestion views read the congestion the ratings drain by (#2020):
//! on a floor whose transport estimate is calm but whose tenants' real
//! commute waits run past the mode's limit (#1971), the overlay, the
//! hotspot, the HUD's mean, the inspector and the 9 AM warning all name it.
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::panels::heatmap::{congestion_severity, HeatmapMode};
use crate::rules::CLASSIC_WAIT_LIMIT;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::MID;

const C: i64 = MID - 15;
const OFFICE_FLOOR: i64 = 5;
/// A real average wait three times the Classic limit: congestion 3.0.
const REAL: f64 = 3.0;
/// Classic's warning names the cause only (#549).
const WARNING: &str = "Tenants are complaining of long elevator waits.";

/// Lobby and floors 2 to 6, an occupied office on 5, one elevator, and the
/// office floor's tenants waiting `REAL` times the limit on average.
fn calm_tower_with_jammed_commutes() -> (Simulation, i64) {
    let mut sim = Simulation::new_game(7, GameMode::Classic);
    sim.money = 1e9;
    for x in C..C + 30 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        for floor in 2..=6 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    let id = sim
        .tower
        .place(Kind::Office, OFFICE_FLOOR, C)
        .unit_id
        .unwrap();
    let office = sim.tower.get_unit_mut(id).unwrap();
    office.state = UnitState::Occupied;
    office.ever_occupied = true;
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorStandard, C + 20, 1, 6)
            .ok
    );
    let estimate = sim
        .spatial_congestion_by_floor()
        .get(&OFFICE_FLOOR)
        .copied()
        .unwrap_or(0.0);
    assert!(estimate < 1.0, "the estimate alone is calm: {estimate}");
    sim.crowd
        .commute_wait_by_floor
        .insert(OFFICE_FLOOR, REAL * CLASSIC_WAIT_LIMIT);
    (sim, id)
}

#[test]
fn every_congestion_view_reads_the_congestion_the_ratings_drain_by() {
    let (mut sim, id) = calm_tower_with_jammed_commutes();
    let office = sim.tower.get_unit(id).unwrap().clone();
    let mut ctx = sim.build_satisfaction_context(false);
    let step = sim.satisfaction_step(&office, 0.6, &mut ctx);
    assert_eq!(step.cong, REAL, "the ratings read the real wait");
    assert_eq!(ctx.global_cong, REAL, "the warning's reading");
    assert_eq!(sim.spatial_congestion_by_floor()[&OFFICE_FLOOR], REAL);
    assert_eq!(sim.peak_congestion(), (REAL, Some(OFFICE_FLOOR)));
    let cell = sim
        .floor_heatmap(HeatmapMode::Congestion)
        .into_iter()
        .find(|c| c.floor == OFFICE_FLOOR)
        .expect("the office floor has a cell");
    assert_eq!(cell.severity, congestion_severity(REAL));
    assert_eq!(sim.inspector_congestion_at(OFFICE_FLOOR).0, REAL);
    assert!(sim.congestion() > 0.0, "the HUD's mean counts the floor");
}

#[test]
fn the_morning_warning_names_jammed_commutes() {
    let (mut sim, _) = calm_tower_with_jammed_commutes();
    sim.clock.minutes = 9.0 * 60.0;
    assert_eq!(sim.clock.hour(), 9);
    // The warning draws a coin each 9 AM pass; a dozen passes all but
    // guarantee one heads.
    for _ in 0..12 {
        sim.update_satisfaction();
    }
    assert!(
        sim.log.iter().any(|e| e.text == WARNING),
        "{:?}",
        sim.log.iter().map(|e| &e.text).collect::<Vec<_>>()
    );
}

/// Modern's morning warning also says what to do about it (#549).
#[test]
fn the_modern_morning_warning_adds_the_fix() {
    let (mut sim, _) = calm_tower_with_jammed_commutes();
    sim.mode = GameMode::Modern;
    sim.clock.minutes = 9.0 * 60.0;
    for _ in 0..12 {
        sim.update_satisfaction();
    }
    let said: Vec<&str> = sim.log.iter().map(|e| e.text.as_str()).collect();
    let fix = format!("{WARNING} Add cars or shafts.");
    assert!(said.contains(&fix.as_str()), "{said:?}");
    assert!(!said.contains(&WARNING), "{said:?}");
}

/// A floor whose stairs carry the floor above's load binds on the stairs
/// until its tenants' real elevator waits jam it: commute waits are waits
/// for a car, so the gripe then names the elevators.
#[test]
fn a_floor_jammed_by_real_waits_blames_the_elevators() {
    use super::{lay_row, put, seat, MID};
    use crate::churn::CongestionBindingClass as Binding;
    let mut sim = Simulation::new_game(8, GameMode::Classic);
    sim.money = 1e9;
    sim.star = 3;
    lay_row(&mut sim, Kind::Lobby, 1);
    for floor in 2..=3 {
        lay_row(&mut sim, Kind::Floor, floor);
    }
    let office = put(&mut sim, Kind::Office, 2, MID - 30);
    seat(&mut sim, office, UnitState::Occupied, 1.0);
    for (kind, x, bottom, top) in [
        (Kind::ElevatorStandard, MID + 20, 1, 2),
        (Kind::Stairs, MID, 1, 2),
        (Kind::Stairs, MID, 2, 3),
    ] {
        assert!(sim.build_transport(kind, x, bottom, top).ok, "{kind:?}");
    }
    for x in [MID - 30, MID - 21, MID - 12] {
        let id = put(&mut sim, Kind::Office, 3, x);
        sim.tower.get_unit_mut(id).unwrap().state = UnitState::Occupied;
    }
    assert_eq!(sim.binding_transport_class_at(2), Binding::Stairs);
    sim.crowd
        .commute_wait_by_floor
        .insert(2, REAL * CLASSIC_WAIT_LIMIT);
    assert_eq!(sim.binding_transport_class_at(2), Binding::Elevator);
    let (ratio, attribution) = sim.inspector_congestion_at(2);
    assert_eq!(ratio, REAL);
    assert_eq!(attribution.map(|a| a.elevator), Some(REAL));
}
