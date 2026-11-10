//! Where a step leaves the ground floor, the basement, the metro station and
//! the sky lobbies: a ground-floor lobby tile it takes out leaves nothing
//! laid since hanging, and nothing it puts back stands where the station's
//! or the lobbies' rules refuse a build.
use super::check_tests::{refused, sell};
use super::tests::{gesture, office, tower, tower_in};
use super::StepRefused;
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::undo::Step;

/// A lobby laid beyond the old one, and a basement under it alone, built
/// outside every gesture.
fn lobby_over_a_basement(sim: &mut Simulation) -> Step {
    let lobby = gesture(sim, |s| {
        for x in 70..90 {
            assert!(s.build(Kind::Lobby, 1, x).ok);
        }
    })
    .unwrap();
    for x in 72..88 {
        assert!(sim.tower.place(Kind::Floor, 0, x).ok);
    }
    lobby
}

#[test]
fn a_lobby_tile_never_leaves_the_basement_hanging() {
    let mut sim = tower();
    let lobby = lobby_over_a_basement(&mut sim);
    refused(&mut sim, &lobby, StepRefused::Blocked);
    // Once it reaches under the old lobby, it still hangs from that.
    for x in (60..72).rev() {
        assert!(sim.tower.place(Kind::Floor, 0, x).ok);
    }
    sim.apply_undo_step(&lobby)
        .expect("the basement still hangs from the old lobby");
    assert!(sim.tower.unit_at(1, 80).is_none());
}

#[test]
fn a_lobby_tile_never_leaves_a_ground_tile_laid_since_hanging() {
    let mut sim = tower();
    let lobby = lobby_over_a_basement(&mut sim);
    for x in 60..72 {
        assert!(sim.tower.place(Kind::Floor, 0, x).ok);
    }
    // The tile beyond the lobby hangs from it alone.
    assert!(sim.tower.place(Kind::Floor, 1, 90).ok);
    refused(&mut sim, &lobby, StepRefused::Blocked);
    let beyond = sim.tower.unit_at(1, 90).unwrap().id;
    assert!(sim.tower.remove_unit(beyond).is_some());
    sim.apply_undo_step(&lobby)
        .expect("nothing laid since hangs from the lobby alone");
}

#[test]
fn a_ground_tile_laid_since_holds_no_basement_up() {
    // The basement runs on to a tile laid beyond the lobby, which hangs
    // from the lobby too.
    let mut sim = tower();
    let lobby = lobby_over_a_basement(&mut sim);
    for x in 88..91 {
        assert!(sim.tower.place(Kind::Floor, 0, x).ok);
    }
    assert!(sim.tower.place(Kind::Floor, 1, 90).ok);
    refused(&mut sim, &lobby, StepRefused::Blocked);
}

#[test]
fn a_lobby_tile_is_never_taken_from_basement_that_reaches_the_tower_through_it_alone() {
    // A gesture lays a lobby tile beyond the old lobby and sells the floor
    // tile beyond it. Since then the basement's own link to the old lobby
    // was sold and a tile added at its far end, so the basement reaches the
    // tower only through the new lobby tile. The undo lays the old floor
    // tile again over that basement, beside no ground-floor tile that
    // stays.
    let mut sim = tower();
    for x in 69..73 {
        assert!(sim.tower.place(Kind::Floor, 0, x).ok);
    }
    assert!(sim.tower.place(Kind::Floor, 1, 71).ok);
    let floor = sim.tower.unit_at(1, 71).unwrap().id;
    let step = gesture(&mut sim, |s| {
        assert!(s.build(Kind::Lobby, 1, 70).ok);
        sell(s, floor);
    })
    .unwrap();
    let link = sim.tower.unit_at(0, 69).unwrap().id;
    assert!(sim.tower.remove_unit(link).is_some());
    assert!(sim.tower.place(Kind::Floor, 0, 73).ok);
    refused(&mut sim, &step, StepRefused::Blocked);
}

