//! The roots a step's ground-floor lobby tiles joined (`joined_roots`): the
//! basement the step takes out with them leaves each part it linked its own
//! root (#2210), and a plain ground-floor tile, which no build lays, does not.
use super::check_tests::sell;
use super::tests::gesture;
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;

/// An empty lot in `mode`, money and stars to spare.
fn lot_in(mode: GameMode) -> Simulation {
    let mut sim = Simulation::new_game(1, mode);
    sim.money = 1e9;
    sim.star = 5;
    sim
}

#[test]
fn basement_the_step_laid_between_two_parts_leaves_each_its_root() {
    // #2210: a sale parted the basement between the first lobby and a part
    // beyond it. One gesture laid lobby tiles in the gap and the basement
    // under them, and basement laid since runs past the far part. The undo
    // leaves each part as the sale did, on its own root: a far part of
    // lobby (which Modern lets stand apart anyway) or of plain ground floor,
    // as a tower saved before shafts stopped laying it there can hold, whose
    // root is its oldest ground-floor tile, as a sale left it.
    for far_lobby in [true, false] {
        let mut sim = lot_in(GameMode::Modern);
        assert!(!sim.toggle_auto_bridge());
        for x in 100..106 {
            assert!(sim.build(Kind::Lobby, 1, x).ok);
        }
        for x in 105..109 {
            assert!(sim.build(Kind::Floor, 0, x).ok);
        }
        for x in 108..116 {
            let placed = if far_lobby {
                sim.build(Kind::Lobby, 1, x).ok
            } else {
                sim.tower.place(Kind::Floor, 1, x).ok
            };
            assert!(placed, "far tile {x}");
        }
        for x in [106, 107] {
            let basement = sim.tower.unit_at(0, x).unwrap().id;
            sell(&mut sim, basement);
        }
        let lobby = gesture(&mut sim, |s| {
            for x in [106, 107] {
                assert!(s.build(Kind::Lobby, 1, x).ok);
                assert!(s.build(Kind::Floor, 0, x).ok);
            }
        })
        .unwrap();
        for x in 109..117 {
            assert!(sim.build(Kind::Floor, 0, x).ok, "basement {x}");
        }
        sim.apply_undo_step(&lobby)
            .unwrap_or_else(|e| panic!("far_lobby {far_lobby}: {e:?}"));
        for x in [106, 107] {
            assert!(sim.tower.unit_at(1, x).is_none());
            assert!(sim.tower.unit_at(0, x).is_none());
        }
        assert_eq!(sim.tower.unit_at(0, 116).unwrap().kind, Kind::Floor);
    }
}

#[test]
fn no_build_lays_plain_floor_on_the_ground_floor() {
    // Why a ground-floor tile a step takes out that is not lobby keeps its
    // place in `joined_roots`' flood: only edits outside every gesture lay
    // one, so the part it links has no root of its own to keep (#2210).
    // A build there lays lobby or nothing.
    for mode in [GameMode::Classic, GameMode::Modern] {
        let mut sim = lot_in(mode);
        assert!(sim.build(Kind::Lobby, 1, 100).ok);
        sim.build(Kind::Floor, 1, 101);
        let laid = sim.tower.unit_at(1, 101).map(|u| u.kind);
        assert!(
            laid.is_none_or(|kind| kind == Kind::Lobby),
            "{mode:?}: {laid:?}"
        );
    }
}
