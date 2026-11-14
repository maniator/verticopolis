//! The bulldozer and lobby tiles (party findings 2026-11-14): Classic keeps
//! every lobby, Modern sells a sky lobby tile like a floor tile, a tall hall
//! tile for half its price per story, and the ground lobby stays in both
//! modes. No floor or lobby tile comes out from under a shaft that needs it.

use super::{GROUND_LOBBY_STAYS, LOBBY_PERMANENT, SHAFT_STANDS_HERE, STORY_ABOVE_STANDS};
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::gameplay::RemovalMethod;
use crate::load::deserialize;
use crate::sim::Simulation;

const ROW: std::ops::Range<i64> = 100..124;
const SKY: i64 = 15;

/// A rich five-star tower in `mode`: a ground lobby over `ROW`, floor over
/// it up to floor 14, and plain floor over `ROW` on the sky lobby floor.
fn tower(mode: GameMode) -> Simulation {
    let mut sim = Simulation::new_game(1, mode);
    sim.money = 1e9;
    sim.star = 5;
    let tiles: Vec<i64> = ROW.collect();
    assert_eq!(sim.paint_brush(Kind::Lobby, 1, &tiles).placed, 24);
    for floor in 2..=SKY {
        assert_eq!(
            sim.paint_brush(Kind::Floor, floor, &tiles).placed,
            24,
            "{floor}"
        );
    }
    sim
}

/// Lays a sky lobby `height` stories high over `xs` on the sky lobby floor.
fn sky_hall(sim: &mut Simulation, height: i64, xs: std::ops::Range<i64>) {
    let tiles: Vec<i64> = xs.collect();
    let laid = sim.with_lobby_height(height, |sim| sim.paint_brush(Kind::Lobby, SKY, &tiles));
    assert_eq!(laid.placed, tiles.len() as i64, "{:?}", laid.reason);
}

fn id_at(sim: &Simulation, floor: i64, x: i64) -> i64 {
    sim.tower.unit_at(floor, x).unwrap().id
}

/// Bulldozes the tile at `(floor, x)` and answers the refusal, or `None`
/// with the refund checked against `refund` when it sold.
fn bulldoze(sim: &mut Simulation, floor: i64, x: i64, refund: f64) -> Option<String> {
    let before = sim.money;
    let r = sim.remove_facility(id_at(sim, floor, x), RemovalMethod::Bulldoze);
    if r.ok {
        assert_eq!(sim.money - before, refund, "the refund at ({floor}, {x})");
        None
    } else {
        assert_eq!(sim.money, before, "a refusal moves no cash");
        r.reason
    }
}

#[test]
fn classic_keeps_every_lobby_tile() {
    let mut sim = tower(GameMode::Classic);
    sky_hall(&mut sim, 1, 120..124);
    for (floor, x) in [(1, 100), (1, 123), (SKY, 123)] {
        assert_eq!(
            bulldoze(&mut sim, floor, x, 0.0).as_deref(),
            Some(LOBBY_PERMANENT)
        );
        assert_eq!(sim.tower.unit_at(floor, x).unwrap().kind, Kind::Lobby);
    }
}

#[test]
fn modern_keeps_the_ground_lobby_and_sells_a_sky_lobby_tile() {
    let mut sim = tower(GameMode::Modern);
    sky_hall(&mut sim, 1, 120..124);
    assert_eq!(
        bulldoze(&mut sim, 1, 123, 0.0).as_deref(),
        Some(GROUND_LOBBY_STAYS)
    );
    let half = Kind::Lobby.resale_refund();
    assert_eq!(bulldoze(&mut sim, SKY, 123, half), None);
    assert!(!sim.tower.has_structure(SKY, 123));
    // A gap in the middle of the hall is Modern's to open, as for floors.
    assert_eq!(bulldoze(&mut sim, SKY, 121, half), None);
    assert_eq!(sim.tower.lobby_tile_count(SKY), 2);
}