#[test]
fn an_old_ground_tile_cut_off_from_the_tower_holds_nothing_built_since() {
    // A ground-floor tile beyond the lobby tile hangs from basement that
    // runs under the floor tile beside the old lobby. Since the gesture,
    // a sale took the basement's link and an edit added a tile at its far
    // end, so the old tile reaches the tower through the lobby
    // tile alone.
    let island = |added: bool| {
        let mut sim = tower();
        assert!(sim.tower.place(Kind::Floor, 1, 70).ok);
        for x in 70..73 {
            assert!(sim.tower.place(Kind::Floor, 0, x).ok);
        }
        assert!(sim.tower.place(Kind::Floor, 1, 72).ok);
        let lobby = gesture(&mut sim, |s| assert!(s.build(Kind::Lobby, 1, 71).ok)).unwrap();
        if added {
            assert!(sim.tower.place(Kind::Floor, 0, 73).ok);
        }
        // A story laid since on the old tile stands on the tile under it.
        assert!(sim.tower.place(Kind::Floor, 2, 72).ok);
        let link = sim.tower.unit_at(0, 71).unwrap().id;
        sell(&mut sim, link);
        (sim, lobby)
    };
    let (mut sim, lobby) = island(true);
    refused(&mut sim, &lobby, StepRefused::Blocked);
    // All there before the lobby tile, the island hung from something else.
    let (mut sim, lobby) = island(false);
    sim.apply_undo_step(&lobby)
        .expect("the lobby tile answers only for what was built since");
}

#[test]
fn a_ground_tile_the_step_lays_again_holds_up_no_basement_on_its_own() {
    // The undo lays a floor tile again over basement laid since. The check
    // asks nothing of what the tile hangs from (#1843), so the basement
    // must reach past it to a tile that stays.
    let lobby_over_a_floor_tile = |parted: bool| {
        let mut sim = tower();
        assert!(sim.tower.place(Kind::Floor, 1, 70).ok);
        assert!(sim.tower.place(Kind::Floor, 1, 71).ok);
        let lobby = gesture(&mut sim, |s| {
            assert!(s.build(Kind::Lobby, 1, 71).ok);
            assert!(s.build(Kind::Lobby, 1, 72).ok);
        })
        .unwrap();
        assert!(sim.tower.place(Kind::Floor, 0, 71).ok);
        assert!(sim.tower.place(Kind::Floor, 0, 72).ok);
        if parted {
            // A sale since parted the run from the old lobby.
            let link = sim.tower.unit_at(1, 70).unwrap().id;
            sell(&mut sim, link);
        }
        (sim, lobby)
    };
    // A sale since parted the run from the old lobby, so nothing older that
    // stays was joined to the lobby tiles, and with no lobby tile of its own
    // the run cannot stand as a tower's first.
    let (mut sim, lobby) = lobby_over_a_floor_tile(true);
    refused(&mut sim, &lobby, StepRefused::Blocked);
    let (mut sim, lobby) = lobby_over_a_floor_tile(false);
    sim.apply_undo_step(&lobby)
        .expect("the basement reaches the old lobby through the floor tile");
    assert_eq!(sim.tower.unit_at(1, 71).unwrap().kind, Kind::Floor);
}

#[test]
fn the_story_below_holds_the_basement_only_where_it_reaches_the_ground() {
    let mut sim = tower();
    let lobby = lobby_over_a_basement(&mut sim);
    assert!(sim.tower.place(Kind::Floor, -1, 80).ok);
    refused(&mut sim, &lobby, StepRefused::Blocked);
    // The story below runs on under the old lobby, and up to it there.
    for x in (60..80).rev() {
        assert!(sim.tower.place(Kind::Floor, -1, x).ok);
    }
    assert!(sim.tower.place(Kind::Floor, 0, 60).ok);
    sim.apply_undo_step(&lobby)
        .expect("the basement hangs from the old lobby through the story below");
}

#[test]
fn the_basement_beside_a_taken_tile_hangs_from_the_ground_too() {
    // One gesture lays a lobby tile and a run of basement from under it;
    // the basement laid beside since hung from that run alone.
    let mut sim = tower();
    let step = gesture(&mut sim, |s| {
        assert!(s.build(Kind::Lobby, 1, 70).ok);
        assert!(s.build(Kind::Floor, 0, 70).ok);
        assert!(s.build(Kind::Floor, 0, 71).ok);
    })
    .unwrap();
    for x in 72..80 {
        assert!(sim.tower.place(Kind::Floor, 0, x).ok);
    }
    refused(&mut sim, &step, StepRefused::Blocked);
}

#[test]
fn the_basement_below_a_taken_tile_hangs_from_the_ground_too() {
    let mut sim = tower();
    let step = gesture(&mut sim, |s| {
        assert!(s.build(Kind::Lobby, 1, 70).ok);
        assert!(s.build(Kind::Floor, 0, 70).ok);
    })
    .unwrap();
    assert!(sim.tower.place(Kind::Floor, -1, 70).ok);
    refused(&mut sim, &step, StepRefused::Blocked);
}

