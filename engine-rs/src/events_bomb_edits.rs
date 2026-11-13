//! The tower's edit lock during a bomb search: while Security's guards are
//! out, nothing is built, sold or bulldozed, no elevator is changed, and no
//! edit is undone or redone, in both modes (owner, 2026-11-13).

use serde_json::Value;

use crate::sim::Simulation;

/// What the player reads when an edit is refused during a bomb search.
pub const BOMB_SEARCH_EDIT_REFUSAL: &str =
    "Security is searching for the bomb. Building, bulldozing and elevator changes wait until the search ends.";

impl Simulation {
    /// Why the tower can't be edited now, or `None` when it can. While a
    /// [`bomb_lockdown`](Simulation::bomb_lockdown) holds, every build,
    /// sale, bulldoze, elevator change, undo and redo is refused with
    /// [`BOMB_SEARCH_EDIT_REFUSAL`]. A bomb nobody searches for locks
    /// nothing, as it freezes nothing.
    pub fn edit_refusal(&self) -> Option<&'static str> {
        self.bomb_lockdown().then_some(BOMB_SEARCH_EDIT_REFUSAL)
    }

    /// A player's stop change on elevator `id`
    /// ([`Tower::set_stop`](crate::tower::Tower::set_stop)): whether it was
    /// made. Refused, changing nothing, while the tower takes no edits.
    pub fn edit_stop(&mut self, id: i64, floor: i64, stop: bool) -> bool {
        self.edit_refusal().is_none() && self.tower.set_stop(id, floor, stop)
    }

    /// A player's express stops for shaft `id`
    /// ([`Tower::set_express_stops`](crate::tower::Tower::set_express_stops)):
    /// whether `id` names a shaft and the stops were set. Refused, changing
    /// nothing, while the tower takes no edits.
    pub fn edit_express_stops(&mut self, id: i64) -> bool {
        let known = self.edit_refusal().is_none() && self.tower.get_transport(id).is_some();
        if known {
            self.tower.set_express_stops(id);
        }
        known
    }

    /// A player clearing shaft `id`'s skipped stops
    /// ([`Tower::clear_stops`](crate::tower::Tower::clear_stops)). Refused,
    /// changing nothing, while the tower takes no edits.
    pub fn edit_clear_stops(&mut self, id: i64) -> bool {
        self.edit_refusal().is_none() && self.tower.clear_stops(id)
    }

    /// A player's schedule for elevator `id`
    /// ([`Tower::set_schedule`](crate::tower::Tower::set_schedule)). Refused,
    /// changing nothing, while the tower takes no edits.
    pub fn edit_schedule(&mut self, id: i64, raw: &Value) -> bool {
        self.edit_refusal().is_none() && self.tower.set_schedule(id, raw)
    }
}
