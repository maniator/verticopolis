//! The five facts the onboarding checklist advances on (`ONBOARD_STEPS` in
//! `src/ui/Onboarding.ts`), in step order: a lobby exists, a floor above the
//! lobby exists, an office exists, an office's floor is served, an office is
//! occupied. The steps' wording and pulse targets stay in TypeScript.

use serde_json::{json, Value};

use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

impl Simulation {
    /// `{ lobby, floor, office, connect, play }`, each a boolean. Reads the
    /// lobby tile count and walks the units once for the floor step, then the
    /// rooms once for the three office steps, asking the served-floor memo in
    /// place (#1237).
    pub fn onboarding_facts(&self) -> Value {
        let lobby = self.tower.lobby_tiles.values().any(|&n| n > 0);
        let floor = self
            .tower
            .units
            .iter()
            .any(|u| u.kind == Kind::Floor && u.floor >= 2);
        let (mut office, mut connect, mut play) = (false, false, false);
        for u in self.tower.room_units() {
            if u.kind != Kind::Office {
                continue;
            }
            office = true;
            connect = connect || self.tower.is_floor_served(u.floor);
            play = play || u.state == UnitState::Occupied;
            if connect && play {
                break;
            }
        }
        json!({
            "lobby": lobby,
            "floor": floor,
            "office": office,
            "connect": connect,
            "play": play,
        })
    }
}
