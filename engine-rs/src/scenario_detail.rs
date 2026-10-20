//! What the seeded differential compares at a checkpoint beyond the three
//! hashes: the money, the log, and a digest of each top-level field of the
//! full save. `scripts/fuzz-compare.ts` builds the same record from the
//! TypeScript engine and names the first field that differs. The record stays
//! out of `conformance/expected.json`.

use crate::canonical::digest;
use crate::sim::Simulation;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize)]
pub struct CheckpointDetail {
    pub label: String,
    pub money: f64,
    /// `log_seq` and the entries the ring holds, so a dropped or reordered
    /// line shows even when the text matches.
    pub log: Value,
    /// The digest of each top-level field of `serialize()`, by name.
    pub save: BTreeMap<String, String>,
}

pub fn checkpoint_detail(sim: &Simulation, label: &str) -> CheckpointDetail {
    let entries: Vec<Value> = sim
        .log
        .iter()
        .map(|e| json!({ "minute": e.minute, "text": e.text, "kind": e.kind.as_str() }))
        .collect();
    let save = match sim.serialize() {
        Value::Object(m) => m.iter().map(|(k, v)| (k.clone(), digest(v))).collect(),
        other => BTreeMap::from([("(save)".to_string(), digest(&other))]),
    };
    CheckpointDetail {
        label: label.to_string(),
        money: sim.money,
        log: json!({ "seq": sim.log_seq, "count": entries.len(), "digest": digest(&Value::Array(entries)) }),
        save,
    }
}

#[cfg(test)]
mod tests {
    use crate::scenario::{run_scenario_detailed, Scenario};

    fn detailed(commands: &str) -> (Vec<String>, Vec<super::CheckpointDetail>) {
        let text = format!(
            r#"{{"id":"t","description":"t","start":{{"newGame":{{"seed":1,"mode":"classic"}}}},"commands":[{commands}]}}"#
        );
        let (run, details) =
            run_scenario_detailed(&Scenario::parse(&text).unwrap(), std::path::Path::new("."));
        assert!(run.error.is_none(), "{:?}", run.error);
        (
            run.checkpoints.into_iter().map(|c| c.label).collect(),
            details,
        )
    }

    #[test]
    fn one_detail_per_checkpoint_in_order() {
        let (labels, details) = detailed(r#"{"op":"tick","dt":60,"times":3,"checkpointEvery":1}"#);
        assert!(labels.len() > 3);
        let detail_labels: Vec<_> = details.iter().map(|d| d.label.clone()).collect();
        assert_eq!(labels, detail_labels);
    }

    #[test]
    fn the_detail_follows_the_game() {
        let (_, details) =
            detailed(r#"{"op":"setMoney","amount":123456},{"op":"checkpoint","label":"set"}"#);
        let set = details.iter().find(|d| d.label == "set").unwrap();
        assert_eq!(set.money, 123456.0);
        assert!(!set.save.is_empty());
        let again =
            detailed(r#"{"op":"setMoney","amount":123456},{"op":"checkpoint","label":"set"}"#).1;
        let same = again.iter().find(|d| d.label == "set").unwrap();
        assert_eq!(
            serde_json::to_string(set).unwrap(),
            serde_json::to_string(same).unwrap()
        );
    }
}
