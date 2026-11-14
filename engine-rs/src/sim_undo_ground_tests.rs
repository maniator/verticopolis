//! Floor and lobby tiles, and the shafts on them. A step never takes out a
//! tile that a room, a shaft or the story above still stands on, as a sale
//! never does. A tile, like a shaft, is in use once an hourly pass has run
//! with it standing, and a build the gesture took out again keeps the use
//! it had: neither goes back at its full price.
use crate::crowd::fasthash::FastSet;

use super::check_tests::{lift, meanwhile, refused, sell};
use super::tests::{gesture, office, tower};
use super::StepRefused;
use crate::charges::ExtendEnd;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::sim_undo_ground::Ground;
use crate::tower::UnitState;
use crate::undo::Step;

/// Lay `kind` on `floor` from x 75 to 84 as one gesture.
pub(super) fn laid(sim: &mut Simulation, kind: Kind, floor: i64) -> Step {
    gesture(sim, |s| {
        for x in 75..85 {
            let r = s.build(kind, floor, x);
            assert!(r.ok, "{:?}", r.reason);
        }
    })
    .unwrap()
}

/// Run the clock until the next hourly pass, which comes within the game
/// hour.
pub(super) fn an_hour_passes(sim: &mut Simulation) {
    let runs = sim.on_hour_runs;
    for _ in 0..13 {
        sim.tick(5.0);
        if sim.on_hour_runs != runs {
            return;
        }
    }
    panic!("no hourly pass ran in an hour");
}

#[test]
fn floor_tiles_under_a_used_room_never_come_back() {
    let mut sim = tower();
    let lobby = laid(&mut sim, Kind::Lobby, 1);
    let floor = laid(&mut sim, Kind::Floor, 2);
    let room = gesture(&mut sim, |s| {
        let id = office(s, 2, 76);
        s.tower.get_unit_mut(id).unwrap().pending_income = 1.0;
    })
    .unwrap();
    refused(&mut sim, &room, StepRefused::InUse { sellable: true });
    refused(&mut sim, &floor, StepRefused::Blocked);
    refused(&mut sim, &lobby, StepRefused::Blocked);

    // Once what stood in the way is sold, the step applies here; the port
    // has dropped a blocked step by then.
    let id = sim.tower.unit_at(2, 76).unwrap().id;
    sell(&mut sim, id);
    let before = sim.money;
    sim.apply_undo_step(&floor).unwrap();
    assert!(sim.money > before, "a bare floor laid just now comes back");
    assert!(sim.tower.unit_at(2, 80).is_none());
}

#[test]
fn a_tile_under_the_story_above_never_comes_back() {
    let mut sim = tower();
    let lobby = laid(&mut sim, Kind::Lobby, 1);
    let floor = laid(&mut sim, Kind::Floor, 2);
    refused(&mut sim, &lobby, StepRefused::Blocked);
    sim.apply_undo_step(&floor).unwrap();
    sim.apply_undo_step(&lobby).unwrap();
}

#[test]
fn a_tile_under_a_shaft_never_comes_back() {
    let mut sim = tower();
    // One gesture lays both stories, so only the shaft holds them up.
    let ground = gesture(&mut sim, |s| {
        for floor in [1, 2] {
            for x in 75..85 {
                let kind = if floor == 1 { Kind::Lobby } else { Kind::Floor };
                assert!(s.build(kind, floor, x).ok);
            }
        }
    })
    .unwrap();
    assert!(sim.build_transport(Kind::ElevatorStandard, 77, 1, 2).ok);
    refused(&mut sim, &ground, StepRefused::Blocked);
    let id = sim.tower.transport_at(1, 77).unwrap().id;
    sell(&mut sim, id);
    sim.apply_undo_step(&ground).unwrap();
}

#[test]
fn a_tile_that_stood_through_an_hour_is_in_use() {
    let mut sim = tower();
    let lobby = laid(&mut sim, Kind::Lobby, 1);
    let floor = laid(&mut sim, Kind::Floor, 2);
    let redo = sim.apply_undo_step(&floor).expect("within the hour");
    let floor = sim.apply_undo_step(&redo).unwrap();
    an_hour_passes(&mut sim);
    refused(&mut sim, &floor, StepRefused::GroundUsed { sellable: true });
    // A lobby tile can never be sold, so the player is not told to.
    refused(
        &mut sim,
        &lobby,
        StepRefused::GroundUsed { sellable: false },
    );
}

#[test]
fn a_shaft_nobody_rode_is_in_use_once_an_hour_passes() {
    let mut sim = tower();
    let mut id = 0;
    let step = gesture(&mut sim, |s| {
        assert!(s.build_transport(Kind::Escalator, 40, 2, 3).ok);
        id = s.tower.transport_at(2, 40).unwrap().id;
    })
    .unwrap();
    an_hour_passes(&mut sim);
    assert_eq!(sim.tower.get_transport(id).unwrap().rides, 0);
    refused(&mut sim, &step, StepRefused::ShaftUsed);
}

