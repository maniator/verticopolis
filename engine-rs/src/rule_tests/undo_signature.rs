//! What the undo signature reads, from the retired
//! `towerStateSig.integration.test.ts` and the stack half of
//! `undoHistory.integration.test.ts`. A gesture keeps an undo step only when
//! the port's `undoSignature` (`tower_signature` plus the money) moved, so an
//! edit that can be a gesture's only change has to move the signature, or its
//! step is dropped as a no-op.
//!
//! The stack rules are already Rust tests: `undo_tests::a_new_step_ends_the_redo_trail`,
//! `undo_tests::each_stack_keeps_the_last_fifty_steps`,
//! `undo_tests::clear_forgets_both_stacks`, and
//! `sim_undo_tests::an_edit_that_changes_nothing_leaves_no_step`. The
//! TypeScript `UndoHistory` capture and `UndoSteps` fingerprint cases test that
//! class's own snapshot seam, which the Rust delta journal does not have.
use super::{seeded_game, MID};
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;
use serde_json::json;

/// What the port's `undoSignature` joins: the tower's fingerprint and the money.
fn signature(sim: &Simulation) -> (u64, f64) {
    (sim.tower_signature(), sim.money)
}

/// A seeded game with floor 2 laid around the middle and money to spare.
fn floored(half_width: i64) -> Simulation {
    let mut sim = seeded_game(1, GameMode::Classic);
    sim.money = 1e12;
    sim.star = 5;
    for x in MID - half_width..MID + half_width {
        assert!(sim.tower.place(Kind::Floor, 2, x).ok);
    }
    sim
}

fn unit_on(sim: &mut Simulation, kind: Kind) -> i64 {
    let r = sim.build(kind, 2, MID);
    assert!(r.ok, "{kind:?}: {:?}", r.reason);
    sim.tower.unit_at(2, MID).expect("built").id
}

#[test]
fn the_signature_reads_the_money_and_not_the_clock() {
    let mut sim = seeded_game(1, GameMode::Classic);
    let before = sim.tower_signature();
    let units = sim.tower.units.len();
    sim.tick(30.0);
    assert_eq!(sim.tower.units.len(), units, "only the clock moved");
    assert_eq!(sim.tower_signature(), before);
    let was = signature(&sim);
    sim.money += 1.0;
    assert_ne!(signature(&sim), was);
}

#[test]
fn added_structure_moves_the_signature() {
    let mut sim = seeded_game(1, GameMode::Classic);
    let before = signature(&sim);
    assert!(sim.tower.place(Kind::Floor, 2, MID).ok);
    assert_ne!(signature(&sim), before);
}

#[test]
fn a_rename_a_no_rate_flip_a_schedule_and_a_reroll_each_move_it() {
    let mut sim = floored(10);
    let office = unit_on(&mut sim, Kind::Office);
    let before = signature(&sim);
    assert!(sim.tower.set_label(office, "Penthouse"));
    assert_ne!(signature(&sim), before, "a rename");

    let mut sim = floored(10);
    let office = unit_on(&mut sim, Kind::Office);
    assert_eq!(
        sim.tower.get_unit(office).unwrap().rent,
        None,
        "an Average unit"
    );
    let before = signature(&sim);
    assert!(sim.set_no_rate(office));
    assert_ne!(signature(&sim), before, "taking it off the market");

    let mut sim = floored(10);
    assert!(sim.build_transport(Kind::ElevatorStandard, MID, 1, 2).ok);
    let shaft = sim.tower.transports[0].id;
    let before = signature(&sim);
    assert!(sim
        .tower
        .set_schedule(shaft, &json!({ "waitingCarResponse": 5 })));
    assert_ne!(signature(&sim), before, "a schedule");

    let mut sim = floored(20);
    // The whole lobby run is floored: the shop sits right of the shaft.
    assert!(
        sim.build_transport(Kind::ElevatorStandard, MID - 15, 1, 2)
            .ok
    );
    let shop = unit_on(&mut sim, Kind::Shop);
    let before = signature(&sim);
    assert!(sim.reroll_subtype(shop).is_some());
    assert_ne!(signature(&sim), before, "a subtype reroll");
}
