//! Lobby halls in a split Modern tower (#2068): each hall keeps its own
//! height, a tall hall claims only the stories over its own tiles, halls of
//! one height merge, halls of different heights sit side by side, and the
//! save lists each hall.

use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::load::deserialize;
use crate::sim::{Simulation, TALL_LOBBY_SAVE_VERSION};
use serde_json::{json, Value};

/// Paints `kind` over `xs` on `floor` in brush-sized strokes; every tile lays.
fn paint(sim: &mut Simulation, kind: Kind, floor: i64, xs: std::ops::Range<i64>) {
    let tiles: Vec<i64> = xs.collect();
    for stroke in tiles.chunks(crate::brush::BRUSH_TILE_LIMIT) {
        let laid = sim.paint_brush(kind, floor, stroke);
        assert_eq!(
            laid.placed,
            stroke.len() as i64,
            "{kind:?} {floor}: {:?}",
            laid.reason
        );
    }
}

/// A rich five-star Modern tower with bridging off: a one-story ground
/// lobby and plain floors 2 to 14 over columns 90 to 149.
fn split_tower() -> Simulation {
    let mut sim = Simulation::new_game(1, GameMode::Modern);
    sim.money = 1e9;
    sim.star = 5;
    if sim.auto_bridge {
        sim.toggle_auto_bridge();
    }
    paint(&mut sim, Kind::Lobby, 1, 90..150);
    for floor in 2..=14 {
        paint(&mut sim, Kind::Floor, floor, 90..150);
    }
    sim
}

/// Lays a sky lobby hall `height` stories high over `xs` on floor 15.
fn hall(sim: &mut Simulation, height: i64, xs: std::ops::Range<i64>) {
    sim.with_lobby_height(height, |sim| paint(sim, Kind::Lobby, 15, xs));
}

/// Lays plain floor over `xs` on `floor`.
fn floor(sim: &mut Simulation, floor: i64, xs: std::ops::Range<i64>) {
    paint(sim, Kind::Floor, floor, xs);
}

fn runs(sim: &Simulation) -> Vec<[i64; 4]> {
    sim.tower.tall_lobby_runs().to_vec()
}

// The trap #2068 removes: a tall hall claimed its raised stories across the
// whole lot, so the other tower could never build on them.
#[test]
fn a_tall_hall_leaves_the_rest_of_its_raised_stories_buildable() {
    let mut sim = split_tower();
    hall(&mut sim, 1, 120..130);
    hall(&mut sim, 3, 100..110);
    assert_eq!(runs(&sim), vec![[15, 100, 109, 3]]);
    // The right tower builds on 16 and 17 over its own one-story hall.
    floor(&mut sim, 16, 120..130);
    floor(&mut sim, 17, 120..130);
    let office = sim.build(Kind::Office, 16, 120);
    assert!(office.ok, "{:?}", office.reason);
    // Over the tall hall the stories stay part of it.
    let refused = sim.build(Kind::Floor, 16, 105);
    assert!(!refused.ok);
    let reason = refused.reason.unwrap();
    assert!(reason.contains("tall lobby on floor 15"), "{reason}");
}

#[test]
fn floors_already_over_one_hall_do_not_block_a_tall_hall_beside_it() {
    let mut sim = split_tower();
    hall(&mut sim, 1, 120..130);
    floor(&mut sim, 16, 120..130);
    floor(&mut sim, 17, 120..130);
    hall(&mut sim, 3, 100..110);
    assert_eq!(sim.tower.lobby_height_at(15, 105), 3);
    assert_eq!(sim.tower.lobby_height_at(15, 125), 1);
    // A tall hall still needs its own raised tiles clear.
    let mut blocked = split_tower();
    floor(&mut blocked, 15, 100..110);
    floor(&mut blocked, 16, 100..110);
    let r = blocked.with_lobby_height(2, |sim| sim.build(Kind::Lobby, 15, 140));
    assert!(r.ok, "nothing over 140: {:?}", r.reason);
}

