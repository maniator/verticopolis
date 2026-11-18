//! A fire outbreak and the paid-rescue offer it raises, split from
//! `events.rs` for its size: `startFireOn` and `offerFireRescue` in
//! the retired TypeScript `src/engine/EventSystem.ts`.

use crate::events::PendingChoice;
use crate::facilities::Kind;
use crate::gameplay::GameplayEvent;
use crate::services::with_thousands;
use crate::sim::{LogKind, Simulation};
use crate::tower::UnitState;

/// Why [`Simulation::call_fire_rescue`] refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FireRescueRefusal {
    /// No fire is burning.
    None,
    /// An emergency choice is already waiting for the player's answer.
    Pending,
    /// The rescue helicopter is already on its way or at the fire.
    Coming,
}

impl FireRescueRefusal {
    /// The port's `reason` string.
    pub fn reason(&self) -> &'static str {
        match self {
            FireRescueRefusal::None => "none",
            FireRescueRefusal::Pending => "pending",
            FireRescueRefusal::Coming => "coming",
        }
    }
}

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
        let now = self.clock.minutes;
        self.dispatch_fire_guards(i, now);
    }

    /// `offerFireRescue`: the paid-rescue choice a new outbreak raises, with
    /// the free-defense tip for a tower that has no Security office. None
    /// while a helicopter paid for an earlier fire is still on its way: it
    /// lands on this one.
    pub(super) fn offer_fire_rescue(&mut self) {
        if self.helicopter_flying() {
            return;
        }
        let cost = self.fire_rescue_cost();
        let message = format!("🚒 Fire Rescue can fly a helicopter in for ${}. It puts the fire out when it arrives, though the rooms already ablaze burn down to gutted shells you'll rebuild. Decline and Security fights it from the emergency stairs; you can still call the helicopter from the Tower menu while the fire burns.", with_thousands(cost));
        self.events.pending = Some(PendingChoice {
            kind: "fireRescue",
            cost,
            message: message.clone(),
        });
        self.emit(&message, LogKind::Bad);
        // A tip is a fix, which Classic leaves to the player (#549).
        if self.mode.advises_fixes() && !self.has_any(Kind::Security) {
            self.emit(
                "Tip: a Security office fights fires for free. Build one to defend your tower.",
                LogKind::Bad,
            );
        }
    }

    /// Options > Call Fire Rescue (manual p.62): a player who declined the
    /// offer can still call the rescue for as long as a fire burns. This puts
    /// the same offer up again, at today's price, and returns that price;
    /// [`Simulation::resolve_choice`] answers it as it answers the first one.
    /// It takes no money and draws nothing from the random stream. Refused
    /// while the helicopter is already on its way.
    pub fn call_fire_rescue(&mut self) -> Result<f64, FireRescueRefusal> {
        if self.events.pending.is_some() {
            return Err(FireRescueRefusal::Pending);
        }
        if self.events.active.is_empty() {
            return Err(FireRescueRefusal::None);
        }
        if self.helicopter_flying() {
            return Err(FireRescueRefusal::Coming);
        }
        self.offer_fire_rescue();
        Ok(self.fire_rescue_cost())
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
