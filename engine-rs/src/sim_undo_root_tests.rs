//! The root of the part of the tower a step's ground-floor lobby tiles stood
//! in, its oldest ground-floor tile that stays: a run the step leaves beside
//! them, or beside the tiles there it takes with them, hangs where it reaches
//! that tile, and one run with a lobby tile may stand on its own as a first
//! where no ground-floor tile of that part older than the lobby tiles stays,
//! nor comes back with the step outside that run.
use super::check_tests::{refused, sell};
use super::tests::{gesture, tower};
use super::StepRefused;
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;

/// An empty lot, where a first lobby tile stands on its own.
fn lot() -> Simulation {
    let mut sim = Simulation::new_game(1, GameMode::Modern);
    sim.money = 1e9;
    sim.star = 5;
    sim
}

#[test]
fn the_first_lobby_tile_comes_out_from_under_one_run_left_standing() {
    let mut sim = lot();
    let first = gesture(&mut sim, |s| assert!(s.build(Kind::Lobby, 1, 100).ok)).unwrap();
    // The run touches the lobby tile beside it and below it, and is offered
    // the place once.
    assert!(sim.tower.place(Kind::Floor, 0, 100).ok);
    for x in 101..111 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        assert!(sim.tower.place(Kind::Floor, 0, x).ok);
    }
    sim.apply_undo_step(&first)
        .expect("the lobby left stands as a tower's first tile does");
    assert!(sim.tower.unit_at(1, 100).is_none());
    // Two runs left apart: only one of them could be a tower's first.
    let mut sim = lot();
    let first = gesture(&mut sim, |s| assert!(s.build(Kind::Lobby, 1, 100).ok)).unwrap();
    assert!(sim.tower.place(Kind::Lobby, 1, 101).ok);
    assert!(sim.tower.place(Kind::Lobby, 1, 99).ok);
    refused(&mut sim, &first, StepRefused::Blocked);
    // Basement alone could start no tower.
    let mut sim = lot();
    let first = gesture(&mut sim, |s| assert!(s.build(Kind::Lobby, 1, 100).ok)).unwrap();
    assert!(sim.tower.place(Kind::Floor, 0, 100).ok);
    refused(&mut sim, &first, StepRefused::Blocked);
    // A tower starts with a lobby tile, so a run with only plain floor on
    // the ground floor, as a tower saved before shafts stopped laying it
    // there can hold, could start no tower.
    let mut sim = lot();
    let first = gesture(&mut sim, |s| assert!(s.build(Kind::Lobby, 1, 100).ok)).unwrap();
    assert!(sim.tower.place(Kind::Floor, 1, 101).ok);
    refused(&mut sim, &first, StepRefused::Blocked);
    // A floor tile the step lays again is as old as it was, so a run apart
    // from it was never the tower's first.
    let mut sim = lot();
    let first = sim.tower.place(Kind::Lobby, 1, 100).unit_id.unwrap();
    assert!(sim.tower.place(Kind::Floor, 1, 101).ok);
    assert!(sim.tower.remove_unit(first).is_some());
    let lobby = gesture(&mut sim, |s| {
        for x in [102, 101, 103] {
            assert!(s.build(Kind::Lobby, 1, x).ok);
        }
    })
    .unwrap();
    assert!(sim.tower.place(Kind::Lobby, 1, 104).ok);
    refused(&mut sim, &lobby, StepRefused::Blocked);
    // While the tower's first lobby tile stays in the part the lobby tile
    // stood in, no run left apart from it stands as a first.
    let mut sim = tower();
    let lobby = gesture(&mut sim, |s| assert!(s.build(Kind::Lobby, 1, 70).ok)).unwrap();
    assert!(sim.tower.place(Kind::Lobby, 1, 71).ok);
    refused(&mut sim, &lobby, StepRefused::Blocked);
}

#[test]
fn a_ground_tile_the_step_takes_out_leaves_nothing_older_behind() {
    // The gesture lays its floor tile before its lobby tile, and edits
    // outside every gesture since leave the two apart. Once both go, the
    // lobby tile laid since is all that is left, so it stands as a first
    // though the floor tile the step takes out was older than the lobby tile.
    let mut sim = lot();
    let first = sim.tower.place(Kind::Lobby, 1, 100).unit_id.unwrap();
    let next = sim.tower.place(Kind::Floor, 1, 101).unit_id.unwrap();
    let step = gesture(&mut sim, |s| {
        assert!(s.tower.place(Kind::Floor, 1, 102).ok);
        assert!(s.build(Kind::Lobby, 1, 99).ok);
    })
    .unwrap();
    for id in [first, next] {
        assert!(sim.tower.remove_unit(id).is_some());
    }
    assert!(sim.tower.place(Kind::Lobby, 1, 98).ok);
    sim.apply_undo_step(&step)
        .expect("the lobby tile left stands as a tower's first");
    assert!(sim.tower.unit_at(1, 102).is_none());
}

