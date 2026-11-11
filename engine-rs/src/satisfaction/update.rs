//! The hourly satisfaction pass and the notices it raises.

use super::{vacate_reason_text, NOISE_CAP, VACATE_NOTICE_MINUTES, VACATE_RESCIND};
use crate::econ::{rent_config, rent_of};
use crate::facilities::Kind;
use crate::sim::{LogKind, Simulation};
use crate::tower::UnitState;

#[doc(hidden)]
impl Simulation {
    /// `updateSatisfaction`.
    pub fn update_satisfaction(&mut self) {
        let mut ctx = self.build_satisfaction_context(false);
        if ctx.global_cong > 1.4 && self.clock.hour() == 9 && self.rng.chance(0.5) {
            self.emit(
                "Tenants are complaining of long elevator waits. Add cars or shafts.",
                LogKind::Bad,
            );
        }
        let mut notices: Vec<(i64, Kind, &'static str)> = Vec::new();
        for i in self.tower.room_indices() {
            if self.tower.units[i].is_dormant() {
                continue;
            }
            // One copy of the room per hour (#1689). The step reads the room
            // by reference and writes nothing to it, so the copy taken before
            // it equals the unit once the new satisfaction is stored.
            let mut u = self.tower.units[i].clone();
            let r = self.satisfaction_step(&u, u.satisfaction, &mut ctx);
            self.tower.units[i].satisfaction = r.next;
            u.satisfaction = r.next;
            debug_assert!(
                u == self.tower.units[i],
                "the satisfaction step changed the room it read"
            );
            let lease_tenant = matches!(
                u.kind,
                Kind::Office | Kind::Condo | Kind::FitnessClub | Kind::Clinic
            ) || u.kind.is_rental();
            if lease_tenant && u.state == UnitState::Vacating {
                let is_relocation = u.extras().vacate_reason == Some("relocation");
                let noise_cannot_evict = u.extras().vacate_reason == Some("noise")
                    && self.mode.noise_erosion_scale() == 0.0;
                let price_cfg = if u.kind == Kind::Office || u.kind.is_rental() {
                    rent_config(u.kind)
                } else {
                    None
                };
                let over_market_rent =
                    price_cfg.is_some_and(|c| c.over_neutral(rent_of(u.kind, u.rent, u.no_rate)));
                let non_noise_problem = !r.served
                    || (u.floor != 1 && r.cong > 1.0)
                    || over_market_rent
                    || r.far_walk
                    || r.lobby_far;
                if noise_cannot_evict && non_noise_problem {
                    u.extras_mut().vacate_reason = Some(self.vacate_cause(&u, &r));
                    self.tower.units[i].extras_mut().vacate_reason = u.extras().vacate_reason;
                }
                let rescind_noise = noise_cannot_evict && !non_noise_problem;
                if !is_relocation && (u.satisfaction >= VACATE_RESCIND || rescind_noise) {
                    let (w, at) = self.tower.marked(i);
                    w.set_state(at, UnitState::Occupied);
                    w.extras_mut().vacate_reason = None;
                    w.extras_mut().vacate_at = None;
                    if rescind_noise {
                        w.satisfaction = w.satisfaction.max(NOISE_CAP);
                    }
                } else if self.clock.minutes >= u.extras().vacate_at.unwrap_or(0.0) {
                    let reason = u.extras().vacate_reason.unwrap_or("access");
                    self.vacate(i, reason);
                }
            } else if lease_tenant && u.satisfaction <= 0.0 {
                let reason = self.vacate_cause(&u, &r);
                let (w, at) = self.tower.marked(i);
                w.set_state(at, UnitState::Vacating);
                w.extras_mut().vacate_reason = Some(reason);
                w.extras_mut().vacate_at = Some(self.clock.minutes + VACATE_NOTICE_MINUTES);
                notices.push((u.floor, u.kind, reason));
            } else if u.satisfaction <= 0.0 && u.kind.is_hotel() {
                let reason = self.vacate_cause(&u, &r);
                self.vacate(i, reason);
            }
        }
        self.emit_notices(&notices);
    }

    /// `emitNotices`: one toast naming the unit when one tenant gave notice,
    /// or a per-cause tally (in first-seen order, as the TypeScript `Map`
    /// keeps it) when several did at once.
    pub(super) fn emit_notices(&mut self, notices: &[(i64, Kind, &'static str)]) {
        if notices.is_empty() {
            return;
        }
        if notices.len() == 1 {
            let (floor, kind, reason) = notices[0];
            let msg = format!(
                "{} on {} gave notice: {}. Fix it before they leave.",
                kind.facility().name,
                self.floor_label(floor),
                vacate_reason_text(reason)
            );
            self.emit(&msg, LogKind::Bad);
            return;
        }
        let mut by_reason: Vec<(&'static str, usize)> = Vec::new();
        for &(_, _, reason) in notices {
            match by_reason.iter_mut().find(|(r, _)| *r == reason) {
                Some(entry) => entry.1 += 1,
                None => by_reason.push((reason, 1)),
            }
        }
        let parts: Vec<String> = by_reason
            .iter()
            .map(|(r, n)| format!("{} \u{d7} {}", n, vacate_reason_text(r)))
            .collect();
        let msg = format!(
            "{} tenants gave notice: {}. Fix the flagged units before they leave.",
            notices.len(),
            parts.join(", ")
        );
        self.emit(&msg, LogKind::Bad);
    }
}
