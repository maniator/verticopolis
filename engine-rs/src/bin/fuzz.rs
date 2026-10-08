//! Differential fuzzer: grow a random scenario from a seed, one command at a
//! time, keeping only commands the Rust engine accepts (a refused build keeps
//! its `expectFail`), then write the scenario and the Rust checkpoints so
//! `scripts/fuzz-compare.ts` can replay it on the TypeScript engine and name
//! the first divergence. Usage: fuzz <seed> <out-dir> [commands]

use std::path::PathBuf;

use serde_json::{json, Value};
use verticopolis_engine::facilities::{Kind, FACILITIES};
use verticopolis_engine::rng::Rng;
use verticopolis_engine::scenario::{run_scenario, RunError, Scenario};

const LEFT: i64 = 150;
const RIGHT: i64 = 230;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() < 2 {
        eprintln!("usage: fuzz <seed> <out-dir> [commands]");
        std::process::exit(2);
    }
    let seed: u32 = args[0].parse().unwrap_or_else(|_| {
        eprintln!("seed must be a whole number");
        std::process::exit(2);
    });
    let out = PathBuf::from(&args[1]);
    let budget: usize = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(40);
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let mut rng = Rng::new(seed);
    let modern = rng.chance(0.5);
    let height = rng.int(3, 9);
    let id = format!("fuzz-{seed}");
    let mut commands: Vec<Value> = vec![
        json!({"op": "setMoney", "amount": 500000000}),
        json!({"op": "buildRow", "kind": "lobby", "floor": 1, "from": LEFT, "to": RIGHT}),
    ];
    for fl in 2..=height {
        commands.push(json!({"op": "buildRow", "kind": "floor", "floor": fl, "from": LEFT + 1, "to": RIGHT - 1}));
    }
    let places: Vec<Kind> = FACILITIES
        .iter()
        .filter(|f| !f.transport && !f.basement && f.kind != Kind::Lobby && f.kind != Kind::Floor)
        .filter(|f| modern || !f.modern_only)
        .map(|f| f.kind)
        .collect();
    let shafts: Vec<Kind> = FACILITIES.iter().filter(|f| f.transport).map(|f| f.kind).collect();
    let scenario_value = |commands: &[Value]| {
        json!({
            "id": id,
            "description": format!("Fuzz seed {seed}: a random {} tower of {height} stories.", if modern { "Modern" } else { "Classic" }),
            "start": {"newGame": {"seed": seed, "mode": if modern { "modern" } else { "classic" }}},
            "commands": commands,
        })
    };
    let run = |commands: &[Value]| {
        let text = serde_json::to_string(&scenario_value(commands)).unwrap();
        let s = Scenario::parse(&text).expect("the fuzzer only emits valid commands");
        run_scenario(&s, &repo_root)
    };
    let mut kept = 0;
    while kept < budget {
        let roll = rng.int(0, 99);
        let mut cmd = if roll < 38 {
            let kind = places[rng.int(0, places.len() as i64 - 1) as usize];
            json!({"op": "build", "kind": kind.as_str(), "floor": rng.int(1, height), "x": rng.int(LEFT, RIGHT)})
        } else if roll < 48 {
            let kind = shafts[rng.int(0, shafts.len() as i64 - 1) as usize];
            let bottom = rng.int(1, height - 1);
            let top = if kind.max_span() == 1 { bottom + 1 } else { rng.int(bottom + 1, height) };
            json!({"op": "buildTransport", "kind": kind.as_str(), "x": rng.int(LEFT, RIGHT), "bottom": bottom, "top": top})
        } else if roll < 54 {
            json!({"op": "sell", "floor": rng.int(1, height), "x": rng.int(LEFT, RIGHT)})
        } else if roll < 60 {
            json!({"op": "adjustRent", "floor": rng.int(2, height), "x": rng.int(LEFT, RIGHT), "dir": if rng.chance(0.5) { 1 } else { -1 }})
        } else if roll < 64 {
            json!({"op": "setCars", "floor": 1, "x": rng.int(LEFT, RIGHT), "cars": rng.int(1, 8)})
        } else if roll < 86 {
            let dt = [1, 3, 10, 20, 60][rng.int(0, 4) as usize];
            let times = rng.int(5, 240);
            json!({"op": "tick", "dt": dt, "times": times, "checkpointEvery": (times / 4).max(1)})
        } else if roll < 89 {
            json!({"op": "startFire"})
        } else if roll < 91 {
            json!({"op": "bombThreat"})
        } else if roll < 94 {
            json!({"op": "evaluateStar"})
        } else if roll < 97 {
            json!({"op": "callExterminator"})
        } else {
            json!({"op": "reload"})
        };
        let mut trial = commands.clone();
        trial.push(cmd.clone());
        let result = run(&trial);
        let op = cmd["op"].as_str().unwrap().to_string();
        match result.error {
            None => {
                commands.push(cmd);
                kept += 1;
            }
            Some(RunError::Failed { index, .. }) if index == trial.len() - 1 => {
                if matches!(op.as_str(), "build" | "buildTransport" | "callExterminator") {
                    cmd["expectFail"] = json!(true);
                    commands.push(cmd);
                    kept += 1;
                }
                // Any other refused command is dropped; the prefix stays valid.
            }
            Some(e) => panic!("the accepted prefix failed on replay: {e:?}"),
        }
    }
    commands.push(json!({"op": "checkpoint", "label": "end"}));
    let final_run = run(&commands);
    assert!(final_run.error.is_none(), "{:?}", final_run.error);
    std::fs::create_dir_all(&out).expect("out dir");
    let scenario_path = out.join(format!("{id}.json"));
    std::fs::write(&scenario_path, serde_json::to_string_pretty(&scenario_value(&commands)).unwrap()).unwrap();
    let checkpoints: Vec<Value> = final_run
        .checkpoints
        .iter()
        .map(|c| json!({"label": c.label, "state": c.state, "crowd": c.crowd}))
        .collect();
    std::fs::write(out.join(format!("{id}.rs.json")), serde_json::to_string_pretty(&checkpoints).unwrap()).unwrap();
    println!("{id}: {} commands, {} checkpoints, written to {}", commands.len(), checkpoints.len(), scenario_path.display());
}
