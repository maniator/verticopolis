//! The conformance scenario runner: a port of `src/tests/conformance/scenario.ts`.
//! Commands the engine cannot run yet stop the scenario with
//! `RunError::Unsupported`, so the referee can report how far the port gets.

use serde::Deserialize;
use serde_json::Value;

use crate::canonical::digest;
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;

#[derive(Deserialize, Debug)]
#[serde(untagged)]
pub enum Start {
    NewGame {
        #[serde(rename = "newGame")]
        new_game: NewGame,
    },
    Fixture {
        fixture: String,
        mode: Option<String>,
    },
}

#[derive(Deserialize, Debug)]
pub struct NewGame {
    pub seed: u32,
    pub mode: String,
}

#[derive(Deserialize, serde::Serialize, Debug)]
#[serde(tag = "op")]
pub enum Command {
    #[serde(rename = "setMoney")]
    SetMoney { amount: f64 },
    #[serde(rename = "build")]
    Build {
        kind: String,
        floor: i64,
        x: i64,
        #[serde(rename = "expectFail")]
        expect_fail: Option<bool>,
    },
    #[serde(rename = "buildRow")]
    BuildRow {
        kind: String,
        floor: i64,
        from: i64,
        to: i64,
    },
    #[serde(rename = "buildTransport")]
    BuildTransport {
        kind: String,
        x: i64,
        bottom: i64,
        top: i64,
        #[serde(rename = "expectFail")]
        expect_fail: Option<bool>,
    },
    #[serde(rename = "sell")]
    Sell { floor: i64, x: i64 },
    #[serde(rename = "adjustRent")]
    AdjustRent { floor: i64, x: i64, dir: i64 },
    #[serde(rename = "setNoRate")]
    SetNoRate { floor: i64, x: i64 },
    #[serde(rename = "setCars")]
    SetCars { floor: i64, x: i64, cars: i64 },
    #[serde(rename = "startFire")]
    StartFire,
    #[serde(rename = "bombThreat")]
    BombThreat,
    #[serde(rename = "evaluateStar")]
    EvaluateStar,
    #[serde(rename = "reload")]
    Reload,
    #[serde(rename = "tick")]
    Tick {
        dt: i64,
        times: Option<i64>,
        #[serde(rename = "checkpointEvery")]
        checkpoint_every: Option<i64>,
    },
    #[serde(rename = "checkpoint")]
    Checkpoint { label: String },
}

