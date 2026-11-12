//! The shaft panel's per-floor "served" flags after its stops moved to
//! `Transport::stop_floors` (#1984): every floor of an express shaft reads
//! exactly what `stops_at` answers, lobbies and endpoints included.

use super::tests::{founded, shaft};
use crate::clock::GameMode;
use crate::facilities::Kind;

#[test]
fn the_shaft_panel_flags_every_floor_the_way_stops_at_does() {
    let mut sim = founded(GameMode::Modern, 31);
    shaft(&mut sim, Kind::ElevatorExpress, 160, 1, 31);
    shaft(&mut sim, Kind::ElevatorStandard, 170, 1, 12);
    let express = sim.tower.transports[0].id;
    let standard = sim.tower.transports[1].id;
    // The express shaft stops only at its lobby ends, so its skip list is
    // full; the standard shaft drops a few of its floors.
    let skips = sim
        .tower
        .get_transport(express)
        .unwrap()
        .skip_floors
        .clone();
    assert!(
        skips.is_some_and(|s| s.len() > 20),
        "express skips its middle floors"
    );
    for fl in [4, 7, 9] {
        assert!(sim.tower.set_stop(standard, fl, false), "floor {fl} skip");
    }
    for id in [express, standard] {
        let t = sim.tower.get_transport(id).unwrap().clone();
        let d = sim.transport_detail(id).unwrap();
        let stops = d["stops"].as_array().unwrap();
        assert_eq!(
            stops.len() as i64,
            t.top - t.bottom + 1,
            "every floor listed"
        );
        for row in stops {
            let fl = row["floor"].as_i64().unwrap();
            assert_eq!(row["served"], t.stops_at(fl), "shaft {id} floor {fl}");
        }
    }
    let t = sim.tower.get_transport(standard).unwrap();
    assert!(!t.stops_at(7), "the skip took");
    let d = sim.transport_detail(standard).unwrap();
    let seven = d["stops"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["floor"] == 7)
        .unwrap();
    assert_eq!(seven["served"], false);
}
