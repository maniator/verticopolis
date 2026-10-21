//! The Rust step driver against the TypeScript's: `tests/data/fixed-step-cases.json`
//! holds what the web host loop does with each frame sequence, and the driver
//! must cut the same ticks and carry the same debt, bit for bit. The cases are
//! written by `src/tests/conformance/fixedStepCases.test.ts`.

use serde_json::Value;
use verticopolis_engine::clock::GameMode;
use verticopolis_engine::fixed_step::{
    drain_fixed_steps, quantum_for, sync_step_mode, FrameStepper, StepDebt, StepSim,
    MAX_CATCHUP_MINUTES, MAX_QUANTUM_MINUTES, OWED_EPSILON,
};
use verticopolis_engine::sim::Simulation;

/// A bare clock that moves by each step, the way the TypeScript cases drive it.
struct Clock {
    minute: f64,
    ticks: Vec<f64>,
}

impl StepSim for Clock {
    fn step(&mut self, dt: f64) {
        self.ticks.push(dt);
        self.minute = (self.minute + dt) % 1440.0;
    }
    fn minute_of_day(&self) -> f64 {
        self.minute
    }
}

fn clock(minute: f64) -> Clock {
    Clock {
        minute,
        ticks: Vec::new(),
    }
}

fn num(v: &Value) -> f64 {
    v.as_f64().expect("a number")
}

#[test]
fn the_driver_cuts_the_same_ticks_as_the_web_host_loop() {
    let text = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/data/fixed-step-cases.json"
    ))
    .expect("tests/data/fixed-step-cases.json");
    let json: Value = serde_json::from_str(&text).unwrap();
    let cases = json["cases"].as_array().unwrap();
    assert!(cases.len() >= 8);
    let mut frames_checked = 0;
    for case in cases {
        let id = case["id"].as_str().unwrap();
        let mut sim = clock(num(&case["startMinute"]));
        let mut host = FrameStepper::default();
        let frames = case["frames"].as_array().unwrap();
        let out = case["out"].as_array().unwrap();
        assert_eq!(frames.len(), out.len(), "{id}");
        for (n, (frame, want)) in frames.iter().zip(out).enumerate() {
            sim.ticks.clear();
            host.advance(
                &mut sim,
                num(&frame[0]),
                num(&frame[1]),
                num(&frame[2]) == 1.0,
                num(&frame[3]) == 1.0,
            );
            let want: Vec<f64> = want.as_array().unwrap().iter().map(num).collect();
            let mut got = vec![host.acc_minutes];
            got.extend(&sim.ticks);
            let bits = |v: &[f64]| v.iter().map(|x| x.to_bits()).collect::<Vec<_>>();
            assert_eq!(
                bits(&got),
                bits(&want),
                "{id}, frame {n}: {got:?} vs {want:?}"
            );
            frames_checked += 1;
        }
    }
    assert!(frames_checked > 3000);
}

#[test]
fn quanta_follow_the_pace_curve_and_the_cap() {
    // Flat pace: the minutes a 60 Hz frame owes, floored, never under one.
    assert_eq!(quantum_for(30.0, 0.0, true), 1.0);
    assert_eq!(quantum_for(120.0, 0.0, true), 2.0);
    assert_eq!(quantum_for(600.0, 0.0, true), 10.0);
    assert_eq!(quantum_for(1.0e6, 0.0, true), MAX_QUANTUM_MINUTES);
    // The night sprint (3.25x pace) steps bigger than the lunch crawl (0.14x).
    assert!(quantum_for(120.0, 180.0, false) > quantum_for(120.0, 12.0 * 60.0 + 10.0, false));
    // Junk rates and clocks fall back to one minute.
    assert_eq!(quantum_for(f64::NAN, 0.0, false), 1.0);
    assert_eq!(quantum_for(f64::INFINITY, 0.0, false), 1.0);
    assert_eq!(quantum_for(-5.0, 0.0, false), 1.0);
}

#[test]
fn owed_minutes_under_another_mode_are_dropped() {
    let mut debt = StepDebt::default();
    sync_step_mode(&mut debt, 120.0, false);
    debt.minutes = 7.0;
    sync_step_mode(&mut debt, 120.0, false);
    assert_eq!(debt.minutes, 7.0);
    sync_step_mode(&mut debt, 120.0, true);
    assert_eq!(debt.minutes, 0.0);
    debt.minutes = 3.0;
    sync_step_mode(&mut debt, 30.0, true);
    assert_eq!(debt.minutes, 0.0);
    // NaN matches NaN (the TypeScript compares the mode as text), zero matches -0.
    debt.minutes = 2.0;
    sync_step_mode(&mut debt, f64::NAN, true);
    debt.minutes = 2.0;
    sync_step_mode(&mut debt, f64::NAN, true);
    assert_eq!(debt.minutes, 2.0);
    sync_step_mode(&mut debt, 0.0, true);
    debt.minutes = 2.0;
    sync_step_mode(&mut debt, -0.0, true);
    assert_eq!(debt.minutes, 2.0);
}

#[test]
fn a_bad_amount_or_rate_steps_nothing_and_owes_nothing() {
    for (owed, rate) in [
        (f64::NAN, 120.0),
        (-1.0, 120.0),
        (5.0, 0.0),
        (5.0, -3.0),
        (5.0, f64::NAN),
    ] {
        let mut sim = clock(0.0);
        let mut debt = StepDebt::owing(owed);
        assert_eq!(drain_fixed_steps(&mut sim, &mut debt, rate, true, None), 0);
        assert!(sim.ticks.is_empty(), "owed {owed}, rate {rate}");
        assert_eq!(debt.minutes, 0.0);
    }
}

#[test]
fn dust_under_a_quantum_runs_and_is_paid_back() {
    // A debt a hair under one quantum steps, and leaves a debt of at most the
    // tolerance below zero that the next frame pays back.
    let q = quantum_for(120.0, 0.0, true);
    let mut sim = clock(0.0);
    let mut debt = StepDebt::owing(q - 0.75 * OWED_EPSILON);
    assert_eq!(drain_fixed_steps(&mut sim, &mut debt, 120.0, true, None), 1);
    assert!(debt.minutes < 0.0 && debt.minutes >= -OWED_EPSILON);
    // A step budget that is not a finite number of at least one means the default of four.
    let mut sim = clock(0.0);
    let mut debt = StepDebt::owing(100.0);
    assert_eq!(
        drain_fixed_steps(&mut sim, &mut debt, 120.0, true, Some(0.5)),
        4
    );
    let mut debt = StepDebt::owing(100.0);
    assert_eq!(
        drain_fixed_steps(&mut sim, &mut debt, 120.0, true, Some(2.9)),
        2
    );
}

#[test]
fn a_real_tower_driven_for_a_day_by_the_rust_loop() {
    let mut sim = Simulation::new_game(4242, GameMode::Modern);
    let mut host = FrameStepper::default();
    let from = sim.clock.minutes;
    let mut steps = 0;
    let mut frames = 0;
    while sim.clock.minutes - from < 1440.0 {
        steps += host.advance(&mut sim, 1000.0 / 60.0, 120.0, false, true);
        frames += 1;
        assert!(frames < 100_000, "the clock is not advancing");
    }
    assert!(steps >= 360, "{steps} steps");
    assert!(host.acc_minutes <= MAX_CATCHUP_MINUTES);
}
