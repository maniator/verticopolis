//! Sky bridges (Modern): lobby tiles over open air on a sky lobby floor,
//! from one wing's sky lobby to another's, with nothing built on them.

use super::*;
use crate::clock::GameMode;
use crate::gameplay::RemovalMethod;
use crate::sim::Simulation;

const SKY: i64 = 15;
/// The left wing's columns, and the right wing's, `GAP` tiles apart.
const LEFT: std::ops::Range<i64> = 100..110;
const GAP: i64 = 10;

fn right_wing(gap: i64) -> std::ops::Range<i64> {
    LEFT.end + gap..LEFT.end + gap + 10
}

/// Two wings `gap` tiles apart in `mode`, joined by the ground lobby, with a
/// sky lobby on floor 15 over each wing. The right wing stops at `right_top`.
fn towers(mode: GameMode, gap: i64, right_top: i64) -> Simulation {
    let mut sim = Simulation::new_game(1, mode);
    sim.money = 1e9;
    sim.star = 5;
    // Tile by tile, so the automatic fill never closes the gap.
    for x in LEFT.start..right_wing(gap).end {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    for (wing, top) in [(LEFT, SKY), (right_wing(gap), right_top)] {
        for floor in 2..=top {
            let kind = if floor == SKY {
                Kind::Lobby
            } else {
                Kind::Floor
            };
            for x in wing.clone() {
                let r = sim.tower.place(kind, floor, x);
                assert!(r.ok, "{floor} {x}: {:?}", r.reason);
            }
        }
    }
    sim
}

fn gap_tiles(gap: i64) -> Vec<i64> {
    (LEFT.end..LEFT.end + gap).collect()
}

fn reason(sim: &Simulation, floor: i64, x: i64) -> Option<String> {
    sim.tower.can_place(Kind::Lobby, floor, x).reason
}

#[test]
fn a_bridge_joins_two_wings_on_their_sky_lobby_floor() {
    let mut sim = towers(GameMode::Modern, GAP, SKY);
    let left = sim.tower.seg_at(SKY, Some(LEFT.start as f64));
    let right = sim.tower.seg_at(SKY, Some(right_wing(GAP).start as f64));
    assert_ne!(left, right, "two wings before the bridge");
    let laid = sim.paint_brush(Kind::Lobby, SKY, &gap_tiles(GAP));
    assert_eq!(laid.placed, GAP, "{:?}", laid.reason);
    assert!(gap_tiles(GAP)
        .into_iter()
        .all(|x| sim.tower.is_skybridge_tile(SKY, x)));
    assert!(!sim.tower.is_skybridge_tile(SKY, LEFT.start));
    let left = sim.tower.seg_at(SKY, Some(LEFT.start as f64));
    let right = sim.tower.seg_at(SKY, Some(right_wing(GAP).start as f64));
    assert_eq!(left, right, "one walkable floor across the bridge");
}

#[test]
fn classic_builds_no_bridge() {
    let sim = towers(GameMode::Classic, GAP, SKY);
    assert!(reason(&sim, SKY, LEFT.end).is_some_and(|r| r.contains("no floating overhangs")));
}

#[test]
fn a_bridge_needs_a_sky_lobby_across_the_gap() {
    // The right wing stops below the sky lobby floor.
    let sim = towers(GameMode::Modern, GAP, SKY - 1);
    assert_eq!(
        reason(&sim, SKY, LEFT.end).as_deref(),
        Some(REACHES_A_LOBBY)
    );
}

#[test]
fn a_bridge_spans_at_most_its_limit() {
    let mut sim = towers(GameMode::Modern, SKYBRIDGE_MAX_SPAN, SKY);
    let laid = sim.paint_brush(Kind::Lobby, SKY, &gap_tiles(SKYBRIDGE_MAX_SPAN));
    assert_eq!(laid.placed, SKYBRIDGE_MAX_SPAN, "{:?}", laid.reason);
    let sim = towers(GameMode::Modern, SKYBRIDGE_MAX_SPAN + 1, SKY);
    assert_eq!(reason(&sim, SKY, LEFT.end).as_deref(), Some(SPAN_TOO_LONG));
}

#[test]
fn a_bridge_tile_hangs_from_a_lobby_beside_it() {
    let sim = towers(GameMode::Modern, GAP, SKY);
    assert_eq!(
        reason(&sim, SKY, LEFT.end + 3).as_deref(),
        Some(STARTS_AT_A_LOBBY)
    );
    assert_eq!(reason(&sim, SKY, LEFT.end), None);
    // Only sky lobby floors are crossed: a lobby can't go on floor 14 at
    // all, and floor never goes over open air.
    let floor = sim.tower.can_place(Kind::Floor, SKY - 1, LEFT.end);
    assert!(!floor.ok);
}

#[test]
fn nothing_stands_on_a_bridge() {
    let mut sim = towers(GameMode::Modern, GAP, SKY);
    sim.paint_brush(Kind::Lobby, SKY, &gap_tiles(GAP));
    let x = LEFT.end + 4;
    assert!(!sim.tower.can_place(Kind::Floor, SKY + 1, x).ok);
    assert!(!sim.tower.shaft_has_structure_at(SKY, x, 1));
    assert!(sim.tower.shaft_has_structure_at(SKY, LEFT.start, 1));
    // The automatic fill under a room does not plan floor on a bridge.
    assert!(sim
        .tower
        .bridge_fill_plan(Kind::Office, SKY + 1, x, 9, 1)
        .iter()
        .all(|&(floor, _)| floor != SKY + 1));
}

#[test]
fn a_bridge_tile_costs_twice_a_lobby_tile() {
    let sim = towers(GameMode::Modern, GAP, SKY);
    let on_story = sim.can_build(Kind::Lobby, SKY + 15, LEFT.start).cost;
    let bridge = sim.can_build(Kind::Lobby, SKY, LEFT.end);
    assert!(bridge.ok, "{:?}", bridge.reason);
    let bare = Kind::Lobby.facility().cost + Kind::Floor.facility().cost;
    assert_eq!(bridge.cost, bare * SKYBRIDGE_PRICE_FACTOR);
    assert!(bridge.cost > on_story);
}

fn sell(sim: &mut Simulation, x: i64) -> Option<String> {
    let id = sim.tower.unit_at(SKY, x).unwrap().id;
    sim.remove_facility(id, RemovalMethod::Bulldoze).reason
}

#[test]
fn the_bulldozer_never_leaves_a_piece_hanging_from_nothing() {
    let mut sim = towers(GameMode::Modern, GAP, SKY);
    sim.paint_brush(Kind::Lobby, SKY, &gap_tiles(GAP));
    // A wing's lobby tile stays while a bridge hangs from it.
    assert_eq!(
        sell(&mut sim, LEFT.end - 1).as_deref(),
        Some(BRIDGE_HANGS_HERE)
    );
    // A tile in the middle comes out: each half hangs from its own wing.
    let middle = LEFT.end + 5;
    assert_eq!(sell(&mut sim, middle), None);
    // Now the tile next to the left wing holds up the left half.
    assert_eq!(sell(&mut sim, LEFT.end).as_deref(), Some(PIECE_WOULD_FALL));
    // From the open end inward, the half comes out tile by tile.
    for x in (LEFT.end..middle).rev() {
        assert_eq!(sell(&mut sim, x), None, "{x}");
    }
    // With its bridge gone, the wing's lobby tile sells again.
    assert_eq!(sell(&mut sim, LEFT.end - 1), None);
}

#[test]
fn a_half_built_bridge_still_reaches_across() {
    let mut sim = towers(GameMode::Modern, GAP, SKY);
    let half: Vec<i64> = gap_tiles(GAP).into_iter().take(4).collect();
    assert_eq!(sim.paint_brush(Kind::Lobby, SKY, &half).placed, 4);
    // The two wings are not joined until the last tile goes in.
    let left = sim.tower.seg_at(SKY, Some(LEFT.start as f64));
    let right = sim.tower.seg_at(SKY, Some(right_wing(GAP).start as f64));
    assert_ne!(left, right);
    // The right wing builds out to meet it.
    assert_eq!(reason(&sim, SKY, right_wing(GAP).start - 1), None);
}

#[test]
fn a_bridge_beside_a_tall_hall_is_one_story() {
    let mut sim = towers(GameMode::Modern, GAP, SKY - 1);
    // The right wing's sky lobby rises two stories.
    let right: Vec<i64> = right_wing(GAP).collect();
    let tall = sim.with_lobby_height(2, |sim| sim.paint_brush(Kind::Lobby, SKY, &right));
    assert_eq!(tall.placed, right.len() as i64, "{:?}", tall.reason);
    let laid = sim.paint_brush(Kind::Lobby, SKY, &gap_tiles(GAP));
    assert_eq!(laid.placed, GAP, "{:?}", laid.reason);
    let next_to_hall = sim.tower.unit_at(SKY, right_wing(GAP).start - 1).unwrap();
    assert_eq!(sim.tower.unit_stories(next_to_hall), 1);
}
