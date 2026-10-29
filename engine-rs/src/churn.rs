//! Port of `sim/churn.ts`: vacate, move-ins, names, relocations.

use crate::econ::{classic_ladder, rent_config};
use crate::facilities::Kind;
use crate::jsmath;
use crate::presence::CongestionAttribution;
use crate::rent::snap_to_ladder;
use crate::satisfaction::{vacate_reason_text, VACATE_NOTICE_MINUTES};
use crate::services::with_thousands;
use crate::sim::{LogKind, Simulation};
use crate::tower::UnitState;

use crate::rules::CLASSIC_HOUSEHOLD;

mod move_in;
mod names;

/// `CongestionBindingClass` (sim/gripe.ts): the transport class whose shaft
/// binds a floor's congestion reading; `Walkways` is the stairs-and-escalators
/// tie, `None` the transportless defensive case.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CongestionBindingClass {
    Elevator,
    Stairs,
    Escalator,
    Walkways,
    None,
}

/// `BINDING_TIE_EPS`: two ratios within this band count as tied.
const BINDING_TIE_EPS: f64 = 1e-9;

const HOUSEHOLD_SIZES: [i64; 4] = [2, 3, 4, 5];
const HOUSEHOLD_WEIGHTS: [i64; 4] = [4, 6, 2, 1];

/// `householdPrice`.
pub fn household_price(base: f64, residents: Option<i64>) -> f64 {
    match residents {
        None => base,
        Some(r) => jsmath::round((base * r as f64) / CLASSIC_HOUSEHOLD),
    }
}

/// `rollHousehold`.
pub fn roll_household(rng: &mut crate::rng::Rng) -> i64 {
    let total: i64 = HOUSEHOLD_WEIGHTS.iter().sum();
    let mut roll = rng.int(1, total);
    for i in 0..HOUSEHOLD_SIZES.len() {
        roll -= HOUSEHOLD_WEIGHTS[i];
        if roll <= 0 {
            return HOUSEHOLD_SIZES[i];
        }
    }
    3
}

impl Simulation {
    /// `servingTransportKindsAt(floor)`: (elevator, stairs, escalator), the
    /// passenger kinds with a shaft stopping at the floor; staff-only
    /// service elevators never count.
    pub fn serving_transport_kinds_at(&self, floor: i64) -> (bool, bool, bool) {
        let mut kinds = (false, false, false);
        for t in &self.tower.transports {
            if t.kind.is_staff_only_transport() || !t.stops_at(floor) {
                continue;
            }
            if t.kind.is_elevator() {
                kinds.0 = true;
            } else if t.kind == Kind::Stairs {
                kinds.1 = true;
            } else if t.kind == Kind::Escalator {
                kinds.2 = true;
            }
        }
        kinds
    }

    /// `bindingTransportClassAt(floor)`: the class that binds the floor's
    /// congestion reading, from the spatial model's own attribution. A
    /// walkway flips the wording only when strictly worse than every serving
    /// elevator beyond `BINDING_TIE_EPS`; two tied walkway kinds that both
    /// clear the band read as the combined class. A floor without an
    /// attribution entry, or with every class at 0, falls back to the
    /// serving-kinds classification.
    pub fn binding_transport_class_at(&self, floor: i64) -> CongestionBindingClass {
        self.binding_class_from(
            self.spatial_congestion_attribution_by_floor().get(&floor),
            floor,
        )
    }

    /// `bindingTransportClassAt` on an attribution entry the caller already
    /// built (`None` for a floor without one), so a reader holding the
    /// congestion maps does not build them again.
    pub(crate) fn binding_class_from(
        &self,
        att: Option<&CongestionAttribution>,
        floor: i64,
    ) -> CongestionBindingClass {
        if let Some(att) = att {
            let walk_max = att.stairs.max(att.escalator);
            if walk_max > att.elevator + BINDING_TIE_EPS {
                let stairs_bind = att.stairs > att.elevator + BINDING_TIE_EPS;
                let escalator_bind = att.escalator > att.elevator + BINDING_TIE_EPS;
                if stairs_bind
                    && escalator_bind
                    && (att.stairs - att.escalator).abs() <= BINDING_TIE_EPS
                {
                    return CongestionBindingClass::Walkways;
                }
                return if att.stairs >= att.escalator {
                    CongestionBindingClass::Stairs
                } else {
                    CongestionBindingClass::Escalator
                };
            }
            if att.elevator > 0.0 {
                return CongestionBindingClass::Elevator;
            }
        }
        match self.serving_transport_kinds_at(floor) {
            (true, _, _) => CongestionBindingClass::Elevator,
            (false, true, true) => CongestionBindingClass::Walkways,
            (false, true, false) => CongestionBindingClass::Stairs,
            (false, false, true) => CongestionBindingClass::Escalator,
            (false, false, false) => CongestionBindingClass::None,
        }
    }