#[test]
fn a_ground_tile_the_step_lays_again_joins_its_run_but_starts_no_tower() {
    // The gesture lays lobby tiles over an old floor tile and beyond it,
    // and the first lobby tile goes outside every gesture since, so the
    // floor tile the undo lays again is the oldest ground-floor tile left.
    let lobby_over_the_floor_tile = |since: fn(&mut Simulation)| {
        let mut sim = lot();
        let first = sim.tower.place(Kind::Lobby, 1, 100).unit_id.unwrap();
        assert!(sim.tower.place(Kind::Floor, 1, 101).ok);
        let lobby = gesture(&mut sim, |s| {
            assert!(s.build(Kind::Lobby, 1, 101).ok);
            assert!(s.build(Kind::Lobby, 1, 102).ok);
        })
        .unwrap();
        assert!(sim.tower.remove_unit(first).is_some());
        since(&mut sim);
        (sim, lobby)
    };
    // Laid again within the one run left, it is part of that run.
    let (mut sim, lobby) =
        lobby_over_the_floor_tile(|s| assert!(s.tower.place(Kind::Lobby, 1, 100).ok));
    sim.apply_undo_step(&lobby)
        .expect("the run with the lobby tile stands as a tower's first");
    // The floor tile laid again is never a root, since the check asks
    // nothing of what it hangs from (#1843), and with no lobby tile the run
    // cannot stand as a tower's first, so the basement laid under it since
    // is refused.
    let (mut sim, lobby) =
        lobby_over_the_floor_tile(|s| assert!(s.tower.place(Kind::Floor, 0, 101).ok));
    refused(&mut sim, &lobby, StepRefused::Blocked);
}

#[test]
fn a_part_of_the_ground_floor_a_sale_parted_keeps_its_own_root() {
    // A sale parted three floor tiles from the old lobby before the gesture
    // laid a lobby tile beside them, and basement under them and a floor
    // tile beside them went in since. The undo leaves them as the sale did,
    // with what went in since hanging from the oldest of them.
    let mut sim = tower();
    for x in 70..75 {
        assert!(sim.tower.place(Kind::Floor, 1, x).ok);
    }
    for x in 70..72 {
        let link = sim.tower.unit_at(1, x).unwrap().id;
        sell(&mut sim, link);
    }
    let lobby = gesture(&mut sim, |s| assert!(s.build(Kind::Lobby, 1, 75).ok)).unwrap();
    assert!(sim.tower.place(Kind::Floor, 0, 74).ok);
    assert!(sim.tower.place(Kind::Floor, 1, 71).ok);
    sim.apply_undo_step(&lobby)
        .expect("the parted floor tiles hold up what went in since");
    assert!(sim.tower.unit_at(1, 75).is_none());
    assert!(sim.tower.unit_at(1, 70).is_none());
    for (floor, x) in [(1, 71), (1, 72), (1, 73), (1, 74), (0, 74)] {
        assert_eq!(sim.tower.unit_at(floor, x).unwrap().kind, Kind::Floor);
    }
}

#[test]
fn a_tile_the_step_lays_again_joins_the_lobby_tiles_part_to_the_tower() {
    // A sale parted two floor tiles from the one beside the old lobby. The
    // gesture laid a lobby tile in the gap and sold that floor tile, which
    // the undo lays again, so the basement laid since under the old lobby
    // is judged by the old lobby, which it reaches.
    let mut sim = tower();
    for x in 70..74 {
        assert!(sim.tower.place(Kind::Floor, 1, x).ok);
    }
    let gap = sim.tower.unit_at(1, 71).unwrap().id;
    sell(&mut sim, gap);
    let beside = sim.tower.unit_at(1, 70).unwrap().id;
    let lobby = gesture(&mut sim, |s| {
        assert!(s.tower.place(Kind::Lobby, 1, 71).ok);
        sell(s, beside);
    })
    .unwrap();
    assert!(sim.tower.place(Kind::Floor, 0, 69).ok);
    sim.apply_undo_step(&lobby)
        .expect("the floor tile laid again joins the old lobby as before");
    assert_eq!(sim.tower.unit_at(1, 70).unwrap().kind, Kind::Floor);
    assert!(sim.tower.unit_at(1, 71).is_none());
}

