//! The conformance scenario runner: a port of `src/tests/conformance/scenario.ts`.
//! Commands the engine cannot run yet stop the scenario with
//! `RunError::Unsupported`, so the referee can report how far the port gets.

use crate::canonical::digest;
use crate::clock::GameMode;
use crate::gameplay::batch_json;
use crate::scenario_detail::checkpoint_detail;
pub use crate::scenario_detail::CheckpointDetail;
use crate::sim::Simulation;
pub use crate::snapshot::state_view;
use crate::suite::fixture_path;
use serde::Deserialize;
use serde_json::Value;

mod apply;
mod command;
mod expect;
mod validate;

use apply::apply;
pub use command::{Command, NewGame, Start};
use expect::events_fit;
use validate::{check_scenario, whole_floats_to_ints};

#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Scenario {
    pub id: String,
    pub description: String,
    pub start: Start,
    pub commands: Vec<Command>,
}

impl Scenario {
    /// Parse and validate a scenario file the way `loadScenario` does: the
    /// same field table (`OPS` in scenario.ts), the same type checks, and the
    /// same refusal of an unknown op or field, so a typo cannot quietly
    /// weaken a scenario on one side only. Whole floats such as `1.0` count
    /// as integers (`Number.isInteger`).
    pub fn parse(text: &str) -> Result<Scenario, String> {
        let mut raw: Value =
            serde_json::from_str(text).map_err(|e| format!("scenario does not parse: {e}"))?;
        whole_floats_to_ints(&mut raw);
        check_scenario(&raw)?;
        serde_json::from_value(raw).map_err(|e| format!("scenario does not parse: {e}"))
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct Checkpoint {
    pub label: String,
    pub state: String,
    pub crowd: String,
    /// The hash of the gameplay events drained since the previous
    /// checkpoint (the first one counts from the start).
    pub events: String,
}

#[derive(Debug)]
pub enum RunError {
    /// The port cannot run this yet. Carries the command index and a name.
    Unsupported { index: usize, what: String },
    /// The scenario is wrong for the engine (a build that failed, and so on).
    Failed { index: usize, what: String },
}

fn start_sim(start: &Start, suite: &std::path::Path) -> Result<Simulation, RunError> {
    match start {
        Start::NewGame { new_game } => {
            let mode = GameMode::parse(&new_game.mode).ok_or_else(|| RunError::Failed {
                index: 0,
                what: format!("mode {}", new_game.mode),
            })?;
            let sim = Simulation::new_game(new_game.seed, mode);
            // A start state, not a command. The founded game is saved, raised
            // to the star and loaded back, the route all three runners take,
            // so a load's milestones and boundary markers are the same
            // everywhere. One star is the founded game itself.
            match new_game.star.filter(|&star| star > 1) {
                None => Ok(sim),
                Some(star) => {
                    let mut raw = sim.serialize();
                    raw["star"] = star.into();
                    crate::load::deserialize(&raw).map_err(|e| RunError::Failed {
                        index: 0,
                        what: format!("star {star}: {e}"),
                    })
                }
            }
        }
        Start::Fixture { fixture, mode } => {
            let failed = |what: String| RunError::Failed { index: 0, what };
            let text = std::fs::read_to_string(fixture_path(suite, fixture).map_err(failed)?)
                .map_err(|e| failed(format!("{fixture}: {e}")))?;
            let mut raw = crate::load::decode_vctower(&text)
                .map_err(|e| failed(format!("{fixture}: {e}")))?;
            if let Some(m) = mode {
                raw["mode"] = serde_json::Value::String(m.clone());
            }
            let mut sim =
                crate::load::deserialize(&raw).map_err(|e| failed(format!("{fixture}: {e}")))?;
            crate::load::mark_founder_from_loaded_file(&mut sim, &raw);
            if let Some(m) = mode {
                if sim.mode.as_str() != m {
                    return Err(failed(format!(
                        "{fixture} loaded as {}, not {m}",
                        sim.mode.as_str()
                    )));
                }
            }
            Ok(sim)
        }
    }
}

pub struct Run {
    pub checkpoints: Vec<Checkpoint>,
    pub error: Option<RunError>,
}

/// Run a scenario from the conformance directory `suite` ([`fixture_path`]),
/// collecting checkpoints until it finishes or the port cannot continue.
pub fn run_scenario(s: &Scenario, suite: &std::path::Path) -> Run {
    run_scenario_inner(s, suite, None, None).0
}

/// [`run_scenario`], also recording a [`CheckpointDetail`] at every
/// checkpoint (the seeded differential's wider compare).
pub fn run_scenario_detailed(
    s: &Scenario,
    suite: &std::path::Path,
) -> (Run, Vec<CheckpointDetail>) {
    let mut details = Vec::new();
    let run = run_scenario_inner(s, suite, None, Some(&mut details)).0;
    (run, details)
}

/// Run a scenario up to (and including) the checkpoint `label`, returning
/// the live engine at that point.
pub fn run_scenario_until(
    s: &Scenario,
    suite: &std::path::Path,
    label: &str,
) -> Result<Simulation, String> {
    let (run, sim) = run_scenario_inner(s, suite, Some(label), None);
    match (sim, run.error) {
        (Some(sim), _) => Ok(sim),
        (None, Some(RunError::Failed { index, what })) => {
            Err(format!("command {index} failed before {label}: {what}"))
        }
        (None, Some(RunError::Unsupported { index, what })) => Err(format!(
            "command {index} is not ported yet, before {label}: {what}"
        )),
        (None, None) => Err(format!("label {label} not reached")),
    }
}

fn run_scenario_inner(
    s: &Scenario,
    suite: &std::path::Path,
    stop_at: Option<&str>,
    details: Option<&mut Vec<CheckpointDetail>>,
) -> (Run, Option<Simulation>) {
    let details = std::cell::RefCell::new(details);
    let mut out = Vec::new();
    let mut sim = match start_sim(&s.start, suite) {
        Ok(sim) => sim,
        Err(e) => {
            return (
                Run {
                    checkpoints: out,
                    error: Some(e),
                },
                None,
            )
        }
    };
    let stop = std::cell::Cell::new(false);
    let labels = std::cell::RefCell::new(std::collections::HashSet::new());
    // The first failure an `emit` hit (a repeated label, a dropped event or
    // one outside the catalog), raised after the command that took it.
    let duplicate = std::cell::RefCell::new(None::<String>);
    // Events a `reload` carried over from the engine it replaced, ahead of
    // the new engine's own (a save carries no events).
    let carried = std::cell::RefCell::new(Vec::new());
    let emit = |sim: &mut Simulation, label: String, out: &mut Vec<Checkpoint>| {
        // `emit` throws on a repeated label in the TypeScript, so nothing
        // after it in the same command runs or is recorded, and a repeated
        // `stop_at` label is a failure rather than a stop.
        if !labels.borrow_mut().insert(label.clone()) {
            *duplicate.borrow_mut() = Some(format!("checkpoint label {label} is taken twice"));
            return;
        }
        if let Err(e) = events_fit(sim) {
            *duplicate.borrow_mut() = Some(format!("at checkpoint {label}: {e}"));
            return;
        }
        if stop_at == Some(label.as_str()) {
            stop.set(true);
        }
        let mut events = std::mem::take(&mut *carried.borrow_mut());
        events.extend(sim.gameplay.drain());
        if let Some(d) = details.borrow_mut().as_mut() {
            d.push(checkpoint_detail(sim, &label));
        }
        out.push(Checkpoint {
            label,
            state: digest(&state_view(sim)),
            crowd: digest(&sim.crowd.view()),
            events: digest(&batch_json(&events)),
        });
    };
    emit(&mut sim, "start".into(), &mut out);
    if let Some(what) = duplicate.borrow_mut().take() {
        return (
            Run {
                checkpoints: out,
                error: Some(RunError::Failed { index: 0, what }),
            },
            None,
        );
    }
    if stop.get() {
        return (
            Run {
                checkpoints: out,
                error: None,
            },
            Some(sim),
        );
    }
    let mut elapsed: i64 = 0;
    for (i, c) in s.commands.iter().enumerate() {
        #[allow(unused_variables)]
        let unsupported = |what: &str| RunError::Unsupported {
            index: i,
            what: what.to_string(),
        };
        let failed = |what: String| RunError::Failed { index: i, what };
        let r: Result<(), RunError> = (|| {
            match c {
                Command::Checkpoint { label } => emit(&mut sim, label.clone(), &mut out),
                Command::Tick {
                    dt,
                    times,
                    checkpoint_every,
                } => {
                    let times = times.unwrap_or(1);
                    if *dt <= 0 || times <= 0 || checkpoint_every.is_some_and(|e| e <= 0) {
                        return Err(failed("tick needs whole numbers above zero".into()));
                    }
                    for n in 1..=times {
                        sim.tick(*dt as f64);
                        elapsed = elapsed
                            .checked_add(*dt)
                            .ok_or_else(|| failed("elapsed minutes overflow".into()))?;
                        if let Some(every) = checkpoint_every {
                            if n % every == 0 {
                                emit(&mut sim, format!("t+{elapsed}"), &mut out);
                                if stop.get() || duplicate.borrow().is_some() {
                                    break;
                                }
                            }
                        }
                    }
                }
                Command::Reload => {
                    // The events go first, as the TypeScript runner takes them.
                    let before = digest(&state_view(&sim));
                    events_fit(&sim).map_err(failed)?;
                    carried.borrow_mut().extend(sim.gameplay.drain());
                    let saved: Value = serde_json::from_str(&sim.serialize().to_string()).unwrap();
                    let loaded = crate::load::deserialize(&saved).map_err(failed)?;
                    if digest(&state_view(&loaded)) != before {
                        return Err(failed("reload changed the saved state".into()));
                    }
                    sim = loaded;
                }
                other => apply(&mut sim, other, i)?,
            }
            Ok(())
        })();
        if let Some(what) = duplicate.borrow_mut().take() {
            return (
                Run {
                    checkpoints: out,
                    error: Some(failed(what)),
                },
                None,
            );
        }
        if let Err(e) = r {
            return (
                Run {
                    checkpoints: out,
                    error: Some(e),
                },
                None,
            );
        }
        if stop.get() {
            return (
                Run {
                    checkpoints: out,
                    error: None,
                },
                Some(sim),
            );
        }
    }
    emit(&mut sim, "final".into(), &mut out);
    if let Some(what) = duplicate.borrow_mut().take() {
        return (
            Run {
                checkpoints: out,
                error: Some(RunError::Failed {
                    index: s.commands.len(),
                    what,
                }),
            },
            None,
        );
    }
    let stopped = if stop.get() { Some(sim) } else { None };
    (
        Run {
            checkpoints: out,
            error: None,
        },
        stopped,
    )
}

#[cfg(test)]
mod tests;
