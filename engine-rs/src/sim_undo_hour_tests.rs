//! Floor and lobby tiles once an hourly pass has run with them standing,
//! floor a room's build laid under it included, what the player is told to
//! do instead, and which of a step's reasons is given first.
use super::check_tests::{lift, meanwhile, refused, sell};
use super::ground_tests::an_hour_passes;
use super::tests::{gesture, office, tower, tower_in};
use super::StepRefused;
use crate::charges::ExtendEnd;
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::tower::UnitState;

#[test]
fn floor_a_room_laid_under_itself_is_in_use_once_the_hour_passes() {
    let mut sim = tower();
    // Floor 5 has no floor: the office's build lays its own.
    let step = gesture(&mut sim, |s| {
        office(s, 5, 20);
    })
    .unwrap();
    an_hour_passes(&mut sim);
    let id = sim.tower.unit_at(5, 20).unwrap().id;
    assert_eq!(
        sim.tower.get_unit(id).unwrap().state,
        UnitState::Construction,
        "the room is still being built"
    );
    refused(&mut sim, &step, StepRefused::GroundUsed { sellable: true });
}

#[test]
fn a_tile_something_stands_on_is_never_offered_for_sale() {
    let mut sim = tower();
    let floor = gesture(&mut sim, |s| {
        for x in 20..30 {
            assert!(s.build(Kind::Floor, 5, x).ok);
        }
    })
    .unwrap();
    an_hour_passes(&mut sim);
    refused(&mut sim, &floor, StepRefused::GroundUsed { sellable: true });
    // On a tile laid after the first: the advice holds for the whole step.
    office(&mut sim, 5, 25);
    refused(
        &mut sim,
        &floor,
        StepRefused::GroundUsed { sellable: false },
    );
}

#[test]
fn a_tile_a_shaft_stands_on_is_never_offered_for_sale() {
    let mut sim = tower();
    let floor = gesture(&mut sim, |s| {
        for x in 20..30 {
            assert!(s.build(Kind::Floor, 5, x).ok);
        }
    })
    .unwrap();
    an_hour_passes(&mut sim);
    // Built outside the step since, over every tile of its column.
    assert!(sim.build_transport(Kind::ElevatorStandard, 22, 1, 5).ok);
    refused(
        &mut sim,
        &floor,
        StepRefused::GroundUsed { sellable: false },
    );
}

#[test]
fn a_tile_the_step_lays_holds_up_no_shaft_for_the_sale() {
    // The gesture moves a shaft's only tile on a story over by one. The
    // undo puts the old tile back under the shaft, but selling the new one
    // would leave the shaft over nothing there.
    assert!(Kind::ElevatorStandard.facility().width > 1);
    let mut sim = tower();
    assert!(sim.tower.place(Kind::Floor, 5, 40).ok);
    assert!(sim.build_transport(Kind::ElevatorStandard, 40, 1, 5).ok);
    let old = sim.tower.unit_at(5, 40).unwrap().id;
    let step = gesture(&mut sim, |s| {
        assert!(s.build(Kind::Floor, 5, 41).ok);
        sell(s, old);
    })
    .unwrap();
    sim.check_undo_step(&step)
        .expect("once the step applies, the tile it lays holds the shaft up");
    an_hour_passes(&mut sim);
    refused(&mut sim, &step, StepRefused::GroundUsed { sellable: false });
}

#[test]
fn an_hour_that_passes_while_the_gesture_is_open_counts() {
    let mut sim = tower();
    let step = gesture(&mut sim, |s| {
        assert!(s.build(Kind::Floor, 5, 20).ok);
        meanwhile(s, an_hour_passes);
    })
    .unwrap();
    refused(&mut sim, &step, StepRefused::GroundUsed { sellable: true });
}

#[test]
fn a_car_bought_ridden_and_sold_with_its_shaft_keeps_its_use() {
    let mut sim = tower();
    let id = lift(&mut sim);
    let step = gesture(&mut sim, |s| {
        assert!(s.add_car(id).ok);
        meanwhile(s, |s| s.tower.note_ride(id));
        sell(s, id);
    })
    .unwrap();
    refused(&mut sim, &step, StepRefused::UsedThenSold);
}

