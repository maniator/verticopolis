//! Office-noise erosion is Modern-only: Classic caps a noisy tenant at the
//! annoyance ceiling and never evicts it, Modern wears it down to a notice.
//! A Classic notice stamped for noise (a save from before the split) is
//! rescinded on the next pass unless a real problem stands beside it. The
//! erosion scale itself is pinned by `catalog::tests::each_mode_matches_the_lock`;
//! the overhead and hold tax by
//! `catalog::charge_tests::overhead_and_the_condo_hold_tax_follow_the_quote`.
use crate::clock::GameMode;
use crate::econ::rent_config;
use crate::facilities::Kind;
use crate::satisfaction::NOISE_CAP;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{lay_row, put, seat, unit, MID as C};

/// A full-width lobby and floor 2 with a standard elevator at the middle;
/// `served` false leaves floor 2 with no transport.
fn floor_two(mode: GameMode, served: bool) -> Simulation {
    let mut sim = Simulation::new_game(4, mode);
    sim.money = 1_000_000.0;
    sim.star = 1;
    lay_row(&mut sim, Kind::Lobby, 1);
    lay_row(&mut sim, Kind::Floor, 2);
    if served {
        assert!(sim.build_transport(Kind::ElevatorStandard, C, 1, 2).ok);
    }
    sim
}

/// A guest room beside an office, after a week of hourly ticks.
fn noisy_room_after_a_week(mode: GameMode) -> f64 {
    let mut sim = floor_two(mode, true);
    put(&mut sim, Kind::Office, 2, C);
    let room = put(&mut sim, Kind::HotelDouble, 2, C + 9);
    seat(&mut sim, room, UnitState::Asleep, 1.0);
    for _ in 0..24 * 7 {
        sim.tick(60.0);
    }
    unit(&sim, room).satisfaction
}

#[test]
fn classic_noise_caps_at_the_ceiling_and_modern_erodes_past_it() {
    let classic = noisy_room_after_a_week(GameMode::Classic);
    assert!(
        (0.55..=NOISE_CAP + 1e-9).contains(&classic),
        "Classic caps at {NOISE_CAP}: {classic}"
    );
    let modern = noisy_room_after_a_week(GameMode::Modern);
    assert!(modern < 0.4, "Modern erodes toward a notice: {modern}");
}

/// A tenant of `kind` on an overdue noise notice at 5% satisfaction, the
/// state a save written before the split can carry.
fn on_noise_notice(sim: &mut Simulation, kind: Kind) -> i64 {
    let id = put(sim, kind, 2, C + 2);
    seat(sim, id, UnitState::Vacating, 0.05);
    let u = sim.tower.get_unit_mut(id).unwrap();
    u.extras_mut().vacate_reason = Some("noise");
    u.extras_mut().vacate_at = Some(0.0);
    id
}

#[test]
fn classic_rescinds_an_old_noise_notice_and_modern_still_evicts() {
    let mut classic = floor_two(GameMode::Classic, true);
    let condo = on_noise_notice(&mut classic, Kind::Condo);
    classic.tick(60.0);
    let u = unit(&classic, condo);
    assert_eq!(u.state, UnitState::Occupied);
    assert_eq!(u.extras().vacate_reason, None);
    assert!(u.satisfaction >= NOISE_CAP, "lifted to the noise cap");
    let mut modern = floor_two(GameMode::Modern, true);
    let condo = on_noise_notice(&mut modern, Kind::Condo);
    modern.tick(60.0);
    assert_ne!(unit(&modern, condo).state, UnitState::Occupied);
}

#[test]
fn a_classic_noise_notice_still_evicts_over_a_real_rent_or_access_problem() {
    let mut gouged = floor_two(GameMode::Classic, true);
    let office = on_noise_notice(&mut gouged, Kind::Office);
    gouged.tower.get_unit_mut(office).unwrap().rent = Some(rent_config(Kind::Office).unwrap().max);
    gouged.tick(60.0);
    assert_ne!(unit(&gouged, office).state, UnitState::Occupied);
    let mut unserved = floor_two(GameMode::Classic, false);
    let condo = on_noise_notice(&mut unserved, Kind::Condo);
    unserved.tick(60.0);
    assert_ne!(unit(&unserved, condo).state, UnitState::Occupied);
}