#[test]
fn two_halls_of_different_heights_each_claim_their_own_stories() {
    let mut sim = split_tower();
    hall(&mut sim, 3, 100..110);
    hall(&mut sim, 2, 120..130);
    assert_eq!(runs(&sim), vec![[15, 100, 109, 3], [15, 120, 129, 2]]);
    let t = &sim.tower;
    assert!(
        t.has_structure(17, 105),
        "the 3-story hall rises through 17"
    );
    assert!(t.has_structure(16, 125) && !t.has_structure(17, 125));
    assert_eq!(t.lobby_height(15), 3, "the floor's tallest hall");
}

#[test]
fn closing_a_gap_between_two_heights_joins_the_left_hall() {
    let mut sim = split_tower();
    hall(&mut sim, 2, 100..110);
    hall(&mut sim, 3, 111..121);
    let lobby = Kind::Lobby.facility().cost;
    let floor_cost = Kind::Floor.facility().cost;
    let quote = sim.can_build(Kind::Lobby, 15, 110);
    assert!(quote.ok, "{:?}", quote.reason);
    assert_eq!(
        quote.cost,
        lobby * 2.0 + floor_cost,
        "the left hall's height, per story"
    );
    sim.begin_undo_journal("Edit");
    assert!(sim.build(Kind::Lobby, 15, 110).ok);
    let step = sim.end_undo_journal().expect("a step");
    assert_eq!(runs(&sim), vec![[15, 100, 110, 2], [15, 111, 120, 3]]);
    assert!(sim.tower.has_structure(16, 110) && !sim.tower.has_structure(17, 110));
    assert!(sim.tower.has_structure(17, 111));
    sim.apply_undo_step(&step).expect("the undo applies");
    assert_eq!(runs(&sim), vec![[15, 100, 109, 2], [15, 111, 120, 3]]);
    assert!(!sim.tower.has_structure(15, 110));
}

#[test]
fn closing_a_gap_between_equal_heights_merges_the_halls() {
    let mut sim = split_tower();
    hall(&mut sim, 2, 100..110);
    hall(&mut sim, 2, 111..121);
    sim.begin_undo_journal("Edit");
    // Asking for three stories still joins at the halls' two.
    assert!(
        sim.with_lobby_height(3, |sim| sim.build(Kind::Lobby, 15, 110))
            .ok
    );
    let step = sim.end_undo_journal().expect("a step");
    assert_eq!(runs(&sim), vec![[15, 100, 120, 2]]);
    sim.apply_undo_step(&step).expect("the undo applies");
    assert_eq!(runs(&sim), vec![[15, 100, 109, 2], [15, 111, 120, 2]]);
}

#[test]
fn a_tile_laid_against_a_hall_takes_its_height_whatever_is_asked() {
    let mut sim = split_tower();
    hall(&mut sim, 3, 100..110);
    assert!(
        sim.with_lobby_height(1, |sim| sim.build(Kind::Lobby, 15, 110))
            .ok
    );
    assert!(
        sim.with_lobby_height(2, |sim| sim.build(Kind::Lobby, 15, 99))
            .ok
    );
    assert_eq!(runs(&sim), vec![[15, 99, 110, 3]]);
}

#[test]
fn a_shaft_stops_beside_a_tall_hall_and_skips_inside_it() {
    let mut sim = split_tower();
    hall(&mut sim, 3, 100..110);
    hall(&mut sim, 1, 120..130);
    for f in 16..=20 {
        floor(&mut sim, f, 120..130);
    }
    for f in 18..=20 {
        floor(&mut sim, f, 100..110);
    }
    let stops = |sim: &Simulation, x: i64| {
        let placed = sim
            .tower
            .validate_transport(Kind::ElevatorStandard, x, 10, 20);
        assert!(placed.ok, "{x}: {:?}", placed.reason);
        let mut probe = deserialize(&sim.serialize()).unwrap();
        let id = probe
            .tower
            .place_transport(Kind::ElevatorStandard, x, 10, 20)
            .unit_id
            .unwrap();
        let t = probe.tower.get_transport(id).unwrap().clone();
        probe.tower.stops_of(&t)
    };
    let beside = stops(&sim, 122);
    assert!(beside.contains(&16) && beside.contains(&17), "{beside:?}");
    let under = stops(&sim, 102);
    assert!(!under.contains(&16) && !under.contains(&17), "{under:?}");
    assert!(under.contains(&15) && under.contains(&18), "{under:?}");
    // A shaft beside the hall may end on 16; one under it may not.
    assert!(
        sim.tower
            .validate_transport(Kind::ElevatorStandard, 122, 10, 16)
            .ok
    );
    assert!(
        !sim.tower
            .validate_transport(Kind::ElevatorStandard, 102, 10, 16)
            .ok
    );
}