#[test]
fn a_tile_the_step_takes_out_apart_from_its_lobby_tiles_joins_their_part() {
    // Edits outside every gesture parted a floor tile from the old lobby.
    // The gesture laid the link again, and apart from it a lobby tile beside
    // the parted tile. The undo takes the link out too, so basement laid
    // since under the parted tile is judged by the old lobby, which it no
    // longer reaches.
    let parted = |added: bool| {
        let mut sim = tower();
        for x in 70..72 {
            assert!(sim.tower.place(Kind::Floor, 1, x).ok);
        }
        let link = sim.tower.unit_at(1, 70).unwrap().id;
        assert!(sim.tower.remove_unit(link).is_some());
        let lobby = gesture(&mut sim, |s| {
            assert!(s.tower.place(Kind::Floor, 1, 70).ok);
            assert!(s.tower.place(Kind::Lobby, 1, 72).ok);
        })
        .unwrap();
        if added {
            assert!(sim.tower.place(Kind::Floor, 0, 71).ok);
        }
        (sim, lobby)
    };
    let (mut sim, lobby) = parted(true);
    refused(&mut sim, &lobby, StepRefused::Blocked);
    // All there before the lobby tile, the parted tile is left as it was.
    let (mut sim, lobby) = parted(false);
    sim.apply_undo_step(&lobby)
        .expect("the lobby tile answers only for what was built since");
    assert_eq!(sim.tower.unit_at(1, 71).unwrap().kind, Kind::Floor);
}

#[test]
fn a_ground_tile_the_step_takes_out_is_never_the_root() {
    // A sale parted a run of basement from the old lobby. The gesture laid
    // a floor tile on it and, apart from that, a lobby tile, and a lobby
    // tile laid since between the two hangs from them and the basement.
    // Once the undo takes both out, the floor tile is no root, so the lobby
    // tile laid since stands as its part's first.
    let mut sim = tower();
    for x in 69..76 {
        assert!(sim.tower.place(Kind::Floor, 0, x).ok);
    }
    let link = sim.tower.unit_at(0, 70).unwrap().id;
    sell(&mut sim, link);
    let lobby = gesture(&mut sim, |s| {
        assert!(s.tower.place(Kind::Floor, 1, 72).ok);
        assert!(s.tower.place(Kind::Lobby, 1, 74).ok);
    })
    .unwrap();
    assert!(sim.tower.place(Kind::Lobby, 1, 73).ok);
    sim.apply_undo_step(&lobby)
        .expect("the lobby tile laid since stands as its part's first");
    assert_eq!(sim.tower.unit_at(1, 73).unwrap().kind, Kind::Lobby);
    assert!(sim.tower.unit_at(1, 72).is_none());
}

#[test]
fn a_tile_the_step_lays_again_held_up_nothing_built_since() {
    // The gesture laid a floor tile between the one beside the old lobby
    // and a parted one, a lobby tile beyond the parted tile, and took the
    // tile beside the old lobby out. Basement went in under the parted tile
    // since, while its part reached the tower through nothing, so the undo
    // leaves the part as it was, though the tile it lays again stands beside
    // the gap.
    let mut sim = tower();
    for x in 70..73 {
        assert!(sim.tower.place(Kind::Floor, 1, x).ok);
    }
    let gap = sim.tower.unit_at(1, 71).unwrap().id;
    assert!(sim.tower.remove_unit(gap).is_some());
    let beside = sim.tower.unit_at(1, 70).unwrap().id;
    let lobby = gesture(&mut sim, |s| {
        assert!(s.tower.place(Kind::Floor, 1, 71).ok);
        assert!(s.tower.place(Kind::Lobby, 1, 73).ok);
        assert!(s.tower.remove_unit(beside).is_some());
    })
    .unwrap();
    assert!(sim.tower.place(Kind::Floor, 0, 72).ok);
    sim.apply_undo_step(&lobby)
        .expect("the basement laid since hangs from the parted tile");
    assert_eq!(sim.tower.unit_at(1, 70).unwrap().kind, Kind::Floor);
    assert!(sim.tower.unit_at(1, 71).is_none());
}

