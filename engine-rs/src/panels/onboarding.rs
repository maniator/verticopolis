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
    /// lobby tile count and the per-revision floor fact, then walks the rooms
    /// once for the three office steps, asking the served-floor memo in place
    /// (#1237).
    pub fn onboarding_facts(&self) -> Value {
        let [lobby, floor, office, connect, play] = self.onboarding_flags();
        json!({
            "lobby": lobby,
            "floor": floor,
            "office": office,
            "connect": connect,
            "play": play,
        })
    }

    /// Whether any floor tile is built on floor 2 or above. It reads only the
    /// layout, so it is kept per revision: the onboarding card asks every UI
    /// tick, and with no such tile the scan would walk every unit each time
    /// (#1237).
    fn floor_built_above_lobby(&self) -> bool {
        let key = self.tower.index_key();
        if let Some((built, found)) = self.tower.memo.borrow().floor_above_lobby {
            if built == key {
                return found;
            }
        }
        let found = self
            .tower
            .units
            .iter()
            .any(|u| u.kind == Kind::Floor && u.floor >= 2);
        self.tower.memo.borrow_mut().floor_above_lobby = Some((key, found));
        found
    }

    /// The five facts in `onboarding_facts` order: lobby, floor, office,
    /// connect, play.
    pub fn onboarding_flags(&self) -> [bool; 5] {
        let lobby = self.tower.lobby_tiles.values().any(|&n| n > 0);
        let floor = self.floor_built_above_lobby();
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
        [lobby, floor, office, connect, play]
    }
}