#[test]
fn a_shaft_already_passing_a_new_tall_tile_skips_its_raised_stories() {
    let mut sim = split_tower();
    for f in 15..=20 {
        floor(&mut sim, f, 100..105);
    }
    // Columns 102 to 105; floor holds it up on every story over 102 to 104.
    let id = sim
        .tower
        .place_transport(Kind::ElevatorStandard, 102, 10, 20)
        .unit_id
        .unwrap();
    let stops = |sim: &Simulation| {
        let t = sim.tower.get_transport(id).unwrap().clone();
        sim.tower.stops_of(&t)
    };
    assert!(stops(&sim).contains(&16));
    // A 2-story hall of its own under the shaft's last column, where 16 is open.
    let r = sim.with_lobby_height(2, |sim| sim.build(Kind::Lobby, 15, 105));
    assert!(r.ok, "{:?}", r.reason);
    assert_eq!(sim.tower.lobby_height_at(15, 105), 2);
    assert!(!stops(&sim).contains(&16), "{:?}", stops(&sim));
    assert!(!sim.tower.set_stop(id, 16, true));
}

#[test]
fn stairs_out_of_each_hall_climb_that_hall() {
    let mut sim = split_tower();
    hall(&mut sim, 3, 100..110);
    hall(&mut sim, 2, 120..130);
    floor(&mut sim, 18, 100..110);
    floor(&mut sim, 17, 120..130);
    let tall = sim.tower.place_transport(Kind::Stairs, 102, 15, 16);
    let short = sim.tower.place_transport(Kind::Stairs, 122, 15, 16);
    let top = |sim: &Simulation, id: Option<i64>| sim.tower.get_transport(id.unwrap()).unwrap().top;
    assert_eq!(top(&sim, tall.unit_id), 18);
    assert_eq!(top(&sim, short.unit_id), 17);
}

#[test]
fn halls_round_trip_through_the_save_as_runs() {
    let mut sim = split_tower();
    hall(&mut sim, 3, 100..110);
    hall(&mut sim, 2, 111..121);
    let save = sim.serialize();
    assert_eq!(save["version"], json!(TALL_LOBBY_SAVE_VERSION));
    assert_eq!(
        save["lobbyHeights"],
        json!([[15, 100, 109, 3], [15, 111, 120, 2]])
    );
    let back = deserialize(&save).unwrap();
    assert_eq!(runs(&back), runs(&sim));
    assert_eq!(back.serialize()["units"], save["units"]);
}

/// `sim`'s save with `lobbyHeights` set to `heights` at `version`, loaded.
fn load_with(sim: &Simulation, version: i64, heights: Value) -> Simulation {
    let mut save = sim.serialize();
    save["lobbyHeights"] = heights;
    save["version"] = json!(version);
    deserialize(&save).unwrap()
}

#[test]
fn a_version_8_floor_height_loads_as_one_hall_over_every_lobby_tile() {
    let mut sim = split_tower();
    hall(&mut sim, 1, 100..120);
    let back = load_with(&sim, 8, json!([[15, 3]]));
    assert_eq!(runs(&back), vec![[15, 100, 119, 3]]);
    let again = back.serialize();
    assert_eq!(again["version"], json!(TALL_LOBBY_SAVE_VERSION));
    assert_eq!(again["lobbyHeights"], json!([[15, 100, 119, 3]]));
}

#[test]
fn the_loader_keeps_only_halls_the_tower_could_have_built() {
    let mut sim = split_tower();
    hall(&mut sim, 1, 100..110);
    hall(&mut sim, 1, 120..130);
    floor(&mut sim, 16, 120..130);
    // Only the left hall can rise; the right has floor over it.
    let back = load_with(&sim, 9, json!([[15, 100, 109, 3], [15, 120, 129, 2]]));
    assert_eq!(runs(&back), vec![[15, 100, 109, 3]]);
    // A whole-floor entry needs the whole story clear.
    assert!(runs(&load_with(&sim, 8, json!([[15, 2]]))).is_empty());
    for bad in [
        json!([[15, 109, 100, 2]]),   // out of order
        json!([[15, 100, 109, 4]]),   // too tall
        json!([[15, 100, 109]]),      // three numbers
        json!([[15, 100.5, 109, 2]]), // not a whole number
    ] {
        assert!(runs(&load_with(&sim, 9, bad.clone())).is_empty(), "{bad}");
    }
}