#[test]
fn a_room_that_opened_on_its_own_floor_says_so() {
    let mut sim = tower();
    let step = gesture(&mut sim, |s| {
        office(s, 5, 20);
    })
    .unwrap();
    sim.tick(Kind::Office.build_minutes() + 30.0);
    assert_ne!(
        sim.on_hour_runs, step.hour_passes,
        "its floor stood an hour"
    );
    assert_ne!(
        sim.tower.unit_at(5, 20).unwrap().state,
        UnitState::Construction
    );
    refused(&mut sim, &step, StepRefused::Opened { sellable: true });
    // A story laid on its floor since keeps the room's reason first.
    assert!(sim.tower.place(Kind::Floor, 6, 20).ok);
    refused(&mut sim, &step, StepRefused::Opened { sellable: true });
}

#[test]
fn a_classic_room_that_stays_for_good_is_never_offered_with_its_floor() {
    let mut sim = tower_in(GameMode::Classic);
    let step = gesture(&mut sim, |s| {
        let r = s.build(Kind::Security, 5, 20);
        assert!(r.ok, "{:?}", r.reason);
    })
    .unwrap();
    an_hour_passes(&mut sim);
    let room = sim.tower.unit_at(5, 20).unwrap();
    assert_eq!(room.state, UnitState::Construction, "still being built");
    refused(&mut sim, &step, StepRefused::GroundUsed { sellable: false });
}

#[test]
fn a_lobby_tile_is_never_offered_for_sale() {
    let mut sim = tower();
    let step = gesture(&mut sim, |s| assert!(s.build(Kind::Lobby, 1, 70).ok)).unwrap();
    an_hour_passes(&mut sim);
    refused(&mut sim, &step, StepRefused::GroundUsed { sellable: false });
}

#[test]
fn a_dig_whose_room_was_sold_again_leaves_nothing_to_sell() {
    let mut sim = tower();
    for x in 10..70 {
        assert!(sim.tower.place(Kind::Floor, 0, x).ok);
    }
    sim.treasures_found = 0.0;
    let step = gesture(&mut sim, |s| {
        assert!(s.build(Kind::Shop, 0, 20).ok);
        let id = s.tower.unit_at(0, 20).unwrap().id;
        sell(s, id);
    })
    .unwrap();
    assert!(step.searched_for_treasure && step.units.is_empty());
    refused(
        &mut sim,
        &step,
        StepRefused::SearchedForTreasure { sellable: false },
    );
}

#[test]
fn a_dig_whose_gesture_built_a_shaft_offers_the_shaft_for_sale() {
    let mut sim = tower();
    for x in 10..70 {
        assert!(sim.tower.place(Kind::Floor, 0, x).ok);
    }
    sim.treasures_found = 0.0;
    let mut shaft = 0;
    let step = gesture(&mut sim, |s| {
        assert!(s.build(Kind::Shop, 0, 20).ok);
        let id = s.tower.unit_at(0, 20).unwrap().id;
        sell(s, id);
        shaft = lift(s);
    })
    .unwrap();
    assert!(step.searched_for_treasure && step.units.is_empty());
    refused(
        &mut sim,
        &step,
        StepRefused::SearchedForTreasure { sellable: true },
    );
    // Once it is sold outside every gesture, nothing is left to sell.
    sell(&mut sim, shaft);
    refused(
        &mut sim,
        &step,
        StepRefused::SearchedForTreasure { sellable: false },
    );
}

#[test]
fn a_dig_whose_room_was_sold_since_is_never_offered_for_sale() {
    let mut sim = tower();
    for x in 10..70 {
        assert!(sim.tower.place(Kind::Floor, 0, x).ok);
    }
    sim.treasures_found = 0.0;
    let step = gesture(&mut sim, |s| {
        assert!(s.build(Kind::Shop, 0, 20).ok);
        assert!(s.build(Kind::Floor, 5, 40).ok);
    })
    .unwrap();
    assert!(step.searched_for_treasure);
    // Sold outside every gesture: the step can no longer sell it.
    let shop = sim.tower.unit_at(0, 20).unwrap().id;
    sell(&mut sim, shop);
    refused(
        &mut sim,
        &step,
        StepRefused::SearchedForTreasure { sellable: false },
    );
}

