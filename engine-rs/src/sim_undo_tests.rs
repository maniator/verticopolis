//! Undo on the simulation: every kind of edit puts the tower back exactly,
//! a step stays the size of its edit, and the cash a step moves is exactly
//! what the edit moved.
use super::*;
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::gameplay::RemovalMethod;
use crate::rent::BatchTarget;
use serde_json::{json, Value};

/// The save with the facts an undo leaves alone taken out: the dice (an edit
/// rolls them, an undo does not roll them back), the message log, the dug
/// ground, and the id counter (an id is never handed out twice).
pub(super) fn shape(sim: &Simulation) -> Value {
    let mut v: Value = serde_json::from_str(&sim.save_text()).unwrap();
    let map = v.as_object_mut().unwrap();
    for key in [
        "rng",
        "rngState",
        "log",
        "logSeq",
        "treasuresFound",
        "excavated",
        "nextId",
    ] {
        map.remove(key);
    }
    v
}

/// A tower with a lobby row on floor 1 and floors 2 to 4 over it, rich and
/// at five stars.
pub(super) fn tower() -> Simulation {
    tower_in(GameMode::Modern)
}

pub(super) fn tower_in(mode: GameMode) -> Simulation {
    let mut sim = Simulation::new_game(1, mode);
    sim.money = 1e9;
    sim.star = 5;
    for x in 10..70 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        for floor in 2..=4 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    sim
}

/// Run `edit` as one gesture and answer its step.
pub(super) fn gesture(sim: &mut Simulation, edit: impl FnOnce(&mut Simulation)) -> Option<Step> {
    sim.begin_undo_journal("Edit");
    edit(sim);
    sim.end_undo_journal()
}

/// An edit, its undo and its redo, each checked against the exact tower it
/// should leave. Answers the step.
#[track_caller]
fn round_trip(sim: &mut Simulation, edit: impl FnOnce(&mut Simulation)) -> Step {
    let at = std::panic::Location::caller().line();
    let before = shape(sim);
    let money = sim.money;
    let step = gesture(sim, edit).expect("the edit changed the tower");
    let after = shape(sim);
    let spent = money - sim.money;
    assert_ne!(before, after, "the edit at line {at} changed the save");
    let redo = sim.apply_undo_step(&step).expect("the undo applies");
    assert_eq!(shape(sim), before, "undo puts the tower back");
    assert_eq!(
        sim.money, money,
        "undo returns exactly the cash the edit moved"
    );
    let again = sim.apply_undo_step(&redo).expect("the redo applies");
    assert_eq!(shape(sim), after, "redo puts the edit back");
    assert_eq!(money - sim.money, spent, "redo moves the same cash again");
    let redo = sim.apply_undo_step(&again).expect("a second undo applies");
    assert_eq!(shape(sim), before, "and a second undo puts it back again");
    let _ = sim.apply_undo_step(&redo).expect("a second redo applies");
    assert_eq!(
        shape(sim),
        after,
        "and the edit stands when the round trip ends"
    );
    step
}

pub(super) fn office(sim: &mut Simulation, floor: i64, x: i64) -> i64 {
    assert!(sim.build(Kind::Office, floor, x).ok);
    sim.tower.unit_at(floor, x).unwrap().id
}

#[test]
fn building_a_room_and_its_floor_round_trips() {
    let mut sim = tower();
    // Floor 5 has no floor under it: the build lays tiles (and bridges).
    round_trip(&mut sim, |s| assert!(s.build(Kind::Office, 4, 20).ok));
    round_trip(&mut sim, |s| assert!(s.build(Kind::Office, 5, 20).ok));
}

/// A lobby placed where there is no floor yet pays for that floor too, and
/// its undo gives back that whole price: placed, bridged to the tower, and
/// laid by the floor brush on the ground floor.
#[test]
fn a_lobby_with_its_floor_round_trips() {
    let tile = Kind::Lobby.facility().cost + Kind::Floor.facility().cost;
    let mut sim = tower();
    round_trip(&mut sim, |s| {
        let before = s.money;
        assert!(s.build(Kind::Lobby, 1, 70).ok);
        assert_eq!(before - s.money, tile);
    });
    // The lobby at 75 bridges 71..=74 to the tower.
    round_trip(&mut sim, |s| {
        let before = s.money;
        assert!(s.build(Kind::Lobby, 1, 75).ok);
        assert_eq!(before - s.money, 5.0 * tile);
    });
    round_trip(&mut sim, |s| {
        let before = s.money;
        assert_eq!(s.paint_brush(Kind::Floor, 1, &[76, 77]).placed, 2);
        assert_eq!(before - s.money, 2.0 * tile);
    });
}

