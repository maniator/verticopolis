//! The conformance scenario runner: a port of `src/tests/conformance/scenario.ts`.
//! Commands the engine cannot run yet stop the scenario with
//! `RunError::Unsupported`, so the referee can report how far the port gets.

use crate::canonical::digest;
use crate::clock::GameMode;
use crate::econ::rent_of;
use crate::facilities::Kind;
use crate::gameplay::batch_json;
use crate::scenario_detail::checkpoint_detail;
pub use crate::scenario_detail::CheckpointDetail;
use crate::sim::Simulation;
pub use crate::snapshot::state_view;
use crate::suite::fixture_path;
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize, Debug)]
#[serde(untagged, deny_unknown_fields)]
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
#[serde(deny_unknown_fields)]
pub struct NewGame {
    pub seed: u32,
    pub mode: String,
}

#[derive(Deserialize, Debug)]
#[serde(tag = "op", deny_unknown_fields)]
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
        reason: Option<String>,
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
        reason: Option<String>,
    },
    #[serde(rename = "sell")]
    Sell {
        floor: i64,
        x: i64,
        kind: Option<String>,
        #[serde(rename = "expectFail")]
        expect_fail: Option<bool>,
    },
    #[serde(rename = "adjustRent")]
    AdjustRent {
        floor: i64,
        x: i64,
        dir: i64,
        #[serde(rename = "expectFail")]
        expect_fail: Option<bool>,
    },
    #[serde(rename = "setNoRate")]
    SetNoRate {
        floor: i64,
        x: i64,
        #[serde(rename = "expectFail")]
        expect_fail: Option<bool>,
    },
    #[serde(rename = "setCars")]
    SetCars {
        floor: i64,
        x: i64,
        cars: i64,
        #[serde(rename = "expectFail")]
        expect_fail: Option<bool>,
    },
    #[serde(rename = "addCar")]
    AddCar {
        floor: i64,
        x: i64,
        reason: Option<String>,
    },
    #[serde(rename = "removeCar")]
    RemoveCar {
        floor: i64,
        x: i64,
        reason: Option<String>,
    },
    #[serde(rename = "extendTransport")]
    ExtendTransport {
        floor: i64,
        x: i64,
        end: String,
        #[serde(rename = "targetFloor")]
        target_floor: i64,
        reason: Option<String>,
    },
    #[serde(rename = "beginExtend")]
    BeginExtend { floor: i64, x: i64 },
    #[serde(rename = "endExtend")]
    EndExtend,
    #[serde(rename = "removeFacility")]
    RemoveFacility {
        floor: i64,
        x: i64,
        method: String,
        shaft: Option<bool>,
        reason: Option<String>,
    },
    #[serde(rename = "startFire")]
    StartFire {
        #[serde(rename = "expectFail")]
        expect_fail: Option<bool>,
    },
    #[serde(rename = "bombThreat")]
    BombThreat,
    #[serde(rename = "evaluateStar")]
    EvaluateStar,
    #[serde(rename = "setSchedule")]
    SetSchedule {
        floor: i64,
        x: i64,
        schedule: Value,
        #[serde(rename = "expectFail")]
        expect_fail: Option<bool>,
    },
    #[serde(rename = "callExterminator")]
    CallExterminator {
        #[serde(rename = "expectFail")]
        expect_fail: Option<bool>,
        reason: Option<String>,
    },
    #[serde(rename = "resolveChoice")]
    ResolveChoice { accept: bool, kind: Option<String> },
    #[serde(rename = "toggleAutoBridge")]
    ToggleAutoBridge,
    #[serde(rename = "setFilmPolicy")]
    SetFilmPolicy { floor: i64, x: i64, policy: String },
    #[serde(rename = "rerollSubtype")]
    RerollSubtype { floor: i64, x: i64 },
    #[serde(rename = "applyRentBatch")]
    ApplyRentBatch {
        kind: String,
        target: Value,
        #[serde(rename = "onlyDefaultPriced")]
        only_default_priced: Option<bool>,
    },
    #[serde(rename = "resizeTransport")]
    ResizeTransport {
        floor: i64,
        x: i64,
        bottom: i64,
        top: i64,
        #[serde(rename = "expectFail")]
        expect_fail: Option<bool>,
        reason: Option<String>,
    },
    #[serde(rename = "clearStops")]
    ClearStops { floor: i64, x: i64 },
    #[serde(rename = "setStop")]
    SetStop {
        floor: i64,
        x: i64,
        #[serde(rename = "stopFloor")]
        stop_floor: i64,
        stop: bool,
    },
    #[serde(rename = "priceUnit")]
    PriceUnit { floor: i64, x: i64, target: f64 },
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

