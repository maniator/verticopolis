//! The fixed time step on a real tower: a day of the split-tower save,
//! driven the way the host loop drives it, ends byte-identical at 30, 60 and
//! 144 Hz and from a jittery frame source, at each speed and with the steady
//! clock; a host too slow for the step budget takes the same steps, fewer of
//! them; and the frame-derived stepping it replaced did diverge.
//!
//! The driver itself (quanta, debt, mode changes, bad input) is covered by
//! `tests/fixed_step.rs`: `the_driver_cuts_the_same_ticks_as_the_web_host_loop`,
//! `quanta_follow_the_pace_curve_and_the_cap`,
//! `owed_minutes_under_another_mode_are_dropped`,
//! `a_bad_amount_or_rate_steps_nothing_and_owes_nothing`,
//! `dust_under_a_quantum_runs_and_is_paid_back` and
//! `a_real_tower_driven_for_a_day_by_the_rust_loop`.
use serde_json::Value;

use crate::fixed_step::{drain_fixed_steps, quantum_for, StepDebt, StepSim};
use crate::load::deserialize;
use crate::sim::Simulation;
use crate::tdt::pacing::pace_factor;

use super::fixture_save;

const GAME_MINUTES: f64 = 24.0 * 60.0;
/// The fastest, middle and slowest speeds, in game minutes per second.
const FASTEST: f64 = 120.0;
const MIDDLE: f64 = 30.0;
const SLOWEST: f64 = 10.0;
/// The host's catch-up cap for the slow-host case.
const CATCH_UP_CAP: f64 = 30.0;

/// A loaded sim that records every step it takes.
struct Host {
    sim: Simulation,
    ticks: Vec<f64>,
}

impl StepSim for Host {
    fn step(&mut self, dt: f64) {
        self.ticks.push(dt);
        self.sim.tick(dt);
    }
    fn minute_of_day(&self) -> f64 {
        self.sim.clock.minute_of_day()
    }
}

struct Run {
    state: String,
    ticks: Vec<f64>,
    leftover: f64,
    final_quantum: f64,
}

/// Owe a day of minutes frame by frame at `rate`, paced by the canon curve
/// (or flat with the steady clock), step what is owed, then drain the rest.
fn play(save: &Value, rate: f64, mut frame: impl FnMut() -> f64, steady: bool, cap: f64) -> Run {
    let mut host = Host {
        sim: deserialize(save).expect("the fixture loads"),
        ticks: Vec::new(),
    };
    let mut debt = StepDebt::owing(0.0);
    let mut owed = 0.0;
    while owed < GAME_MINUTES {
        let pace = if steady {
            1.0
        } else {
            pace_factor(host.minute_of_day())
        };
        let owe = (rate * frame() * pace).min(GAME_MINUTES - owed);
        owed += owe;
        debt.minutes = (debt.minutes + owe).min(cap);
        drain_fixed_steps(&mut host, &mut debt, rate, steady, None);
    }
    while drain_fixed_steps(&mut host, &mut debt, rate, steady, None) > 0 {}
    Run {
        final_quantum: quantum_for(rate, host.minute_of_day(), steady),
        state: host.sim.serialize().to_string(),
        ticks: host.ticks,
        leftover: debt.minutes,
    }
}

fn steady_hz(hz: f64) -> impl FnMut() -> f64 {
    move || 1.0 / hz
}

/// Frames of 8 to 41 ms from a fixed linear congruential sequence.
fn jittery() -> impl FnMut() -> f64 {
    let mut s: u32 = 12345;
    move || {
        s = s.wrapping_mul(1_103_515_245).wrapping_add(12345);
        (8 + s % 34) as f64 / 1000.0
    }
}

fn distinct(ticks: &[f64]) -> Vec<u64> {
    let mut v: Vec<u64> = ticks.iter().map(|t| t.to_bits()).collect();
    v.sort();
    v.dedup();
    v
}

#[test]
fn the_tower_ends_the_same_at_any_frame_rate() {
    let save = fixture_save("split-tower");
    for (rate, steady) in [
        (FASTEST, false),
        (FASTEST, true),
        (MIDDLE, false),
        (SLOWEST, false),
    ] {
        let runs = [
            play(&save, rate, steady_hz(30.0), steady, f64::INFINITY),
            play(&save, rate, steady_hz(60.0), steady, f64::INFINITY),
            play(&save, rate, steady_hz(144.0), steady, f64::INFINITY),
            play(&save, rate, jittery(), steady, f64::INFINITY),
        ];
        for (i, r) in runs.iter().enumerate() {
            let label = format!("rate {rate} steady {steady} run {i}");
            assert!(r.leftover < r.final_quantum, "{label}: minutes dropped");
            assert_eq!(r.ticks, runs[0].ticks, "{label}");
            assert!(r.state == runs[0].state, "{label}: the towers differ");
        }
        if rate == FASTEST && !steady {
            assert!(
                distinct(&runs[0].ticks).len() > 1,
                "the paced day varies the step"
            );
        }
        if steady {
            assert_eq!(distinct(&runs[0].ticks), [2.0_f64.to_bits()]);
        }
    }
}

#[test]
fn a_host_too_slow_for_the_budget_takes_the_same_steps_fewer_of_them() {
    let save = fixture_save("split-tower");
    let fast = play(&save, FASTEST, steady_hz(60.0), false, CATCH_UP_CAP);
    let slow = play(&save, FASTEST, steady_hz(12.0), false, CATCH_UP_CAP);
    assert!(slow.ticks.len() < fast.ticks.len());
    assert_eq!(slow.ticks, fast.ticks[..slow.ticks.len()]);
    let mut replay = deserialize(&save).unwrap();
    for &dt in &slow.ticks {
        replay.tick(dt);
    }
    let replayed = replay.serialize().to_string();
    assert!(replayed == slow.state, "the replay differs");
}

#[test]
fn the_frame_derived_stepping_it_replaced_did_diverge() {
    let save = fixture_save("split-tower");
    // The old loop: step min(20, acc), carrying the fractional minutes.
    let legacy = |hz: f64| -> String {
        let mut sim = deserialize(&save).unwrap();
        let (mut owed, mut acc) = (0.0, 0.0);
        while owed < GAME_MINUTES {
            let owe = (FASTEST / hz).min(GAME_MINUTES - owed);
            owed += owe;
            acc += owe;
            while acc >= 1.0 {
                let step = acc.min(20.0);
                sim.tick(step);
                acc -= step;
            }
        }
        sim.serialize().to_string()
    };
    assert!(legacy(30.0) != legacy(144.0));
}
