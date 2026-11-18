//! The thief: once a day a thief may prowl one stretch of floor, and
//! Security catches him only when an office reaches that stretch by the
//! emergency stairs (`super::stairs`). In Classic he comes only to a tower
//! with Security, like the fire and the ransom call (#2364).

use indexmap::IndexSet;

use super::stairs::Stairs;
use super::THIEF_DAILY_CHANCE;
use crate::facilities::Kind;
use crate::services::with_thousands;
use crate::sim::{LogKind, Simulation, ThiefFx};
use crate::star::EMERGENCIES_FROM_STAR;

impl Simulation {
    pub(super) fn maybe_thief(&mut self) {
        if self.star < EMERGENCIES_FROM_STAR {
            return;
        }
        if !self.events.extra.chance(THIEF_DAILY_CHANCE) {
            return;
        }
        // After the daily draw, so every tower still spends it, and the
        // Security scan runs only on the days a thief rolls.
        if self.mode.thief_needs_security() && !self.has_any(Kind::Security) {
            return;
        }
        // The spot places the cosmetic (`triggerThief`); the draw also keeps
        // the event stream in step with the TypeScript.
        let stairs = Stairs::of(&self.tower);
        let (floor, x) = self.thief_spot(&stairs);
        let caught = self.security_reaches(&stairs, floor, x);
        self.fx.thief = ThiefFx {
            caught,
            floor,
            x,
            seq: self.fx.thief.seq + 1,
        };
        if caught {
            self.emit(
                "🕵️ Security caught a thief prowling the tower. Nothing was taken.",
                LogKind::Good,
            );
            return;
        }
        let loss = 5_000.0 + self.events.extra.int(0, 20_000) as f64;
        self.money -= loss;
        let notice = self.theft_notice(loss);
        self.emit(&notice, LogKind::Bad);
    }

    /// The notice for a thief who got away with `loss`. Classic names the
    /// loss only (#549); Modern adds the fix.
    pub(crate) fn theft_notice(&self, loss: f64) -> String {
        let fix = if self.mode.advises_fixes() {
            " Build Security."
        } else {
            ""
        };
        format!(
            "🕵️ A thief slipped through the tower and made off with ${}.{fix}",
            with_thousands(loss)
        )
    }

    /// Where the thief prowls: a floor with something on it and a tile of
    /// its stretch, one draw over every (floor, stretch) with a unit. A tower
    /// that fills its floors has one stretch each, so the draw is the one over
    /// floors it always was.
    pub(super) fn thief_spot(&mut self, stairs: &Stairs) -> (i64, i64) {
        let mut spots: IndexSet<(i64, i64)> = IndexSet::new();
        for u in &self.tower.units {
            if u.is_present() {
                let at = stairs.at(u.floor, u.x).or_else(|| stairs.first_on(u.floor));
                spots.insert((u.floor, at.map_or(u.x, |s| stairs.stretch(s).first)));
            }
        }
        if spots.is_empty() {
            return (1, 0);
        }
        let v: Vec<(i64, i64)> = spots.into_iter().collect();
        *self.events.extra.pick(&v)
    }

    /// Whether a Security office can reach the stretch at (`floor`, `x`) by
    /// the emergency stairs: its own tower, or one a shared floor joins to
    /// it. A thief on no stretch of floor is caught by any office.
    pub(super) fn security_reaches(&self, stairs: &Stairs, floor: i64, x: i64) -> bool {
        if !self.has_any(Kind::Security) {
            return false;
        }
        let Some(at) = stairs.at(floor, x) else {
            return true;
        };
        let walk = stairs.walk_from(at);
        self.tower.units_of_kind(Kind::Security).any(|u| {
            stairs
                .at(u.floor, u.x)
                .is_some_and(|s| walk.floors[s].is_some())
        })
    }
}
