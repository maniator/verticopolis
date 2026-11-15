//! What a load rebuilds from the saved people (`crowd::adopt`), and the crowd
//! values saved beside them: the step's hour and the office commuters.

use serde_json::{json, Value};

use crate::clock::GameMode;
use crate::crowd::commuters::{Commute, Desk, Shift};
use crate::load_stream::load_save_text;
use crate::sim::Simulation;

/// One valid saved person, as the save writes them, to forge from.
fn walker(id: i64) -> Value {
    json!({
        "id": id, "state": "toShaft", "floor": 1, "fy": 1.0, "x": 10.0,
        "startX": 10.0, "floors": [1, 5], "originFloor": 1, "shafts": [99],
        "leg": 0, "shaftId": 99, "destX": 20.0, "wait": 0.0, "tripWait": 0.0,
        "age": 3.0, "linger": 0.0,
    })
}

fn load_with_crowd(crowd: Value) -> Simulation {
    let mut save = Simulation::new_game(5, GameMode::Modern).serialize();
    save["crowd"] = crowd;
    load_save_text(save.to_string().as_bytes()).unwrap()
}

#[test]
fn a_maid_whose_room_was_demolished_keeps_her_claim_on_her_floor() {
    let mut maid = walker(8);
    maid["staff"] = json!(true);
    maid["crewId"] = json!(3);
    maid["staffTrip"] = json!("job");
    maid["cleanUnitId"] = json!(4242);
    let sim = load_with_crowd(json!({ "people": [maid] }));
    // The live game keeps the claim until she is done; so does the load,
    // on the floor her route ends on.
    assert_eq!(sim.housekeeping.room_holder(4242), Some((3, 5)));
    assert_eq!(sim.crowd.people[0].clean_unit_id, Some(4242));
}

#[test]
fn the_steps_hour_and_weekend_come_back() {
    let mut sim = Simulation::new_game(5, GameMode::Modern);
    sim.tick(1.0);
    let hour = sim.crowd.hour;
    assert!(hour.is_some(), "a step sets the hour");
    let loaded = load_save_text(sim.save_text().as_bytes()).unwrap();
    assert_eq!(loaded.crowd.hour, hour);
    assert_eq!(loaded.crowd.weekend, sim.crowd.weekend);
    let forged = load_with_crowd(json!({ "hour": 13, "weekend": true }));
    assert_eq!((forged.crowd.hour, forged.crowd.weekend), (Some(13), true));
    for bad in [json!(24), json!(-1), json!(7.5), json!("noon")] {
        let forged = load_with_crowd(json!({ "hour": bad.clone() }));
        assert_eq!(forged.crowd.hour, None, "{bad}");
    }
}

#[test]
fn the_commuters_desks_and_bookings_come_back() {
    let mut worker = walker(7);
    worker["commute"] = json!({ "officeId": 4, "inbound": true });
    let crowd = json!({
        "people": [worker, walker(9)],
        "desks": [
            [4, 5, 10, 9, 2, 1, 0],
            [4, 6, 10, 9, 7, 0, 0],
            [5, 5, 30, 9, -1, 0, 0],
            [6, 5, 30, 0, 1, 0, 0],
            [7, 5, 30, 9, 1],
        ],
        "shifts": [[400.0, 4, false], [500.5, 4, true], ["x", 4, true], [1.0, 4], [600.0, 4, true, 9], [700.0, 4, true, "x"]],
    });
    let sim = load_with_crowd(crowd);
    let worker = &sim.crowd.people[0];
    let commute = Commute {
        workplace_id: 4,
        inbound: true,
    };
    assert_eq!(worker.commute, Some(commute));
    assert!(worker.commuter);
    assert!(!sim.crowd.people[1].commuter);
    assert_eq!(sim.crowd.commuter_count, 1, "counted from the people");
    let desk = Desk {
        floor: 5,
        x: 10,
        width: 9,
        inside: 2,
        coming: 1,
        going: 0,
    };
    // The first row for an office is kept; rows that do not read are not.
    assert_eq!(sim.crowd.desks.len(), 1);
    assert_eq!(sim.crowd.desks[&4], desk);
    // Latest first, so the next one due is last.
    // A fourth entry names the station an arrival is held for (the Metro's
    // train); one that does not read drops the row.
    let shift = |at, inbound, station| Shift {
        at,
        workplace_id: 4,
        inbound,
        station,
    };
    assert_eq!(
        sim.crowd.shifts,
        vec![
            shift(600.0, true, Some(9)),
            shift(500.5, true, None),
            shift(400.0, false, None)
        ]
    );
    // And they are written back as they were read.
    let crowd = &sim.serialize()["crowd"];
    assert_eq!(crowd["desks"], json!([[4, 5, 10, 9, 2, 1, 0]]));
    assert_eq!(
        crowd["shifts"],
        json!([[600.0, 4, true, 9], [500.5, 4, true], [400.0, 4, false]])
    );
    assert_eq!(
        crowd["people"][0]["commute"],
        json!({ "officeId": 4, "inbound": true })
    );
}

