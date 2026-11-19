//! Sky bridges (Modern): lobby tiles over open air on a sky lobby floor,
//! from one wing's sky lobby to another's, with nothing built on them, laid
//! whole by the Sky Bridge tool.

use super::*;
use crate::clock::GameMode;
use crate::crowd::spawn::add;
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

/// The Sky Bridge tool's click on the gap, which must lay the bridge.
fn lay(sim: &mut Simulation) {
    let r = sim.build_skybridge(SKY, LEFT.end + 2);
    assert!(r.ok, "{:?}", r.reason);
}

/// The first `n` tiles of the gap from the left wing, laid one by one as a
/// save from before the Sky Bridge tool could hold them.
fn half_bridge(sim: &mut Simulation, n: i64) {
    for x in LEFT.end..LEFT.end + n {
        assert!(sim.tower.place_as(Kind::Lobby, SKY, x, OverAir::Bridge).ok);
    }
}

/// The price of one bridge tile: twice a lobby tile on bare ground.
fn tile_price() -> f64 {
    (Kind::Lobby.facility().cost + Kind::Floor.facility().cost) * SKYBRIDGE_PRICE_FACTOR
}

#[test]
fn a_bridge_joins_two_wings_on_their_sky_lobby_floor() {
    let mut sim = towers(GameMode::Modern, GAP, SKY);
    let left = sim.tower.seg_at(SKY, Some(LEFT.start as f64));
    let right = sim.tower.seg_at(SKY, Some(right_wing(GAP).start as f64));
    assert_ne!(left, right, "two wings before the bridge");
    lay(&mut sim);
    assert!(gap_tiles(GAP)
        .into_iter()
        .all(|x| sim.tower.is_skybridge_tile(SKY, x)));
    assert!(!sim.tower.is_skybridge_tile(SKY, LEFT.start));
    let left = sim.tower.seg_at(SKY, Some(LEFT.start as f64));
    let right = sim.tower.seg_at(SKY, Some(right_wing(GAP).start as f64));
    assert_eq!(left, right, "one walkable floor across the bridge");
}

#[test]
fn one_click_lays_the_whole_gap_and_charges_its_full_price() {
    let mut sim = towers(GameMode::Modern, GAP, SKY);
    // Any tile of the gap quotes the same bridge, wing to wing.
    for x in [LEFT.end, LEFT.end + 5, LEFT.end + GAP - 1] {
        let quote = sim.quote_skybridge(SKY, x);
        assert!(quote.ok, "{:?}", quote.reason);
        assert_eq!(quote.tiles, LEFT.end..LEFT.end + GAP);
        assert_eq!(quote.cost, tile_price() * GAP as f64);
    }
    let money = sim.money;
    sim.gameplay.drain();
    lay(&mut sim);
    assert_eq!(money - sim.money, tile_price() * GAP as f64);
    let placed = sim.gameplay.drain();
    assert_eq!(
        placed,
        vec![crate::gameplay::GameplayEvent::FacilityPlaced {
            kind: Kind::Lobby,
            floor: SKY,
            count: GAP
        }]
    );
}

#[test]
fn the_lobby_tool_lays_no_tile_over_open_air() {
    let mut sim = towers(GameMode::Modern, GAP, SKY);
    assert_eq!(
        reason(&sim, SKY, LEFT.end).as_deref(),
        Some(LOBBY_OVER_OPEN_AIR)
    );
    let brushed = sim.paint_brush(Kind::Lobby, SKY, &gap_tiles(GAP));
    assert_eq!(brushed.placed, 0);
    assert_eq!(brushed.reason.as_deref(), Some(LOBBY_OVER_OPEN_AIR));
    // The quote the Lobby tool's ghost shows says the same.
    let ghost = sim.can_build(Kind::Lobby, SKY, LEFT.end);
    assert_eq!(ghost.reason.as_deref(), Some(LOBBY_OVER_OPEN_AIR));
}

#[test]
fn classic_builds_no_bridge() {
    let sim = towers(GameMode::Classic, GAP, SKY);
    assert!(reason(&sim, SKY, LEFT.end).is_some_and(|r| r.contains("no floating overhangs")));
    let quote = sim.quote_skybridge(SKY, LEFT.end);
    assert_eq!(
        quote.reason.as_deref(),
        Some(crate::sim_skybridge_build::MODERN_ONLY)
    );
}