#[test]
fn a_tall_sky_hall_tile_sells_for_half_its_price_on_every_story() {
    let mut sim = tower(GameMode::Modern);
    sky_hall(&mut sim, 3, 116..124);
    assert!(sim.tower.has_structure(SKY + 2, 123));
    let refund = Kind::Lobby.resale_refund() * 3.0;
    assert_eq!(bulldoze(&mut sim, SKY, 123, refund), None);
    for story in SKY..SKY + 3 {
        assert!(!sim.tower.has_structure(story, 123), "story {story}");
    }
    // The hall's raised story names the same tile, so a pick there sells it too.
    assert_eq!(id_at(&sim, SKY + 1, 122), id_at(&sim, SKY, 122));
    assert_eq!(bulldoze(&mut sim, SKY + 1, 122, refund), None);
    let runs = sim.tower.tall_lobby_runs();
    assert_eq!(&runs[..], &[[SKY, 116, 121, 3]]);
}

#[test]
fn a_tall_hall_tile_under_a_story_stays() {
    let mut sim = tower(GameMode::Modern);
    sky_hall(&mut sim, 3, 116..124);
    assert!(sim.tower.place(Kind::Floor, SKY + 3, 123).ok);
    assert_eq!(
        bulldoze(&mut sim, SKY, 123, 0.0).as_deref(),
        Some(STORY_ABOVE_STANDS)
    );
    // The tile beside it has nothing over its hall.
    let refund = Kind::Lobby.resale_refund() * 3.0;
    assert_eq!(bulldoze(&mut sim, SKY, 116, refund), None);
}

#[test]
fn no_tile_comes_out_from_under_a_shaft_that_needs_it_in_either_mode() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let mut sim = tower(mode);
        // A standard elevator four columns wide over 120..124, from the
        // ground floor to the top floor's plain floor.
        assert!(
            sim.tower
                .place_transport(Kind::ElevatorStandard, 120, 1, SKY)
                .ok
        );
        let floor = Kind::Floor.resale_refund();
        // The shaft keeps floor in its column while any of its four tiles stands.
        for x in [123, 122, 121] {
            assert_eq!(bulldoze(&mut sim, SKY, x, floor), None, "{mode:?} {x}");
        }
        let refused = bulldoze(&mut sim, SKY, 120, 0.0);
        assert_eq!(refused.as_deref(), Some(SHAFT_STANDS_HERE), "{mode:?}");
        assert!(sim.tower.has_structure(SKY, 120));
    }
}

#[test]
fn no_tall_hall_tile_comes_out_from_under_a_shaft_that_lands_on_it() {
    let mut sim = tower(GameMode::Modern);
    sky_hall(&mut sim, 3, 116..124);
    // A standard elevator from the ground floor up to the hall's own floor.
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorStandard, 120, 1, SKY)
            .ok
    );
    let refund = Kind::Lobby.resale_refund() * 3.0;
    for x in [123, 122, 121] {
        assert_eq!(bulldoze(&mut sim, SKY, x, refund), None, "{x}");
    }
    assert_eq!(
        bulldoze(&mut sim, SKY, 120, 0.0).as_deref(),
        Some(SHAFT_STANDS_HERE)
    );
}

#[test]
fn the_last_sky_lobby_tile_takes_the_express_stop_with_it() {
    let mut sim = tower(GameMode::Modern);
    // Floors over the express's columns only, so nothing stands over the hall.
    let tiles: Vec<i64> = (104..124).collect();
    for floor in SKY + 1..=20 {
        assert_eq!(sim.paint_brush(Kind::Floor, floor, &tiles).placed, 20);
    }
    sky_hall(&mut sim, 1, 100..102);
    let express = sim.tower.place_transport(Kind::ElevatorExpress, 110, 1, 20);
    assert!(express.ok, "{:?}", express.reason);
    let id = express.unit_id.unwrap();
    let stops_at_sky = |sim: &Simulation| {
        let t = sim.tower.get_transport(id).unwrap();
        !t.skip_floors
            .as_deref()
            .unwrap_or(&[])
            .contains(&(SKY as f64))
    };
    assert!(stops_at_sky(&sim));
    let half = Kind::Lobby.resale_refund();
    assert_eq!(bulldoze(&mut sim, SKY, 101, half), None);
    assert!(
        stops_at_sky(&sim),
        "one lobby tile still makes it a lobby floor"
    );
    assert_eq!(bulldoze(&mut sim, SKY, 100, half), None);
    assert!(
        !stops_at_sky(&sim),
        "no lobby tile left, so no express stop"
    );
}

