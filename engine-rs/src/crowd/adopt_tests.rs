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
        "shifts": [[400.0, 4, false], [500.5, 4, true], ["x", 4, true], [1.0, 4]],
    });
    let sim = load_with_crowd(crowd);
    let worker = &sim.crowd.people[0];
    let commute = Commute {
        office_id: 4,
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
    let shift = |at, inbound| Shift {
        at,
        office_id: 4,
        inbound,
    };
    assert_eq!(
        sim.crowd.shifts,
        vec![shift(500.5, true), shift(400.0, false)]
    );
    // And they are written back as they were read.
    let crowd = &sim.serialize()["crowd"];
    assert_eq!(crowd["desks"], json!([[4, 5, 10, 9, 2, 1, 0]]));
    assert_eq!(
        crowd["shifts"],
        json!([[500.5, 4, true], [400.0, 4, false]])
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
    assert_eq!(sim.crowd.shaft_lines.get(&(3, 1)), Some(&5));
    assert_eq!(sim.crowd.shaft_lines.get(&(9, 4)), Some(&2));
    assert_eq!(sim.crowd.shaft_lines.get(&(4, 2)), None, "a line of nobody");
    // Written back in key order, whatever order the map holds them in.
    let crowd = &sim.serialize()["crowd"];
    assert_eq!(crowd["lines"], json!([[3, 1, 5], [9, 4, 2]]));
    let empty = load_with_crowd(json!({}));
    assert!(empty.serialize()["crowd"].get("lines").is_none());
}