#[test]
fn a_build_used_and_sold_inside_its_gesture_keeps_its_use() {
    // A shaft built, ridden and sold.
    let mut sim = tower();
    let step = gesture(&mut sim, |s| {
        let id = lift(s);
        meanwhile(s, |s| s.tower.note_ride(id));
        sell(s, id);
    })
    .unwrap();
    assert!(step.used_in_gesture);
    refused(&mut sim, &step, StepRefused::UsedThenSold);

    // A car bought, ridden and sold.
    let mut sim = tower();
    let id = lift(&mut sim);
    let step = gesture(&mut sim, |s| {
        assert!(s.add_car(id).ok);
        meanwhile(s, |s| s.tower.note_ride(id));
        assert!(s.remove_car(id).ok);
    })
    .unwrap();
    refused(&mut sim, &step, StepRefused::UsedThenSold);

    // Floors bought for a shaft, ridden, and taken back by the same drag.
    let mut sim = tower();
    let id = lift(&mut sim);
    assert!(sim.begin_extend(id));
    let step = gesture(&mut sim, |s| {
        assert_eq!(s.extend_transport(id, ExtendEnd::Up, 4).added, 1);
        meanwhile(s, |s| s.tower.note_ride(id));
        assert!(s.resize_transport(id, 1, 3).ok);
    })
    .unwrap();
    refused(&mut sim, &step, StepRefused::UsedThenSold);

    // A floor tile laid, stood through an hour, and sold, beside the floor
    // already there, so no bridge is laid with it.
    let mut sim = tower();
    assert!(sim.build(Kind::Lobby, 1, 70).ok);
    let step = gesture(&mut sim, |s| {
        assert!(s.build(Kind::Floor, 2, 70).ok);
        meanwhile(s, an_hour_passes);
        let floor = s.tower.unit_at(2, 70).unwrap().id;
        sell(s, floor);
    })
    .unwrap();
    refused(&mut sim, &step, StepRefused::UsedThenSold);

    // Nothing used it: the step hands back what the edit lost.
    let mut sim = tower();
    let start = sim.money;
    let step = gesture(&mut sim, |s| {
        let id = lift(s);
        sell(s, id);
    })
    .unwrap();
    assert!(!step.used_in_gesture);
    sim.apply_undo_step(&step).unwrap();
    assert_eq!(sim.money, start);
}

#[test]
fn a_lasting_refusal_is_reported_before_one_that_can_come_right() {
    // A room on fire, and a room in use, in one step.
    let mut sim = tower();
    let mut ids = (0, 0);
    let step = gesture(&mut sim, |s| ids = (office(s, 2, 12), office(s, 2, 30))).unwrap();
    sim.tower.get_unit_mut(ids.0).unwrap().state = UnitState::Fire;
    sim.tower.get_unit_mut(ids.1).unwrap().pending_income = 1.0;
    refused(&mut sim, &step, StepRefused::InUse { sellable: true });

    // A sale's undo the balance cannot pay for, with a tile that stood
    // through an hour.
    let mut sim = tower();
    let id = office(&mut sim, 2, 12);
    assert!(sim.build(Kind::Lobby, 1, 75).ok);
    let step = gesture(&mut sim, |s| {
        sell(s, id);
        assert!(s.build(Kind::Floor, 2, 75).ok);
    })
    .unwrap();
    assert!(step.money < 0.0, "the undo takes the sale's refund back");
    sim.money = 0.0;
    refused(&mut sim, &step, StepRefused::NotEnoughMoney);
    an_hour_passes(&mut sim);
    sim.money = 0.0;
    refused(&mut sim, &step, StepRefused::GroundUsed { sellable: true });
}

#[test]
fn a_redo_sells_again_what_the_edit_sold_whatever_the_rides() {
    // One gesture sells a car and buys a floor: the undo takes the floor
    // back at its price, the redo sells the car again at the sale's.
    let mut sim = tower();
    let id = lift(&mut sim);
    assert!(sim.add_car(id).ok);
    assert!(sim.begin_extend(id));
    let mixed = gesture(&mut sim, |s| {
        assert!(s.remove_car(id).ok);
        assert_eq!(s.extend_transport(id, ExtendEnd::Up, 4).added, 1);
    })
    .unwrap();
    let redo = sim.apply_undo_step(&mixed).unwrap();
    sim.tower.note_ride(id);
    let undo = sim
        .apply_undo_step(&redo)
        .expect("a sale done again does not mind the rides");
    sim.tower.note_ride(id);
    refused(&mut sim, &undo, StepRefused::ShaftUsed);
}

