//! Undo against random edits: a run of edits is undone edit by edit, and
//! undo and redo between edits leave the game exactly as the edits alone do.
use super::tests::{gesture, office, shape, tower};
use crate::facilities::Kind;
use crate::gameplay::RemovalMethod;
use crate::sim::Simulation;

/// A fixed pseudo-random stream, so the sequences below repeat.
struct Dice(u64);

impl Dice {
    fn next(&mut self, below: u64) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (self.0 >> 33) % below
    }
}

/// One random edit: a build, a sale, a car, a price or a stop.
fn random_edit(sim: &mut Simulation, dice: &mut Dice) {
    let x = 10 + dice.next(55) as i64;
    let floor = 2 + dice.next(3) as i64;
    match dice.next(9) {
        0 => drop(sim.build(Kind::Office, floor, x)),
        1 => drop(sim.build(Kind::Condo, floor, x)),
        2 => drop(sim.build(Kind::Floor, 5, x)),
        3 => drop(sim.build_transport(Kind::ElevatorStandard, x, 1, 3)),
        4 | 5 => {
            if let Some(id) = sim.tower.unit_at(floor, x).map(|u| u.id) {
                let _ = sim.remove_facility(id, RemovalMethod::Sell);
            }
        }
        6 => {
            if let Some(id) = sim.tower.transport_at(1, x).map(|t| t.id) {
                let _ = sim.add_car(id);
                let _ = sim.tower.set_stop(id, 2, dice.next(2) == 0);
            }
        }
        7 => {
            if let Some(id) = sim.tower.unit_at(floor, x).map(|u| u.id) {
                let _ = sim.price_unit(id, 100_000.0 * dice.next(9) as f64);
                let _ = sim.tower.set_label(id, "Renamed");
            }
        }
        _ => drop(sim.paint_brush(Kind::Floor, 5, &[x, x + 1, x + 2])),
    }
}

#[test]
fn undoing_a_run_of_random_edits_puts_the_tower_back_edit_by_edit() {
    for seed in 0..12 {
        let mut sim = tower();
        let mut dice = Dice(seed);
        let mut shapes = vec![(shape(&sim), sim.money)];
        let mut steps = Vec::new();
        for _ in 0..40 {
            if let Some(step) = gesture(&mut sim, |s| random_edit(s, &mut dice)) {
                steps.push(step);
                shapes.push((shape(&sim), sim.money));
            }
        }
        assert!(steps.len() > 10, "seed {seed} edited the tower");
        shapes.pop();
        while let (Some(step), Some((want, money))) = (steps.pop(), shapes.pop()) {
            sim.apply_undo_step(&step).expect("the undo applies");
            assert_eq!(shape(&sim), want, "seed {seed}");
            assert_eq!(sim.money, money, "seed {seed}: exactly the cash it had");
        }
    }
}

#[test]
fn undo_and_redo_between_edits_leave_the_game_exactly_as_the_edits_alone_do() {
    for seed in 0..12 {
        let (mut direct, mut cycled) = (tower(), tower());
        let (mut a, mut b) = (Dice(seed), Dice(seed));
        let mut extra = Dice(seed + 100);
        for round in 0..30 {
            random_edit(&mut direct, &mut a);
            let step = gesture(&mut cycled, |s| random_edit(s, &mut b));
            if let Some(mut step) = step {
                for _ in 0..extra.next(4) {
                    step = cycled.apply_undo_step(&step).unwrap();
                    step = cycled.apply_undo_step(&step).unwrap();
                }
            }
            if round % 5 == 4 {
                direct.tick(90.0);
                cycled.tick(90.0);
            }
            assert_eq!(
                cycled.save_text(),
                direct.save_text(),
                "seed {seed} round {round}"
            );
        }
    }
}

#[test]
fn cycling_with_time_passing_moves_exactly_the_recorded_cash_each_way() {
    let mut sim = tower();
    let id = office(&mut sim, 2, 12);
    let before = sim.money;
    let mut step = gesture(&mut sim, |s| {
        assert!(s.remove_facility(id, RemovalMethod::Sell).ok)
    })
    .unwrap();
    let refund = sim.money - before;
    assert!(refund > 0.0, "a sale pays back part of the price");
    assert!(
        refund < Kind::Office.facility().cost,
        "and never the whole of it"
    );
    let mut dice = Dice(5);
    for _ in 0..12 {
        sim.tick(10.0 + dice.next(600) as f64);
        let was = sim.money;
        step = sim.apply_undo_step(&step).unwrap();
        assert_eq!(
            was - sim.money,
            refund,
            "the undo takes back the refund, no more"
        );
        sim.tick(10.0 + dice.next(600) as f64);
        let was = sim.money;
        step = sim.apply_undo_step(&step).unwrap();
        assert_eq!(sim.money - was, refund, "the redo pays the refund, no more");
    }
}
