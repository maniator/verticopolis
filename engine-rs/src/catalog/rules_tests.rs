//! The catalog's `rules` block against what the engine does in each mode,
//! so a frontend that reads the block shows what the engine applies. The
//! condo household rule is charged in `charge_tests.rs`
//! (`a_condo_sells_once_at_the_quoted_household_price`).

use super::*;
use crate::schedule_authoring::{tests::tower, ProposalStatus};
use crate::schedule_facts::AdviceStatus;
use crate::schedule_presets::PresetStatus;

const MODES: [GameMode; 2] = [GameMode::Classic, GameMode::Modern];

/// Each assisted schedule query answers exactly where the catalog says the
/// mode offers it, and the unassisted staging preset answers in both modes.
#[test]
fn schedule_assist_is_what_the_schedule_queries_answer() {
    for mode in MODES {
        let assist = catalog(mode).rules.schedule_assist;
        let (sim, id) = tower(mode, 4);
        let assisted = if assist {
            PresetStatus::Available
        } else {
            PresetStatus::UnavailableInMode
        };
        for preset in ["rush", "balanced", "feeder"] {
            let status = sim.schedule_preset(id, preset).status;
            assert_eq!(status, assisted, "{} {preset}", mode.as_str());
        }
        let staging = sim.schedule_preset(id, "stage-up-tower").status;
        assert_eq!(staging, PresetStatus::Available, "{}", mode.as_str());
        let tune = sim.auto_tune_proposal(id, None, false).status;
        assert_eq!(
            tune == ProposalStatus::UnavailableInMode,
            !assist,
            "{} auto-tune: {tune:?}",
            mode.as_str()
        );
        let facts = sim.schedule_facts(id, None, false);
        assert_eq!(
            facts.advice.status == AdviceStatus::UnavailableInMode,
            !assist,
            "{} advice: {:?}",
            mode.as_str(),
            facts.advice.status
        );
        assert_eq!(facts.recommended.is_some(), assist, "{}", mode.as_str());
    }
}

/// The values each mode states, in the keys a frontend reads.
#[test]
fn each_mode_states_its_rules() {
    let classic = catalog(GameMode::Classic).rules;
    assert!(!classic.variant_households);
    assert!(!classic.preview_names_refusal);
    assert!(!classic.schedule_assist);
    let modern = catalog(GameMode::Modern).rules;
    assert!(modern.variant_households);
    assert!(modern.preview_names_refusal);
    assert!(modern.schedule_assist);
    let v = catalog_value(GameMode::Modern);
    assert_eq!(v["rules"]["variantHouseholds"], Value::Bool(true));
    assert_eq!(v["rules"]["previewNamesRefusal"], Value::Bool(true));
    assert_eq!(v["rules"]["scheduleAssist"], Value::Bool(true));
}
