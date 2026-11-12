//! Each elevator car's waiting floor through the `.TDT` codec. The 1994
//! elevator record keeps one home floor per car (byte 186 of the record,
//! `docs/canon/tdt-byte-map.md`), and a car with nothing to do goes back to
//! it. An import writes those floors as the shaft's `schedule.homeFloors`, so
//! the cars of an imported tower wait where the original had them instead of
//! all stacking on the lobby; an export writes the authored homes back.
//!
//! Already covered: a car idling at its authored home by
//! `dispatch_tests`, and the home snapping on a stop edit by
//! `rule_tests::elevator_schedule`.
use serde_json::{json, Value};

use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::load::deserialize_tdt;
use crate::sim::Simulation;
use crate::tdt::{export_tdt, import_tdt};

use super::seeded_game;

const TOP: i64 = 12;

/// A centered lobby with floor slabs to `TOP`, one standard elevator with
/// four cars over floors 1 to `TOP`, and the given authored homes.
fn tower_with_homes(homes: Value) -> Simulation {
    let mut sim = seeded_game(7, GameMode::Classic);
    sim.money = 1e9;
    let mid = super::MID;
    for floor in 2..=TOP {
        for x in mid - 20..mid + 20 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    let placed = sim.build_transport(Kind::ElevatorStandard, mid, 1, TOP);
    assert!(placed.ok, "{:?}", placed.reason);
    let id = sim.tower.transports[0].id;
    assert!(sim.tower.set_cars(id, 4));
    if !homes.is_null() {
        assert!(sim.tower.set_schedule(id, &json!({ "homeFloors": homes })));
    }
    sim
}

fn imported(sim: &Simulation) -> Value {
    let bytes = export_tdt(&sim.serialize().to_string()).expect("exports");
    let (text, _) = import_tdt(&bytes, "HOMES.TDT").expect("imports");
    serde_json::from_str(&text).unwrap()
}

fn elevator(save: &Value) -> &Value {
    save["transports"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["kind"] == "elevatorStandard")
        .expect("the elevator survives the round trip")
}

#[test]
fn authored_waiting_floors_survive_an_export_and_import() {
    let save = imported(&tower_with_homes(json!([1, 4, 8, 12])));
    let shaft = elevator(&save);
    assert_eq!(shaft["schedule"]["homeFloors"], json!([1, 4, 8, 12]));
    assert_eq!(
        shaft["carPositions"],
        json!([1, 4, 8, 12]),
        "each car starts at home"
    );
}

#[test]
fn a_shaft_without_authored_homes_exports_where_its_cars_stand() {
    let mut sim = tower_with_homes(Value::Null);
    sim.tower.transports[0].car_positions = vec![1.0, 3.0, 6.0, 9.0];
    let save = imported(&sim);
    assert_eq!(
        elevator(&save)["schedule"]["homeFloors"],
        json!([1, 3, 6, 9])
    );
}

#[test]
fn a_waiting_floor_the_shaft_skips_snaps_to_the_nearest_stop() {
    let mut sim = tower_with_homes(Value::Null);
    let id = sim.tower.transports[0].id;
    sim.tower.transports[0].car_positions = vec![1.0, 5.0, 6.0, 12.0];
    assert!(sim.tower.set_stop(id, 5, false));
    assert!(sim.tower.set_stop(id, 6, false));
    let save = imported(&sim);
    // 5 is two from 7 and one from 4; 6 is one from 7 and two from 4.
    assert_eq!(
        elevator(&save)["schedule"]["homeFloors"],
        json!([1, 4, 7, 12])
    );
}

#[test]
fn idle_cars_of_an_imported_tower_return_to_their_own_floors() {
    let save = imported(&tower_with_homes(json!([1, 4, 8, 12])));
    let mut sim = deserialize_tdt(&save).expect("the import loads");
    // Send every car to the lobby, the floor they all used to wait on.
    let shaft = &mut sim.tower.transports[0];
    assert_eq!(shaft.kind, Kind::ElevatorStandard);
    shaft.car_positions = vec![1.0; 4];
    // Nobody lives here, so no call holds a car: two quiet hours.
    for _ in 0..120 {
        sim.tick(1.0);
    }
    let parked: Vec<f64> = sim.tower.transports[0].car_positions.clone();
    assert_eq!(parked, vec![1.0, 4.0, 8.0, 12.0]);
}
