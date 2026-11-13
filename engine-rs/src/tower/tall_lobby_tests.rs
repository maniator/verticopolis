//! Tall lobbies (#308): the height a floor's first lobby placement sets,
//! what the stories it rises through refuse, the shafts that pass them, and
//! the save and `.TDT` round trips.

use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::load::{deserialize, deserialize_tdt};
use crate::sim::{Simulation, PLAIN_SAVE_VERSION, SAVE_VERSION};
use crate::{export_tdt, import_tdt};
use serde_json::{json, Value};

const LOBBY_X: std::ops::Range<i64> = 100..124;

/// A rich five-star tower whose ground lobby, laid in one brush stroke over
/// `LOBBY_X`, asked for `height` stories.
fn tower(mode: GameMode, height: i64) -> Simulation {
    let mut sim = Simulation::new_game(1, mode);
    sim.money = 1e9;
    sim.star = 5;
    let tiles: Vec<i64> = LOBBY_X.collect();
    let laid = sim.with_lobby_height(height, |sim| sim.paint_brush(Kind::Lobby, 1, &tiles));
    assert_eq!(laid.placed, tiles.len() as i64, "{:?}", laid.reason);
    sim
}

/// Lays plain floor over `LOBBY_X` on each of `floors`.
fn floors(sim: &mut Simulation, floors: std::ops::RangeInclusive<i64>) {
    let tiles: Vec<i64> = LOBBY_X.collect();
    for fl in floors {
        let laid = sim.paint_brush(Kind::Floor, fl, &tiles);
        assert_eq!(
            laid.placed,
            tiles.len() as i64,
            "floor {fl}: {:?}",
            laid.reason
        );
    }
}

#[test]
fn the_first_ground_lobby_placement_sets_its_height_in_both_modes() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        for height in 1..=3 {
            let sim = tower(mode, height);
            let t = &sim.tower;
            assert_eq!(t.lobby_height(1), height, "{mode:?}");
            for story in 2..=3 {
                let inside = story <= height;
                assert_eq!(
                    t.is_tall_lobby_story(story),
                    inside,
                    "{mode:?} {height} {story}"
                );
                assert_eq!(t.has_structure(story, 112), inside);
                assert!(
                    !t.floor_has_lobby(story),
                    "only the lobby's own floor is a lobby floor"
                );
            }
            // The unit under a raised story is the lobby itself.
            if height > 1 {
                assert_eq!(t.unit_at(height, 112).map(|u| u.kind), Some(Kind::Lobby));
            }
        }
    }
}

#[test]
fn a_lobby_never_changes_height_once_built() {
    let mut sim = tower(GameMode::Classic, 3);
    // Asking for one story or two later still builds three.
    for asked in [1, 2] {
        let x = 124 + asked;
        let r = sim.with_lobby_height(asked, |sim| sim.build(Kind::Lobby, 1, x));
        assert!(r.ok, "{:?}", r.reason);
        assert_eq!(sim.tower.lobby_height(1), 3);
        assert!(
            sim.tower.has_structure(3, x),
            "the new section rises to the lobby's height"
        );
    }
    // The same for a one-story lobby asked to rise.
    let mut sim = tower(GameMode::Classic, 1);
    let r = sim.with_lobby_height(3, |sim| sim.build(Kind::Lobby, 1, 124));
    assert!(r.ok);
    assert_eq!(sim.tower.lobby_height(1), 1);
    assert!(!sim.tower.has_structure(2, 124));
}

#[test]
fn a_tall_lobby_costs_the_lobby_price_once_per_story() {
    let lobby = Kind::Lobby.facility().cost;
    let floor = Kind::Floor.facility().cost;
    for height in 1..=3 {
        let sim = Simulation::new_game(1, GameMode::Classic);
        let quote = sim.clone_quote(height);
        assert_eq!(quote, lobby * height as f64 + floor, "height {height}");
    }
}

impl Simulation {
    /// The price of a first bare lobby tile on floor 1 asked `height` high.
    fn clone_quote(&self, height: i64) -> f64 {
        let mut sim = deserialize(&self.serialize()).unwrap();
        sim.with_lobby_height(height, |sim| sim.can_build(Kind::Lobby, 1, 100).cost)
    }
}

#[test]
fn classic_raises_only_the_ground_lobby_and_modern_raises_sky_lobbies_too() {
    let tiles: Vec<i64> = LOBBY_X.collect();
    let mut modern = tower(GameMode::Modern, 1);
    floors(&mut modern, 2..=14);
    let laid = modern.with_lobby_height(3, |sim| sim.paint_brush(Kind::Lobby, 15, &tiles));
    assert!(laid.placed > 0, "{:?}", laid.reason);
    assert_eq!(modern.tower.lobby_height(15), 3);
    assert!(modern.tower.is_tall_lobby_story(16));
}

