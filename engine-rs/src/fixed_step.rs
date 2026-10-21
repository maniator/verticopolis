//! The engine-owned fixed time step (`src/engine/sim/fixedStep.ts`) and the
//! host half that feeds it (`advanceOwedMinutes` in `src/game/frameLoop.ts`).
//!
//! A host owes the sim some game minutes each frame; this cuts them into whole
//! quanta sized from the sim's own clock, so a tower comes out the same at any
//! frame rate. A Rust host that drives the engine itself cuts its minutes the
//! same way as the browser or its tower differs at the same speed. Every
//! rounding and tolerance below matches the TypeScript, and
//! `tests/fixed_step.rs` replays `engine-rs/tests/data/fixed-step-cases.json`, which the
//! TypeScript wrote, bit for bit.

use crate::sim::Simulation;
use crate::tdt::pacing::pace_factor;

/// The frame rate the quantum is sized for: about one step per frame.
pub const REFERENCE_HZ: f64 = 60.0;
/// At most this many steps run in one frame.
pub const MAX_STEPS_PER_FRAME: f64 = 4.0;
/// The largest step, in game minutes, below the host's 30-minute catch-up cap.
pub const MAX_QUANTUM_MINUTES: f64 = 20.0;
/// Float dust tolerated when deciding a whole quantum is owed.
pub const OWED_EPSILON: f64 = 1e-6;
/// Hard cap on owed minutes carried between frames (the host half).
pub const MAX_CATCHUP_MINUTES: f64 = 30.0;

/// What a driven sim needs: a step, and the minute of its day.
pub trait StepSim {
    fn step(&mut self, dt_minutes: f64);
    fn minute_of_day(&self) -> f64;
}

impl StepSim for Simulation {
    fn step(&mut self, dt_minutes: f64) {
        self.tick(dt_minutes);
    }
    fn minute_of_day(&self) -> f64 {
        self.clock.minute_of_day()
    }
}

/// Minutes the host still owes the sim, and the step mode (speed and pacing)
/// they were owed under.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct StepDebt {
    pub minutes: f64,
    mode: Option<(f64, bool)>,
}

impl StepDebt {
    /// A debt of `minutes` with no mode recorded yet.
    pub fn owing(minutes: f64) -> StepDebt {
        StepDebt {
            minutes,
            mode: None,
        }
    }
}

/// The same rate in the TypeScript's `${rate}|${steady}` mode string: equal
/// numbers match (so does NaN with NaN), and zero matches negative zero.
fn same_mode(a: (f64, bool), b: (f64, bool)) -> bool {
    (a.0 == b.0 || (a.0.is_nan() && b.0.is_nan())) && a.1 == b.1
}

/// `quantumFor`: the step size, in whole game minutes, for a host at
/// `minutes_per_second` when the sim clock reads `minute_of_day`.
pub fn quantum_for(minutes_per_second: f64, minute_of_day: f64, steady_clock: bool) -> f64 {
    let pace = if steady_clock {
        1.0
    } else {
        pace_factor(minute_of_day)
    };
    let per_frame = (minutes_per_second * pace) / REFERENCE_HZ;
    if !per_frame.is_finite() || per_frame < 1.0 {
        return 1.0;
    }
    MAX_QUANTUM_MINUTES.min(per_frame.floor())
}

/// `syncStepMode`: record the mode the host is about to owe minutes under,
/// dropping any owed under a different one.
pub fn sync_step_mode(debt: &mut StepDebt, minutes_per_second: f64, steady_clock: bool) {
    let mode = (minutes_per_second, steady_clock);
    if let Some(old) = debt.mode {
        if !same_mode(old, mode) {
            debt.minutes = 0.0;
        }
    }
    debt.mode = Some(mode);
}

/// `drainFixedSteps`: advance `sim` by whole quanta out of `debt.minutes`, at
/// most `max_steps` of them (a value that is not a finite number of at least
/// one falls back to [`MAX_STEPS_PER_FRAME`]). Returns the steps run.
pub fn drain_fixed_steps<S: StepSim>(
    sim: &mut S,
    debt: &mut StepDebt,
    minutes_per_second: f64,
    steady_clock: bool,
    max_steps: Option<f64>,
) -> u32 {
    let requested = max_steps.unwrap_or(MAX_STEPS_PER_FRAME);
    let max_steps = if requested.is_finite() && requested >= 1.0 {
        requested.floor()
    } else {
        MAX_STEPS_PER_FRAME
    };
    sync_step_mode(debt, minutes_per_second, steady_clock);
    let owed_ok = debt.minutes >= -OWED_EPSILON && debt.minutes.is_finite();
    let rate_ok = minutes_per_second > 0.0 && minutes_per_second.is_finite();
    if !owed_ok || !rate_ok {
        debt.minutes = 0.0;
        return 0;
    }
    let mut q = quantum_for(minutes_per_second, sim.minute_of_day(), steady_clock);
    let mut steps = 0u32;
    while debt.minutes >= q - OWED_EPSILON && f64::from(steps) < max_steps {
        sim.step(q);
        debt.minutes = (-OWED_EPSILON).max(debt.minutes - q);
        q = quantum_for(minutes_per_second, sim.minute_of_day(), steady_clock);
        steps += 1;
    }
    steps
}

/// A host's per-session step state: the owed minutes it carries between
/// frames, and the debt the engine reads them through.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct FrameStepper {
    pub acc_minutes: f64,
    pub debt: StepDebt,
}

impl FrameStepper {
    /// `advanceOwedMinutes`: owe this frame's minutes (paced by the canon
    /// curve, or flat with the steady clock), cap the carry at
    /// [`MAX_CATCHUP_MINUTES`], and step what is owed. `step` false owes the
    /// minutes without stepping them (a host still busy with its last batch).
    /// Returns the steps run.
    pub fn advance<S: StepSim>(
        &mut self,
        sim: &mut S,
        dt_ms: f64,
        minutes_per_second: f64,
        steady_clock: bool,
        step: bool,
    ) -> u32 {
        self.debt.minutes = self.acc_minutes;
        sync_step_mode(&mut self.debt, minutes_per_second, steady_clock);
        self.acc_minutes = self.debt.minutes;
        let pace = if steady_clock {
            1.0
        } else {
            pace_factor(sim.minute_of_day())
        };
        self.acc_minutes += (dt_ms / 1000.0) * minutes_per_second * pace;
        if !self.acc_minutes.is_finite() {
            self.acc_minutes = 0.0;
        }
        if self.acc_minutes > MAX_CATCHUP_MINUTES {
            self.acc_minutes = MAX_CATCHUP_MINUTES;
        }
        self.debt.minutes = self.acc_minutes;
        if !step {
            return 0;
        }
        let steps = drain_fixed_steps(sim, &mut self.debt, minutes_per_second, steady_clock, None);
        self.acc_minutes = self.debt.minutes;
        steps
    }
}
