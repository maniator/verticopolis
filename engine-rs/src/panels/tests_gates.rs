//! The star checklist's gate ladder (`cumulative_star_gates`) and the ladder
//! promotion checks (`cumulative_gates_met`) are two codings of one rule. The
//! TypeScript shares a single function so a checklist can never call a rung
//! ready that promotion refuses; here a test holds the two together at every
//! gate's threshold.

use super::tests::{founded, put, settle, shaft};
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;

fn agree(sim: &Simulation, step: &str) {
    for rung in 1..=6 {
        let checklist = sim.cumulative_star_gates(rung).iter().all(|(_, met)| *met);
        assert_eq!(
            sim.cumulative_gates_met(rung),
            checklist,
            "rung {rung} after {step}"
        );
    }
}

#[test]
fn the_checklist_and_promotion_agree_at_every_gate_threshold() {
    let mut sim = founded(GameMode::Classic, 3);
    shaft(&mut sim, Kind::ElevatorStandard, 152, 1, 3);
    agree(&sim, "nothing built");
    put(&mut sim, Kind::Security, 2, 160);
    put(&mut sim, Kind::Security, 2, 190);
    settle(&mut sim, 24);
    agree(&sim, "security");
    put(&mut sim, Kind::Medical, 2, 170);
    settle(&mut sim, 24);
    agree(&sim, "medical");
    for fl in [0, -1] {
        for x in 170..200 {
            put(&mut sim, Kind::Floor, fl, x);
        }
    }
    put(&mut sim, Kind::Recycling, -1, 180);
    settle(&mut sim, 24);
    agree(&sim, "recycling");
    put(&mut sim, Kind::HotelSuite, 3, 160);
    settle(&mut sim, 24);
    agree(&sim, "one suite, the gate needs two");
    assert!(
        !sim.cumulative_star_gates(4).iter().all(|(_, met)| *met),
        "one suite is short of the four-star ladder"
    );
    put(&mut sim, Kind::HotelSuite, 3, 172);
    settle(&mut sim, 24);
    agree(&sim, "two suites, no VIP review");
    sim.vip_favorable = true;
    agree(&sim, "VIP review");
    assert!(
        sim.cumulative_star_gates(4).iter().all(|(_, met)| *met),
        "{:?}",
        sim.cumulative_star_gates(4)
    );
    assert!(sim.sell_at(3, 172), "sell the second suite");
    agree(&sim, "second suite sold");
    assert!(sim.sell_at(2, 170), "sell medical");
    agree(&sim, "medical sold");
    assert!(sim.sell_at(-1, 180), "sell recycling");
    agree(&sim, "recycling sold");
}