// Regression (owner, 2026-11-13): a Classic player picked 3 stories and
// painted a sky lobby, and got a permanent one-story lobby without a word.
// Classic refuses it outright, quote and brush alike, and names the way to
// build one; one story still builds, and a taller pick then extends it at
// its own height.
#[test]
fn a_taller_classic_sky_lobby_is_refused_with_the_way_to_build_one() {
    let tiles: Vec<i64> = LOBBY_X.collect();
    let mut classic = tower(GameMode::Classic, 1);
    floors(&mut classic, 2..=14);
    for height in [2, 3] {
        let quote = classic.with_lobby_height(height, |sim| sim.can_build(Kind::Lobby, 15, 110));
        assert!(!quote.ok, "{height}");
        let laid =
            classic.with_lobby_height(height, |sim| sim.paint_brush(Kind::Lobby, 15, &tiles));
        assert_eq!(laid.placed, 0, "{height}");
        let reason = laid.reason.unwrap();
        assert_eq!(
            reason,
            "In Classic, only the ground lobby can be taller than one story. Pick 1 story to build a lobby on floor 15."
        );
    }
    assert!(!classic.tower.floor_has_lobby(15));
    let one = classic.with_lobby_height(1, |sim| sim.paint_brush(Kind::Lobby, 15, &tiles[..4]));
    assert_eq!(one.placed, 4, "{:?}", one.reason);
    let more = classic.with_lobby_height(3, |sim| sim.paint_brush(Kind::Lobby, 15, &tiles[4..]));
    assert_eq!(more.placed, tiles.len() as i64 - 4, "{:?}", more.reason);
    assert_eq!(classic.tower.lobby_height(15), 1);
    // The ground lobby still rises in Classic.
    assert_eq!(tower(GameMode::Classic, 3).tower.lobby_height(1), 3);
}

#[test]
fn a_tall_sky_lobby_needs_the_stories_it_rises_through_clear() {
    let mut sim = tower(GameMode::Modern, 1);
    floors(&mut sim, 2..=16);
    let r = sim.with_lobby_height(2, |sim| sim.build(Kind::Lobby, 15, 112));
    assert!(!r.ok);
    assert!(r.reason.unwrap().contains("Clear floor 16"));
    // One story still fits.
    assert!(
        sim.with_lobby_height(1, |sim| sim.build(Kind::Lobby, 15, 112))
            .ok
    );
}

#[test]
fn nothing_is_built_on_the_stories_a_tall_lobby_rises_through() {
    let mut sim = tower(GameMode::Classic, 3);
    for story in 2..=3 {
        let room = sim.build(Kind::Office, story, 110);
        assert!(!room.ok);
        assert!(room.reason.unwrap().contains("tall lobby"), "story {story}");
        assert!(
            !sim.build(Kind::Floor, story, 125).ok,
            "no floor beside it either"
        );
    }
    // The story above stands on the lobby.
    floors(&mut sim, 4..=4);
    assert!(sim.build(Kind::Office, 4, 110).ok);
    // And the lobby, every story of it, stays for good.
    let id = sim.tower.unit_at(2, 112).unwrap().id;
    assert!(sim.tower.removal_reason(id).is_some());
}

#[test]
fn shafts_pass_through_a_tall_lobby_without_stopping_or_ending_there() {
    let mut sim = tower(GameMode::Classic, 3);
    floors(&mut sim, 4..=8);
    for top in [2, 3] {
        let r = sim
            .tower
            .validate_transport(Kind::ElevatorStandard, 110, 1, top);
        assert!(!r.ok);
        assert!(r.reason.unwrap().contains("can't stop there"));
    }
    let placed = sim.tower.place_transport(Kind::ElevatorStandard, 110, 1, 8);
    assert!(placed.ok, "{:?}", placed.reason);
    let id = placed.unit_id.unwrap();
    let t = sim.tower.get_transport(id).unwrap().clone();
    assert_eq!(sim.tower.stops_of(&t), vec![1, 4, 5, 6, 7, 8]);
    assert!(!sim.tower.set_stop(id, 2, true), "no stop inside the lobby");
    assert!(sim.tower.clear_stops(id));
    let t = sim.tower.get_transport(id).unwrap().clone();
    assert_eq!(
        sim.tower.stops_of(&t),
        vec![1, 4, 5, 6, 7, 8],
        "clearing keeps the rule"
    );
    // Shrinking it to end inside the lobby is refused too.
    assert!(!sim.tower.resize_transport(id, 1, 3).ok);
}

