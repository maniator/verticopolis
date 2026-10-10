//! Replays every scenario in `conformance/scenarios/` on the Rust engine and
//! compares each checkpoint with `conformance/expected.json`. Exits 1 unless
//! every scenario matches end to end; the report names, per scenario, the
//! first divergent checkpoint or the first command the port cannot run yet.
//! It also checks each mode's catalog against `conformance/catalog.json`.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::exit;

use verticopolis_engine::catalog::{catalog_digest, pinned_digests};
use verticopolis_engine::scenario::{run_scenario, Checkpoint, Run, RunError, Scenario};

fn main() {
    let root = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("conformance")
        });
    let lock_path = root.join("expected.json");
    let lock_text = match std::fs::read_to_string(&lock_path) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("cannot read {}: {e}", lock_path.display());
            exit(2);
        }
    };
    let lock: serde_json::Value = serde_json::from_str(&lock_text).expect("expected.json parses");
    let want: BTreeMap<String, Vec<Checkpoint>> =
        serde_json::from_value(lock["scenarios"].clone()).expect("lock shape");
    // The scenario directory and the lock must name the same set (the
    // "has a scenario for every lock entry" test in
    // src/tests/integration/conformance.integration.test.ts), so a new
    // scenario cannot slip past the referee and a stale lock entry cannot
    // pass for a deleted one.
    let scenario_dir = root.join("scenarios");
    let mut on_disk: Vec<String> = match std::fs::read_dir(&scenario_dir)
        .and_then(|entries| entries.collect::<Result<Vec<_>, _>>())
    {
        Ok(entries) => entries
            .iter()
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().into_owned();
                name.strip_suffix(".json").map(str::to_string)
            })
            .collect(),
        Err(e) => {
            eprintln!("cannot read {}: {e}", scenario_dir.display());
            exit(2);
        }
    };
    on_disk.sort();
    let in_lock: Vec<String> = want.keys().cloned().collect();
    if on_disk != in_lock {
        let unlocked: Vec<_> = on_disk
            .iter()
            .filter(|id| !want.contains_key(*id))
            .collect();
        let orphaned: Vec<_> = in_lock.iter().filter(|id| !on_disk.contains(id)).collect();
        eprintln!(
            "scenario set differs from the lock: not in the lock {unlocked:?}, no file {orphaned:?}"
        );
        exit(1);
    }
    // Every scenario is its own engine, so they replay on separate threads;
    // the report prints sorted by id, the order the lock is written in. A
    // panic inside one scenario (a save the loader refuses) is caught and
    // reported as that scenario's failure instead of aborting the referee.
    let repo_root = root.join("..");
    let runs: Vec<Result<Run, String>> = std::thread::scope(|scope| {
        let handles: Vec<_> = want
            .keys()
            .map(|id| {
                let path = root.join("scenarios").join(format!("{id}.json"));
                let repo_root = &repo_root;
                scope.spawn(move || -> Result<Run, String> {
                    let text = std::fs::read_to_string(&path)
                        .map_err(|e| format!("cannot read {}: {e}", path.display()))?;
                    let scenario = Scenario::parse(&text)?;
                    // "a unique id per file" in conformance.integration.test.ts:
                    // the internal id equals the stem, so a copied scenario
                    // cannot run under another file's lock entry.
                    if scenario.id != *id {
                        return Err(format!(
                            "{}: scenario id {:?} does not match the file stem {:?}",
                            path.display(),
                            scenario.id,
                            id
                        ));
                    }
                    std::panic::catch_unwind(|| run_scenario(&scenario, repo_root)).map_err(|p| {
                        let msg = p
                            .downcast_ref::<String>()
                            .cloned()
                            .or_else(|| p.downcast_ref::<&str>().map(|s| s.to_string()))
                            .unwrap_or_else(|| "panic".to_string());
                        format!("engine panicked: {msg}")
                    })
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().expect("scenario thread"))
            .collect()
    });
    let mut all_ok = true;
    for ((id, want), run) in want.iter().zip(runs.iter()) {
        let run = match run {
            Ok(r) => r,
            Err(e) => {
                all_ok = false;
                println!("{id}: FAILED: {e}");
                continue;
            }
        };
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
            if w.is_none() {
                println!(
                    "{id}: EXTRA checkpoint {matched} ({}) past the lock's {total}",
                    g.label
                );
                continue;
            }
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
    // The catalog lock (`catalog.json`): each mode's catalog must hash to
    // the value the TypeScript engine pinned.
    let catalog_path = root.join("catalog.json");
    match std::fs::read_to_string(&catalog_path)
        .map_err(|e| format!("cannot read {}: {e}", catalog_path.display()))
        .and_then(|text| pinned_digests(&text))
    {
        Ok(pinned) => {
            for (mode, want) in pinned {
                let got = catalog_digest(mode);
                if got == want {
                    println!("catalog {}: ok", mode.as_str());
                } else {
                    all_ok = false;
                    println!("catalog {}: DIVERGED: {got} vs {want}", mode.as_str());
                }
            }
        }
        Err(e) => {
            all_ok = false;
            println!("catalog: FAILED: {e}");
        }
    }
    if !all_ok {
        exit(1);
    }
}