/// Field types of `loadScenario`: "int" a whole number, "u32" a whole number
/// from 0 to 4294967295, "count" a whole number above zero, "dir" 1 or -1,
/// "num" a finite number, "str" a non-empty string, "bool" a boolean, "place"
/// a facility kind that is not a transport, "shaft" a transport kind, "mode"
/// classic or modern, "obj" a JSON object, "kind" any facility kind,
/// "choice" fireRescue or bombThreat, "policy" a film policy, "target" a
/// batch rent target (a finite number, default or noRate). A trailing "?"
/// marks the field optional.
fn field_fits(ty: &str, v: &Value) -> bool {
    let int = |v: &Value| v.as_i64().is_some();
    match ty {
        "int" => int(v),
        "u32" => v.as_i64().is_some_and(|n| (0..=0xffff_ffff).contains(&n)),
        "count" => v.as_i64().is_some_and(|n| n > 0),
        "dir" => matches!(v.as_i64(), Some(1) | Some(-1)),
        "num" => v.as_f64().is_some_and(f64::is_finite),
        "str" => v.as_str().is_some_and(|s| !s.is_empty()),
        "bool" => v.is_boolean(),
        "place" => v
            .as_str()
            .and_then(Kind::parse)
            .is_some_and(|k| !k.is_transport()),
        "shaft" => v
            .as_str()
            .and_then(Kind::parse)
            .is_some_and(|k| k.is_transport()),
        "mode" => matches!(v.as_str(), Some("classic") | Some("modern")),
        "obj" => v.is_object(),
        "kind" => v.as_str().and_then(Kind::parse).is_some(),
        "choice" => matches!(v.as_str(), Some("fireRescue") | Some("bombThreat")),
        "policy" => matches!(
            v.as_str(),
            Some("auto") | Some("feature") | Some("blockbuster")
        ),
        "target" => {
            matches!(v.as_str(), Some("default") | Some("noRate"))
                || v.as_f64().is_some_and(f64::is_finite)
        }
        "end" => matches!(v.as_str(), Some("up") | Some("down")),
        "method" => matches!(v.as_str(), Some("sell") | Some("bulldoze")),
        _ => unreachable!("field type {ty}"),
    }
}

/// `check(where, value, spec, skip)`: an object with no field outside the
/// spec (or `skip`), every required field present and of its type, and
/// every optional field absent (`undefined`, so a literal null fails) or of
/// its type.
fn check_fields(
    where_: &str,
    value: &Value,
    spec: &[(&str, &str)],
    skip: &[&str],
) -> Result<(), String> {
    let obj = value
        .as_object()
        .ok_or_else(|| format!("{where_}: must be an object"))?;
    for k in obj.keys() {
        if !skip.contains(&k.as_str()) && !spec.iter().any(|(name, _)| name == k) {
            return Err(format!("{where_}: unknown field {k}"));
        }
    }
    for (k, t) in spec {
        let (ty, optional) = match t.strip_suffix('?') {
            Some(ty) => (ty, true),
            None => (*t, false),
        };
        match obj.get(*k) {
            None if optional => {}
            Some(v) if field_fits(ty, v) => {}
            _ => return Err(format!("{where_}: {k} must be {ty}")),
        }
    }
    Ok(())
}

const AT: [(&str, &str); 2] = [("floor", "int"), ("x", "int")];

fn op_spec(op: &str) -> Option<&'static [(&'static str, &'static str)]> {
    Some(match op {
        "setMoney" => &[("amount", "num")],
        "build" => &[
            ("kind", "place"),
            ("floor", "int"),
            ("x", "int"),
            ("expectFail", "bool?"),
            ("reason", "str?"),
        ],
        "buildRow" => &[
            ("kind", "place"),
            ("floor", "int"),
            ("from", "int"),
            ("to", "int"),
        ],
        "buildTransport" => &[
            ("kind", "shaft"),
            ("x", "int"),
            ("bottom", "int"),
            ("top", "int"),
            ("expectFail", "bool?"),
            ("reason", "str?"),
        ],
        "setNoRate" => &[("floor", "int"), ("x", "int"), ("expectFail", "bool?")],
        "sell" => &[
            ("floor", "int"),
            ("x", "int"),
            ("kind", "kind?"),
            ("expectFail", "bool?"),
        ],
        "adjustRent" => &[
            ("floor", "int"),
            ("x", "int"),
            ("dir", "dir"),
            ("expectFail", "bool?"),
        ],
        "setCars" => &[
            ("floor", "int"),
            ("x", "int"),
            ("cars", "count"),
            ("expectFail", "bool?"),
        ],
        "addCar" | "removeCar" => &[("floor", "int"), ("x", "int"), ("reason", "str?")],
        "extendTransport" => &[
            ("floor", "int"),
            ("x", "int"),
            ("end", "end"),
            ("targetFloor", "int"),
            ("reason", "str?"),
        ],
        "beginExtend" => &AT,
        "endExtend" => &[],
        "removeFacility" => &[
            ("floor", "int"),
            ("x", "int"),
            ("method", "method"),
            ("shaft", "bool?"),
            ("reason", "str?"),
        ],
        "startFire" => &[("expectFail", "bool?")],
        "bombThreat" | "evaluateStar" | "reload" | "toggleAutoBridge" => &[],
        "setFilmPolicy" => &[("floor", "int"), ("x", "int"), ("policy", "policy")],
        "rerollSubtype" | "clearStops" => &AT,
        "resizeTransport" => &[
            ("floor", "int"),
            ("x", "int"),
            ("bottom", "int"),
            ("top", "int"),
            ("expectFail", "bool?"),
            ("reason", "str?"),
        ],
        "setStop" => &[
            ("floor", "int"),
            ("x", "int"),
            ("stopFloor", "int"),
            ("stop", "bool"),
        ],
        "priceUnit" => &[("floor", "int"), ("x", "int"), ("target", "num")],
        "applyRentBatch" => &[
            ("kind", "place"),
            ("target", "target"),
            ("onlyDefaultPriced", "bool?"),
        ],
        "callExterminator" => &[("expectFail", "bool?"), ("reason", "str?")],
        "resolveChoice" => &[("accept", "bool"), ("kind", "choice?")],
        "setSchedule" => &[
            ("floor", "int"),
            ("x", "int"),
            ("schedule", "obj"),
            ("expectFail", "bool?"),
        ],
        "tick" => &[
            ("dt", "count"),
            ("times", "count?"),
            ("checkpointEvery", "count?"),
        ],
        "checkpoint" => &[("label", "str")],
        _ => return None,
    })
}

