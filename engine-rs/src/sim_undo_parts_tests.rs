//! A step that takes out lobby tiles which joined parts of the tower a sale
//! had divided leaves each part on the root it stood on before the tiles
//! went in (`Step::lobby_roots`, #1848 on #1843).
use super::check_tests::{refused, sell};
use super::tests::gesture;
use super::StepRefused;
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;

/// An empty Modern lot with auto-bridge off, so nothing lays a link.
fn lot() -> Simulation {
    let mut sim = Simulation::new_game(1, GameMode::Modern);
    sim.money = 1e9;
    sim.star = 5;
    assert!(!sim.toggle_auto_bridge());
    sim
}

fn build(sim: &mut Simulation, kind: Kind, floor: i64, xs: impl IntoIterator<Item = i64>) {
    for x in xs {
        let r = sim.build(kind, floor, x);
        assert!(r.ok, "{kind:?} at ({floor}, {x}): {:?}", r.reason);
    }
}

fn sell_at(sim: &mut Simulation, floor: i64, x: i64) {
    let id = sim.tower.unit_at(floor, x).unwrap().id;
    sell(sim, id);
}

/// Lobby at 100..106 and 108..116 over basement 105..109, parted by a sale of
/// basement 106 and 107.
fn two_parts() -> Simulation {
    let mut sim = lot();
    build(&mut sim, Kind::Lobby, 1, 100..106);
    build(&mut sim, Kind::Floor, 0, 105..109);
    build(&mut sim, Kind::Lobby, 1, 108..116);
    sell_at(&mut sim, 0, 106);
    sell_at(&mut sim, 0, 107);
    sim
}

#[test]
fn lobby_tiles_that_joined_two_parts_leave_each_on_its_own_root() {
    let mut sim = two_parts();
    let joined = gesture(&mut sim, |s| build(s, Kind::Lobby, 1, [106, 107])).unwrap();
    assert_eq!(joined.lobby_roots.len(), 2, "a root on each side");
    // Basement past the far part went in since, outside every step.
    build(&mut sim, Kind::Floor, 0, 109..112);
    let back = sim.apply_undo_step(&joined);
    assert!(
        back.is_ok(),
        "the far part stood on its own lobby before: {back:?}"
    );
    assert!(sim.tower.unit_at(1, 106).is_none() && sim.tower.unit_at(1, 107).is_none());
    assert!(sim.tower.unit_at(0, 111).is_some());
}

#[test]
fn a_part_a_sale_divided_since_the_lobby_tiles_still_refuses() {
    // The lobby tile joined one part. Since then basement went in past it
    // and a sale parted the basement under it from that part, so what is
    // past it hangs only from the tile and reaches no root it joined. The
    // run is basement alone: a run with a ground lobby tile would stand as
    // its own tower's front door, since Modern lays ground lobbies apart.
    let mut sim = lot();
    build(&mut sim, Kind::Lobby, 1, 100..107);
    build(&mut sim, Kind::Floor, 0, 105..111);
    let joined = gesture(&mut sim, |s| build(s, Kind::Lobby, 1, [107])).unwrap();
    assert_eq!(joined.lobby_roots.len(), 1, "one part beside it");
    build(&mut sim, Kind::Floor, 0, [111]);
    sell_at(&mut sim, 0, 106);
    refused(&mut sim, &joined, StepRefused::Blocked);
}

#[test]
fn a_tile_the_undo_lays_again_does_not_take_the_far_part_off_its_root() {
    // Round 11 of #1848: the gesture laid a lobby tile and sold the basement
    // under it, so its undo lays that basement again beside the first lobby's
    // part, and the far part keeps the root it stood on.
    let mut sim = lot();
    build(&mut sim, Kind::Lobby, 1, [100]);
    build(&mut sim, Kind::Floor, 0, 100..107);
    build(&mut sim, Kind::Lobby, 1, 104..107);
    sell_at(&mut sim, 0, 104);
    let step = gesture(&mut sim, |s| {
        build(s, Kind::Lobby, 1, [103]);
        sell_at(s, 0, 103);
    })
    .unwrap();
    build(&mut sim, Kind::Floor, 0, 107..110);
    let back = sim.apply_undo_step(&step);
    assert!(back.is_ok(), "{back:?}");
    assert!(sim.tower.unit_at(1, 103).is_none());
    assert!(sim.tower.unit_at(0, 103).is_some());
}

#[test]
fn a_redo_of_lobby_tiles_that_join_two_parts_records_both_roots() {
    let mut sim = two_parts();
    let joined = gesture(&mut sim, |s| build(s, Kind::Lobby, 1, [106, 107])).unwrap();
    let redo = sim.apply_undo_step(&joined).unwrap();
    let again = sim.apply_undo_step(&redo).unwrap();
    assert_eq!(
        again.lobby_roots.len(),
        2,
        "the redo's undo knows both roots"
    );
    build(&mut sim, Kind::Floor, 0, 109..112);
    let back = sim.apply_undo_step(&again);
    assert!(back.is_ok(), "{back:?}");
}