#[test]
fn classic_keeps_one_height_per_floor() {
    let mut sim = Simulation::new_game(1, GameMode::Classic);
    sim.money = 1e9;
    sim.star = 5;
    let tiles: Vec<i64> = (100..110).collect();
    sim.with_lobby_height(3, |sim| sim.paint_brush(Kind::Lobby, 1, &tiles));
    // A Classic save's hall entry still covers the whole floor.
    let back = load_with(&sim, 9, json!([[1, 100, 104, 3]]));
    assert_eq!(runs(&back), vec![[1, 100, 109, 3]]);
    // And the raised stories are claimed across the lot.
    assert!(!sim.build(Kind::Floor, 2, 112).ok);
}

/// Turns bridging on, as a new game has it.
fn bridging(sim: &mut Simulation) {
    if !sim.auto_bridge {
        sim.toggle_auto_bridge();
    }
}

// A lobby laid apart from a hall, with bridging on, bridges back to it and
// rises with it: the quote, the charge and `lobbyRise` all say so.
#[test]
fn a_bridged_lobby_tile_rises_with_the_hall_it_reaches_and_pays_for_it() {
    let mut sim = split_tower();
    hall(&mut sim, 3, 100..110);
    bridging(&mut sim);
    let lobby = Kind::Lobby.facility().cost;
    let bare = lobby * 3.0 + Kind::Floor.facility().cost;
    assert_eq!(sim.lobby_rise_at(15, 115), 3);
    // The tile and the five-tile bridge back to the hall, each three stories.
    let quote = sim.can_build(Kind::Lobby, 15, 115);
    assert!(quote.ok, "{:?}", quote.reason);
    assert_eq!(quote.cost, 6.0 * bare);
    let before = sim.money;
    assert!(sim.build(Kind::Lobby, 15, 115).ok);
    assert_eq!(before - sim.money, quote.cost, "charged what it quoted");
    assert_eq!(runs(&sim), vec![[15, 100, 115, 3]]);
}

#[test]
fn a_tile_bridged_to_two_heights_joins_the_left_hall_and_pays_each_side_its_own() {
    let mut sim = split_tower();
    hall(&mut sim, 2, 100..110);
    hall(&mut sim, 3, 120..130);
    bridging(&mut sim);
    let story = |h: f64| Kind::Lobby.facility().cost * h + Kind::Floor.facility().cost;
    let quote = sim.can_build(Kind::Lobby, 15, 114);
    assert!(quote.ok, "{:?}", quote.reason);
    // 110..113 bridge from the left hall at two stories, the tile joins them,
    // and 115..119 bridge from the right hall at three.
    assert_eq!(quote.cost, 5.0 * story(2.0) + 5.0 * story(3.0));
    assert_eq!(sim.lobby_rise_at(15, 114), 2);
    let before = sim.money;
    assert!(sim.build(Kind::Lobby, 15, 114).ok);
    assert_eq!(before - sim.money, quote.cost, "charged what it quoted");
    assert_eq!(runs(&sim), vec![[15, 100, 114, 2], [15, 115, 129, 3]]);
}

#[test]
fn classic_bridges_price_every_tile_at_the_floor_height() {
    let mut sim = Simulation::new_game(1, GameMode::Classic);
    sim.money = 1e9;
    bridging(&mut sim);
    sim.with_lobby_height(3, |sim| paint(sim, Kind::Lobby, 1, 100..110));
    let bare = Kind::Lobby.facility().cost * 3.0 + Kind::Floor.facility().cost;
    let quote = sim.can_build(Kind::Lobby, 1, 115);
    assert!(quote.ok, "{:?}", quote.reason);
    assert_eq!(quote.cost, 6.0 * bare);
    let before = sim.money;
    assert!(sim.build(Kind::Lobby, 1, 115).ok);
    assert_eq!(before - sim.money, quote.cost);
}