#[test]
fn a_crowd_without_commuters_writes_no_desks_or_bookings() {
    let sim = load_with_crowd(json!({ "people": [walker(7)] }));
    let crowd = &sim.serialize()["crowd"];
    assert!(crowd.get("desks").is_none());
    assert!(crowd.get("shifts").is_none());
    assert!(crowd["people"][0].get("commute").is_none());
}

#[test]
fn the_modern_routers_lines_come_back_for_the_next_step() {
    let lines = json!([[9, 4, 2], [3, 1, 5], [4, 2, 0], [1, "x", 2], [5, 5]]);
    let sim = load_with_crowd(json!({ "lines": lines }));
    let riders = |key| sim.crowd.shaft_lines.get(&key).map(|l| l.riders);
    assert_eq!(riders((3, 1)), Some(5));
    assert_eq!(riders((9, 4)), Some(2));
    assert_eq!(sim.crowd.shaft_lines.get(&(4, 2)), None, "a line of nobody");
    // Written back in key order, whatever order the map holds them in.
    let crowd = &sim.serialize()["crowd"];
    assert_eq!(crowd["lines"], json!([[3, 1, 5], [9, 4, 2]]));
    let empty = load_with_crowd(json!({}));
    assert!(empty.serialize()["crowd"].get("lines").is_none());
}

#[test]
fn the_stood_down_cars_come_back_for_the_routers_first_step() {
    let cars = json!([[7, 2], [3, 0], [7, 2], [3, "x"], [4]]);
    let sim = load_with_crowd(json!({ "closedCars": cars }));
    assert_eq!(
        sim.crowd.closed_cars,
        vec![(3, 0), (7, 2)],
        "ascending, once each"
    );
    let crowd = &sim.serialize()["crowd"];
    assert_eq!(crowd["closedCars"], json!([[3, 0], [7, 2]]));
    let empty = load_with_crowd(json!({}));
    assert!(empty.serialize()["crowd"].get("closedCars").is_none());
}

#[test]
fn a_forged_head_count_cannot_send_out_more_workers_than_an_office_holds() {
    let most = crate::facilities::Kind::Office.facility().population;
    let huge = 9_007_199_254_740_991_i64;
    let sim = load_with_crowd(json!({ "desks": [[4, 5, 10, 9, huge, huge, huge]] }));
    let desk = sim.crowd.desks[&4];
    assert_eq!((desk.inside, desk.coming, desk.going), (most, most, most));
    // The office's own head count is held to the same ceiling.
    let mut save = Simulation::new_game(5, GameMode::Modern).serialize();
    save["units"].as_array_mut().unwrap().push(json!({
        "id": 77, "kind": "office", "floor": 2, "x": 100, "width": 9,
        "state": "occupied", "occupants": huge,
    }));
    let loaded = load_save_text(save.to_string().as_bytes()).unwrap();
    let office = loaded.tower.get_unit(77).expect("the office loads");
    assert_eq!(office.occupants, most);
}

#[test]
fn a_save_cannot_send_out_more_workers_of_gone_offices_than_it_holds_people() {
    let most = crate::facilities::Kind::Office.facility().population;
    let cap = crate::crowd::save::MAX_SAVED_PEOPLE as i64;
    let mut sim = Simulation::new_game(5, GameMode::Modern);
    // Office ids no unit carries, each full: far more workers than a save
    // may hold people.
    let gone = cap / most + 200;
    for id in 0..gone {
        let desk = Desk {
            inside: most,
            ..Desk::default()
        };
        sim.crowd.desks.insert(10_000 + id, desk);
    }
    sim.crowd.bound_gone_desks(&sim.tower);
    let kept: i64 = sim.crowd.desks.values().map(|d| d.inside).sum();
    assert_eq!(kept, cap / most * most);
    // The lowest ids are the ones kept, so a load keeps the same desks.
    assert_eq!(sim.crowd.desks.keys().next(), Some(&10_000));
    assert_eq!(sim.crowd.desks.len() as i64, cap / most);
    // Saved people take their share of the room first.
    let people: Vec<Value> = (1..=5).map(walker).collect();
    sim.crowd.people = load_with_crowd(json!({ "people": people })).crowd.people;
    assert_eq!(sim.crowd.people.len(), 5);
    sim.crowd.bound_gone_desks(&sim.tower);
    let kept: i64 = sim.crowd.desks.values().map(|d| d.inside).sum();
    assert_eq!(kept, (cap - 5) / most * most);
    // Through a whole load: whether the first pass walks them out as people
    // or leaves them at their desks, the workers stay under the cap.
    let rows: Vec<Value> = (0..gone)
        .map(|id| json!([10_000 + id, 5, 30, 9, most, 0, 0]))
        .collect();
    let loaded = load_with_crowd(json!({ "desks": rows }));
    let at_desks: i64 = loaded.crowd.desks.values().map(|d| d.inside).sum();
    let total = loaded.crowd.people.len() as i64 + at_desks;
    assert!(total <= cap, "{total} workers after the load");
    assert!(total > 0, "the bound keeps the desks that fit");
}
