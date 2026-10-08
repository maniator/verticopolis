//! Debug aid: run a scenario up to a checkpoint label and print the canonical
//! JSON of the state view (or the crowd view with `--crowd`).
//! Usage: dump <scenario-id> <label> [--crowd]

use std::path::PathBuf;

use verticopolis_engine::canonical::canonical_json;
use verticopolis_engine::scenario::{run_scenario_until, Scenario};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("usage: dump <scenario-id> <label> [--crowd]");
        std::process::exit(2);
    }
    let id = &args[1];
    let label = &args[2];
    let crowd = args.iter().any(|a| a == "--crowd");
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let path = repo
        .join("conformance/scenarios")
        .join(format!("{id}.json"));
    let scenario = std::fs::read_to_string(&path)
        .map_err(|e| format!("cannot read {}: {e}", path.display()))
        .and_then(|text| Scenario::parse(&text))
        .unwrap_or_else(|e| {
            eprintln!("{e}");
            std::process::exit(2);
        });
    match run_scenario_until(&scenario, &repo, label) {
        Some(sim) => {
            let v = if crowd {
                sim.crowd.view()
            } else {
                verticopolis_engine::scenario::state_view(&sim)
            };
            println!("{}", canonical_json(&v));
        }
        None => {
            eprintln!("label {label} not reached");
            std::process::exit(1);
        }
    }
}
