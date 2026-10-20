//! The five facts the onboarding checklist advances on (`ONBOARD_STEPS` in
//! `src/ui/Onboarding.ts`), in step order: a lobby exists, a floor above the
//! lobby exists, an office exists, an office's floor is served, an office is
//! occupied. The steps' wording and pulse targets stay in TypeScript.

use serde_json::{json, Value};

use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

impl Simulation {
    /// `{ lobby, floor, office, connect, play }`, each a boolean.
    pub fn onboarding_facts(&self) -> Value {
        let units = &self.tower.units;
        json!({
            "lobby": units.iter().any(|u| u.kind == Kind::Lobby),
            "floor": units.iter().any(|u| u.kind == Kind::Floor && u.floor >= 2),
            "office": units.iter().any(|u| u.kind == Kind::Office),
            "connect": units
                .iter()
                .any(|u| u.kind == Kind::Office && self.tower.is_floor_served(u.floor)),
            "play": units
                .iter()
                .any(|u| u.kind == Kind::Office && u.state == UnitState::Occupied),
        })
    }
}
