//! A fire outbreak and the paid-rescue offer it raises, split from
//! `events.rs` for its size: `startFireOn` and `offerFireRescue` in
//! `src/engine/EventSystem.ts`.

use crate::events::PendingChoice;
use crate::facilities::Kind;
use crate::gameplay::GameplayEvent;
use crate::services::with_thousands;
use crate::sim::{LogKind, Simulation};
use crate::tower::UnitState;

#[doc(hidden)]
impl Simulation {
    /// `startFireOn`: set the room at index `i` ablaze as a new outbreak. A
    /// blaze spreading to a neighbor is the same fire, so only this counts as
    /// one started.
    pub(super) fn ignite(&mut self, i: usize) {
        let (u, at) = self.tower.marked(i);
        u.set_state(at, UnitState::Fire);
        u.set_occupants(at, 0);
        let (id, name, floor) = (u.id, u.kind.facility().name, u.floor);
        self.events.active.insert(id);
        self.events.fires_started += 1;
        self.gameplay.push(GameplayEvent::FireStarted);
        let msg = format!(
            "🔥 Fire broke out in {} on {}!",
            name,
            self.floor_label(floor)
        );
        self.emit(&msg, LogKind::Bad);
    }

    /// `offerFireRescue`: the paid-rescue choice a new outbreak raises, with
    /// the free-defense tip for a tower that has no Security office.
    pub(super) fn offer_fire_rescue(&mut self) {
        let cost = self.fire_rescue_cost();
        let message = format!("🚒 Fire rescue available for ${}. Pay to stop the spread and save the tower now, or decline and fight it the slow way. Either way the rooms already ablaze burn down to gutted shells you'll rebuild; the fee just limits how far the fire spreads.", with_thousands(cost));
        self.events.pending = Some(PendingChoice {
            kind: "fireRescue",
            cost,
            message: message.clone(),
        });
        self.emit(&message, LogKind::Bad);
        if !self.has_any(Kind::Security) {
            self.emit(
                "Tip: a Security office fights fires for free. Build one to defend your tower.",
                LogKind::Bad,
            );
        }
    }

    /// Tooling only: the daily roll's outbreak in room `id` instead of a
    /// random one, the fire and the rescue offer both, so a test can set a
    /// chosen room ablaze mid-run. It draws nothing from the random stream.
    /// False, changing nothing, while a fire burns or a choice is pending
    /// (the roll starts none then), or when `id` names no room that can
    /// catch fire.
    pub fn start_fire_at(&mut self, id: i64) -> bool {
        if self.events.pending.is_some() || !self.events.active.is_empty() {
            return false;
        }
        let at = self
            .flammable_units()
            .into_iter()
            .find(|&i| self.tower.units[i].id == id);
        let Some(i) = at else { return false };
        self.ignite(i);
        self.offer_fire_rescue();
        true
    }
}