#[test]
fn a_tile_the_step_lays_again_joins_no_tile_it_takes_out() {
    // The gesture laid a floor tile beside the old lobby, next to a parted
    // one it took out, and a lobby tile beyond the parted tiles. The two
    // tiles never stood side by side once the gesture was done, so basement
    // laid since under the parted tiles hangs from them, and the undo leaves
    // their part as it was.
    let mut sim = tower();
    for x in 70..73 {
        assert!(sim.tower.place(Kind::Floor, 1, x).ok);
    }
    let link = sim.tower.unit_at(1, 70).unwrap().id;
    assert!(sim.tower.remove_unit(link).is_some());
    let parted = sim.tower.unit_at(1, 71).unwrap().id;
    let lobby = gesture(&mut sim, |s| {
        assert!(s.tower.place(Kind::Floor, 1, 70).ok);
        assert!(s.tower.place(Kind::Lobby, 1, 73).ok);
        assert!(s.tower.remove_unit(parted).is_some());
    })
    .unwrap();
    assert!(sim.tower.place(Kind::Floor, 0, 72).ok);
    sim.apply_undo_step(&lobby)
        .expect("the basement laid since hangs from the parted tiles");
    assert_eq!(sim.tower.unit_at(1, 71).unwrap().kind, Kind::Floor);
    assert!(sim.tower.unit_at(1, 70).is_none());
}

#[test]
fn a_basement_tile_is_never_the_root() {
    // Edits outside every gesture parted a floor tile, and beyond the gap
    // a floor tile laid again over older basement. The gesture laid a floor
    // tile in the gap and, apart from it, a lobby tile beside the parted
    // tile. The root is a ground-floor tile, so basement laid since under
    // the parted tile hangs from it, the oldest of the part.
    let mut sim = tower();
    for x in 70..73 {
        assert!(sim.tower.place(Kind::Floor, 1, x).ok);
    }
    assert!(sim.tower.place(Kind::Floor, 0, 72).ok);
    for x in 73..75 {
        assert!(sim.tower.place(Kind::Floor, 1, x).ok);
    }
    for x in [73, 71, 72] {
        let tile = sim.tower.unit_at(1, x).unwrap().id;
        assert!(sim.tower.remove_unit(tile).is_some());
    }
    assert!(sim.tower.place(Kind::Floor, 1, 72).ok);
    let lobby = gesture(&mut sim, |s| {
        assert!(s.tower.place(Kind::Floor, 1, 73).ok);
        assert!(s.tower.place(Kind::Lobby, 1, 75).ok);
    })
    .unwrap();
    assert!(sim.tower.place(Kind::Floor, 0, 74).ok);
    sim.apply_undo_step(&lobby)
        .expect("the basement laid since hangs from the parted tile");
    assert_eq!(sim.tower.unit_at(0, 74).unwrap().kind, Kind::Floor);
}

#[test]
fn a_lobby_tile_joined_to_the_tower_through_the_basement_keeps_its_root() {
    // The lobby tile reaches the old lobby only through the basement under
    // the gap beside it, and a lobby tile laid beyond it since hangs from
    // it alone, so that one is no tower's first.
    let mut sim = tower();
    for x in 69..72 {
        assert!(sim.tower.place(Kind::Floor, 0, x).ok);
    }
    // The lobby brush would fill the gap, so the gesture lays the tile alone.
    let lobby = gesture(&mut sim, |s| assert!(s.tower.place(Kind::Lobby, 1, 71).ok)).unwrap();
    assert!(sim.tower.place(Kind::Lobby, 1, 72).ok);
    refused(&mut sim, &lobby, StepRefused::Blocked);
}

#[test]
fn a_part_of_the_ground_floor_a_sale_parted_may_stand_on_its_own() {
    // A lobby tile laid since hangs from the gesture's lobby tile alone,
    // and a sale since parted the two from the old lobby, so the gesture's
    // tile is the oldest of their part. The old floor tile the undo lays
    // again stands in the old lobby's part.
    let parted = |below: bool| {
        let mut sim = tower();
        assert!(sim.tower.place(Kind::Floor, 1, 70).ok);
        let far = sim.tower.place(Kind::Floor, 1, 9).unit_id.unwrap();
        let lobby = gesture(&mut sim, |s| {
            assert!(s.tower.place(Kind::Lobby, 1, 71).ok);
            assert!(s.tower.remove_unit(far).is_some());
        })
        .unwrap();
        assert!(sim.tower.place(Kind::Lobby, 1, 72).ok);
        if below {
            assert!(sim.tower.place(Kind::Floor, 0, 71).ok);
        }
        let link = sim.tower.unit_at(1, 70).unwrap().id;
        sell(&mut sim, link);
        (sim, lobby)
    };
    let (mut sim, lobby) = parted(false);
    sim.apply_undo_step(&lobby)
        .expect("the lobby tile left stands as its part's first");
    // Basement laid since under the gesture's tile is a second run, which
    // could not stand beside it.
    let (mut sim, lobby) = parted(true);
    refused(&mut sim, &lobby, StepRefused::Blocked);
}