#[test]
fn undoing_the_sale_of_a_tall_hall_tile_puts_back_its_height_and_the_save_keeps_it() {
    let mut sim = tower(GameMode::Modern);
    sky_hall(&mut sim, 3, 116..124);
    let money = sim.money;
    sim.begin_undo_journal("Bulldoze");
    assert_eq!(
        bulldoze(&mut sim, SKY, 123, Kind::Lobby.resale_refund() * 3.0),
        None
    );
    let step = sim.end_undo_journal().expect("the sale is a step");
    let redo = sim.apply_undo_step(&step).expect("the undo applies");
    assert_eq!(sim.money, money, "the undo takes the refund back");
    assert_eq!(sim.tower.lobby_height_at(SKY, 123), 3);
    assert!(sim.tower.has_structure(SKY + 2, 123));
    let loaded = deserialize(&sim.serialize()).unwrap();
    assert_eq!(&loaded.tower.tall_lobby_runs()[..], &[[SKY, 116, 123, 3]]);
    // The redo sells it again.
    sim.apply_undo_step(&redo).expect("the redo applies");
    assert!(!sim.tower.has_structure(SKY + 1, 123));
}

#[test]
fn an_undo_never_puts_a_hall_tile_back_over_a_tile_built_since() {
    let mut sim = tower(GameMode::Modern);
    sky_hall(&mut sim, 3, 116..124);
    sim.begin_undo_journal("Bulldoze");
    assert_eq!(
        bulldoze(&mut sim, SKY, 123, Kind::Lobby.resale_refund() * 3.0),
        None
    );
    let step = sim.end_undo_journal().expect("the sale is a step");
    // A new one-story hall tile stands where the tall one stood.
    let laid = sim.with_lobby_height(1, |sim| sim.paint_brush(Kind::Lobby, SKY, &[123]));
    assert_eq!(laid.placed, 1, "{:?}", laid.reason);
    let new_tile = id_at(&sim, SKY, 123);
    assert!(sim.apply_undo_step(&step).is_err());
    assert_eq!(id_at(&sim, SKY, 123), new_tile);
}

#[test]
fn a_redo_never_sells_a_tall_hall_tile_out_from_under_a_story_built_since() {
    let mut sim = tower(GameMode::Modern);
    sky_hall(&mut sim, 3, 116..124);
    sim.begin_undo_journal("Bulldoze");
    assert_eq!(
        bulldoze(&mut sim, SKY, 123, Kind::Lobby.resale_refund() * 3.0),
        None
    );
    let step = sim.end_undo_journal().expect("the sale is a step");
    let redo = sim.apply_undo_step(&step).expect("the undo applies");
    assert!(sim.tower.place(Kind::Floor, SKY + 3, 123).ok);
    assert!(sim.apply_undo_step(&redo).is_err());
    assert!(
        sim.tower.has_structure(SKY + 1, 123),
        "the hall still holds the floor up"
    );
}

#[test]
fn an_undo_never_takes_a_tall_hall_out_from_under_a_story_built_since() {
    let mut sim = tower(GameMode::Modern);
    sim.begin_undo_journal("Lobby");
    sky_hall(&mut sim, 3, 120..124);
    let step = sim.end_undo_journal().expect("the build is a step");
    assert!(sim.tower.place(Kind::Floor, SKY + 3, 123).ok);
    assert!(sim.apply_undo_step(&step).is_err());
    assert!(
        sim.tower.has_structure(SKY + 1, 123),
        "the hall still holds the floor up"
    );
}

#[test]
fn a_room_of_several_stories_still_refunds_half_its_price_once() {
    let mut sim = tower(GameMode::Modern);
    let laid = sim.build(Kind::PartyHall, 5, 100);
    assert!(laid.ok, "{:?}", laid.reason);
    let id = id_at(&sim, 5, 100);
    assert!(sim
        .tower
        .get_unit(id)
        .is_some_and(|u| sim.tower.unit_stories(u) == 2));
    let before = sim.money;
    assert!(sim.remove_facility(id, RemovalMethod::Bulldoze).ok);
    assert_eq!(sim.money - before, Kind::PartyHall.resale_refund());
}
