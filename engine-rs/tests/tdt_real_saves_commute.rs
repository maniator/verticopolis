//! The nine real 1997 saves under real elevator waits (#1971): each was a
//! healthy tower in the original, so four played days must not empty it.
//! Wait limits that misread the original (50 seconds cost the 4 and 5 star
//! towers 15 to 35 percent of their tenants) fail here.

use std::path::PathBuf;

use verticopolis_engine::facilities::Kind;
use verticopolis_engine::load::deserialize_tdt;
use verticopolis_engine::sim::Simulation;
use verticopolis_engine::tdt::parse::parse_tdt;
use verticopolis_engine::tower::UnitState;

const SAVES: [&str; 9] = [
    "TOWER1.TDT",
    "TOWER2.TDT",
    "TOWER3.TDT",
    "TOWER4.TDT",
    "TOWER5.TDT",
    "TOWER6.TDT",
    "TOWER7.TDT",
    "TOWER8.TDT",
    "MYTOWER.TDT",
];

/// The share of its rated tenants a real tower keeps after four days.
const KEPT_AT_LEAST: f64 = 0.95;

fn loaded(name: &str) -> Simulation {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../conformance/fixtures/tdt-reddit")
        .join(name);
    let parsed = parse_tdt(&std::fs::read(path).expect("fixture"), name).expect("imports");
    deserialize_tdt(&parsed.save).expect("loads")
}

/// Occupied offices, condos, hotel rooms and rentals: the rooms a wait drains.
fn rated_tenants(sim: &Simulation) -> usize {
    sim.tower
        .units
        .iter()
        .filter(|u| u.state == UnitState::Occupied)
        .filter(|u| {
            u.kind == Kind::Office
                || u.kind == Kind::Condo
                || u.kind.is_hotel()
                || u.kind.is_rental()
        })
        .count()
}

#[test]
fn a_real_tower_keeps_its_tenants_through_four_days_of_real_waits() {
    for name in SAVES {
        let mut sim = loaded(name);
        let before = rated_tenants(&sim);
        for _ in 0..4 * 24 {
            sim.tick(60.0);
        }
        let after = rated_tenants(&sim);
        assert!(
            after as f64 >= KEPT_AT_LEAST * before as f64,
            "{name}: {after} of {before} rated tenants left after four days"
        );
    }
}