#[test]
fn a_lobby_over_floor_takes_the_slot_and_round_trips() {
    let mut sim = tower();
    // Floor 15 holds plain floor tiles for lobbies to take the place of.
    for x in 70..120 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        for floor in 2..=15 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    round_trip(&mut sim, |s| {
        let r = s.build(Kind::Lobby, 15, 90);
        assert!(r.ok, "{:?}", r.reason);
    });
    round_trip(&mut sim, |s| {
        let r = s.paint_brush(Kind::Lobby, 15, &[82, 83, 84, 100, 101, 110]);
        assert!(r.placed > 0);
    });
}

#[test]
fn a_floor_brush_round_trips() {
    let mut sim = tower();
    round_trip(&mut sim, |s| {
        let r = s.paint_brush(Kind::Floor, 5, &[12, 13, 14, 20, 21, 40]);
        assert!(r.placed > 0);
    });
}

#[test]
fn selling_rooms_in_any_order_round_trips() {
    let mut sim = tower();
    let a = office(&mut sim, 2, 12);
    let b = office(&mut sim, 2, 30);
    let c = office(&mut sim, 3, 20);
    let d = office(&mut sim, 2, 50);
    round_trip(&mut sim, |s| {
        assert!(s.remove_facility(a, RemovalMethod::Sell).ok)
    });
    round_trip(&mut sim, |s| {
        // Out of list order, the later unit first.
        for id in [d, a, c, b] {
            let _ = s.remove_facility(id, RemovalMethod::Sell);
        }
    });
}

#[test]
fn units_taken_out_in_one_pass_go_back_in_list_order() {
    let mut sim = tower();
    let a = office(&mut sim, 2, 12);
    let b = office(&mut sim, 2, 30);
    office(&mut sim, 2, 50);
    round_trip(&mut sim, |s| {
        // One pass takes both out, as a refused build's rollback does.
        assert_eq!(s.tower.remove_units(&[b, a]).len(), 2);
    });
}

#[test]
fn selling_the_floor_under_nothing_round_trips() {
    let mut sim = tower();
    let tile = sim.tower.unit_at(4, 33).unwrap().id;
    round_trip(&mut sim, |s| {
        assert!(s.remove_facility(tile, RemovalMethod::Sell).ok)
    });
}

#[test]
fn removing_a_sold_condo_round_trips_its_buy_back() {
    // #713: the removal nets the buy-back against the refund; undo returns that net.
    let mut sim = tower();
    let id = sim.tower.place(Kind::Condo, 2, 20).unit_id.unwrap();
    let u = sim.tower.get_unit_mut(id).unwrap();
    (u.state, u.ever_occupied, u.rent) = (UnitState::Occupied, true, Some(150_000.0));
    round_trip(&mut sim, |s| {
        assert!(s.remove_facility(id, RemovalMethod::Sell).ok)
    });
}

#[test]
fn building_and_selling_in_one_gesture_leaves_the_tower_as_it_was() {
    let mut sim = tower();
    let before = shape(&sim);
    let step = gesture(&mut sim, |s| {
        let id = office(s, 2, 22);
        assert!(s.remove_facility(id, RemovalMethod::Sell).ok);
    });
    // Rent aside, the cash is what moved: half the build cost came back.
    assert_eq!(shape(&sim).get("units"), before.get("units"));
    if let Some(step) = step {
        assert_eq!(step.weight(), 0, "a unit built and sold leaves no image");
    }
}

#[test]
fn a_shaft_its_cars_its_stops_and_its_span_round_trip() {
    let mut sim = tower();
    round_trip(&mut sim, |s| {
        assert!(s.build_transport(Kind::ElevatorStandard, 15, 1, 3).ok)
    });
    let lift = sim.tower.transport_at(1, 15).unwrap().id;
    round_trip(&mut sim, |s| assert!(s.add_car(lift).ok));
    round_trip(&mut sim, |s| assert!(s.remove_car(lift).ok));
    round_trip(&mut sim, |s| assert!(s.tower.set_stop(lift, 2, false)));
    round_trip(&mut sim, |s| {
        s.begin_extend(lift);
        let r = s.extend_transport(lift, crate::charges::ExtendEnd::Up, 4);
        assert!(r.charge.ok && r.added > 0);
        s.end_extend();
    });
    let lift_schedule = json!({"activeCars": {"weekday": (0..24).map(|h| i32::from(h > 5)).collect::<Vec<_>>(), "weekend": vec![1; 24]}, "waitingCarResponse": 3});
    round_trip(&mut sim, |s| {
        assert!(s.tower.set_schedule(lift, &lift_schedule))
    });
    round_trip(&mut sim, |s| {
        assert!(s.remove_facility(lift, RemovalMethod::Sell).ok)
    });
}