#[test]
fn stairs_and_escalators_climb_the_whole_lobby() {
    let mut sim = tower(GameMode::Classic, 3);
    floors(&mut sim, 4..=4);
    let placed = sim.tower.place_transport(Kind::Stairs, 100, 1, 2);
    assert!(placed.ok, "{:?}", placed.reason);
    let t = sim
        .tower
        .get_transport(placed.unit_id.unwrap())
        .unwrap()
        .clone();
    assert_eq!((t.bottom, t.top), (1, 4));
    assert_eq!(sim.tower.stops_of(&t), vec![1, 4]);
    // A flight of the old fixed span still links two plain floors.
    floors(&mut sim, 5..=5);
    assert!(sim.tower.place_transport(Kind::Escalator, 112, 4, 5).ok);
    assert!(!sim.tower.validate_transport(Kind::Escalator, 112, 4, 6).ok);
}

#[test]
fn a_tall_lobby_round_trips_through_the_save_and_only_it_takes_version_8() {
    let plain = tower(GameMode::Classic, 1).serialize();
    assert_eq!(plain["version"], json!(PLAIN_SAVE_VERSION));
    assert!(plain.get("lobbyHeights").is_none());

    let mut sim = tower(GameMode::Classic, 3);
    floors(&mut sim, 4..=4);
    let save = sim.serialize();
    assert_eq!(save["version"], json!(SAVE_VERSION));
    assert_eq!(save["lobbyHeights"], json!([[1, 3]]));
    let back = deserialize(&save).unwrap();
    assert_eq!(back.tower.lobby_height(1), 3);
    assert!(back.tower.has_structure(3, 112));
    let again = back.serialize();
    assert_eq!(again["lobbyHeights"], save["lobbyHeights"]);
    assert_eq!(
        again["units"], save["units"],
        "no unit is added on the raised stories"
    );
}

/// A save whose `lobbyHeights` is replaced by `heights`, loaded.
fn load_with(sim: &Simulation, heights: Value) -> Simulation {
    let mut save = sim.serialize();
    save["lobbyHeights"] = heights;
    save["version"] = json!(SAVE_VERSION);
    deserialize(&save).unwrap()
}

#[test]
fn the_loader_keeps_only_heights_the_tower_could_have_built() {
    let mut sim = tower(GameMode::Classic, 1);
    floors(&mut sim, 2..=16);
    let tiles: Vec<i64> = LOBBY_X.collect();
    sim.paint_brush(Kind::Lobby, 15, &tiles);
    for heights in [
        json!([[1, 2]]),   // floor 2 holds floor tiles
        json!([[15, 2]]),  // Classic sky lobby
        json!([[1, 4]]),   // too tall
        json!([[1, 1.5]]), // not a whole number
        json!("tall"),     // not a list
        json!([[7, 2]]),   // no lobby there
    ] {
        let back = load_with(&sim, heights.clone());
        assert_eq!(back.tower.tall_lobbies(), vec![], "{heights}");
    }
    // The bare tower takes it.
    let bare = tower(GameMode::Classic, 1);
    assert_eq!(load_with(&bare, json!([[1, 3]])).tower.lobby_height(1), 3);
}

#[test]
fn undo_takes_a_tall_lobby_away_whole() {
    let mut empty = Simulation::new_game(1, GameMode::Classic);
    empty.money = 1e9;
    empty.star = 5;
    empty.begin_undo_journal("Edit");
    let tiles: Vec<i64> = LOBBY_X.collect();
    empty.with_lobby_height(3, |sim| sim.paint_brush(Kind::Lobby, 1, &tiles));
    let step = empty.end_undo_journal().expect("the brush made a step");
    let redo = empty.apply_undo_step(&step).expect("the undo applies");
    assert!(!empty.tower.has_structure(2, 112));
    assert!(!empty.tower.is_tall_lobby_story(2));
    empty.apply_undo_step(&redo).expect("the redo applies");
    assert_eq!(empty.tower.lobby_height(1), 3);
    assert!(empty.tower.has_structure(3, 112));
}

#[test]
fn a_tall_ground_lobby_round_trips_through_the_tdt() {
    for height in [2, 3] {
        let mut sim = tower(GameMode::Classic, height);
        floors(&mut sim, height + 1..=height + 1);
        assert!(sim.tower.place_transport(Kind::Stairs, 100, 1, 2).ok);
        assert!(sim.build(Kind::Office, height + 1, 112).ok);
        let bytes = export_tdt(&sim.serialize().to_string()).unwrap();
        assert_eq!(u16::from_le_bytes([bytes[28], bytes[29]]) as i64, height);
        let (text, _) = import_tdt(&bytes, "TALL.TDT").unwrap();
        let save: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(save["lobbyHeights"], json!([[1, height]]));
        let back = deserialize_tdt(&save).unwrap();
        assert_eq!(back.tower.lobby_height(1), height);
        assert!(back.tower.has_structure(height, 112));
        let stairs: Vec<_> = back
            .tower
            .transports
            .iter()
            .filter(|t| t.kind == Kind::Stairs)
            .collect();
        assert_eq!(stairs.len(), 1);
        assert_eq!((stairs[0].bottom, stairs[0].top), (1, 1 + height));
        assert_eq!(
            back.tower.unit_at(height + 1, 112).map(|u| u.kind),
            Some(Kind::Office)
        );
    }
}