    /// `congestionChurnNote(floor)`: the buy-back line's note naming the
    /// transport that binds the floor's reading, with the lever that clears it.
    fn congestion_churn_note(&self, floor: i64) -> String {
        let binding = self.binding_transport_class_at(floor);
        let noun = match binding {
            CongestionBindingClass::Elevator => "elevators",
            CongestionBindingClass::Walkways => "stairs and escalators",
            CongestionBindingClass::Stairs => "stairs",
            CongestionBindingClass::Escalator => "escalators",
            CongestionBindingClass::None => "vertical transport",
        };
        let lever = if binding == CongestionBindingClass::Elevator {
            "add cars"
        } else {
            "add capacity"
        };
        format!(" A new owner will buy in, but the crowded {noun} will wear them down too until you {lever}.")
    }

    /// `rerollSubtype(id)`: a fresh canon subtype drawn off the current one
    /// (from the list minus the current entry, so no rejection sampling), or
    /// from the whole list when the unit has none; `None` for a unit without
    /// a subtype list of at least two.
    pub fn reroll_subtype(&mut self, id: i64) -> Option<&'static str> {
        let (kind, current) = {
            let u = self.tower.get_unit(id)?;
            (u.kind, u.subtype)
        };
        let list = kind.subtype_list()?;
        if list.len() < 2 {
            return None;
        }
        let current_idx = current.and_then(|c| list.iter().position(|&s| s == c));
        let idx = match current_idx {
            None => self.rng.int(0, list.len() as i64 - 1) as usize,
            Some(cur) => {
                let mut i = self.rng.int(0, list.len() as i64 - 2) as usize;
                if i >= cur {
                    i += 1;
                }
                i
            }
        };
        let next = list[idx];
        self.tower.set_unit_subtype(id, Some(next));
        self.tower.bump_meal_overlay_revision();
        Some(next)
    }

    /// `vacate(u, reason)` on the unit at index `i`.
    pub fn vacate(&mut self, i: usize, reason: &'static str) {
        let (kind, floor, ever_occupied, rent, residents, no_rate) = {
            let u = &self.tower.units[i];
            (
                u.kind,
                u.floor,
                u.ever_occupied,
                u.rent,
                u.residents,
                u.no_rate,
            )
        };
        // The congestion note's binding class is read before the unit
        // empties below, as the TypeScript does: the departing tenant's own
        // load is part of what bound the floor's reading. Gated on the
        // conditions the emit needs (only a bought-back sold condo on the
        // market carries the note), so no other eviction pays the map build.
        let cong_note =
            if reason == "congestion" && kind == Kind::Condo && ever_occupied && !no_rate {
                self.congestion_churn_note(floor)
            } else {
                String::new()
            };
        let mut buyback = 0.0;
        if kind == Kind::Condo && ever_occupied {
            let sale_price = rent.unwrap_or_else(|| rent_config(Kind::Condo).unwrap().default);
            buyback = household_price(sale_price, residents);
            self.money -= buyback;
            self.record_money("condos", -buyback);
        }
        let modern = self.mode.is_modern();
        let (u, at) = self.tower.marked(i);
        u.set_state(at, UnitState::Empty);
        u.set_occupants(at, 0);
        if !kind.is_hotel() {
            u.ever_occupied = false;
        }
        u.set_residents(at, None);
        if kind == Kind::Condo {
            if let Some(r) = u.rent {
                u.rent = Some(if modern {
                    let band = rent_config(Kind::Condo).unwrap();
                    r.min(band.max).max(band.min)
                } else {
                    snap_to_ladder(&classic_ladder(Kind::Condo).unwrap(), r)
                });
            }
        }
        u.vacate_reason = None;
        u.vacate_at = None;
        self.tower
            .set_unit_label_at(i, kind.facility().name.to_string());
        let name = kind.facility().name;
        // The trailing note asks the move-in gate directly, on the emptied
        // unit: a No Rate unit stays off the market, a unit the gate still
        // holds stays empty until the cause is fixed, and only a unit that
        // re-sells carries the congestion churn note.
        let buyback_note = if buyback > 0.0 {
            if no_rate {
                " It is off the market (No Rate); set a rate to sell it again.".to_string()
            } else {
                let probe = self.tower.units[i].clone();
                let mut ctx = self.build_satisfaction_context(true);
                if self.would_evict_fresh_tenant(&probe, &mut ctx) {
                    " It stays empty until you fix the cause.".to_string()
                } else {
                    cong_note
                }
            }
        } else {
            String::new()
        };
        let msg = if buyback > 0.0 {
            format!(
                "The owner left {} on {} ({}). You bought it back for ${}.{}",
                name,
                self.floor_label(floor),
                vacate_reason_text(reason),
                with_thousands(buyback),
                buyback_note
            )
        } else {
            format!(
                "A tenant left {} on {} ({}).",
                name,
                self.floor_label(floor),
                vacate_reason_text(reason)
            )
        };
        self.emit(&msg, LogKind::Bad);
    }

    /// `rollCondoRelocations` (Modern only).
    pub fn roll_condo_relocations(&mut self) {
        let days = (VACATE_NOTICE_MINUTES / (24.0 * 60.0)).ceil();
        let scale = self.clock.calendar.maint_period_days as f64 / 30.0;
        for i in 0..self.tower.units.len() {
            let (kind, state, ever_occupied, residents, floor) = {
                let u = &self.tower.units[i];
                (u.kind, u.state, u.ever_occupied, u.residents, u.floor)
            };
            if kind != Kind::Condo || state != UnitState::Occupied || !ever_occupied {
                continue;
            }
            let chance = self.mode.condo_relocation_chance(residents) * scale;
            if chance <= 0.0 || !self.rng.chance(chance) {
                continue;
            }
            let (u, at) = self.tower.marked(i);
            u.set_state(at, UnitState::Vacating);
            u.vacate_reason = Some("relocation");
            u.vacate_at = Some(self.clock.minutes + VACATE_NOTICE_MINUTES);
            let msg = format!(
                "A household in Condominium on {} is relocating. They leave in under {} day(s); you buy the unit back and re-list it.",
                self.floor_label(floor),
                days
            );
            self.emit(&msg, LogKind::Bad);
        }
    }

    /// `reportMoveIns`.
    pub fn report_move_ins(&mut self) {
        let m = self.move_ins_today;
        let mut parts: Vec<String> = Vec::new();
        if m.offices > 0 {
            parts.push(format!(
                "{} office{} leased",
                m.offices,
                if m.offices > 1 { "s" } else { "" }
            ));
        }
        if m.condos > 0 {
            parts.push(format!(
                "{} condo{} sold",
                m.condos,
                if m.condos > 1 { "s" } else { "" }
            ));
        }
        if m.rooms > 0 {
            parts.push(format!(
                "{} hotel room{} booked",
                m.rooms,
                if m.rooms > 1 { "s" } else { "" }
            ));
        }
        if m.fitness > 0 {
            parts.push(format!(
                "{} fitness club{} leased",
                m.fitness,
                if m.fitness > 1 { "s" } else { "" }
            ));
        }
        if m.clinic > 0 {
            parts.push(format!(
                "{} clinic{} leased",
                m.clinic,
                if m.clinic > 1 { "s" } else { "" }
            ));
        }
        if m.rentals > 0 {
            parts.push(format!(
                "{} rental{} leased",
                m.rentals,
                if m.rentals > 1 { "s" } else { "" }
            ));
        }
        if !parts.is_empty() {
            self.emit(
                &format!("New tenants: {}.", parts.join(", ")),
                LogKind::Good,
            );
        }
        self.move_ins_today = Default::default();
    }
}

#[cfg(test)]
mod tests;
