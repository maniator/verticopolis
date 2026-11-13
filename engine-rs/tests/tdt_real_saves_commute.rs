//! The nine real 1997 saves under real elevator waits (#1971): each was a
//! healthy tower in the original, so four played days must not empty it.
//! Wait limits that misread the original (50 seconds cost the 4 and 5 star
//! towers 15 to 35 percent of their tenants) fail here.
//!
//! The days are played the way the game plays them at its top speed, a
//! frame at a time on the canon day curve, which steps one to six game
//! minutes per frame (four through the evening, six at night). Riders board
//! only a car standing open at their floor, and the commute waits now depend
//! on the step length: measured on TOWER2 over four days of fixed steps,
//! steps of up to three minutes keep all 519 rated tenants, four minutes
//! keep 503 and hour ticks keep 489. Hour ticks are not a way the game runs,
//! so they would measure the stepping instead of the waits. Making a stop
//! last long enough at every speed waits on the measurement of the
//! original's car timing (#2061).

use std::path::PathBuf;

use verticopolis_engine::facilities::Kind;
use verticopolis_engine::fixed_step::FrameStepper;
use verticopolis_engine::load::deserialize_tdt;
use verticopolis_engine::sim::Simulation;
use verticopolis_engine::tdt::parse::parse_tdt;
use verticopolis_engine::tower::UnitState;

/// The share of its rated tenants a real tower keeps after four days.
const KEPT_AT_LEAST: f64 = 0.95;

/// The game's top speed, in game minutes per real second (`SPEEDS[3]`).
const TOP_SPEED: f64 = 120.0;

/// One frame at the 60 Hz the web host renders at, in milliseconds.
const FRAME_MS: f64 = 1000.0 / 60.0;

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

/// Plays `name` for four days at the top speed and checks it kept its
/// tenants.
fn keeps_its_tenants(name: &str) {
    let mut sim = loaded(name);
    let before = rated_tenants(&sim);
    let mut host = FrameStepper::default();
    let end = sim.clock.minutes + 4.0 * 1440.0;
    let mut frames = 0;
    while sim.clock.minutes < end {
        host.advance(&mut sim, FRAME_MS, TOP_SPEED, false, true);
        frames += 1;
        assert!(frames < 1_000_000, "{name}: the clock is not advancing");
    }
    let after = rated_tenants(&sim);
    assert!(
        after as f64 >= KEPT_AT_LEAST * before as f64,
        "{name}: {after} of {before} rated tenants left after four days"
    );
}

/// One test per save, so the nine play in parallel.
macro_rules! real_save {
    ($($test:ident: $name:literal,)*) => {$(
        #[test]
        fn $test() {
            keeps_its_tenants($name);
        }
    )*};
}

real_save! {
    tower1_keeps_its_tenants_through_four_days_of_real_waits: "TOWER1.TDT",
    tower2_keeps_its_tenants_through_four_days_of_real_waits: "TOWER2.TDT",
    tower3_keeps_its_tenants_through_four_days_of_real_waits: "TOWER3.TDT",
    tower4_keeps_its_tenants_through_four_days_of_real_waits: "TOWER4.TDT",
    tower5_keeps_its_tenants_through_four_days_of_real_waits: "TOWER5.TDT",
    tower6_keeps_its_tenants_through_four_days_of_real_waits: "TOWER6.TDT",
    tower7_keeps_its_tenants_through_four_days_of_real_waits: "TOWER7.TDT",
    tower8_keeps_its_tenants_through_four_days_of_real_waits: "TOWER8.TDT",
    mytower_keeps_its_tenants_through_four_days_of_real_waits: "MYTOWER.TDT",
}