fn check_scenario(s: &Value) -> Result<(), String> {
    check_fields(
        "scenario",
        s,
        &[("id", "str"), ("description", "str")],
        &["start", "commands"],
    )?;
    let start = s.get("start").unwrap_or(&Value::Null);
    if start.get("newGame").is_some() {
        check_fields("start", start, &[], &["newGame"])?;
        check_fields(
            "start.newGame",
            &start["newGame"],
            &[("seed", "u32"), ("mode", "mode")],
            &[],
        )?;
    } else {
        check_fields(
            "start",
            start,
            &[("fixture", "str"), ("mode", "mode?")],
            &[],
        )?;
    }
    let commands = s
        .get("commands")
        .and_then(Value::as_array)
        .ok_or("scenario: commands must be an array")?;
    for (i, c) in commands.iter().enumerate() {
        let where_ = format!("command {i}");
        if !c.is_object() {
            return Err(format!("{where_}: must be an object"));
        }
        let op = c.get("op").and_then(Value::as_str);
        let spec = op.and_then(op_spec).ok_or_else(|| {
            format!(
                "{where_}: unknown op {}",
                c.get("op").unwrap_or(&Value::Null)
            )
        })?;
        check_fields(&where_, c, spec, &["op"])?;
        if op == Some("buildRow") && c["from"].as_i64() > c["to"].as_i64() {
            return Err(format!("{where_}: buildRow from must not be past to"));
        }
    }
    Ok(())
}

