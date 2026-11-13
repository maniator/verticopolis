//! The undo's sale advice for Classic floor beside lobby tiles agrees with
//! the bulldozer (`charges_floor_end_tests.rs`): a lobby beyond a gap does
//! not hold a run in, and a lobby touching the run does.
use super::check_tests::{refused, sell};
use super::ground_tests::an_hour_passes;
use super::tests::gesture;
use super::{Simulation, Step, StepRefused};
use crate::charges::floor_end_tests::{lobbies_at, stories, take_out, SKY};
use crate::clock::GameMode;
use crate::facilities::Kind;
use std::ops::Range;

/// A Classic tower whose story `SKY` lacks `run`, and the step that lays
/// it again.
fn laid_again(run: Range<i64>) -> (Simulation, Step) {
    let mut sim = stories(GameMode::Classic, 10..120);
    take_out(&mut sim, SKY, run.clone());
    let step = gesture(&mut sim, |s| {
        for x in run.clone() {
            if s.tower.unit_at(SKY, x).is_none() {
                assert!(s.build(Kind::Floor, SKY, x).ok, "x {x}");
            }
        }
    })
    .unwrap();
    assert!(run.clone().all(|x| sim.tower.unit_at(SKY, x).is_some()));
    (sim, step)
}

fn bulldozer_takes(sim: &Simulation, x: i64) -> bool {
    let id = sim.tower.unit_at(SKY, x).unwrap().id;
    sim.tower.removal_reason(id).is_none()
}

#[test]
fn a_run_stranded_between_lobbies_beyond_gaps_is_offered_for_sale() {
    let (mut sim, step) = laid_again(60..70);
    lobbies_at(&mut sim, &[40, 100]);
    for gap in [10..40, 41..60, 70..100, 101..120] {
        take_out(&mut sim, SKY, gap);
    }
    an_hour_passes(&mut sim);
    refused(&mut sim, &step, StepRefused::GroundUsed { sellable: true });
    // The bulldozer agrees: the run comes out from either end inward.
    assert!(!bulldozer_takes(&sim, 65));
    assert!(bulldozer_takes(&sim, 60) && bulldozer_takes(&sim, 69));
    for x in 60..70 {
        let id = sim.tower.unit_at(SKY, x).unwrap().id;
        sell(&mut sim, id);
    }
    assert!(!sim.tower.has_structure(SKY, 65));
}

#[test]
fn a_run_ending_right_beside_a_lobby_is_never_offered_for_sale() {
    // The lobby touches the run's last tile, not its first, so the run's
    // first tile has to look past the whole run for it.
    let (mut sim, step) = laid_again(36..40);
    lobbies_at(&mut sim, &[40]);
    take_out(&mut sim, SKY, 41..120);
    an_hour_passes(&mut sim);
    refused(&mut sim, &step, StepRefused::GroundUsed { sellable: false });
    assert!(!bulldozer_takes(&sim, 36) && !bulldozer_takes(&sim, 39));
}

#[test]
fn a_run_starting_right_beside_a_lobby_is_never_offered_for_sale() {
    let (mut sim, step) = laid_again(41..45);
    lobbies_at(&mut sim, &[40]);
    take_out(&mut sim, SKY, 10..40);
    an_hour_passes(&mut sim);
    refused(&mut sim, &step, StepRefused::GroundUsed { sellable: false });
    assert!(!bulldozer_takes(&sim, 41) && !bulldozer_takes(&sim, 44));
}
