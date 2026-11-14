//! The lobby rule dates a tile by when it last went into the tower, so a
//! tile a redo put back is newer than what was laid while it was out
//! (#1846, on #1843).
use super::check_tests::sell;
use super::tests::{gesture, tower};
use crate::facilities::Kind;

#[test]
fn a_lobby_tile_a_redo_put_back_is_dated_by_its_return() {
    let mut sim = tower();
    // A lobby tile past the lobby's east end, taken out by its undo.
    let lay = gesture(&mut sim, |s| assert!(s.build(Kind::Lobby, 1, 70).ok)).unwrap();
    let redo = sim.apply_undo_step(&lay).unwrap();
    // While it is out, basement goes in under the lobby's end and past it,
    // outside every gesture, so the redo trail stays.
    for x in [69, 70] {
        let r = sim.build(Kind::Floor, 0, x);
        assert!(r.ok, "x {x}: {:?}", r.reason);
    }
    let undo = sim.apply_undo_step(&redo).unwrap();
    assert_eq!(sim.tower.unit_at(1, 70).map(|u| u.kind), Some(Kind::Lobby));
    let under_the_end = sim.tower.unit_at(0, 69).unwrap().id;
    sell(&mut sim, under_the_end);

    // (0,70) went in while the lobby tile was out, so it is older than the
    // tile's return and hung from something else: the undo applies.
    let back = sim.apply_undo_step(&undo);
    assert!(back.is_ok(), "{back:?}");
    assert!(sim.tower.unit_at(1, 70).is_none());
    assert!(sim.tower.unit_at(0, 70).is_some());
}