#[test]
fn a_lobby_tile_answers_only_for_the_basement_it_held() {
    // Basement that hung from a floor tile at the lobby tile's corner,
    // taken out since, never hung from the lobby tile, so it keeps no lobby
    // undo back.
    let mut sim = tower();
    let lobby = gesture(&mut sim, |s| assert!(s.build(Kind::Lobby, 1, 70).ok)).unwrap();
    assert!(sim.tower.place(Kind::Floor, 1, 71).ok);
    assert!(sim.tower.place(Kind::Floor, 0, 71).ok);
    let floor = sim.tower.unit_at(1, 71).unwrap().id;
    assert!(sim.tower.remove_unit(floor).is_some());
    let redo = sim
        .apply_undo_step(&lobby)
        .expect("nothing the lobby tile held is left hanging");
    // A ground-floor tile needs no basement under it.
    sim.apply_undo_step(&redo)
        .expect("and the lobby tile is laid again");
}

#[test]
fn only_basement_laid_after_the_lobby_tile_holds_its_undo_back() {
    // A sale left a run of basement under the lobby tile's place hanging
    // before the tile was laid, so taking the tile out leaves it as it was.
    let mut sim = tower();
    for x in 69..72 {
        assert!(sim.tower.place(Kind::Floor, 0, x).ok);
    }
    let held = sim.tower.unit_at(0, 69).unwrap().id;
    sell(&mut sim, held);
    let lobby = gesture(&mut sim, |s| assert!(s.build(Kind::Lobby, 1, 70).ok)).unwrap();
    sim.apply_undo_step(&lobby)
        .expect("the basement hangs as it did before the lobby tile");
    assert!(sim.tower.unit_at(1, 70).is_none());
    // Basement laid since onto that run hung from the lobby tile through it.
    let mut sim = tower();
    for x in 69..71 {
        assert!(sim.tower.place(Kind::Floor, 0, x).ok);
    }
    let held = sim.tower.unit_at(0, 69).unwrap().id;
    sell(&mut sim, held);
    let lobby = gesture(&mut sim, |s| assert!(s.build(Kind::Lobby, 1, 70).ok)).unwrap();
    assert!(sim.tower.place(Kind::Floor, 0, 71).ok);
    refused(&mut sim, &lobby, StepRefused::Blocked);
}

#[test]
fn a_basement_tile_the_step_puts_back_is_left_as_it_was() {
    // A gesture lays two lobby tiles and, under the second, sells a tile
    // of hanging basement and lays a new one: the undo puts the old one
    // back, hanging as it did.
    let mut sim = tower();
    for x in 69..72 {
        assert!(sim.tower.place(Kind::Floor, 0, x).ok);
    }
    let gap = sim.tower.unit_at(0, 70).unwrap().id;
    assert!(sim.tower.remove_unit(gap).is_some());
    let old = sim.tower.unit_at(0, 71).unwrap().id;
    let step = gesture(&mut sim, |s| {
        assert!(s.build(Kind::Lobby, 1, 70).ok);
        assert!(s.build(Kind::Lobby, 1, 71).ok);
        sell(s, old);
        assert!(s.build(Kind::Floor, 0, 71).ok);
    })
    .unwrap();
    // Basement laid since under the new tile hangs from the lobby through
    // it.
    assert!(sim.tower.place(Kind::Floor, -1, 71).ok);
    refused(&mut sim, &step, StepRefused::Blocked);
    let below = sim.tower.unit_at(-1, 71).unwrap().id;
    assert!(sim.tower.remove_unit(below).is_some());
    sim.apply_undo_step(&step)
        .expect("the old basement tile goes back as it was");
    assert_eq!(sim.tower.unit_at(0, 71).unwrap().id, old);
}

#[test]
fn a_floor_tile_sold_from_over_the_basement_is_sold_again() {
    // A sale lets the basement under a ground-floor floor tile go, so the
    // redo of that sale does too.
    let mut sim = tower();
    assert!(sim.tower.place(Kind::Floor, 1, 70).ok);
    assert!(sim.tower.place(Kind::Floor, 0, 70).ok);
    let id = sim.tower.unit_at(1, 70).unwrap().id;
    let sale = gesture(&mut sim, |s| sell(s, id)).unwrap();
    let redo = sim.apply_undo_step(&sale).expect("the sale undoes");
    sim.apply_undo_step(&redo).expect("and is made again");
    assert!(sim.tower.unit_at(1, 70).is_none());
}