#[test]
fn a_one_story_ground_lobby_still_writes_height_1_and_no_lobby_writes_0() {
    let sim = tower(GameMode::Classic, 1);
    let bytes = export_tdt(&sim.serialize().to_string()).unwrap();
    assert_eq!(u16::from_le_bytes([bytes[28], bytes[29]]), 1);
    let empty = Simulation::new_game(1, GameMode::Classic);
    let bytes = export_tdt(&empty.serialize().to_string()).unwrap();
    assert_eq!(u16::from_le_bytes([bytes[28], bytes[29]]), 0);
    let (text, _) = import_tdt(&bytes, "EMPTY.TDT").unwrap();
    let save: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(save["version"], json!(PLAIN_SAVE_VERSION));
}

/// A Modern tower: a one-story ground lobby, floors 2 to 14, a three-story
/// sky lobby on floor 15, and floors 18 to 22 over it.
fn tall_sky_tower() -> Simulation {
    let mut sim = tower(GameMode::Modern, 1);
    floors(&mut sim, 2..=14);
    let tiles: Vec<i64> = LOBBY_X.collect();
    let laid = sim.with_lobby_height(3, |sim| sim.paint_brush(Kind::Lobby, 15, &tiles));
    assert_eq!(laid.placed, tiles.len() as i64, "{:?}", laid.reason);
    floors(&mut sim, 18..=22);
    sim
}

// Regression (owner, 2026-11-13): no elevator may stop on a story a tall
// lobby rises through, whatever the kind and however its stops are edited.
#[test]
fn no_elevator_kind_stops_inside_a_tall_sky_lobby() {
    let mut sim = tall_sky_tower();
    for kind in [
        Kind::ElevatorStandard,
        Kind::ElevatorService,
        Kind::ElevatorExpress,
    ] {
        let placed = sim.tower.place_transport(kind, 104, 10, 20);
        assert!(placed.ok, "{kind:?}: {:?}", placed.reason);
        let id = placed.unit_id.unwrap();
        let stops = |sim: &Simulation| {
            let t = sim.tower.get_transport(id).unwrap().clone();
            sim.tower.stops_of(&t)
        };
        let inside = |s: &[i64]| s.contains(&16) || s.contains(&17);
        assert!(!inside(&stops(&sim)), "{kind:?}: {:?}", stops(&sim));
        for story in [16, 17] {
            assert!(!sim.tower.set_stop(id, story, true), "{kind:?} {story}");
        }
        assert!(sim.tower.clear_stops(id));
        assert!(!inside(&stops(&sim)), "{kind:?} after clearing");
        // It may not end inside the lobby, from either end.
        for (bottom, top) in [(10, 16), (10, 17), (16, 20), (17, 22)] {
            assert!(
                !sim.tower.resize_transport(id, bottom, top).ok,
                "{kind:?} {bottom}-{top}"
            );
            assert!(
                !sim.tower.validate_transport(kind, 104, bottom, top).ok,
                "{kind:?} {bottom}-{top}"
            );
        }
        // Grown past the lobby, it still skips it.
        assert!(sim.tower.resize_transport(id, 10, 22).ok, "{kind:?}");
        assert!(!inside(&stops(&sim)), "{kind:?} after growing");
        sim.tower.remove_transport(id);
    }
}

#[test]
fn a_loaded_skip_list_that_stops_inside_a_tall_lobby_is_corrected() {
    let mut sim = tall_sky_tower();
    let id = sim
        .tower
        .place_transport(Kind::ElevatorStandard, 104, 12, 20)
        .unit_id
        .unwrap();
    let mut save = sim.serialize();
    for t in save["transports"].as_array_mut().unwrap() {
        if t["id"] == json!(id) {
            t["skipFloors"] = json!([]);
        }
    }
    let back = deserialize(&save).unwrap();
    let t = back.tower.get_transport(id).unwrap().clone();
    let stops = back.tower.stops_of(&t);
    assert!(!stops.contains(&16) && !stops.contains(&17), "{stops:?}");
    assert!(stops.contains(&15) && stops.contains(&18), "{stops:?}");
}