#[test]
fn a_dig_is_never_offered_for_sale_under_a_room_it_leaves() {
    let mut sim = tower();
    for x in 10..70 {
        assert!(sim.tower.place(Kind::Floor, 0, x).ok);
    }
    sim.treasures_found = 0.0;
    let step = gesture(&mut sim, |s| {
        assert!(s.build(Kind::Shop, 0, 20).ok);
        assert!(s.build(Kind::Floor, 5, 20).ok);
    })
    .unwrap();
    assert!(step.searched_for_treasure);
    // Built outside the step since, on the step's floor tile.
    office(&mut sim, 5, 20);
    refused(
        &mut sim,
        &step,
        StepRefused::SearchedForTreasure { sellable: false },
    );
}

#[test]
fn a_tile_under_a_burning_room_is_never_offered_for_sale() {
    let mut sim = tower();
    let step = gesture(&mut sim, |s| {
        office(s, 5, 20);
    })
    .unwrap();
    an_hour_passes(&mut sim);
    let id = sim.tower.unit_at(5, 20).unwrap().id;
    sim.tower.get_unit_mut(id).unwrap().state = UnitState::Fire;
    refused(&mut sim, &step, StepRefused::GroundUsed { sellable: false });
}

#[test]
fn a_story_laid_on_the_floor_since_comes_before_a_fire() {
    // The story keeps the step from applying for good; the fire only
    // waits.
    let mut sim = tower();
    let step = gesture(&mut sim, |s| {
        office(s, 5, 20);
    })
    .unwrap();
    assert!(sim.tower.place(Kind::Floor, 6, 20).ok);
    let id = sim.tower.unit_at(5, 20).unwrap().id;
    sim.tower.get_unit_mut(id).unwrap().state = UnitState::Fire;
    refused(&mut sim, &step, StepRefused::Blocked);
}

#[test]
fn a_tile_the_step_lays_again_is_never_offered_for_sale() {
    // The undo leaves a tile there, which selling the new one would not.
    let mut sim = tower();
    for x in 20..40 {
        assert!(sim.tower.place(Kind::Floor, 5, x).ok);
    }
    let old = sim.tower.unit_at(5, 30).unwrap().id;
    let step = gesture(&mut sim, |s| {
        sell(s, old);
        assert!(s.build(Kind::Floor, 5, 30).ok);
    })
    .unwrap();
    an_hour_passes(&mut sim);
    refused(&mut sim, &step, StepRefused::GroundUsed { sellable: false });
}

#[test]
fn a_tile_a_shaft_the_step_shortens_stands_on_is_never_offered_for_sale() {
    let mut sim = tower();
    let id = lift(&mut sim);
    let t = sim.tower.get_transport(id).unwrap().clone();
    let step = gesture(&mut sim, |s| {
        for x in t.x..t.x + t.width {
            assert!(s.build(Kind::Floor, 0, x).ok);
        }
        s.begin_extend(id);
        let r = s.extend_transport(id, ExtendEnd::Down, 0);
        assert!(r.charge.ok && r.added > 0);
        s.end_extend();
    })
    .unwrap();
    an_hour_passes(&mut sim);
    refused(&mut sim, &step, StepRefused::GroundUsed { sellable: false });
}

#[test]
fn a_tile_the_step_lays_holds_up_no_shaft_it_shortens_for_the_sale() {
    // The gesture runs a shaft down onto the basement and moves the tile
    // under it over by one.
    let mut sim = tower();
    let id = lift(&mut sim);
    let t = sim.tower.get_transport(id).unwrap().clone();
    assert!(t.width > 1);
    assert!(sim.tower.place(Kind::Floor, 0, t.x).ok);
    let old = sim.tower.unit_at(0, t.x).unwrap().id;
    let step = gesture(&mut sim, |s| {
        assert!(s.build(Kind::Floor, 0, t.x + 1).ok);
        s.begin_extend(id);
        let r = s.extend_transport(id, ExtendEnd::Down, 0);
        assert!(r.charge.ok && r.added > 0);
        s.end_extend();
        sell(s, old);
    })
    .unwrap();
    an_hour_passes(&mut sim);
    refused(&mut sim, &step, StepRefused::GroundUsed { sellable: false });
}

#[test]
fn a_shafts_own_use_comes_before_what_was_built_on_its_floor_since() {
    for room in [false, true] {
        let mut sim = tower();
        let mut id = 0;
        let step = gesture(&mut sim, |s| {
            id = lift(s);
            for x in 30..40 {
                assert!(s.build(Kind::Floor, 5, x).ok);
            }
        })
        .unwrap();
        sim.tower.note_ride(id);
        if room {
            office(&mut sim, 5, 30);
        } else {
            let stairs = sim.build_transport(Kind::Stairs, 32, 4, 5);
            assert!(stairs.ok, "{:?}", stairs.reason);
        }
        refused(&mut sim, &step, StepRefused::ShaftUsed);
        // Once an hour has passed, the floor's own use comes first: it is
        // the one tile reason found before the shafts'.
        an_hour_passes(&mut sim);
        refused(&mut sim, &step, StepRefused::GroundUsed { sellable: false });
    }
}