/// The test tower with floor on three basement rows, as the station needs.
fn basement() -> Simulation {
    let mut sim = tower();
    for floor in [0, -1, -2] {
        for x in 10..70 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    sim
}

#[test]
fn a_tile_is_never_put_back_below_a_station_built_since() {
    let mut sim = basement();
    assert!(sim.tower.place(Kind::Floor, -3, 40).ok);
    let id = sim.tower.unit_at(-3, 40).unwrap().id;
    let sale = gesture(&mut sim, |s| sell(s, id)).unwrap();
    let station = sim.tower.place(Kind::Metro, -2, 38);
    assert!(station.ok, "{:?}", station.reason);
    refused(&mut sim, &sale, StepRefused::Blocked);
}

/// A station on the lowest row of the test basement, sold as one gesture.
fn station_sold(sim: &mut Simulation) -> Step {
    let station = sim.tower.place(Kind::Metro, -2, 38);
    assert!(station.ok, "{:?}", station.reason);
    let id = station.unit_id.unwrap();
    gesture(sim, |s| sell(s, id)).unwrap()
}

#[test]
fn a_floor_tile_goes_back_on_the_station_row() {
    let mut sim = basement();
    let station = sim.tower.place(Kind::Metro, -2, 38);
    assert!(station.ok, "{:?}", station.reason);
    let id = sim.tower.unit_at(-2, 20).unwrap().id;
    let sale = gesture(&mut sim, |s| sell(s, id)).unwrap();
    sim.apply_undo_step(&sale)
        .expect("a floor tile may stand on the station's row");
}

#[test]
fn a_station_is_never_put_back_over_a_floor_laid_below_it_since() {
    let mut sim = basement();
    let sale = station_sold(&mut sim);
    assert!(sim.tower.place(Kind::Floor, -3, 20).ok);
    refused(&mut sim, &sale, StepRefused::Blocked);
}

#[test]
fn a_station_is_never_put_back_on_a_row_a_room_took_since() {
    let mut sim = basement();
    let sale = station_sold(&mut sim);
    sim.treasures_found = 3.0; // so the dig searches for nothing
    assert!(sim.build(Kind::Shop, -2, 12).ok);
    refused(&mut sim, &sale, StepRefused::Blocked);

    let mut sim = basement();
    let sale = station_sold(&mut sim);
    sim.apply_undo_step(&sale)
        .expect("the station comes back where nothing took its place");
    assert_eq!(sim.tower.metro_floor(), Some(-2));
}

#[test]
fn a_station_comes_back_where_the_step_takes_a_room_off_its_row() {
    let mut sim = basement();
    let station = sim.tower.place(Kind::Metro, -2, 38);
    assert!(station.ok, "{:?}", station.reason);
    let id = station.unit_id.unwrap();
    sim.treasures_found = 3.0; // so the dig searches for nothing
    let step = gesture(&mut sim, |s| {
        sell(s, id);
        assert!(s.build(Kind::Shop, -2, 12).ok);
    })
    .unwrap();
    sim.apply_undo_step(&step)
        .expect("the shop leaves the row the station comes back to");
    assert_eq!(sim.tower.metro_floor(), Some(-2));
}

#[test]
fn a_lobby_tile_is_never_put_back_on_a_floor_a_room_took_since() {
    let mut sim = tower();
    for floor in 5..=15 {
        for x in 10..70 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    let brush = gesture(&mut sim, |s| assert!(s.build(Kind::Lobby, 15, 30).ok)).unwrap();
    let redo = sim.apply_undo_step(&brush).expect("the brush undoes");
    let office = sim.tower.place(Kind::Office, 15, 40);
    assert!(office.ok, "{:?}", office.reason);
    refused(&mut sim, &redo, StepRefused::Blocked);
    // Only a lobby tile keeps off a floor a room stands on.
    let tile = sim.tower.unit_at(15, 65).unwrap().id;
    let sale = gesture(&mut sim, |s| sell(s, tile)).unwrap();
    sim.apply_undo_step(&sale)
        .expect("a floor tile goes back beside the office");
}

#[test]
fn a_classic_escalator_comes_back_beside_an_office() {
    // An office may go in beside an escalator, so a tower with both is one
    // that building could make, whichever came first.
    let mut sim = tower_in(GameMode::Classic);
    let built = sim.build_transport(Kind::Escalator, 40, 2, 3);
    assert!(built.ok, "{:?}", built.reason);
    office(&mut sim, 3, 20);
    let id = sim.tower.transport_at(2, 40).unwrap().id;
    let sale = gesture(&mut sim, |s| sell(s, id)).unwrap();
    office(&mut sim, 2, 20);
    sim.apply_undo_step(&sale)
        .expect("the escalator comes back beside the offices");
}
