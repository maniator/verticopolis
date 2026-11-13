//! Classic's floor ends beside lobby tiles (owner ruling, 2026-11-13, on
//! #2062). A lobby tile is never removed, so it counts as floor on its side
//! of a tile only while it touches that tile through unbroken floor or
//! lobby; one beyond a gap no longer traps the plain floor between, while a
//! tile right beside a lobby is still not an end of its story.
use super::*;
use crate::clock::GameMode;
use crate::facilities::LOT_WIDTH;
use std::ops::Range;

/// The sky lobby story the tests build on. It is the tower's top story, so
/// the story-above rule never answers first.
pub(crate) const SKY: i64 = 15;

/// A tower in `mode` with a lobby on the ground floor and plain floor on
/// every story from 2 to `SKY`, each across `xs`.
pub(crate) fn stories(mode: GameMode, xs: Range<i64>) -> Simulation {
    let mut sim = Simulation::new_game(1, mode);
    sim.money = 1e9;
    for x in xs {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok, "lobby at {x}");
        for floor in 2..=SKY {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok, "{floor}, {x}");
        }
    }
    sim
}

/// Lays a lobby tile over the floor of story `SKY` at each of `xs`, as a
/// tower built before the engine refused plain floor on a sky lobby story
/// could have it.
pub(crate) fn lobbies_at(sim: &mut Simulation, xs: &[i64]) {
    for &x in xs {
        assert!(sim.tower.place(Kind::Lobby, SKY, x).ok, "lobby at {x}");
        assert_eq!(sim.tower.structure_kind_at(SKY, x), Some(Kind::Lobby));
    }
}

/// Takes the tiles of `xs` on `floor` out without the bulldozer's rules, as
/// an older save could hold them.
pub(crate) fn take_out(sim: &mut Simulation, floor: i64, xs: Range<i64>) {
    for x in xs {
        let id = sim.tower.unit_at(floor, x).unwrap().id;
        sim.tower.remove_unit(id);
    }
}

fn reload(sim: &Simulation) -> Simulation {
    let sim = crate::load_stream::load_save_text(sim.save_text().as_bytes()).unwrap();
    assert_eq!(sim.tower.mode, GameMode::Classic);
    sim
}

/// The bulldozer's answer for the plain floor tile at `floor`, `x`.
fn bulldoze(sim: &mut Simulation, floor: i64, x: i64) -> ChargeResult {
    let u = sim.tower.unit_at(floor, x).unwrap();
    assert_eq!(u.kind, Kind::Floor, "floor {floor}, x {x}");
    let id = u.id;
    sim.remove_facility(id, RemovalMethod::Bulldoze)
}

#[track_caller]
fn comes_out(sim: &mut Simulation, floor: i64, x: i64) {
    assert!(bulldoze(sim, floor, x).ok, "floor {floor}, x {x}");
    assert!(sim.tower.unit_at(floor, x).is_none());
}

#[track_caller]
fn stays_put(sim: &mut Simulation, floor: i64, x: i64) {
    let money = sim.money;
    assert_eq!(
        bulldoze(sim, floor, x),
        ChargeResult::refuse(crate::tower::MID_FLOOR_GAP),
        "floor {floor}, x {x}"
    );
    assert!(!sim.sell_at(floor, x), "floor {floor}, x {x}");
    assert_eq!(sim.tower.structure_kind_at(floor, x), Some(Kind::Floor));
    assert_eq!(sim.money, money);
}

#[test]
fn a_stretch_stranded_between_two_lobbies_comes_out_from_its_ends_after_a_reload() {
    // The reviewer's repro on #2062: lobby, gap, plain floor, gap, lobby.
    let mut sim = stories(GameMode::Classic, 10..120);
    lobbies_at(&mut sim, &[40, 100]);
    take_out(&mut sim, SKY, 41..60);
    take_out(&mut sim, SKY, 70..100);
    let mut sim = reload(&sim);
    // Every tile that could already come out.
    for x in (10..40).chain((101..120).rev()) {
        comes_out(&mut sim, SKY, x);
    }
    // The middle of the stretch still has plain floor on both sides.
    stays_put(&mut sim, SKY, 65);
    comes_out(&mut sim, SKY, 60);
    comes_out(&mut sim, SKY, 69);
    for x in 61..69 {
        comes_out(&mut sim, SKY, x);
    }
    // Only the two lobby tiles are left on the story.
    let left: Vec<i64> = (0..LOT_WIDTH)
        .filter(|&x| sim.tower.has_structure(SKY, x))
        .collect();
    assert_eq!(left, vec![40, 100]);
    assert!((0..LOT_WIDTH).all(|x| sim.tower.structure_kind_at(SKY, x) != Some(Kind::Floor)));
}

