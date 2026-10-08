//! Debug aid: run a scenario up to a checkpoint label and print the canonical
//! JSON of the state view (or the crowd view with `--crowd`).
//! Usage: dump <scenario-id> <label> [--crowd]

use std::path::PathBuf;

use verticopolis_engine::canonical::canonical_json;
use verticopolis_engine::scenario::{run_scenario_until, Scenario};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let id = &args[1];
    let label = &args[2];
    let crowd = args.iter().any(|a| a == "--crowd");
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let scenario: Scenario = serde_json::from_str(
        &std::fs::read_to_string(
            repo.join("conformance/scenarios")
                .join(format!("{id}.json")),
        )
        .unwrap(),
    )
    .unwrap();
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
