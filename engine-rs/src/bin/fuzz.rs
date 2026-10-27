//! Differential fuzzer: grow a random scenario from a seed, one command at a
//! time, keeping only commands the Rust engine accepts (a refusal keeps
//! its `expectFail`), then write the scenario and the Rust checkpoints so
//! `scripts/fuzz-compare.ts` can replay it on the TypeScript engine and name
//! the first divergence. Usage: fuzz <seed> <out-dir> [commands]
//! The shrinker and the corpus replay use the other form: fuzz --replay
//! <scenario.json> <out-dir> runs a given scenario and writes the same records.

use std::path::PathBuf;

use serde_json::{json, Value};
use verticopolis_engine::facilities::{is_lobby_floor, Kind, FACILITIES};
use verticopolis_engine::rng::Rng;
use verticopolis_engine::scenario::{run_scenario, run_scenario_detailed, Run, RunError, Scenario};

const LEFT: i64 = 150;
const RIGHT: i64 = 230;

/// Write a scenario that broke the engine beside the ordinary output so the
/// workflow artifact carries it even when the run panics.
fn write_failed(out: &std::path::Path, id: &str, scenario: &Value) {
    let _ = std::fs::create_dir_all(out);
    let _ = std::fs::write(
        out.join(format!("{id}.failed.json")),
        serde_json::to_string_pretty(scenario).unwrap(),
    );
}

/// Write a run's checkpoints and details beside each other, named for the
/// scenario id, in the form `scripts/fuzz-compare.ts` reads.
fn write_records(out: &std::path::Path, id: &str, run: &Run, details: &impl serde::Serialize) {
    if let Err(e) = try_write_records(out, id, run, details) {
        // A failed write is bad input or a full disk, not an engine panic.
        eprintln!("{}: cannot write the records: {e}", out.display());
        std::process::exit(2);
    }
}

fn try_write_records(
    out: &std::path::Path,
    id: &str,
    run: &Run,
    details: &impl serde::Serialize,
) -> Result<(), Box<dyn std::error::Error>> {
    std::fs::create_dir_all(out)?;
    let checkpoints: Vec<Value> = run
        .checkpoints
        .iter()
        .map(|c| json!({"label": c.label, "state": c.state, "crowd": c.crowd, "events": c.events}))
        .collect();
    std::fs::write(
        out.join(format!("{id}.rs.json")),
        serde_json::to_string_pretty(&checkpoints)?,
    )?;
    std::fs::write(
        out.join(format!("{id}.rs.detail.json")),
        serde_json::to_string(details)?,
    )?;
    Ok(())
}