#[test]
fn an_express_shaft_round_trips() {
    let mut sim = tower();
    round_trip(&mut sim, |s| {
        assert!(s.build_transport(Kind::ElevatorExpress, 40, 1, 4).ok)
    });
    let express = sim.tower.transport_at(1, 40).unwrap().id;
    round_trip(&mut sim, |s| {
        assert!(s.remove_facility(express, RemovalMethod::Sell).ok)
    });
    round_trip(&mut sim, |s| {
        assert!(s.build_transport(Kind::Stairs, 20, 1, 2).ok)
    });
    round_trip(&mut sim, |s| {
        assert!(s.build_transport(Kind::Escalator, 55, 1, 2).ok)
    });
}

#[test]
fn prices_names_and_policies_round_trip() {
    let mut sim = tower();
    let shop = {
        assert!(sim.build(Kind::Condo, 2, 14).ok);
        sim.tower.unit_at(2, 14).unwrap().id
    };
    round_trip(&mut sim, |s| {
        assert!(s.price_unit(shop, 1_000_000.0).is_some())
    });
    round_trip(&mut sim, |s| assert!(s.tower.set_label(shop, "Penthouse")));
    round_trip(&mut sim, |s| {
        assert!(s
            .apply_rent_batch(Kind::Condo, BatchTarget::Price(1.0), false)
            .is_some())
    });
    let r = sim.build(Kind::Cinema, 3, 12);
    assert!(r.ok, "{:?}", r.reason);
    let cinema = sim.tower.unit_at(3, 12).unwrap().id;
    round_trip(&mut sim, |s| {
        assert!(s.set_film_policy(cinema, "blockbuster").is_some())
    });
}

#[test]
fn taking_a_unit_off_the_market_round_trips() {
    let mut sim = tower_in(GameMode::Classic);
    let office = office(&mut sim, 2, 12);
    round_trip(&mut sim, |s| assert!(s.set_no_rate(office)));
}