#[test]
fn the_sky_bridge_opens_at_three_stars() {
    let mut sim = towers(GameMode::Modern, GAP, SKY);
    sim.star = SKYBRIDGE_MIN_STAR - 1;
    let quote = sim.quote_skybridge(SKY, LEFT.end);
    assert_eq!(quote.reason.as_deref(), Some("Sky Bridge unlocks at 3★."));
    assert!(!sim.build_skybridge(SKY, LEFT.end).ok);
    assert!(sim.tower.unit_at(SKY, LEFT.end).is_none());
    sim.star = SKYBRIDGE_MIN_STAR;
    assert!(sim.quote_skybridge(SKY, LEFT.end).ok);
}

#[test]
fn a_bridge_needs_a_sky_lobby_across_the_gap() {
    // The right wing stops below the sky lobby floor.
    let mut sim = towers(GameMode::Modern, GAP, SKY - 1);
    let quote = sim.quote_skybridge(SKY, LEFT.end);
    assert_eq!(quote.reason.as_deref(), Some(REACHES_A_LOBBY));
    assert!(quote.tiles.is_empty());
    assert!(!sim.build_skybridge(SKY, LEFT.end).ok);
    assert!(sim.tower.unit_at(SKY, LEFT.end).is_none());
}

#[test]
fn a_bridge_spans_at_most_its_limit() {
    let mut sim = towers(GameMode::Modern, SKYBRIDGE_MAX_SPAN, SKY);
    lay(&mut sim);
    assert!(sim
        .tower
        .is_skybridge_tile(SKY, LEFT.end + SKYBRIDGE_MAX_SPAN - 1));
    let sim = towers(GameMode::Modern, SKYBRIDGE_MAX_SPAN + 1, SKY);
    let quote = sim.quote_skybridge(SKY, LEFT.end);
    assert_eq!(quote.reason.as_deref(), Some(SPAN_TOO_LONG));
}

#[test]
fn the_tool_points_only_at_open_air_on_a_sky_lobby_floor() {
    let mut sim = towers(GameMode::Modern, GAP, SKY);
    let refused = |sim: &Simulation, floor, x| sim.quote_skybridge(floor, x).reason;
    assert_eq!(
        refused(&sim, SKY, LEFT.start).as_deref(),
        Some(POINT_AT_THE_GAP)
    );
    assert_eq!(
        refused(&sim, SKY - 1, LEFT.end).as_deref(),
        Some(NOT_A_SKY_LOBBY_FLOOR)
    );
    assert_eq!(refused(&sim, SKY, -1).as_deref(), Some(POINT_AT_THE_GAP));
    lay(&mut sim);
    assert_eq!(
        refused(&sim, SKY, LEFT.end + 3).as_deref(),
        Some(ALREADY_BRIDGED)
    );
}

#[test]
fn a_bridge_the_money_does_not_cover_is_quoted_and_not_laid() {
    let mut sim = towers(GameMode::Modern, GAP, SKY);
    sim.money = tile_price() * GAP as f64 - 1.0;
    let quote = sim.quote_skybridge(SKY, LEFT.end);
    assert_eq!(quote.reason.as_deref(), Some("Not enough money."));
    assert_eq!(
        quote.tiles,
        LEFT.end..LEFT.end + GAP,
        "the ghost still shows the whole bridge"
    );
    assert_eq!(quote.cost, tile_price() * GAP as f64);
    let money = sim.money;
    assert!(!sim.build_skybridge(SKY, LEFT.end).ok);
    assert_eq!(sim.money, money);
    assert!(gap_tiles(GAP)
        .into_iter()
        .all(|x| sim.tower.unit_at(SKY, x).is_none()));
}