#[test]
fn a_classic_room_that_stays_for_good_keeps_the_whole_step_from_sale() {
    let mut sim = tower_in(GameMode::Classic);
    let step = gesture(&mut sim, |s| {
        assert!(s.build(Kind::Floor, 5, 40).ok);
        let r = s.build(Kind::Security, 2, 20);
        assert!(r.ok, "{:?}", r.reason);
    })
    .unwrap();
    an_hour_passes(&mut sim);
    let room = sim.tower.unit_at(2, 20).unwrap();
    assert_eq!(room.state, UnitState::Construction, "still being built");
    refused(&mut sim, &step, StepRefused::GroundUsed { sellable: false });
}

#[test]
fn a_dig_is_reported_before_what_time_did_since() {
    let mut sim = tower();
    for x in 10..70 {
        assert!(sim.tower.place(Kind::Floor, 0, x).ok);
    }
    sim.treasures_found = 0.0;
    let step = gesture(&mut sim, |s| {
        assert!(s.build(Kind::Shop, 0, 20).ok);
        office(s, 5, 20);
    })
    .unwrap();
    assert!(step.searched_for_treasure);
    sim.tick(Kind::Office.build_minutes() + 30.0);
    assert_ne!(
        sim.tower.unit_at(5, 20).unwrap().state,
        UnitState::Construction,
        "the office opened"
    );
    refused(
        &mut sim,
        &step,
        StepRefused::SearchedForTreasure { sellable: true },
    );
}

#[test]
fn a_classic_tile_with_floor_on_both_sides_is_never_offered_for_sale() {
    // A saved Classic gap filled with the Floor tool: once the hour passes
    // the sale refuses that tile (`MID_FLOOR_GAP`), so the undo does not
    // send the player there.
    // A gap of three tiles, so the run's first tile answers for the rest.
    let mut sim = tower_in(GameMode::Classic);
    for x in 40..43 {
        let gap = sim.tower.unit_at(4, x).unwrap().id;
        sim.tower.remove_unit(gap);
    }
    // Classic bridges the gap from its first tile.
    let fill = gesture(&mut sim, |s| {
        assert!(s.build(Kind::Floor, 4, 40).ok);
    })
    .unwrap();
    assert!((40..43).all(|x| sim.tower.unit_at(4, x).is_some()));
    an_hour_passes(&mut sim);
    refused(&mut sim, &fill, StepRefused::GroundUsed { sellable: false });
    let id = sim.tower.unit_at(4, 40).unwrap().id;
    assert!(
        !sim.remove_facility(id, crate::gameplay::RemovalMethod::Sell)
            .ok
    );
}

#[test]
fn a_floor_run_that_reaches_an_end_is_still_offered_for_sale() {
    // The same fill in Modern, and a Classic run laid out to the floor's
    // end, can each be sold tile by tile, so the advice stands.
    let mut modern = tower_in(GameMode::Modern);
    let gap = modern.tower.unit_at(4, 40).unwrap().id;
    modern.tower.remove_unit(gap);
    let fill = gesture(&mut modern, |s| {
        assert!(s.build(Kind::Floor, 4, 40).ok);
    })
    .unwrap();
    an_hour_passes(&mut modern);
    refused(
        &mut modern,
        &fill,
        StepRefused::GroundUsed { sellable: true },
    );

    // Floor 4 runs from x 10 to 69; the run laid again is its last 4 tiles.
    let mut classic = tower_in(GameMode::Classic);
    for x in 66..70 {
        let id = classic.tower.unit_at(4, x).unwrap().id;
        classic.tower.remove_unit(id);
    }
    let run = gesture(&mut classic, |s| {
        for x in 66..70 {
            assert!(s.build(Kind::Floor, 4, x).ok);
        }
    })
    .unwrap();
    an_hour_passes(&mut classic);
    refused(
        &mut classic,
        &run,
        StepRefused::GroundUsed { sellable: true },
    );
}
