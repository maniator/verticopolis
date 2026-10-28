use indexmap::IndexMap;
use serde_json::Value;

use super::*;
use crate::clock::GameMode;
use crate::facilities::{Kind, FACILITIES};
use crate::telemetry::{HourlyByDay, OriginRings};
use crate::tower::UnitState;

fn code(kind: Kind) -> f64 {
    FACILITIES.iter().position(|f| f.kind == kind).unwrap() as f64
}

/// The JSON getters' numbers as the port writes them: null as NaN, a
/// boolean as 0 or 1.
fn num(v: &Value) -> f64 {
    match v {
        Value::Null => f64::NAN,
        Value::Bool(b) => flag(*b),
        v => v.as_f64().unwrap(),
    }
}

fn same(a: f64, b: f64) -> bool {
    a == b || (a.is_nan() && b.is_nan())
}

/// A lobby and two floors over x 150..230, an office, a hotel room and a
/// cinema, a standard elevator over floors 1 to 3 and stairs over 1 and 2.
fn built() -> Engine {
    let mut e = Engine::of(Simulation::new_game(7, GameMode::Modern));
    e.sim.money = 1e9;
    for x in 150..230 {
        assert!(e.sim.tower.place(Kind::Lobby, 1, x).ok);
        assert!(e.sim.tower.place(Kind::Floor, 2, x).ok);
        assert!(e.sim.tower.place(Kind::Floor, 3, x).ok);
    }
    assert!(e.sim.tower.place(Kind::Office, 2, 160).ok);
    assert!(e.sim.tower.place(Kind::HotelSingle, 3, 160).ok);
    assert!(e.sim.tower.place(Kind::Cinema, 2, 169).ok);
    let shaft = e.port_build_shaft(code(Kind::ElevatorStandard), 155.0, 1.0, 3.0);
    assert_eq!(shaft[0], 1.0, "{:?}", e.last_reason_text());
    let stairs = e.port_build_shaft(code(Kind::Stairs), 210.0, 1.0, 2.0);
    assert_eq!(stairs[0], 1.0, "{:?}", e.last_reason_text());
    e
}

fn unit(e: &Engine, kind: Kind) -> i64 {
    e.sim
        .tower
        .units
        .iter()
        .find(|u| u.kind == kind)
        .unwrap()
        .id
}

#[test]
fn heat_cells_are_the_overlays_cells() {
    let mut e = built();
    let hotel = unit(&e, Kind::HotelSingle);
    e.sim
        .tower
        .units
        .iter_mut()
        .find(|u| u.id == hotel)
        .unwrap()
        .state = UnitState::Infested;
    for (i, name) in HEAT_MODES.iter().enumerate() {
        let cells = e.port_heat_cells(i as f64);
        let mode = HeatmapMode::parse(name).unwrap();
        let json: Value = serde_json::from_str(&e.sim.floor_heatmap_json(mode)).unwrap();
        let json = json.as_array().unwrap();
        assert_eq!(cells.len(), json.len() * HEAT_CELL.len(), "{name}");
        for (row, c) in cells.chunks(HEAT_CELL.len()).zip(json) {
            for (slot, key) in HEAT_CELL[..4].iter().enumerate() {
                assert_eq!(row[slot], num(&c[key]), "{name} {key}");
            }
            let tint = c["tint"].as_str().unwrap_or("none");
            assert_eq!(HEAT_TINTS[row[4] as usize], tint, "{name}");
        }
    }
    let infested = e.port_heat_cells(3.0);
    assert!(
        infested.chunks(5).any(|c| c[4] == 2.0),
        "the infested tint is coded"
    );
    assert!(e.port_heat_cells(4.0).is_empty());
    assert!(e.port_heat_cells(0.5).is_empty());
}

#[test]
fn crew_coverage_is_the_coverage_readout() {
    let e = built();
    let json = e.sim.housekeeping_coverage().to_json();
    let r = e.port_crew_coverage();
    assert_eq!(r.len(), CREW_COVERAGE.len());
    for (slot, key) in CREW_COVERAGE.iter().enumerate() {
        assert_eq!(r[slot], num(&json[key]), "{key}");
    }
}