#[test]
fn a_wedding_hall_takes_its_flag_and_its_visit_with_it() {
    let mut sim = tower();
    sim.star = 5;
    for floor in 5..=100 {
        for x in 10..70 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    let before_day = sim.vip_visit_day;
    let step = gesture(&mut sim, |s| {
        let r = s.build(Kind::WeddingHall, 100, 12);
        assert!(r.ok, "{:?}", r.reason);
    });
    let step = step.expect("the hall was built");
    assert_eq!(sim.tower.built_wedding_hall, Some(true));
    let redo = sim.apply_undo_step(&step).unwrap();
    assert_eq!(sim.tower.built_wedding_hall, Some(false));
    assert_eq!(sim.vip_visit_day, before_day);
    sim.apply_undo_step(&redo).unwrap();
    assert_eq!(sim.tower.built_wedding_hall, Some(true));
}

#[test]
fn a_step_is_the_size_of_its_edit_not_of_the_tower() {
    let mut small = tower();
    let mut large = tower();
    for x in 70..2000 {
        let _ = large.tower.place(Kind::Lobby, 1, x);
        let _ = large.tower.place(Kind::Floor, 2, x);
    }
    let weight = |sim: &mut Simulation| {
        gesture(sim, |s| assert!(s.build(Kind::Office, 3, 21).ok))
            .unwrap()
            .weight()
    };
    let (in_small, in_large) = (weight(&mut small), weight(&mut large));
    assert_eq!(in_small, in_large);
    assert_eq!(in_small, 1, "the one office");
}

#[test]
fn an_edit_that_changes_nothing_leaves_no_step() {
    let mut sim = tower();
    let id = office(&mut sim, 2, 12);
    assert!(gesture(&mut sim, |s| {
        let _ = s.tower.set_label(id, "Office");
        let _ = s.build(Kind::Office, 2, 12);
    })
    .is_none());
}

#[test]
fn cycling_an_edit_nets_exactly_zero() {
    let mut sim = tower();
    let id = office(&mut sim, 2, 12);
    let start = sim.money;
    let step = gesture(&mut sim, |s| {
        assert!(s.remove_facility(id, RemovalMethod::Sell).ok)
    })
    .unwrap();
    let sold = sim.money;
    assert!(sold > start, "selling paid a refund");
    let mut step = step;
    for _ in 0..20 {
        step = sim.apply_undo_step(&step).unwrap();
        assert_eq!(sim.money, start, "the undo takes back exactly the refund");
        step = sim.apply_undo_step(&step).unwrap();
        assert_eq!(sim.money, sold, "the redo pays exactly the refund again");
    }
}

#[test]
fn undo_returns_the_cash_the_edit_recorded_whatever_time_has_done() {
    let mut sim = tower();
    // A sale, since time leaves a build in use and an undo would not take
    // it out.
    assert!(sim.build_transport(Kind::ElevatorStandard, 15, 1, 4).ok);
    let id = sim.tower.transports[0].id;
    let start = sim.money;
    let step = gesture(&mut sim, |s| {
        assert!(s.remove_facility(id, RemovalMethod::Sell).ok)
    })
    .unwrap();
    let refund = sim.money - start;
    assert!(refund > 0.0);
    sim.tick(60.0 * 24.0 * 3.0);
    let before_undo = sim.money;
    let redo = sim.apply_undo_step(&step).unwrap();
    assert_eq!(
        sim.money,
        before_undo - refund,
        "exactly the refund, no more"
    );
    sim.tick(60.0);
    let again = sim.money;
    sim.apply_undo_step(&redo).unwrap();
    assert_eq!(sim.money, again + refund, "and the redo pays it again");
}

#[test]
fn an_undo_the_balance_cannot_pay_for_is_refused_and_kept() {
    let mut sim = tower();
    let id = office(&mut sim, 2, 12);
    let step = gesture(&mut sim, |s| {
        assert!(s.remove_facility(id, RemovalMethod::Sell).ok)
    })
    .unwrap();
    sim.money = 1.0;
    assert_eq!(
        sim.apply_undo_step(&step).unwrap_err(),
        StepRefused::NotEnoughMoney
    );
    assert!(sim.tower.get_unit(id).is_none(), "nothing came back");
    assert_eq!(sim.money, 1.0);
    sim.money = 1e9;
    assert!(sim.apply_undo_step(&step).is_ok());
    assert!(sim.tower.get_unit(id).is_some());
}

#[test]
fn an_undone_sale_brings_back_the_stored_income_once() {
    let mut sim = tower();
    let id = office(&mut sim, 2, 12);
    sim.tower.get_unit_mut(id).unwrap().pending_income = 5_000.0;
    let before = shape(&sim);
    let step = gesture(&mut sim, |s| {
        assert!(s.remove_facility(id, RemovalMethod::Sell).ok)
    })
    .unwrap();
    assert!(
        sim.tower.get_unit(id).is_none(),
        "the income left with the unit"
    );
    sim.apply_undo_step(&step).unwrap();
    assert_eq!(sim.tower.get_unit(id).unwrap().pending_income, 5_000.0);
    assert_eq!(shape(&sim), before);
}

#[test]
fn a_time_step_inside_a_gesture_is_not_part_of_the_step() {
    let mut sim = tower();
    let start = sim.money;
    sim.begin_undo_journal("Build");
    let _ = office(&mut sim, 2, 12);
    let paid = start - sim.money;
    sim.tick(60.0 * 24.0);
    let step = sim.end_undo_journal().unwrap();
    assert_eq!(
        step.money, paid,
        "only the build's price, not the day's takings"
    );
}

/// Taking a batch of units out at once leaves the same step as taking them
/// out one at a time, last index first: the journal merges the batch's
/// indexes into those removed before it in one pass, and the removals after
/// it find their places as before.
#[test]
fn a_batch_removal_records_the_same_step_as_one_by_one_removals() {
    let step_of = |batch: bool| {
        let mut sim = tower();
        gesture(&mut sim, |s| {
            assert!(s.build(Kind::Floor, 5, 20).ok);
            // Removed first, from before the batch's units, between them
            // and after them in the list.
            for (floor, x) in [(2, 12), (3, 22), (2, 25), (2, 60)] {
                let id = s.tower.unit_at(floor, x).unwrap().id;
                assert!(s.tower.remove_unit(id).is_some());
            }
            let mut ids: Vec<i64> = (20..30)
                .map(|x| s.tower.unit_at(4, x).unwrap().id)
                .collect();
            ids.push(s.tower.unit_at(5, 20).unwrap().id);
            if batch {
                assert_eq!(s.tower.remove_units(&ids).len(), ids.len());
            } else {
                let mut at: Vec<(usize, i64)> = ids
                    .iter()
                    .map(|&id| (s.tower.units.iter().position(|u| u.id == id).unwrap(), id))
                    .collect();
                at.sort_unstable();
                for (_, id) in at.into_iter().rev() {
                    assert!(s.tower.remove_unit(id).is_some());
                }
            }
            // Removed after, where the journal reads its place in the list
            // as the gesture found it from the removals noted so far.
            for (floor, x) in [(2, 21), (3, 40)] {
                let id = s.tower.unit_at(floor, x).unwrap().id;
                assert!(s.tower.remove_unit(id).is_some());
            }
        })
        .unwrap()
    };
    assert_eq!(
        format!("{:?}", step_of(true)),
        format!("{:?}", step_of(false))
    );
}
