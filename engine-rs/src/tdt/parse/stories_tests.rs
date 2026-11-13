//! `raise_ground_lobby` (#308): which paved stories a tall ground lobby takes
//! over on import, and which keep it at one story.

use std::collections::BTreeMap;

use super::raise_ground_lobby;
use crate::clock::GameMode;
use crate::facilities::{Kind, LOT_WIDTH};
use crate::sim::Simulation;
use crate::tdt::parse::parse_tdt;
use crate::tdt::types::TdtTower;

const LOBBY_X: std::ops::Range<usize> = 100..124;

/// The decoded `.TDT` of a Classic tower whose ground lobby rises three
/// stories over `LOBBY_X`, as the importer reads its header and tail.
fn tall_lobby_tdt() -> TdtTower {
    let mut sim = Simulation::new_game(1, GameMode::Classic);
    sim.money = 1e9;
    let tiles: Vec<i64> = LOBBY_X.map(|x| x as i64).collect();
    let laid = sim.with_lobby_height(3, |sim| sim.paint_brush(Kind::Lobby, 1, &tiles));
    assert_eq!(laid.placed, tiles.len() as i64, "{:?}", laid.reason);
    let bytes = crate::export_tdt(&sim.serialize().to_string()).unwrap();
    let tdt = parse_tdt(&bytes, "TALL.TDT").unwrap().tower;
    assert_eq!(tdt.header.lobby_height, 3);
    tdt
}

/// A paved row with the tiles in `xs` set.
fn row(xs: impl IntoIterator<Item = usize>) -> Vec<u8> {
    let mut row = vec![0; LOT_WIDTH as usize];
    for x in xs {
        row[x] = 1;
    }
    row
}

#[test]
fn stories_paved_only_over_the_lobby_are_taken_over() {
    let tdt = tall_lobby_tdt();
    let mut paved = BTreeMap::from([
        (1, row(LOBBY_X)),
        (2, row(LOBBY_X)),
        (3, row(LOBBY_X)),
        (4, row(LOBBY_X)),
    ]);
    assert_eq!(raise_ground_lobby(&mut paved, &tdt, &[]), 3);
    assert_eq!(paved.keys().copied().collect::<Vec<_>>(), vec![1, 4]);
}

// Review of #2054: a slab on a raised story beside the lobby's footprint is
// not covered by the lobby, so taking the story over would drop it.
#[test]
fn a_tile_beside_the_lobby_on_a_raised_story_keeps_one_story_and_the_tile() {
    let tdt = tall_lobby_tdt();
    for story in [2, 3] {
        let beside = LOBBY_X.end + 5;
        let mut paved = BTreeMap::from([(1, row(LOBBY_X)), (story, row(LOBBY_X.chain([beside])))]);
        assert_eq!(
            raise_ground_lobby(&mut paved, &tdt, &[]),
            1,
            "story {story}"
        );
        assert_eq!(paved[&story][beside], 1, "story {story}");
        assert_eq!(paved.len(), 2, "story {story}");
    }
}