#[derive(Deserialize, Debug)]
pub struct Scenario {
    pub id: String,
    pub description: String,
    pub start: Start,
    pub commands: Vec<Command>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct Checkpoint {
    pub label: String,
    pub state: String,
    pub crowd: String,
}

#[derive(Debug)]
pub enum RunError {
    /// The port cannot run this yet. Carries the command index and a name.
    Unsupported { index: usize, what: String },
    /// The scenario is wrong for the engine (a build that failed, and so on).
    Failed { index: usize, what: String },
}

/// The saved game minus prose: log `text` and the pending choice's `message`.
pub fn state_view(sim: &Simulation) -> Value {
    let mut v = sim.serialize();
    if let Some(log) = v.get_mut("log").and_then(Value::as_array_mut) {
        for e in log {
            if let Some(o) = e.as_object_mut() {
                o.remove("text");
            }
        }
    }
    if let Some(p) = v
        .get_mut("events")
        .and_then(|e| e.get_mut("pending"))
        .and_then(Value::as_object_mut)
    {
        p.remove("message");
    }
    v
}

fn parse_mode(s: &str) -> Option<GameMode> {
    match s {
        "classic" => Some(GameMode::Classic),
        "modern" => Some(GameMode::Modern),
        _ => None,
    }
}

fn start_sim(start: &Start) -> Result<Simulation, RunError> {
    match start {
        Start::NewGame { new_game } => {
            let mode = parse_mode(&new_game.mode).ok_or_else(|| RunError::Failed {
                index: 0,
                what: format!("mode {}", new_game.mode),
            })?;
            Ok(Simulation::new_game(new_game.seed, mode))
        }
        Start::Fixture { fixture, .. } => Err(RunError::Unsupported {
            index: 0,
            what: format!("fixture start {fixture}"),
        }),
    }
}

fn expect_ok(ok: bool, expect_fail: bool, what: &str, reason: Option<&str>) -> Result<(), String> {
    if ok == !expect_fail {
        return Ok(());
    }
    Err(if ok {
        format!("{what} succeeded but was expected to fail")
    } else {
        format!("{what} failed: {}", reason.unwrap_or("no reason"))
    })
}

pub struct Run {
    pub checkpoints: Vec<Checkpoint>,
    pub error: Option<RunError>,
}

/// Run a scenario, collecting checkpoints until it finishes or the port
/// cannot continue.
pub fn run_scenario(s: &Scenario) -> Run {
    let mut out = Vec::new();
    let mut sim = match start_sim(&s.start) {
        Ok(sim) => sim,
        Err(e) => {
            return Run {
                checkpoints: out,
                error: Some(e),
            }
        }
    };
    let emit = |sim: &Simulation, label: String, out: &mut Vec<Checkpoint>| {
        out.push(Checkpoint {
            label,
            state: digest(&state_view(sim)),
            crowd: digest(&sim.crowd.view()),
        });
    };
    emit(&sim, "start".into(), &mut out);
    for (i, c) in s.commands.iter().enumerate() {
        let unsupported = |what: &str| RunError::Unsupported {
            index: i,
            what: what.to_string(),
        };
        let failed = |what: String| RunError::Failed { index: i, what };
        let kind_of = |k: &str| {
            Kind::parse(k).ok_or_else(|| RunError::Failed {
                index: i,
                what: format!("unknown kind {k}"),
            })
        };
        let r: Result<(), RunError> = (|| {
            match c {
                Command::SetMoney { amount } => sim.money = *amount,
                Command::Checkpoint { label } => emit(&sim, label.clone(), &mut out),
                Command::Build {
                    kind,
                    floor,
                    x,
                    expect_fail,
                } => {
                    let r = sim.build(kind_of(kind)?, *floor, *x);
                    expect_ok(
                        r.ok,
                        expect_fail.unwrap_or(false),
                        &format!("build {kind} @ {floor},{x}"),
                        r.reason.as_deref(),
                    )
                    .map_err(failed)?;
                }
                Command::BuildRow {
                    kind,
                    floor,
                    from,
                    to,
                } => {
                    let k = kind_of(kind)?;
                    for x in *from..=*to {
                        let r = sim.build(k, *floor, x);
                        expect_ok(
                            r.ok,
                            false,
                            &format!("build {kind} @ {floor},{x}"),
                            r.reason.as_deref(),
                        )
                        .map_err(failed)?;
                    }
                }
                Command::BuildTransport {
                    kind,
                    x,
                    bottom,
                    top,
                    expect_fail,
                } => {
                    let r = sim.build_transport(kind_of(kind)?, *x, *bottom, *top);
                    expect_ok(
                        r.ok,
                        expect_fail.unwrap_or(false),
                        &format!("buildTransport {kind} @ x{x} {bottom}-{top}"),
                        r.reason.as_deref(),
                    )
                    .map_err(failed)?;
                }
                Command::Sell { floor, x } => {
                    expect_ok(
                        sim.sell_at(*floor, *x),
                        false,
                        &format!("sell @ {floor},{x}"),
                        None,
                    )
                    .map_err(failed)?;
                }
                Command::SetCars { floor, x, cars } => {
                    let id = sim
                        .tower
                        .transport_at(*floor, *x)
                        .map(|t| t.id)
                        .ok_or_else(|| failed(format!("no transport at floor {floor}, x {x}")))?;
                    let ok = sim.tower.set_cars(id, *cars);
                    let landed = sim
                        .tower
                        .transports
                        .iter()
                        .find(|t| t.id == id)
                        .map(|t| t.cars)
                        == Some(*cars);
                    expect_ok(
                        ok && landed,
                        false,
                        &format!("setCars {cars} @ {floor},{x}"),
                        None,
                    )
                    .map_err(failed)?;
                }
                Command::Tick { .. } => return Err(unsupported("tick")),
                Command::AdjustRent { .. } => return Err(unsupported("adjustRent")),
                Command::SetNoRate { .. } => return Err(unsupported("setNoRate")),
                Command::StartFire => return Err(unsupported("startFire")),
                Command::BombThreat => return Err(unsupported("bombThreat")),
                Command::EvaluateStar => return Err(unsupported("evaluateStar")),
                Command::Reload => return Err(unsupported("reload")),
            }
            Ok(())
        })();
        if let Err(e) = r {
            return Run {
                checkpoints: out,
                error: Some(e),
            };
        }
    }
    emit(&sim, "final".into(), &mut out);
    Run {
        checkpoints: out,
        error: None,
    }
}