/// `fuzz --replay <scenario.json> <out-dir>`: run a scenario that was not just
/// grown (a shrinker's candidate, a corpus entry) and write its records as
/// `<scenario id>.rs.json` and `.rs.detail.json`. Exit 1 when the Rust engine
/// refuses it, so the caller can tell an invalid candidate from a divergence.
fn replay(args: &[String]) {
    let [file, out] = args else {
        eprintln!("usage: fuzz --replay <scenario.json> <out-dir>");
        std::process::exit(2);
    };
    let text = std::fs::read_to_string(file).unwrap_or_else(|e| {
        eprintln!("{file}: {e}");
        std::process::exit(2);
    });
    let scenario = Scenario::parse(&text).unwrap_or_else(|e| {
        eprintln!("{file}: {e}");
        std::process::exit(2);
    });
    let suite = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("conformance");
    let (run, details) = run_scenario_detailed(&scenario, &suite);
    if let Some(e) = run.error {
        eprintln!("{file}: the Rust engine stopped: {e:?}");
        std::process::exit(1);
    }
    let stem = std::path::Path::new(file)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("replay");
    write_records(std::path::Path::new(out), stem, &run, &details);
    println!("{file}: {} checkpoints", run.checkpoints.len());
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("--replay") {
        replay(&args[1..]);
        return;
    }
    if args.len() < 2 {
        eprintln!("usage: fuzz <seed> <out-dir> [commands]");
        std::process::exit(2);
    }
    let seed: u32 = args[0].parse().unwrap_or_else(|_| {
        eprintln!("seed must be a whole number below 4294967296");
        std::process::exit(2);
    });
    let out = PathBuf::from(&args[1]);
    let budget: usize = match args.get(2) {
        None => 40,
        Some(s) => s.parse().unwrap_or_else(|_| {
            eprintln!("commands must be a whole number");
            std::process::exit(2);
        }),
    };
    let suite = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("conformance");
    // The generator's stream is separate from the game's own seed, so the
    // command sequence does not replay the simulation's random draws.
    let mut rng = Rng::new(seed ^ 0x9e37_79b9);
    let modern = rng.chance(0.5);
    // One seed in four grows a tall tower (sky-lobby rows every 15 floors and a
    // burst of shafts and stairs against the pool caps); the rest stay short
    // and fast.
    let tall = rng.chance(0.25);
    let height = if tall { rng.int(16, 40) } else { rng.int(3, 9) };
    // The tower is built with plenty of cash, then the cash is set to the
    // seed's profile: a rich game, a modest one, or a tight one that runs out.
    let cash = match rng.int(0, 3) {
        0 | 1 => 500_000_000,
        2 => rng.int(5, 50) * 1_000_000,
        _ => rng.int(2, 40) * 100_000,
    };
    // The star the game opens at. A new game starts at one star, which keeps
    // escalators, service and express shafts (two and three stars) and the
    // later rooms locked; raising it puts them in reach, and the refusals
    // below each star stay in the mix.
    let star = [1, 1, 2, 3, 3, 4, 5][rng.int(0, 6) as usize];
    let id = format!("fuzz-{seed}");
    let mut commands: Vec<Value> = vec![
        json!({"op": "setMoney", "amount": 500000000}),
        json!({"op": "buildRow", "kind": "lobby", "floor": 1, "from": LEFT, "to": RIGHT}),
    ];
    for fl in 2..=height {
        let kind = if is_lobby_floor(fl) { "lobby" } else { "floor" };
        commands.push(
            json!({"op": "buildRow", "kind": kind, "floor": fl, "from": LEFT + 1, "to": RIGHT - 1}),
        );
        // A tall tower's rows alone would overflow the runner's 1024-event window.
        commands.push(json!({"op": "checkpoint", "label": format!("row{fl}")}));
    }
    commands.push(json!({"op": "setMoney", "amount": cash}));
    let places: Vec<Kind> = FACILITIES
        .iter()
        .filter(|f| !f.transport && !f.basement && f.kind != Kind::Lobby && f.kind != Kind::Floor)
        .filter(|f| modern || !f.modern_only)
        .map(|f| f.kind)
        .collect();
    let shafts: Vec<Kind> = FACILITIES
        .iter()
        .filter(|f| f.transport)
        .map(|f| f.kind)
        .collect();
    let scenario_value = |commands: &[Value]| {
        let mut new_game = json!({"seed": seed, "mode": if modern { "modern" } else { "classic" }});
        if star > 1 {
            new_game["star"] = json!(star);
        }
        json!({
            "id": id,
            "description": format!("Fuzz seed {seed}: a random {} tower of {height} stories at {star} star{}.", if modern { "Modern" } else { "Classic" }, if star == 1 { "" } else { "s" }),
            "start": {"newGame": new_game},
            "commands": commands,
        })
    };
    let run = |commands: &[Value]| {
        let text = serde_json::to_string(&scenario_value(commands)).unwrap();
        let s = Scenario::parse(&text).expect("the fuzzer only emits valid commands");
        run_scenario(&s, &suite)
    };
    // A tall tower starts with a burst of shafts and stairs that overruns the
    // 24-shaft and 64-link pools, so both engines also agree on the refusal at
    // each cap. The burst runs before the random commands and is not part of
    // the command budget. Its standard shafts and stairs need no star; the
    // escalators, service and express shafts that unlock higher come from the
    // random commands, at the stars the seed opens with.
    let mut pressure: Vec<Value> = Vec::new();
    if tall {
        // Standard shafts: 27 slots (nine columns, three floor bands) against
        // a pool of 24, in columns right of the stairs.
        let band = height / 3;
        for i in 0..27 {
            let (bottom, top) = match i / 9 {
                0 => (1, band),
                1 => (band + 1, band * 2),
                _ => (band * 2 + 1, height),
            };
            let x = LEFT + 42 + 4 * (i % 9);
            pressure.push(json!({"op": "buildTransport", "kind": "elevatorStandard", "x": x, "bottom": bottom, "top": top}));
        }
        // Stairs: five columns over floor pairs 1 to 13, 65 slots against a
        // pool of 64 links.
        for k in 0..65 {
            let bottom = 1 + k / 5;
            let x = LEFT + 1 + 8 * (k % 5);
            pressure.push(json!({"op": "buildTransport", "kind": "stairs", "x": x, "bottom": bottom, "top": bottom + 1}));
        }
        pressure.reverse();
    }
    let mut kept = 0;
    let mut step = 0;
    while kept < budget || !pressure.is_empty() {
        let burst = pressure.pop();
        let roll = if burst.is_some() { 0 } else { rng.int(0, 99) };
        let mut cmd = if let Some(b) = burst.clone() {
            b
        } else if rng.chance(0.04) {
            // Cash that runs out, or goes below zero, in the middle of a run.
            let amount = [0, 1_000, 25_000, 250_000, -50_000, 3_000_000][rng.int(0, 5) as usize];
            json!({"op": "setMoney", "amount": amount})
        } else if roll < 38 {
            let kind = places[rng.int(0, places.len() as i64 - 1) as usize];
            json!({"op": "build", "kind": kind.as_str(), "floor": rng.int(1, height), "x": rng.int(LEFT, RIGHT)})
        } else if roll < 48 {
            let kind = shafts[rng.int(0, shafts.len() as i64 - 1) as usize];
            let bottom = rng.int(1, height - 1);
            let top = if kind.max_span() == 1 {
                bottom + 1
            } else {
                rng.int(bottom + 1, height)
            };
            json!({"op": "buildTransport", "kind": kind.as_str(), "x": rng.int(LEFT, RIGHT), "bottom": bottom, "top": top})
        } else if roll < 54 {
            json!({"op": "sell", "floor": rng.int(1, height), "x": rng.int(LEFT, RIGHT)})
        } else if roll < 60 {
            json!({"op": "adjustRent", "floor": rng.int(2, height), "x": rng.int(LEFT, RIGHT), "dir": if rng.chance(0.5) { 1 } else { -1 }})
        } else if roll < 63 {
            json!({"op": "setCars", "floor": 1, "x": rng.int(LEFT, RIGHT), "cars": rng.int(1, 8)})
        } else if roll < 66 {
            let row = |rng: &mut Rng| -> Vec<i64> { (0..24).map(|_| rng.int(0, 3)).collect() };
            let weekday = row(&mut rng);
            let weekend = row(&mut rng);
            let homes: Vec<i64> = (0..rng.int(0, 3)).map(|_| rng.int(1, height)).collect();
            json!({"op": "setSchedule", "floor": 1, "x": rng.int(LEFT, RIGHT), "schedule": {
                "activeCars": {"weekday": weekday, "weekend": weekend},
                "waitingCarResponse": rng.int(1, 30),
                "standardFloorDeparture": rng.int(1, 60),
                "homeFloors": homes,
            }})
        } else if roll < 68 && !modern {
            json!({"op": "setNoRate", "floor": rng.int(2, height), "x": rng.int(LEFT, RIGHT)})
        } else if roll < 86 {
            let dt = [1, 3, 10, 20, 60][rng.int(0, 4) as usize];
            let times = rng.int(5, 240);
            // A checkpoint every in-game hour of the run (`60 / dt` ticks), or
            // every quarter of a short run, so the compare localizes a
            // divergence to the hour at the latest.
            let hour = 60 / dt;
            json!({"op": "tick", "dt": dt, "times": times, "checkpointEvery": hour.min((times / 4).max(1))})
        } else if roll < 89 {
            json!({"op": "startFire"})
        } else if roll < 91 {
            json!({"op": "bombThreat"})
        } else if roll < 94 {
            json!({"op": "evaluateStar"})
        } else if roll < 97 && modern {
            json!({"op": "callExterminator"})
        } else {
            json!({"op": "reload"})
        };
        let mut trial = commands.clone();
        trial.push(cmd.clone());
        let result = run(&trial);
        let op = cmd["op"].as_str().unwrap().to_string();
        // A checkpoint after each command keeps the events between two
        // checkpoints inside the runner's 1024-event window. A burst command
        // adds only a few events, so it checkpoints every sixth.
        // A reload carries its events over to the next command, so it does not
        // checkpoint: the carry path stays covered.
        let mut kept_one = |commands: &mut Vec<Value>, cmd: Value| {
            let reload = cmd["op"] == "reload";
            commands.push(cmd);
            step += 1;
            if burst.is_none() {
                kept += 1;
            }
            if !reload && (burst.is_none() || step % 6 == 0) {
                commands.push(json!({"op": "checkpoint", "label": format!("k{step}")}));
            }
        };
        match result.error {
            None => kept_one(&mut commands, cmd),
            Some(RunError::Failed { index, what }) if index == trial.len() - 1 => {
                match op.as_str() {
                    // A refusal the runner lets a scenario expect.
                    "build" | "buildTransport" | "callExterminator" => {
                        cmd["expectFail"] = json!(true);
                        kept_one(&mut commands, cmd);
                    }
                    // The tuning ops take `expectFail` too, but they also fail on a
                    // bad address (nothing at that tile). Only an engine refusal is
                    // kept: the same command replayed with `expectFail` runs clean
                    // when the engine said no, and errors when the address was bad,
                    // which is dropped with the prefix still valid.
                    "sell" | "adjustRent" | "setCars" | "setNoRate" | "setSchedule"
                    | "startFire" => {
                        let mut refused = cmd.clone();
                        refused["expectFail"] = json!(true);
                        trial.pop();
                        trial.push(refused.clone());
                        if run(&trial).error.is_none() {
                            kept_one(&mut commands, refused);
                        } else {
                            eprintln!("seed {seed}: dropped {op} ({what}): {cmd}");
                        }
                    }
                    // tick, reload, bombThreat, evaluateStar cannot legitimately refuse:
                    // a failure here is the engine's own. The failing scenario is
                    // written before the panic so the artifact carries it.
                    other => {
                        write_failed(&out, &id, &scenario_value(&trial));
                        panic!("seed {seed}: {other} failed on an accepted prefix: {what}")
                    }
                }
            }
            Some(e) => {
                write_failed(&out, &id, &scenario_value(&trial));
                panic!("seed {seed}: the accepted prefix failed on replay: {e:?}")
            }
        }
    }
    commands.push(json!({"op": "checkpoint", "label": "end"}));
    let final_scenario = scenario_value(&commands);
    let final_text = serde_json::to_string(&final_scenario).unwrap();
    let (final_run, details) =
        run_scenario_detailed(&Scenario::parse(&final_text).unwrap(), &suite);
    assert!(final_run.error.is_none(), "{:?}", final_run.error);
    std::fs::create_dir_all(&out).expect("out dir");
    let scenario_path = out.join(format!("{id}.json"));
    std::fs::write(
        &scenario_path,
        serde_json::to_string_pretty(&scenario_value(&commands)).unwrap(),
    )
    .unwrap();
    write_records(&out, &id, &final_run, &details);
    println!(
        "{id}: {} commands, {} checkpoints, written to {}",
        commands.len(),
        final_run.checkpoints.len(),
        scenario_path.display()
    );
}