#[test]
fn a_shaft_ridden_then_sold_and_put_back_is_still_used() {
    let mut sim = tower();
    let mut id = 0;
    let build = gesture(&mut sim, |s| id = lift(s)).unwrap();
    sim.tower.note_ride(id);
    let sale = gesture(&mut sim, |s| sell(s, id)).unwrap();
    sim.apply_undo_step(&sale).unwrap();
    refused(&mut sim, &build, StepRefused::ShaftUsed);
}

#[test]
fn a_room_that_opened_while_its_gesture_was_open_is_used() {
    let mut sim = tower();
    let mut id = 0;
    let step = gesture(&mut sim, |s| {
        id = office(s, 2, 12);
        meanwhile(s, |s| s.tick(Kind::Office.build_minutes() + 30.0));
    })
    .unwrap();
    assert_eq!(sim.tower.get_unit(id).unwrap().state, UnitState::Empty);
    refused(&mut sim, &step, StepRefused::Opened { sellable: true });
}

#[test]
fn a_condo_sold_while_its_gesture_was_open_goes_back_at_its_sale_price() {
    let mut sim = tower();
    assert!(sim.build(Kind::Condo, 2, 12).ok);
    let id = sim.tower.unit_at(2, 12).unwrap().id;
    let was = sim.tower.get_unit(id).unwrap().rent;
    let mut sold_at = was;
    let step = gesture(&mut sim, |s| {
        assert!(s.price_unit(id, 200_000.0).is_some());
        sold_at = s.tower.get_unit(id).unwrap().rent;
        meanwhile(s, |s| {
            s.tower.get_unit_mut(id).unwrap().ever_occupied = true
        });
        sell(s, id);
    })
    .unwrap();
    assert_ne!(was, sold_at);
    sim.apply_undo_step(&step).unwrap();
    let u = sim.tower.get_unit(id).unwrap();
    assert!(u.ever_occupied, "sold, as it left");
    assert_eq!(u.rent, sold_at, "at the price it sold at");
}

/// Lay a lobby and floors 2 to 4 at x `xs`.
fn stories(sim: &mut Simulation, xs: std::ops::Range<i64>) {
    for floor in 1..=4 {
        for x in xs.clone() {
            let kind = if floor == 1 { Kind::Lobby } else { Kind::Floor };
            let r = sim.build(kind, floor, x);
            assert!(r.ok, "{:?}", r.reason);
        }
    }
}

#[test]
fn tiles_taken_on_several_floors_are_found_under_a_shaft() {
    let width = Kind::ElevatorStandard.facility().width;
    let last = 77 + width - 1;
    for kept in [false, true] {
        let mut sim = tower();
        // The shaft's last column keeps its tiles when `kept`.
        let to = if kept { last } else { 85 };
        if kept {
            // The kept column's stories go in after the gesture, and hang
            // from this basement, which runs on from under the old lobby.
            for x in 69..85 {
                assert!(sim.tower.place(Kind::Floor, 0, x).ok);
            }
        }
        let ground = gesture(&mut sim, |s| stories(s, 75..to)).unwrap();
        if kept {
            stories(&mut sim, last..85);
        }
        assert!(sim.build_transport(Kind::ElevatorStandard, 77, 1, 4).ok);
        if kept {
            sim.apply_undo_step(&ground)
                .expect("the shaft still stands on its last column");
        } else {
            refused(&mut sim, &ground, StepRefused::Blocked);
        }
    }
}

#[test]
fn a_floor_tile_is_never_put_back_over_nothing() {
    let mut sim = tower();
    let lay = gesture(&mut sim, |s| assert!(s.build(Kind::Floor, 5, 12).ok)).unwrap();
    let redo = sim.apply_undo_step(&lay).unwrap();
    let under = sim.tower.unit_at(4, 12).unwrap().id;
    sell(&mut sim, under);
    refused(&mut sim, &redo, StepRefused::Blocked);
}