#[test]
fn the_unit_card_is_the_detail_card() {
    let mut e = built();
    let office = unit(&e, Kind::Office);
    e.sim
        .tower
        .units
        .iter_mut()
        .find(|u| u.id == office)
        .unwrap()
        .vacate_reason = Some("rent");
    let cinema = unit(&e, Kind::Cinema);
    e.sim
        .tower
        .units
        .iter_mut()
        .find(|u| u.id == cinema)
        .unwrap()
        .film_policy = Some("blockbuster");
    // The cinema twice: booked for the blockbuster, then not.
    e.sim.blockbusters.push(cinema as f64);
    let ids = [
        office,
        unit(&e, Kind::HotelSingle),
        unit(&e, Kind::Lobby),
        cinema,
        cinema,
    ];
    for (n, id) in ids.into_iter().enumerate() {
        if n == 4 {
            e.sim.blockbusters.clear();
        }
        let r = e.port_unit_card(id as f64);
        if id == cinema {
            let at = |name: &str| UNIT_CARD.iter().position(|k| *k == name).unwrap();
            assert_eq!(r[at("filmPolicy")], 2.0, "the policy's code");
            assert_eq!(r[at("blockbuster")], if n == 3 { 1.0 } else { 0.0 });
        }
        let json = e.sim.unit_detail(id).unwrap();
        assert_eq!(r.len(), UNIT_CARD.len());
        let kind = FACILITIES[r[1] as usize].key;
        assert_eq!(json["kind"], kind);
        assert_eq!(
            json["state"],
            crate::view::layout::UNIT_STATES[r[5] as usize]
        );
        let codes = [
            ("vacateReason", &VACATE_REASONS[..]),
            ("filmPolicy", &FILM_POLICIES[..]),
        ];
        for (slot, key) in UNIT_CARD.iter().enumerate() {
            if let Some((_, table)) = codes.iter().find(|(k, _)| k == key) {
                let want = json[key]
                    .as_str()
                    .map(|s| table.iter().position(|t| *t == s).unwrap());
                assert!(same(r[slot], want.map_or(f64::NAN, |i| i as f64)), "{key}");
            } else if !matches!(*key, "kindCode" | "stateCode") {
                assert!(
                    same(r[slot], num(&json[key])),
                    "{key}: {} vs {}",
                    r[slot],
                    json[key]
                );
            }
        }
    }
    assert!(e.port_unit_card(-1.0).is_empty());
    assert!(e.port_unit_card(1.5).is_empty());
    assert!(e.port_unit_card(f64::NAN).is_empty());
}

#[test]
fn the_shaft_card_is_the_transport_detail() {
    let mut e = built();
    let id = e.sim.tower.transports[0].id;
    let stairs = e.sim.tower.transports[1].id;
    let check = |e: &Engine, id: i64| {
        let r = e.port_shaft_card(id as f64);
        let json = e.sim.transport_detail(id).unwrap();
        let head = &r[..SHAFT_CARD.len()];
        assert_eq!(FACILITIES[head[1] as usize].key, json["kind"]);
        for (slot, key) in SHAFT_CARD.iter().enumerate() {
            match *key {
                "kindCode" => {}
                "hourly" | "origins" => assert_eq!(head[slot], flag(!json[key].is_null())),
                "stops" => assert_eq!(head[slot], json["stops"].as_array().unwrap().len() as f64),
                _ => assert!(same(head[slot], num(&json[key])), "{key}"),
            }
        }
        let mut at = SHAFT_CARD.len();
        if head[9] == 1.0 {
            for day in ["weekday", "weekend"] {
                for v in json["hourly"][day].as_array().unwrap() {
                    assert_eq!(r[at], num(v));
                    at += 1;
                }
            }
        }
        for row in json["stops"].as_array().unwrap() {
            for (i, key) in STOP_ROW.iter().enumerate() {
                assert_eq!(r[at + i], num(&row[key]), "{key}");
            }
            at += STOP_ROW.len();
        }
        if head[11] == 1.0 {
            for day in ["weekday", "weekend"] {
                for ring in json["origins"][day].as_array().unwrap() {
                    let pairs = ring.as_array().unwrap();
                    assert_eq!(r[at], pairs.len() as f64);
                    at += 1;
                    for p in pairs {
                        assert_eq!((r[at], r[at + 1]), (num(&p[0]), num(&p[1])));
                        at += 2;
                    }
                }
            }
        }
        assert_eq!(at, r.len(), "nothing trails the card");
    };
    check(&e, id);
    // Stairs carry no stop rows and no utilization reading.
    check(&e, stairs);
    let r = e.port_shaft_card(stairs as f64);
    let at = |name: &str| SHAFT_CARD.iter().position(|k| *k == name).unwrap();
    assert_eq!(r[at("stops")], 0.0);
    assert!(r[at("utilization")].is_nan());
    e.port_mark_stop(id as f64, 2.0, false);
    e.sim.telemetry.util.insert(id, 0.25);
    let hours: Vec<f64> = (0..24).map(f64::from).collect();
    e.sim.telemetry.hourly.insert(
        id,
        HourlyByDay {
            weekday: hours.clone(),
            weekend: hours,
        },
    );
    let mut rings = OriginRings::empty();
    let mut slot = IndexMap::new();
    slot.insert(1, 2.5);
    slot.insert(3, 0.5);
    rings.weekday[8] = slot;
    e.sim.telemetry.origins.insert(id, rings);
    check(&e, id);
    assert!(e.port_shaft_card(id as f64 + 1000.0).is_empty());
    assert!(e.port_shaft_card(f64::INFINITY).is_empty());
}
