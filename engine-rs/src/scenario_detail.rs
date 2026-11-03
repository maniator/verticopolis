//! What the seeded differential compares at a checkpoint beyond the three
//! hashes: the money, the log, a digest of each top-level field of the full
//! save, and the fx sequences and emergency counters, which sit outside the
//! hashed views (#879). `scripts/fuzz-compare.ts` builds the same record from
//! the TypeScript engine and names the first field that differs. The record
//! stays out of `conformance/expected.json`.

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
    /// The fx sequences and emergency counters, by the names the TypeScript
    /// runner and the WASM adapter use (`FX_SLOTS` in `checkpointDetail.ts`).
    pub fx: BTreeMap<String, f64>,
}

fn fx_slots(sim: &Simulation) -> BTreeMap<String, f64> {
    let fx = &sim.fx;
    [
        ("santaFxSeq", fx.santa_seq as f64),
        ("explosionSeq", fx.explosion.seq as f64),
        ("explosionFloor", fx.explosion.floor as f64),
        ("explosionX", fx.explosion.x),
        ("thiefSeq", fx.thief.seq as f64),
        ("thiefCaught", if fx.thief.caught { 1.0 } else { 0.0 }),
        ("thiefFloor", fx.thief.floor as f64),
        ("treasureSeq", fx.treasure.seq as f64),
        ("treasureFloor", fx.treasure.floor as f64),
        ("treasureX", fx.treasure.x),
        ("vipFxSeq", fx.vip_seq as f64),
        ("fires", sim.events.fires_started as f64),
        ("firesGutRooms", sim.events.fires_gut_rooms as f64),
        ("bombs", sim.events.bombs_detonated as f64),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v))
    .collect()
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
        fx: fx_slots(sim),
    }
}

#[cfg(test)]
mod tests {
    use crate::scenario::{run_scenario_detailed, Scenario};
    use crate::sim::Simulation;

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
    fn the_fx_record_names_every_slot_and_follows_the_sim() {
        use crate::clock::GameMode;
        let mut sim = Simulation::new_game(1, GameMode::Classic);
        let names: Vec<String> = super::fx_slots(&sim).keys().cloned().collect();
        assert_eq!(names.len(), 14);
        assert!(super::fx_slots(&sim)
            .iter()
            .all(|(k, v)| *v == 0.0 || k.as_str() == "thiefFloor"));
        sim.fx.santa_seq = 2;
        sim.fx.thief.caught = true;
        sim.fx.treasure.x = 172.5;
        sim.events.bombs_detonated = 3;
        let fx = super::fx_slots(&sim);
        assert_eq!(fx["santaFxSeq"], 2.0);
        assert_eq!(fx["thiefCaught"], 1.0);
        assert_eq!(fx["treasureX"], 172.5);
        assert_eq!(fx["bombs"], 3.0);
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
