//! A ground-floor or basement tile a step puts back hangs from a tile
//! beside, above or below it that stays, or from one the step puts back with
//! it, as its build asked (#1843). Where no ground-floor tile stays at all, a
//! lobby goes back on its own, as a tower's first does.
use super::check_tests::{refused, sell};
use super::ground_tests::laid;
use super::tests::{gesture, tower};
use super::StepRefused;
use crate::facilities::Kind;
use crate::sim::Simulation;

/// A basement run under the lobby's east end, from x 60 to 72: the tiles
/// past x 69 hang beside the tiles under the lobby.
fn basement_run(sim: &mut Simulation) {
    for x in 60..73 {
        let r = sim.build(Kind::Floor, 0, x);
        assert!(r.ok, "x {x}: {:?}", r.reason);
    }
}

#[test]
fn a_basement_tile_is_never_put_back_touching_nothing() {
    let mut sim = tower();
    basement_run(&mut sim);
    let end = sim.tower.unit_at(0, 72).unwrap().id;
    let sale = gesture(&mut sim, |s| sell(s, end)).unwrap();
    // Its neighbor goes in a sale the stack no longer holds, as when a
    // blocked step between them was dropped (#1843).
    let neighbor = sim.tower.unit_at(0, 71).unwrap().id;
    sell(&mut sim, neighbor);
    refused(&mut sim, &sale, StepRefused::Blocked);
}

#[test]
fn a_basement_tile_goes_back_beside_a_tile_that_stays_or_one_put_back_with_it() {
    let mut sim = tower();
    basement_run(&mut sim);
    let end = sim.tower.unit_at(0, 72).unwrap().id;
    let sale = gesture(&mut sim, |s| sell(s, end)).unwrap();
    sim.apply_undo_step(&sale).unwrap();
    assert!(
        sim.tower.unit_at(0, 72).map(|u| u.id) == Some(end),
        "beside x 71, which stays"
    );

    // Two tiles taken out together come back together, the inner one
    // holding the outer.
    let mut sim = tower();
    basement_run(&mut sim);
    let ids = [72, 71].map(|x| sim.tower.unit_at(0, x).unwrap().id);
    let sale = gesture(&mut sim, |s| ids.into_iter().for_each(|id| sell(s, id))).unwrap();
    sim.apply_undo_step(&sale).unwrap();
    assert!(sim.tower.unit_at(0, 72).is_some() && sim.tower.unit_at(0, 71).is_some());
}

#[test]
fn a_first_lobby_goes_back_on_an_empty_lot() {
    let mut sim = Simulation::new_game(1, crate::clock::GameMode::Modern);
    sim.money = 1e9;
    let lay = laid(&mut sim, Kind::Lobby, 1);
    let redo = sim.apply_undo_step(&lay).unwrap();
    assert!(sim.tower.unit_at(1, 80).is_none());
    sim.apply_undo_step(&redo).unwrap();
    assert!(
        sim.tower.unit_at(1, 80).is_some(),
        "nothing stays on the ground floor, so it stands first"
    );
}