/// What a gesture does to an old ground-floor tile.
#[derive(Clone, Copy)]
enum OldTile {
    Stays,
    Brushed,
    Sold,
}

#[test]
fn an_old_tile_the_step_lays_again_beyond_a_link_starts_no_tower() {
    // Sales parted an old floor tile on the basement from the first lobby.
    // The gesture laid a lobby tile apart on the basement and a basement link
    // toward the old tile, and a lobby run laid since hangs from both. The
    // old tile is older than the gesture's lobby tile whether it stays or
    // the undo lays it again where the gesture brushed a lobby over it or
    // sold it, so the run is no tower's first in any of them.
    for old_tile in [OldTile::Stays, OldTile::Brushed, OldTile::Sold] {
        let mut sim = lot();
        assert!(!sim.toggle_auto_bridge());
        assert!(sim.build(Kind::Lobby, 1, 100).ok);
        for x in 100..110 {
            assert!(sim.build(Kind::Floor, 0, x).ok);
        }
        // Plain floor on the ground floor, as a tower saved before shafts
        // stopped laying it there can hold.
        assert!(sim.tower.place(Kind::Floor, 1, 109).ok);
        for x in [101, 102, 103, 104, 106, 107] {
            let basement = sim.tower.unit_at(0, x).unwrap().id;
            sell(&mut sim, basement);
        }
        let lobby = gesture(&mut sim, |s| {
            match old_tile {
                OldTile::Stays => {}
                OldTile::Brushed => {
                    let r = s.paint_brush(Kind::Lobby, 1, &[109]);
                    assert_eq!(r.placed, 1, "{:?}", r.reason);
                }
                OldTile::Sold => {
                    let floor = s.tower.unit_at(1, 109).unwrap().id;
                    sell(s, floor);
                }
            }
            assert!(s.build(Kind::Lobby, 1, 105).ok);
            assert!(s.build(Kind::Floor, 0, 107).ok);
        })
        .unwrap();
        assert!(sim.build(Kind::Lobby, 1, 106).ok);
        assert!(sim.build(Kind::Floor, 1, 107).ok);
        refused(&mut sim, &lobby, StepRefused::Blocked);
    }
}

#[test]
fn a_basement_tile_the_step_lays_again_beyond_a_link_starts_nothing() {
    // Sales parted old basement from the first lobby. The gesture sold an old
    // basement tile and laid a new one in its place, and laid a lobby tile
    // apart on the basement and a basement link toward the swap. A lobby run
    // laid since hangs from both. Basement starts no tower, so the old
    // basement tile the undo lays again leaves the run, with no older
    // ground-floor tile in its part, to stand as a first.
    let mut sim = lot();
    assert!(!sim.toggle_auto_bridge());
    assert!(sim.build(Kind::Lobby, 1, 100).ok);
    for x in 100..110 {
        assert!(sim.build(Kind::Floor, 0, x).ok);
    }
    for x in [101, 102, 103, 104, 106, 107] {
        let basement = sim.tower.unit_at(0, x).unwrap().id;
        sell(&mut sim, basement);
    }
    let swapped = sim.tower.unit_at(0, 109).unwrap().id;
    let lobby = gesture(&mut sim, |s| {
        sell(s, swapped);
        assert!(s.build(Kind::Floor, 0, 109).ok);
        assert!(s.build(Kind::Lobby, 1, 105).ok);
        assert!(s.build(Kind::Floor, 0, 107).ok);
    })
    .unwrap();
    assert!(sim.build(Kind::Lobby, 1, 106).ok);
    assert!(sim.build(Kind::Floor, 1, 107).ok);
    sim.apply_undo_step(&lobby)
        .expect("the run left stands as a tower's first");
    assert_eq!(sim.tower.unit_at(0, 109).unwrap().id, swapped);
    assert!(sim.tower.unit_at(1, 105).is_none());
}