#[test]
fn a_floor_tile_right_beside_a_lobby_is_not_an_end() {
    let mut sim = stories(GameMode::Classic, 10..120);
    lobbies_at(&mut sim, &[40]);
    let mut sim = reload(&sim);
    // Plain floor beyond the lobby, or beyond the tile, on the other side.
    stays_put(&mut sim, SKY, 39);
    stays_put(&mut sim, SKY, 41);
    // With nothing left of the lobby, the tile beside it on the left has
    // plain floor on one side only: the lobby still counts, the far side
    // does not.
    take_out(&mut sim, SKY, 10..39);
    comes_out(&mut sim, SKY, 39);
    stays_put(&mut sim, SKY, 41);
}

#[test]
fn a_lobby_beyond_a_gap_on_one_side_lets_the_stretch_end_there() {
    // Plain floor 10..80, a gap, a lobby at 100, and nothing past it.
    let mut sim = stories(GameMode::Classic, 10..120);
    lobbies_at(&mut sim, &[100]);
    take_out(&mut sim, SKY, 80..100);
    take_out(&mut sim, SKY, 101..120);
    let mut sim = reload(&sim);
    stays_put(&mut sim, SKY, 50);
    comes_out(&mut sim, SKY, 79);
    comes_out(&mut sim, SKY, 10);
}

#[test]
fn plain_floor_beyond_a_lobby_and_a_gap_still_counts() {
    // The same stretch, with plain floor left past the lobby: a gap that
    // floor stands across is still a gap in the middle of the story.
    let mut sim = stories(GameMode::Classic, 10..120);
    lobbies_at(&mut sim, &[100]);
    take_out(&mut sim, SKY, 80..100);
    let mut sim = reload(&sim);
    stays_put(&mut sim, SKY, 79);
    stays_put(&mut sim, SKY, 101);
    comes_out(&mut sim, SKY, 119);
    comes_out(&mut sim, SKY, 10);
}

#[test]
fn a_ground_floor_tile_flush_with_the_lobby_is_not_an_end() {
    // The ground floor: a lobby run 10..60 with plain floor flush at 60..90,
    // as an older save could hold, and no story above it.
    let mut sim = Simulation::new_game(1, GameMode::Classic);
    sim.money = 1e9;
    for x in 10..60 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    for x in 60..90 {
        assert!(sim.tower.place(Kind::Floor, 1, x).ok);
    }
    let mut sim = reload(&sim);
    stays_put(&mut sim, 1, 60);
    stays_put(&mut sim, 1, 75);
    comes_out(&mut sim, 1, 89);
    for x in (61..89).rev() {
        comes_out(&mut sim, 1, x);
    }
    // The last plain tile has the lobby on one side and nothing on the other.
    comes_out(&mut sim, 1, 60);
}

#[test]
fn the_lot_edges_are_ends_of_their_story() {
    let mut sim = stories(GameMode::Classic, 0..LOT_WIDTH);
    let last = LOT_WIDTH - 1;
    stays_put(&mut sim, SKY, 1);
    stays_put(&mut sim, SKY, last - 1);
    comes_out(&mut sim, SKY, 0);
    comes_out(&mut sim, SKY, last);
    // Lobby tiles on the lot edges, each beyond a gap from a plain stretch.
    let mut sim = stories(GameMode::Classic, 0..LOT_WIDTH);
    lobbies_at(&mut sim, &[0, last]);
    take_out(&mut sim, SKY, 1..10);
    take_out(&mut sim, SKY, last - 10..last);
    let mut sim = reload(&sim);
    stays_put(&mut sim, SKY, 100);
    comes_out(&mut sim, SKY, 10);
    comes_out(&mut sim, SKY, last - 11);
}

#[test]
fn modern_still_takes_a_tile_anywhere_on_a_sky_lobby_story() {
    let mut sim = stories(GameMode::Modern, 10..120);
    lobbies_at(&mut sim, &[40, 100]);
    for x in [39, 41, 70, 99, 101] {
        comes_out(&mut sim, SKY, x);
    }
}
