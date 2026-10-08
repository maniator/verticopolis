//! Replays every scenario in `conformance/scenarios/` on the Rust engine and
//! compares each checkpoint with `conformance/expected.json`. Exits 1 unless
//! every scenario matches end to end; the report names, per scenario, the
//! first divergent checkpoint or the first command the port cannot run yet.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::exit;

use verticopolis_engine::scenario::{run_scenario, Checkpoint, RunError, Scenario};

fn main() {
    let root = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("conformance")
        });
    let lock: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(root.join("expected.json")).expect("expected.json"),
    )
    .expect("expected.json parses");
    let want: BTreeMap<String, Vec<Checkpoint>> =
        serde_json::from_value(lock["scenarios"].clone()).expect("lock shape");
    let mut all_ok = true;
    for (id, want) in &want {
        let path = root.join("scenarios").join(format!("{id}.json"));
        let scenario: Scenario =
            serde_json::from_str(&std::fs::read_to_string(&path).expect("scenario file"))
                .expect("scenario parses");
        let repo_root = root.join("..");
        let run = run_scenario(&scenario, &repo_root);
        let got = &run.checkpoints;
        let matched = got
            .iter()
            .zip(want.iter())
            .take_while(|(g, w)| g == w)
            .count();
        let total = want.len();
        if matched < got.len() {
            all_ok = false;
            let g = &got[matched];
            let w = want.get(matched);
            println!(
                "{id}: DIVERGED at checkpoint {matched} ({}): state {} vs {}, crowd {} vs {}",
                g.label,
                g.state,
                w.map(|w| w.state.as_str()).unwrap_or("none"),
                g.crowd,
                w.map(|w| w.crowd.as_str()).unwrap_or("none")
            );
            continue;
        }
        match &run.error {
            None if matched == total => println!("{id}: ok ({total} checkpoints)"),
            None => {
                all_ok = false;
                println!("{id}: SHORT, {matched} of {total} checkpoints");
            }
            Some(RunError::Unsupported { index, what }) => {
                all_ok = false;
                println!("{id}: {matched} of {total} checkpoints match, then command {index} ({what}) is not ported yet");
            }
            Some(RunError::Failed { index, what }) => {
                all_ok = false;
                println!("{id}: {matched} of {total} checkpoints match, then command {index} FAILED: {what}");
            }
        }
    }
    if !all_ok {
        exit(1);
    }
}