/// A room and a sky lobby share no floor: a room goes back only where no
/// lobby stays, and a lobby the same step takes the room from goes back.
#[test]
fn a_room_is_never_put_back_on_a_floor_that_holds_a_lobby() {
    let mut sim = tower();
    for floor in 5..=15 {
        for x in 10..40 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    let id = office(&mut sim, 15, 12);
    let sale = gesture(&mut sim, |s| sell(s, id)).unwrap();
    assert!(sim.build(Kind::Lobby, 15, 30).ok, "a sky lobby beside it");
    refused(&mut sim, &sale, StepRefused::Blocked);

    // A lobby the same step takes out leaves the floor free.
    let mut sim = tower();
    for floor in 5..=15 {
        for x in 10..40 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    let id = office(&mut sim, 15, 12);
    let step = gesture(&mut sim, |s| {
        sell(s, id);
        assert!(s.build(Kind::Lobby, 15, 30).ok);
    })
    .unwrap();
    let redo = sim.apply_undo_step(&step).unwrap();
    assert!(sim.tower.get_unit(id).is_some());
    // And a room the same step takes out leaves it free for the lobby.
    sim.apply_undo_step(&redo)
        .expect("the redo sells the office and lays the lobby again");
    assert!(sim.tower.get_unit(id).is_none());
    assert_eq!(sim.tower.unit_at(15, 30).unwrap().kind, Kind::Lobby);
}

#[test]
fn a_room_is_never_put_back_below_a_metro_station_built_since() {
    let mut sim = tower();
    for floor in [0, -1, -2] {
        for x in 10..70 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    assert!(sim.build(Kind::Shop, -2, 12).ok);
    let id = sim.tower.unit_at(-2, 12).unwrap().id;
    let sale = gesture(&mut sim, |s| sell(s, id)).unwrap();
    let station = sim.tower.place(Kind::Metro, -2, 38);
    assert!(station.ok, "{:?}", station.reason);
    refused(&mut sim, &sale, StepRefused::Blocked);

    // A station the same step takes out leaves its row free.
    let mut sim = tower();
    for floor in [0, -1, -2] {
        for x in 10..70 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    sim.treasures_found = 3.0; // so the dig searches for nothing
    assert!(sim.build(Kind::Shop, -2, 40).ok);
    let id = sim.tower.unit_at(-2, 40).unwrap().id;
    let step = gesture(&mut sim, |s| {
        sell(s, id);
        let r = s.build(Kind::Metro, -2, 38);
        assert!(r.ok, "{:?}", r.reason);
    })
    .unwrap();
    sim.apply_undo_step(&step).unwrap();
    assert!(sim.tower.get_unit(id).is_some());
}

#[test]
fn a_drag_that_took_nothing_back_says_what_used_it() {
    // A ride between two floors of one extend drag: the step is refused
    // for the ride, and nothing was sold.
    let mut sim = tower();
    assert!(sim.build_transport(Kind::ElevatorStandard, 15, 1, 2).ok);
    let id = sim.tower.transport_at(1, 15).unwrap().id;
    assert!(sim.begin_extend(id));
    let step = gesture(&mut sim, |s| {
        assert_eq!(s.extend_transport(id, ExtendEnd::Up, 3).added, 1);
        meanwhile(s, |s| s.tower.note_ride(id));
        assert_eq!(s.extend_transport(id, ExtendEnd::Up, 4).added, 1);
    })
    .unwrap();
    assert!(step.used_in_gesture);
    refused(&mut sim, &step, StepRefused::ShaftUsed);
}

/// The search over the taken tiles by column answers what a walk over all
/// of them does, for every shaft span over a staircase of tiles that the
/// step lists floor by floor, out of column order.
#[test]
fn the_column_search_answers_as_a_walk_over_the_taken_tiles() {
    let mut sim = tower();
    let lay = gesture(&mut sim, |s| {
        for floor in 1..=4 {
            let kind = if floor == 1 { Kind::Lobby } else { Kind::Floor };
            for x in 75..95 - 3 * floor {
                assert!(s.build(kind, floor, x).ok);
            }
        }
    })
    .unwrap();
    let id = lift(&mut sim);
    let mut t = sim.tower.get_transport(id).unwrap().clone();
    let leaving: FastSet<i64> = lay.units.iter().map(|img| img.id).collect();
    let ground = Ground::of(&sim.tower, &lay, &leaving);
    let holds = |f: i64, x: i64| {
        sim.tower
            .structure
            .get(&(f, x))
            .is_some_and(|id| !leaving.contains(id))
    };
    let taken: Vec<(i64, i64)> = lay
        .units
        .iter()
        .filter_map(|img| sim.tower.get_unit(img.id))
        .map(|u| (u.floor, u.x))
        .collect();
    for x in 60..100 {
        for bottom in 1..=4 {
            for top in bottom..=4 {
                (t.x, t.bottom, t.top) = (x, bottom, top);
                let columns = t.x..t.x + t.width;
                let walked = taken.iter().all(|&(f, x)| {
                    let under = (bottom..=top).contains(&f) && columns.contains(&x);
                    !under || columns.clone().any(|x| holds(f, x))
                });
                assert_eq!(ground.still_under_shaft(&t), walked, "{x}, {bottom}-{top}");
            }
        }
    }
    // A span that runs backward finds no tiles, where a slice would panic:
    // its column holds taken tiles between its ends, which the span the
    // right way round finds.
    assert!(taken.contains(&(2, 80)) && taken.contains(&(3, 80)));
    (t.x, t.bottom, t.top) = (80, 1, 4);
    assert!(!ground.still_under_shaft(&t));
    (t.x, t.bottom, t.top) = (80, 4, 1);
    assert!(ground.still_under_shaft(&t));
}