/// `Number.isInteger(1.0)` is true, so a scenario may spell a whole number
/// with a fraction; serde's integer fields would refuse it. Whole floats
/// outside the i64 range stay floats and fail the integer checks, where the
/// TypeScript would accept them and fail the command instead.
fn whole_floats_to_ints(v: &mut Value) {
    match v {
        Value::Number(n) => {
            if let Some(f) = n.as_f64() {
                if n.as_i64().is_none() && f.fract() == 0.0 && f.abs() < i64::MAX as f64 {
                    *v = Value::from(f as i64);
                }
            }
        }
        Value::Array(a) => a.iter_mut().for_each(whole_floats_to_ints),
        Value::Object(o) => o.values_mut().for_each(whole_floats_to_ints),
        _ => {}
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
            Ok(Simulation::new_game(new_game.seed, mode))
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

/// The id of the shaft covering a tile, or the runner's "no transport" error.
fn transport_id_at(sim: &Simulation, floor: i64, x: i64) -> Result<i64, String> {
    sim.tower
        .transport_at(floor, x)
        .map(|t| t.id)
        .ok_or_else(|| format!("no transport at floor {floor}, x {x}"))
}

/// The id of the unit covering a tile, or the runner's "no unit" error.
fn unit_id_at(sim: &Simulation, floor: i64, x: i64) -> Result<i64, String> {
    sim.tower
        .unit_at(floor, x)
        .map(|u| u.id)
        .ok_or_else(|| format!("no unit at floor {floor}, x {x}"))
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

/// A result against `expectFail` and, when the scenario names a `reason`, the
/// exact refusal reason, so an engine that refuses for another reason (or
/// checks the gates in another order) fails.
fn expect_outcome(
    ok: bool,
    got: Option<&str>,
    expect_fail: &Option<bool>,
    want: &Option<String>,
    what: &str,
) -> Result<(), String> {
    let fail = expect_fail.unwrap_or(false);
    if want.is_some() && !fail {
        return Err(format!("{what}: a reason needs expectFail"));
    }
    expect_ok(ok, fail, what, got)?;
    match want {
        Some(w) if got != Some(w.as_str()) => Err(format!(
            "{what} was refused for {:?}, expected {w:?}",
            got.unwrap_or("no reason")
        )),
        _ => Ok(()),
    }
}

/// The buffered events may be hashed: none was pushed out of a full ring
/// (the scenario must checkpoint more often), and each is one the catalog
/// describes (`conformance/events/catalog.json`).
fn events_fit(sim: &Simulation) -> Result<(), String> {
    use crate::gameplay::{check_catalog, check_event, CATALOG_JSON, GAMEPLAY_RING_CAP};
    static CATALOG: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    if sim.gameplay.dropped > 0 {
        return Err(format!(
            "more than {GAMEPLAY_RING_CAP} gameplay events between two checkpoints; checkpoint more often"
        ));
    }
    let catalog = CATALOG.get_or_init(|| {
        let c: Value = serde_json::from_str(CATALOG_JSON).expect("the catalog parses");
        check_catalog(&c).expect("the catalog is valid");
        c
    });
    for e in sim.gameplay.iter() {
        check_event(catalog, &e.to_json())?;
    }
    Ok(())
}

/// `expectCharge`: a charge op lands, or, when the scenario names a reason,
/// is refused with exactly that reason, so both engines' copy is pinned.
/// Either way the balance must have moved by exactly the reported delta.
fn expect_charge(
    r: &crate::charges::ChargeResult,
    reason: &Option<String>,
    what: &str,
    moved: f64,
) -> Result<(), String> {
    if moved != r.delta {
        return Err(format!(
            "{what}: the balance moved {moved} but the command reported {}",
            r.delta
        ));
    }
    if !r.ok && r.delta != 0.0 {
        return Err(format!(
            "{what}: refused but reported a delta of {}",
            r.delta
        ));
    }
    let Some(want) = reason else {
        return expect_ok(r.ok, false, what, r.reason.as_deref());
    };
    if r.ok {
        return Err(format!(
            "{what} succeeded but was expected to fail with {want}"
        ));
    }
    if r.reason.as_deref() != Some(want.as_str()) {
        return Err(format!(
            "{what} failed with {}, expected {want}",
            r.reason.as_deref().unwrap_or("no reason")
        ));
    }
    Ok(())
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
        let kind_of = |k: &str| {
            Kind::parse(k).ok_or_else(|| RunError::Failed {
                index: i,
                what: format!("unknown kind {k}"),
            })
        };
        let r: Result<(), RunError> = (|| {
            match c {
                Command::SetMoney { amount } => sim.money = *amount,
                Command::Checkpoint { label } => emit(&mut sim, label.clone(), &mut out),
                Command::Build {
                    kind,
                    floor,
                    x,
                    expect_fail,
                    reason,
                } => {
                    let r = sim.build(kind_of(kind)?, *floor, *x);
                    expect_outcome(
                        r.ok,
                        r.reason.as_deref(),
                        expect_fail,
                        reason,
                        &format!("build {kind} @ {floor},{x}"),
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
                    reason,
                } => {
                    let r = sim.build_transport(kind_of(kind)?, *x, *bottom, *top);
                    expect_outcome(
                        r.ok,
                        r.reason.as_deref(),
                        expect_fail,
                        reason,
                        &format!("buildTransport {kind} @ x{x} {bottom}-{top}"),
                    )
                    .map_err(failed)?;
                }
                Command::Sell {
                    floor,
                    x,
                    kind,
                    expect_fail,
                } => {
                    if let Some(kind) = kind {
                        let here = sim
                            .tower
                            .unit_at(*floor, *x)
                            .map(|u| u.kind)
                            .or_else(|| sim.tower.transport_at(*floor, *x).map(|t| t.kind));
                        if here.map(|k| k.as_str()) != Some(kind.as_str()) {
                            return Err(failed(format!(
                                "sell @ {floor},{x}: expected {kind}, found {}",
                                here.map(|k| k.as_str()).unwrap_or("nothing")
                            )));
                        }
                    }
                    // A refusal needs something on the tile to refuse: a sell at
                    // a bare tile is a bad address, as for the ops that look up
                    // a unit first.
                    if expect_fail.unwrap_or(false)
                        && sim.tower.unit_at(*floor, *x).is_none()
                        && sim.tower.transport_at(*floor, *x).is_none()
                    {
                        return Err(failed(format!(
                            "no unit or transport at floor {floor}, x {x}"
                        )));
                    }
                    expect_ok(
                        sim.sell_at(*floor, *x),
                        expect_fail.unwrap_or(false),
                        &format!("sell @ {floor},{x}"),
                        None,
                    )
                    .map_err(failed)?;
                }
                Command::SetSchedule {
                    floor,
                    x,
                    schedule,
                    expect_fail,
                } => {
                    let id = sim
                        .tower
                        .transport_at(*floor, *x)
                        .map(|t| t.id)
                        .ok_or_else(|| failed(format!("no transport at floor {floor}, x {x}")))?;
                    expect_ok(
                        sim.tower.set_schedule(id, schedule),
                        expect_fail.unwrap_or(false),
                        &format!("setSchedule @ {floor},{x}"),
                        Some("not an elevator"),
                    )
                    .map_err(failed)?;
                }
                Command::SetCars {
                    floor,
                    x,
                    cars,
                    expect_fail,
                } => {
                    let id = sim
                        .tower
                        .transport_at(*floor, *x)
                        .map(|t| t.id)
                        .ok_or_else(|| failed(format!("no transport at floor {floor}, x {x}")))?;
                    let ok = sim.set_cars(id, *cars);
                    let landed = sim
                        .tower
                        .transports
                        .iter()
                        .find(|t| t.id == id)
                        .map(|t| t.cars)
                        == Some(*cars);
                    expect_ok(
                        ok && landed,
                        expect_fail.unwrap_or(false),
                        &format!("setCars {cars} @ {floor},{x}"),
                        None,
                    )
                    .map_err(failed)?;
                }
                Command::AddCar { floor, x, reason } => {
                    let id = transport_id_at(&sim, *floor, *x).map_err(failed)?;
                    let before = sim.money;
                    let r = sim.add_car(id);
                    expect_charge(
                        &r,
                        reason,
                        &format!("addCar @ {floor},{x}"),
                        sim.money - before,
                    )
                    .map_err(failed)?;
                }
                Command::RemoveCar { floor, x, reason } => {
                    let id = transport_id_at(&sim, *floor, *x).map_err(failed)?;
                    let before = sim.money;
                    let r = sim.remove_car(id);
                    expect_charge(
                        &r,
                        reason,
                        &format!("removeCar @ {floor},{x}"),
                        sim.money - before,
                    )
                    .map_err(failed)?;
                }
                Command::ExtendTransport {
                    floor,
                    x,
                    end,
                    target_floor,
                    reason,
                } => {
                    let id = transport_id_at(&sim, *floor, *x).map_err(failed)?;
                    let side = crate::charges::ExtendEnd::parse(end)
                        .ok_or_else(|| failed(format!("unknown end {end}")))?;
                    let before = sim.money;
                    let r = sim.extend_transport(id, side, *target_floor);
                    expect_charge(
                        &r.charge,
                        reason,
                        &format!("extendTransport {end} to {target_floor} @ {floor},{x}"),
                        sim.money - before,
                    )
                    .map_err(failed)?;
                }
                Command::RemoveFacility {
                    floor,
                    x,
                    method,
                    shaft,
                    reason,
                } => {
                    let id = if shaft.unwrap_or(false) {
                        transport_id_at(&sim, *floor, *x)
                    } else {
                        unit_id_at(&sim, *floor, *x)
                    }
                    .map_err(failed)?;
                    let how = crate::gameplay::RemovalMethod::parse(method)
                        .ok_or_else(|| failed(format!("unknown method {method}")))?;
                    let before = sim.money;
                    let r = sim.remove_facility(id, how);
                    expect_charge(
                        &r,
                        reason,
                        &format!("removeFacility {method} @ {floor},{x}"),
                        sim.money - before,
                    )
                    .map_err(failed)?;
                }
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
                Command::AdjustRent {
                    floor,
                    x,
                    dir,
                    expect_fail,
                } => {
                    if *dir != 1 && *dir != -1 {
                        return Err(failed(format!("adjustRent dir {dir} is not 1 or -1")));
                    }
                    let (id, kind, rent, no_rate) = sim
                        .tower
                        .unit_at(*floor, *x)
                        .map(|u| (u.id, u.kind, u.rent, u.no_rate))
                        .ok_or_else(|| failed(format!("no unit at floor {floor}, x {x}")))?;
                    let before = rent_of(kind, rent, no_rate);
                    let moved = sim.adjust_rent(id, *dir).is_some() && {
                        let u = sim.tower.get_unit(id).unwrap();
                        rent_of(u.kind, u.rent, u.no_rate) != before
                    };
                    expect_ok(
                        moved,
                        expect_fail.unwrap_or(false),
                        &format!("adjustRent {dir} @ {floor},{x}"),
                        Some("rent did not move"),
                    )
                    .map_err(failed)?;
                }
                Command::SetNoRate {
                    floor,
                    x,
                    expect_fail,
                } => {
                    let id = sim
                        .tower
                        .unit_at(*floor, *x)
                        .map(|u| u.id)
                        .ok_or_else(|| failed(format!("no unit at floor {floor}, x {x}")))?;
                    expect_ok(
                        sim.set_no_rate(id),
                        expect_fail.unwrap_or(false),
                        &format!("setNoRate @ {floor},{x}"),
                        None,
                    )
                    .map_err(failed)?;
                }
                Command::StartFire { expect_fail } => {
                    let before = sim.events.count();
                    sim.start_fire();
                    expect_ok(
                        sim.events.count() > before,
                        expect_fail.unwrap_or(false),
                        "startFire",
                        Some("nothing caught fire"),
                    )
                    .map_err(failed)?;
                }
                Command::BeginExtend { floor, x } => {
                    let id = transport_id_at(&sim, *floor, *x).map_err(failed)?;
                    expect_ok(
                        sim.begin_extend(id),
                        false,
                        "beginExtend",
                        Some("no elevator there"),
                    )
                    .map_err(failed)?;
                }
                Command::EndExtend => sim.end_extend(),
                Command::BombThreat => sim.bomb_threat(),
                Command::EvaluateStar => sim.evaluate_star(),
                Command::ToggleAutoBridge => {
                    // The toggle is a Modern control; a Classic scenario that
                    // asks for it is wrong.
                    let before = sim.auto_bridge;
                    expect_ok(
                        sim.toggle_auto_bridge() != before,
                        false,
                        "toggleAutoBridge",
                        Some("bridging is not toggleable in this mode"),
                    )
                    .map_err(failed)?;
                }
                Command::SetFilmPolicy { floor, x, policy } => {
                    let id = unit_id_at(&sim, *floor, *x).map_err(failed)?;
                    expect_ok(
                        sim.set_film_policy(id, policy).is_some(),
                        false,
                        &format!("setFilmPolicy {policy} @ {floor},{x}"),
                        Some("not a cinema"),
                    )
                    .map_err(failed)?;
                }
                Command::RerollSubtype { floor, x } => {
                    let id = unit_id_at(&sim, *floor, *x).map_err(failed)?;
                    expect_ok(
                        sim.reroll_subtype(id).is_some(),
                        false,
                        &format!("rerollSubtype @ {floor},{x}"),
                        Some("no subtype to draw"),
                    )
                    .map_err(failed)?;
                }
                Command::ResizeTransport {
                    floor,
                    x,
                    bottom,
                    top,
                    expect_fail,
                    reason,
                } => {
                    let id = transport_id_at(&sim, *floor, *x).map_err(failed)?;
                    let r = sim.resize_transport(id, *bottom, *top);
                    expect_outcome(
                        r.ok,
                        r.reason.as_deref(),
                        expect_fail,
                        reason,
                        &format!("resizeTransport @ {floor},{x} to {bottom}-{top}"),
                    )
                    .map_err(failed)?;
                }
                Command::ClearStops { floor, x } => {
                    let id = transport_id_at(&sim, *floor, *x).map_err(failed)?;
                    expect_ok(
                        sim.tower.clear_stops(id),
                        false,
                        &format!("clearStops @ {floor},{x}"),
                        None,
                    )
                    .map_err(failed)?;
                }
                Command::SetStop {
                    floor,
                    x,
                    stop_floor,
                    stop,
                } => {
                    let id = transport_id_at(&sim, *floor, *x).map_err(failed)?;
                    expect_ok(
                        sim.tower.set_stop(id, *stop_floor, *stop),
                        false,
                        &format!("setStop {stop_floor} {stop} @ {floor},{x}"),
                        Some("outside the span, or an express stop off a lobby"),
                    )
                    .map_err(failed)?;
                }
                Command::PriceUnit { floor, x, target } => {
                    let id = unit_id_at(&sim, *floor, *x).map_err(failed)?;
                    expect_ok(
                        sim.price_unit(id, *target).is_some(),
                        false,
                        &format!("priceUnit {target} @ {floor},{x}"),
                        Some("not repriceable"),
                    )
                    .map_err(failed)?;
                }
                Command::ApplyRentBatch {
                    kind,
                    target,
                    only_default_priced,
                } => {
                    let kind = Kind::parse(kind).expect("checked at load");
                    let target = match target {
                        Value::String(s) if s == "default" => crate::rent::BatchTarget::Default,
                        Value::String(s) if s == "noRate" => crate::rent::BatchTarget::NoRate,
                        v => crate::rent::BatchTarget::Price(v.as_f64().expect("checked at load")),
                    };
                    let r =
                        sim.apply_rent_batch(kind, target, only_default_priced.unwrap_or(false));
                    // A batch that matched nothing changes nothing, so the
                    // scenario must point at units that exist.
                    expect_ok(
                        r.as_ref().is_some_and(|r| r.matched > 0),
                        false,
                        &format!("applyRentBatch {}", kind.as_str()),
                        Some(if r.is_none() {
                            "not a priced kind or target"
                        } else {
                            "no unit of that kind"
                        }),
                    )
                    .map_err(failed)?;
                }
                Command::ResolveChoice { accept, kind } => {
                    // The answer must land on a real pending choice of the
                    // kind the scenario names, and an accept must be payable,
                    // as in the TypeScript runner.
                    let Some(p) = sim.events.pending.as_ref() else {
                        return Err(failed("resolveChoice: no pending choice".into()));
                    };
                    if let Some(k) = kind {
                        if p.kind != *k {
                            return Err(failed(format!(
                                "resolveChoice: expected {k}, found {}",
                                p.kind
                            )));
                        }
                    }
                    if *accept && sim.money < p.cost {
                        return Err(failed(format!("resolveChoice: cannot pay {}", p.cost)));
                    }
                    sim.resolve_choice(*accept);
                }
                Command::CallExterminator {
                    expect_fail,
                    reason,
                } => {
                    let r = sim.call_exterminator();
                    expect_outcome(
                        r.is_ok(),
                        r.err().map(|e| e.reason()),
                        expect_fail,
                        reason,
                        "callExterminator",
                    )
                    .map_err(failed)?;
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
mod tests {
    use super::Scenario;

    fn scenario(commands: &str) -> Result<Scenario, String> {
        Scenario::parse(&format!(
            r#"{{"id":"t","description":"t","start":{{"newGame":{{"seed":1,"mode":"classic"}}}},"commands":[{commands}]}}"#
        ))
    }

    #[test]
    fn a_repeated_label_fails_at_the_emit() {
        let s = scenario(
            r#"{"op":"checkpoint","label":"a"},{"op":"checkpoint","label":"a"},{"op":"checkpoint","label":"b"}"#,
        )
        .unwrap();
        let run = super::run_scenario(&s, std::path::Path::new("."));
        let labels: Vec<_> = run.checkpoints.iter().map(|c| c.label.as_str()).collect();
        assert_eq!(labels, ["start", "a"]);
        match run.error {
            Some(super::RunError::Failed { index, what }) => {
                assert_eq!(index, 1);
                assert_eq!(what, "checkpoint label a is taken twice");
            }
            other => panic!("{other:?}"),
        }
        // Inside one command, nothing after the repeated emit runs: a tick
        // whose first checkpoint repeats a label records no later ones.
        let ticked = scenario(
            r#"{"op":"checkpoint","label":"t+60"},{"op":"tick","dt":60,"times":3,"checkpointEvery":1},{"op":"checkpoint","label":"z"}"#,
        )
        .unwrap();
        let run2 = super::run_scenario(&ticked, std::path::Path::new("."));
        let labels: Vec<_> = run2.checkpoints.iter().map(|c| c.label.as_str()).collect();
        assert_eq!(labels, ["start", "t+60"]);
        assert!(matches!(
            run2.error,
            Some(super::RunError::Failed { index: 1, .. })
        ));
        // A repeat on a later tick iteration stops there too, after that
        // iteration's step has already advanced the simulation on both engines.
        let later = scenario(
            r#"{"op":"checkpoint","label":"t+120"},{"op":"tick","dt":60,"times":3,"checkpointEvery":1}"#,
        )
        .unwrap();
        let run3 = super::run_scenario(&later, std::path::Path::new("."));
        let labels: Vec<_> = run3.checkpoints.iter().map(|c| c.label.as_str()).collect();
        assert_eq!(labels, ["start", "t+120", "t+60"]);
        match run3.error {
            Some(super::RunError::Failed { index, what }) => {
                assert_eq!(index, 1);
                assert_eq!(what, "checkpoint label t+120 is taken twice");
            }
            other => panic!("{other:?}"),
        }
        // The first "a" is a stop in its own right; a stop label past the
        // repeat is never reached and the failure is reported instead.
        assert!(super::run_scenario_until(&s, std::path::Path::new("."), "a").is_ok());
        match super::run_scenario_until(&s, std::path::Path::new("."), "b") {
            Err(e) => assert!(e.contains("taken twice")),
            Ok(_) => panic!("a stop label past a repeated label must fail"),
        }
    }

    #[test]
    fn a_charge_op_pins_its_refusal_reason() {
        use crate::charges::ChargeResult;
        let paid = ChargeResult {
            ok: true,
            reason: None,
            delta: -1.0,
        };
        let refused = ChargeResult {
            ok: false,
            reason: Some("Not enough money.".into()),
            delta: 0.0,
        };
        let want = Some("Not enough money.".to_string());
        assert!(super::expect_charge(&paid, &None, "a", -1.0).is_ok());
        assert!(super::expect_charge(&refused, &want, "a", 0.0).is_ok());
        assert!(super::expect_charge(&refused, &None, "a", 0.0)
            .unwrap_err()
            .contains("failed: Not enough money."));
        assert!(super::expect_charge(&paid, &want, "a", -1.0)
            .unwrap_err()
            .contains("expected to fail with Not enough money."));
        assert!(
            super::expect_charge(&refused, &Some("Other.".into()), "a", 0.0)
                .unwrap_err()
                .contains("failed with Not enough money., expected Other.")
        );
        assert!(super::expect_charge(&paid, &None, "a", -2.0)
            .unwrap_err()
            .contains("the balance moved -2 but the command reported -1"));
        let refused_but_billed = ChargeResult {
            delta: -5.0,
            ..refused.clone()
        };
        assert!(super::expect_charge(&refused_but_billed, &want, "a", -5.0)
            .unwrap_err()
            .contains("refused but reported a delta of -5"));
    }

    #[test]
    fn whole_floats_count_as_integers() {
        let s = scenario(r#"{"op":"tick","dt":60.0,"times":2.0}"#).unwrap();
        assert_eq!(s.commands.len(), 1);
        assert!(scenario(r#"{"op":"tick","dt":60.5}"#).is_err());
    }

    #[test]
    fn load_time_checks_match_the_typescript_runner() {
        assert!(
            scenario(r#"{"op":"buildRow","kind":"office","floor":2,"from":5,"to":4}"#)
                .unwrap_err()
                .contains("from must not be past to")
        );
        assert!(
            scenario(r#"{"op":"build","kind":"elevator","floor":2,"x":4}"#)
                .unwrap_err()
                .contains("kind must be place")
        );
        assert!(
            scenario(r#"{"op":"buildTransport","kind":"office","x":4,"bottom":1,"top":3}"#)
                .unwrap_err()
                .contains("kind must be shaft")
        );
        assert!(scenario(r#"{"op":"build","kind":"office","floor":2,"x":4}"#).is_ok());
        for (bad, why) in [
            (r#"{"op":"checkpoint","label":""}"#, "label must be str"),
            (r#"{"op":"tick","dt":0}"#, "dt must be count"),
            (
                r#"{"op":"tick","dt":60,"times":null}"#,
                "times must be count",
            ),
            (
                r#"{"op":"build","kind":"office","floor":2,"x":4,"expectFail":null}"#,
                "expectFail must be bool",
            ),
            (
                r#"{"op":"adjustRent","floor":2,"x":4,"dir":2}"#,
                "dir must be dir",
            ),
            (
                r#"{"op":"resolveChoice","accept":true,"kind":"fireRescu"}"#,
                "kind must be choice",
            ),
            (
                r#"{"op":"setCars","floor":2,"x":4,"cars":0}"#,
                "cars must be count",
            ),
            (
                r#"{"op":"sell","floor":2,"x":4,"extra":1}"#,
                "unknown field extra",
            ),
            (r#"{"op":"nope"}"#, "unknown op"),
            (
                r#"{"op":"extendTransport","floor":1,"x":4,"end":"left","targetFloor":3}"#,
                "end must be end",
            ),
            (
                r#"{"op":"extendTransport","floor":1,"x":4,"end":"up","targetFloor":3,"hwmTop":3}"#,
                "unknown field hwmTop",
            ),
            (
                r#"{"op":"removeFacility","floor":1,"x":4,"method":"burn"}"#,
                "method must be method",
            ),
            (
                r#"{"op":"addCar","floor":1,"x":4,"reason":""}"#,
                "reason must be str",
            ),
            (
                r#"{"op":"build","kind":"office","floor":1e300,"x":4}"#,
                "floor must be int",
            ),
        ] {
            assert!(scenario(bad).unwrap_err().contains(why), "{bad}");
        }
        assert!(scenario(r#"{"op":"build","kind":"office","floor":2.0,"x":4}"#).is_ok());
        assert!(Scenario::parse(
            r#"{"id":"t","description":"t","start":{"newGame":{"seed":1,"mode":"classic"},"fixture":"x"},"commands":[]}"#
        )
        .unwrap_err()
        .contains("unknown field fixture"));
        assert!(Scenario::parse(
            r#"{"id":"t","description":"t","extra":1,"start":{"newGame":{"seed":1,"mode":"classic"}},"commands":[]}"#
        )
        .unwrap_err()
        .contains("unknown field extra"));
        let bad_start = Scenario::parse(
            r#"{"id":"t","description":"t","start":{"newGame":{"seed":-1,"mode":"classic"}},"commands":[]}"#,
        );
        assert!(bad_start.unwrap_err().contains("seed must be u32"));
        let bad_mode = Scenario::parse(
            r#"{"id":"t","description":"t","start":{"fixture":"x","mode":"foo"},"commands":[]}"#,
        );
        assert!(bad_mode.unwrap_err().contains("mode must be mode"));
    }
}
