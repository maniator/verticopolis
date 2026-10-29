//! The loader conformance table, replayed natively.

use crate::canonical::digest;
use crate::snapshot::state_view;
use serde_json::Value;

/// `conformance/loader-cases.json`: forged and hand-edited saves whose
/// loaded state the TypeScript `deserialize` hashed. Regenerate it with
/// `VC_CONFORMANCE_UPDATE=1 npx vitest run --project integration loaderCases`.
const TABLE: &str = include_str!("../../../conformance/loader-cases.json");

#[test]
fn forged_saves_load_as_the_typescript_loads_them() {
    let table: Value = serde_json::from_str(TABLE).expect("loader-cases.json parses");
    let cases = table["cases"].as_array().expect("cases");
    assert!(!cases.is_empty());
    let mut misses = Vec::new();
    for case in cases {
        let id = case["id"].as_str().unwrap();
        let expected = case["expected"].as_str().unwrap();
        let known = case.get("knownDivergence").and_then(Value::as_str);
        let input = &case["input"];
        let (got, view) = match std::panic::catch_unwind(|| super::deserialize(input)) {
            Ok(Ok(sim)) => {
                let v = state_view(&sim);
                (digest(&v), Some(v))
            }
            Ok(Err(_)) => ("throws".to_string(), None),
            Err(_) => ("panics".to_string(), None),
        };
        if let Some(why) = known {
            // A recorded divergence: the mismatch is expected, and a match
            // means the case can lose its marker.
            if got == expected {
                misses.push(format!(
                    "{id}: no longer diverges ({why}); drop its knownDivergence marker"
                ));
            } else if got == "panics" {
                misses.push(format!(
                    "{id}: panics, which a known divergence never excuses"
                ));
            } else if got == "throws" && expected != "throws" {
                misses.push(format!(
                    "{id}: throws, which the recorded divergence ({why}) does not cover"
                ));
            } else if expected == "throws" {
                misses.push(format!(
                    "{id}: the TypeScript throws, which the recorded divergence ({why}) does not cover"
                ));
            }
            continue;
        }
        if got != expected {
            // Leave the Rust side's canonical JSON beside the target dir so
            // the miss can be read field by field against
            // `npx tsx scripts/loader-case-dump.ts <id>`.
            if let Some(v) = view {
                let path = concat!(env!("CARGO_MANIFEST_DIR"), "/target");
                let _ = std::fs::create_dir_all(path);
                let _ = std::fs::write(
                    format!("{path}/loader-case-{id}.rs.json"),
                    crate::canonical::canonical_json(&v),
                );
            }
            misses.push(format!(
                "{id}: {got} vs {expected} (Rust view written to engine-rs/target/loader-case-{id}.rs.json; TypeScript: npx tsx scripts/loader-case-dump.ts {id})"
            ));
        }
    }
    assert!(
        misses.is_empty(),
        "loader cases diverge:\n{}",
        misses.join("\n")
    );
}
