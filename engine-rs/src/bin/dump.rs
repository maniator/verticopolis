//! Debug aid: run a scenario up to a checkpoint label and print the canonical
//! JSON of the state view (or the crowd view with `--crowd`).
//! Usage: dump <scenario-id> <label> [--crowd]

use std::path::PathBuf;

use verticopolis_engine::canonical::canonical_json;
use verticopolis_engine::scenario::{run_scenario_until, Scenario};

fn main() {
    let args: Vec<String> = std::env::args_os()
        .skip(1)
        .map(|a| a.to_string_lossy().into_owned())
        .collect();
    let crowd = args.iter().any(|a| a == "--crowd");
    let positional: Vec<&String> = args.iter().filter(|a| !a.starts_with("--")).collect();
    if positional.len() != 2 || args.iter().any(|a| a.starts_with("--") && a != "--crowd") {
        eprintln!("usage: dump <scenario-id> <label> [--crowd]");
        std::process::exit(2);
    }
    let id = positional[0];
    let label = positional[1];
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
        Ok(sim) => {
            let v = if crowd {
                sim.crowd.view()
            } else {
                verticopolis_engine::scenario::state_view(&sim)
            };
            println!("{}", canonical_json(&v));
        }
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    }
}
