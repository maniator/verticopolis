//! The facts behind the inspector's diagnostics (#1215, facade slice 6c,
//! decision F3): what `facilityDiagnostics`, `gripeCopy` and
//! `housekeepingDiagnostics` decide about one unit, answered by the engine
//! that runs the tower; PR 1 answers for the tenant family, and the later
//! PRs add the rest. The wording stays in TypeScript, and so does the choice
//! of what to print: this module returns which sections' gates hold and the
//! numbers their lines print.
//!
//! A section is present only when its line's gate holds, and each is
//! evaluated only past its gate, in the order the TypeScript card is built,
//! so a plain unit costs a few lookups and only an unhappy or gated one pays
//! for congestion, the demand map or the move-in gate's horizon. Nothing here
//! draws from the random streams or writes game state. The reads fill the
//! same revision-keyed caches the TypeScript inspector fills (reachability,
//! noise), which the step also reads and which hold pure functions of the
//! tower (the floor bounds among them), and the inspector's demand memo in
//! `memo.rs`, keyed on at least what the TypeScript keys it on and filled at
//! the same reads.

mod memo;
#[cfg(test)]
mod memo_tests;
mod tenant;
#[cfg(test)]
mod tenant_tests;

pub use memo::DiagMemo;
pub use tenant::{GripeFacts, LobbyFacts, NoticeFacts, SlotFacts, WontLeaseFacts};

use serde::Serialize;

use crate::charges::whole;
use crate::sim::Simulation;

/// One unit's diagnostics facts, as `diagnosticFacts(id)` returns them.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticFacts {
    pub id: i64,
    pub kind: &'static str,
    pub mode: &'static str,
    /// The access line: `notConnected`, `cutOff`, `reachable` or `noRoute`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub access: Option<&'static str>,
    /// The No Rate line: `occupied` or `offMarket`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub no_rate: Option<&'static str>,
    /// W1, the long walk to transport.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub far_walk: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lobby: Option<LobbyFacts>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gripe: Option<GripeFacts>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wont_lease: Option<WontLeaseFacts>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notice: Option<NoticeFacts>,
}

impl Simulation {
    /// The diagnostics facts for the unit `id`, or `None` when no unit has
    /// it (a transport's id included). It changes no game state: it fills
    /// only caches that sit outside the save and the digest (see the module
    /// note), which is why it takes `&mut`.
    pub fn diagnostic_facts(&mut self, id: i64) -> Option<DiagnosticFacts> {
        let u = self.tower.get_unit(id)?.clone();
        let mut facts = DiagnosticFacts {
            id: u.id,
            kind: u.kind.as_str(),
            mode: self.mode.as_str(),
            access: None,
            no_rate: None,
            far_walk: false,
            lobby: None,
            gripe: None,
            wont_lease: None,
            notice: None,
        };
        self.tenant_facts(&u, &mut facts);
        Some(facts)
    }
}

/// `diagnosticFacts(id)` behind the binding, on the id already read off its
/// `JsValue`: `None` for anything but a whole JS number within
/// `Number.isSafeInteger`, and for an id no unit has (no unit has a zero or
/// negative id). Serializing these plain fields cannot fail; if it ever
/// did, the answer would be `None`.
pub fn facts_json(sim: &mut Simulation, id: Option<f64>) -> Option<String> {
    let id = id.and_then(whole)?;
    let facts = sim.diagnostic_facts(id)?;
    serde_json::to_string(&facts).ok()
}