#[test]
fn the_tool_finishes_a_half_bridge_for_its_missing_tiles() {
    let mut sim = towers(GameMode::Modern, GAP, SKY);
    half_bridge(&mut sim, 4);
    // The two wings are not joined until the last tile goes in.
    let left = sim.tower.seg_at(SKY, Some(LEFT.start as f64));
    let right = sim.tower.seg_at(SKY, Some(right_wing(GAP).start as f64));
    assert_ne!(left, right);
    // Pointing at the half bridge or the open air past it quotes the rest.
    for x in [LEFT.end + 1, LEFT.end + 6] {
        let quote = sim.quote_skybridge(SKY, x);
        assert_eq!(quote.tiles, LEFT.end + 4..LEFT.end + GAP);
        assert_eq!(quote.cost, tile_price() * (GAP - 4) as f64);
    }
    let money = sim.money;
    lay(&mut sim);
    assert_eq!(money - sim.money, tile_price() * (GAP - 4) as f64);
    let right = sim.tower.seg_at(SKY, Some(right_wing(GAP).start as f64));
    assert_eq!(sim.tower.seg_at(SKY, Some(LEFT.start as f64)), right);
}

#[test]
fn nothing_stands_on_a_bridge() {
    let mut sim = towers(GameMode::Modern, GAP, SKY);
    lay(&mut sim);
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

fn sell(sim: &mut Simulation, x: i64) -> Option<String> {
    let id = sim.tower.unit_at(SKY, x).unwrap().id;
    sim.remove_facility(id, RemovalMethod::Bulldoze).reason
}

#[test]
fn the_bulldozer_takes_a_bridge_whole() {
    let mut sim = towers(GameMode::Modern, GAP, SKY);
    lay(&mut sim);
    // A wing's lobby tile stays while a bridge hangs from it.
    assert_eq!(
        sell(&mut sim, LEFT.end - 1).as_deref(),
        Some(BRIDGE_HANGS_HERE)
    );
    // Any tile of it takes the whole bridge, wing to wing, and pays back
    // each tile's sale price.
    let money = sim.money;
    let tile = sim.tower.unit_at(SKY, LEFT.end + 5).unwrap().clone();
    let each = sim.tower.sale_refund(&tile);
    assert_eq!(sell(&mut sim, LEFT.end + 5), None);
    assert!(gap_tiles(GAP)
        .into_iter()
        .all(|x| sim.tower.unit_at(SKY, x).is_none()));
    assert_eq!(sim.money - money, each * GAP as f64);
    // The wings keep their sky lobbies, and the left one's edge sells again.
    assert!(sim.tower.unit_at(SKY, right_wing(GAP).start).is_some());
    assert_eq!(sell(&mut sim, LEFT.end - 1), None);
}

#[test]
fn the_bulldozer_takes_a_half_bridge_to_its_open_end() {
    let mut sim = towers(GameMode::Modern, GAP, SKY);
    half_bridge(&mut sim, 4);
    assert_eq!(sell(&mut sim, LEFT.end + 3), None);
    assert!((LEFT.end..LEFT.end + 4).all(|x| sim.tower.unit_at(SKY, x).is_none()));
}

#[test]
fn nobody_is_left_on_open_air() {
    let mut sim = towers(GameMode::Modern, GAP, SKY);
    lay(&mut sim);
    // Someone walks along the bridge toward the left wing.
    let from = Some(LEFT.end + 2);
    let at = add(&mut sim.crowd, &sim.tower, SKY, SKY, from, Some(LEFT.start));
    let at = at.expect("a walk along floor 15");
    sim.crowd.people[at].x = (LEFT.end + 2) as f64;
    assert_eq!(
        sell(&mut sim, LEFT.end + 7).as_deref(),
        Some(PEOPLE_CROSSING)
    );
    assert!(sim.tower.is_skybridge_tile(SKY, LEFT.end + 2));
    sim.crowd.people[at].x = (LEFT.end - 3) as f64;
    assert_eq!(sell(&mut sim, LEFT.end + 7), None);
}

#[test]
fn a_bridge_beside_a_tall_hall_is_one_story() {
    let mut sim = towers(GameMode::Modern, GAP, SKY - 1);
    // The right wing's sky lobby rises two stories.
    let right: Vec<i64> = right_wing(GAP).collect();
    let tall = sim.with_lobby_height(2, |sim| sim.paint_brush(Kind::Lobby, SKY, &right));
    assert_eq!(tall.placed, right.len() as i64, "{:?}", tall.reason);
    // A one-story bridge tile costs the same beside it.
    assert_eq!(
        sim.quote_skybridge(SKY, LEFT.end).cost,
        tile_price() * GAP as f64
    );
    lay(&mut sim);
    let next_to_hall = sim.tower.unit_at(SKY, right_wing(GAP).start - 1).unwrap();
    assert_eq!(sim.tower.unit_stories(next_to_hall), 1);
}

/// A half bridge saved before the Sky Bridge tool survives a `.vctower`
/// round trip tile for tile (the save format is unchanged), still joins
/// nothing, and the tool then finishes it for the missing tiles' price.
#[test]
fn a_saved_half_bridge_loads_as_it_was_and_the_tool_finishes_it() {
    use crate::load::{decode_vctower, deserialize, encode_simulation_vctower};
    let mut sim = towers(GameMode::Modern, GAP, SKY);
    half_bridge(&mut sim, 3);
    let bytes = encode_simulation_vctower(&sim, "4.8.0", 0.0).unwrap();
    let raw = decode_vctower(std::str::from_utf8(&bytes).unwrap()).unwrap();
    let mut loaded = deserialize(&raw).unwrap();
    for x in gap_tiles(GAP) {
        let laid = x < LEFT.end + 3;
        assert_eq!(loaded.tower.is_skybridge_tile(SKY, x), laid, "column {x}");
    }
    let left = loaded.tower.seg_at(SKY, Some(LEFT.start as f64));
    let right = loaded.tower.seg_at(SKY, Some(right_wing(GAP).start as f64));
    assert_ne!(left, right);
    let money = loaded.money;
    let r = loaded.build_skybridge(SKY, LEFT.end + 5);
    assert!(r.ok, "{:?}", r.reason);
    assert_eq!(money - loaded.money, tile_price() * (GAP - 3) as f64);
    for x in gap_tiles(GAP) {
        assert!(loaded.tower.is_skybridge_tile(SKY, x), "column {x}");
    }
    let right = loaded.tower.seg_at(SKY, Some(right_wing(GAP).start as f64));
    assert_eq!(loaded.tower.seg_at(SKY, Some(LEFT.start as f64)), right);
}

#[test]
fn floors_rise_to_a_story_below_a_bridge_and_no_closer() {
    let mut sim = towers(GameMode::Modern, GAP, SKY);
    lay(&mut sim);
    let x = LEFT.end + 3;
    for floor in 2..SKY - 1 {
        let r = sim.tower.place(Kind::Floor, floor, x);
        assert!(r.ok, "{floor}: {:?}", r.reason);
    }
    let r = sim.tower.place(Kind::Floor, SKY - 1, x);
    assert_eq!(r.reason.as_deref(), Some(UNDER_A_BRIDGE));
    let r = sim
        .tower
        .can_place_structure_ignoring_support(Kind::Floor, SKY - 1, x);
    assert_eq!(r.reason.as_deref(), Some(UNDER_A_BRIDGE));
    assert!(
        gap_tiles(GAP)
            .iter()
            .all(|&c| sim.tower.is_skybridge_tile(SKY, c)),
        "the bridge stays whole"
    );
}

#[test]
fn a_story_under_open_air_on_a_sky_lobby_floor_is_still_fine() {
    let mut sim = towers(GameMode::Modern, GAP, SKY);
    // No bridge: the gap is open air, so floors may rise right up to floor 15.
    let x = LEFT.end + 3;
    for floor in 2..SKY {
        let r = sim.tower.place(Kind::Floor, floor, x);
        assert!(r.ok, "{floor}: {:?}", r.reason);
    }
}

#[test]
fn a_room_right_under_a_bridge_is_refused_in_its_quote_and_its_build() {
    let mut sim = towers(GameMode::Modern, GAP, SKY);
    lay(&mut sim);
    let x = LEFT.end;
    assert!(
        Kind::Office.facility().width <= GAP,
        "the office fits the gap"
    );
    let quote = sim.can_build(Kind::Office, SKY - 1, x);
    assert!(!quote.ok, "no green ghost under a bridge");
    assert_eq!(quote.reason.as_deref(), Some(UNDER_A_BRIDGE));
    let built = sim.build(Kind::Office, SKY - 1, x);
    assert_eq!(built.reason.as_deref(), Some(UNDER_A_BRIDGE));
    assert!(
        gap_tiles(GAP)
            .iter()
            .all(|&c| sim.tower.is_skybridge_tile(SKY, c)),
        "the bridge stays whole"
    );
}
