//! Port of `sim/churn.ts`: vacate, move-ins, names, relocations.

use crate::demand::fold_origin_demand;
use crate::econ::{classic_ladder, rent_config, rent_of};
use crate::facilities::Kind;
use crate::jsmath;
use crate::rent::snap_to_ladder;
use crate::satisfaction::{SatisfactionContext, VACATE_NOTICE_MINUTES};
use crate::sim::{LogKind, Simulation};
use crate::tower::UnitState;

const CLASSIC_HOUSEHOLD: f64 = 3.0;
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
    /// `vacate(u, reason)` on the unit at index `i`.
    pub fn vacate(&mut self, i: usize, reason: &'static str) {
        let (kind, floor, ever_occupied, rent, residents) = {
            let u = &self.tower.units[i];
            (u.kind, u.floor, u.ever_occupied, u.rent, u.residents)
        };
        let mut buyback = 0.0;
        if kind == Kind::Condo && ever_occupied {
            let sale_price = rent.unwrap_or_else(|| rent_config(Kind::Condo).unwrap().default);
            buyback = household_price(sale_price, residents);
            self.money -= buyback;
            self.record_money("condos", -buyback);
        }
        let modern = self.mode.is_modern();
        let u = &mut self.tower.units[i];
        u.state = UnitState::Empty;
        u.occupants = 0;
        if !kind.is_hotel() {
            u.ever_occupied = false;
        }
        u.residents = None;
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
        u.label = kind.facility().name.to_string();
        u.vacate_reason = None;
        u.vacate_at = None;
        let name = kind.facility().name;
        let msg = if buyback > 0.0 {
            format!("The owner left {} on {} ({}). You bought it back for ${}.", name, self.floor_label(floor), reason, buyback)
        } else {
            format!("A tenant left {} on {} ({}).", name, self.floor_label(floor), reason)
        };
        self.emit(&msg, LogKind::Bad);
    }

    /// `attemptMoveIns`.
    pub fn attempt_move_ins(&mut self) {
        let weekend = self.clock.is_weekend();
        let parking_penalty = if self.office_parking_short() { 0.5 } else { 1.0 };
        let served_set = self.tower.served_floors();
        let mut reach_memo: std::collections::HashMap<i64, bool> = std::collections::HashMap::new();
        let mut sat_ctx: Option<SatisfactionContext> = None;
        let evening = self.clock.is_evening();
        for i in self.tower.room_indices() {
            let u = self.tower.units[i].clone();
            if u.state != UnitState::Empty || u.no_rate {
                continue;
            }
            let f = u.kind.facility();
            if f.population == 0 && !u.kind.is_hotel() {
                continue;
            }
            if !served_set.contains(&u.floor) {
                continue;
            }
            let key = self.tower.seg_at(u.floor, Some(u.x as f64));
            let reachable = match reach_memo.get(&key) {
                Some(&h) => h,
                None => {
                    let h = self.position_reachable(u.floor, u.x);
                    reach_memo.insert(key, h);
                    h
                }
            };
            if !reachable {
                continue;
            }
            if u.kind == Kind::Condo || u.kind == Kind::Office || u.kind.is_lease_amenity() || u.kind.is_rental() {
                if sat_ctx.is_none() {
                    sat_ctx = Some(self.build_satisfaction_context(true));
                }
                if self.would_evict_fresh_tenant(&u, sat_ctx.as_mut().unwrap()) {
                    continue;
                }
            }
            let demand = self.demand_factor(&u);
            let mut filled = false;
            match u.kind {
                Kind::Office => {
                    if !weekend && self.rng.chance(0.25 * demand * parking_penalty) {
                        filled = true;
                    }
                }
                Kind::Condo => {
                    if self.rng.chance(0.18 * demand) {
                        filled = true;
                    }
                }
                Kind::FitnessClub | Kind::Clinic => {
                    if self.rng.chance(0.22 * demand) {
                        self.move_in(i);
                        if u.kind == Kind::FitnessClub {
                            if let Some(ctx) = sat_ctx.as_mut() {
                                if served_set.contains(&u.floor) {
                                    ctx.club_floors.push(u.floor);
                                }
                            }
                        }
                    }
                }
                Kind::RentalStudio | Kind::RentalApartment => {
                    let fill_rate = if u.kind == Kind::RentalStudio { 0.22 } else { 0.16 };
                    if self.rng.chance(fill_rate * demand) {
                        filled = true;
                    }
                }
                k if k.is_hotel() => {
                    if evening && self.rng.chance(0.5 * demand) {
                        let w = &mut self.tower.units[i];
                        w.state = UnitState::Asleep;
                        w.ever_occupied = true;
                        self.move_ins_today.rooms += 1;
                        if let Some(ctx) = sat_ctx.as_mut() {
                            if let Some(dm) = ctx.demand_map.as_mut() {
                                let w = self.tower.units[i].clone();
                                fold_origin_demand(dm, self, &w);
                            }
                        }
                    }
                }
                _ => {}
            }
            if filled {
                self.move_in(i);
                if let Some(ctx) = sat_ctx.as_mut() {
                    if let Some(dm) = ctx.demand_map.as_mut() {
                        let w = self.tower.units[i].clone();
                        fold_origin_demand(dm, self, &w);
                    }
                }
            }
        }
    }

    /// `moveIn(u)`.
    pub fn move_in(&mut self, i: usize) {
        let kind = self.tower.units[i].kind;
        {
            let u = &mut self.tower.units[i];
            u.state = UnitState::Occupied;
            u.satisfaction = 1.0;
            u.vacate_reason = None;
            u.vacate_at = None;
        }
        if kind == Kind::Condo && !self.tower.units[i].ever_occupied {
            let asking = {
                let u = &self.tower.units[i];
                rent_of(u.kind, u.rent, u.no_rate)
            };
            let (price, residents) = if self.mode.is_modern() {
                let r = roll_household(&mut self.rng);
                (household_price(asking, Some(r)), Some(r))
            } else {
                (asking, None)
            };
            let floor = self.tower.units[i].floor;
            let u = &mut self.tower.units[i];
            u.ever_occupied = true;
            if residents.is_some() {
                u.residents = residents;
            }
            u.rent = Some(asking);
            self.money += price;
            self.record_money("condos", price);
            self.move_ins_today.condos += 1;
            let msg = format!("Condominium on {} sold for ${}.", self.floor_label(floor), price);
            self.emit(&msg, LogKind::Money);
        }
        match kind {
            Kind::Office => {
                let name = self.company_name();
                let u = &mut self.tower.units[i];
                u.ever_occupied = true;
                u.label = name;
                self.move_ins_today.offices += 1;
            }
            Kind::FitnessClub => {
                let name = self.gym_name();
                let u = &mut self.tower.units[i];
                u.ever_occupied = true;
                u.label = name;
                self.move_ins_today.fitness += 1;
            }
            Kind::Clinic => {
                let name = self.clinic_name();
                let u = &mut self.tower.units[i];
                u.ever_occupied = true;
                u.label = name;
                self.move_ins_today.clinic += 1;
            }
            Kind::RentalStudio | Kind::RentalApartment => {
                let residents = if kind == Kind::RentalApartment { Some(roll_household(&mut self.rng)) } else { None };
                let u = &mut self.tower.units[i];
                u.ever_occupied = true;
                if residents.is_some() {
                    u.residents = residents;
                }
                self.move_ins_today.rentals += 1;
            }
            _ => {}
        }
    }

    pub fn company_name(&mut self) -> String {
        const A: [&str; 10] = ["Apex", "Nimbus", "Vertex", "Cobalt", "Atlas", "Orion", "Pioneer", "Summit", "Delta", "Vista"];
        const B: [&str; 8] = ["Holdings", "Systems", "Partners", "Industries", "Group", "Labs", "Trading", "Capital"];
        let a = *self.rng.pick(&A);
        let b = *self.rng.pick(&B);
        format!("{a} {b}")
    }

    pub fn gym_name(&mut self) -> String {
        const A: [&str; 10] = ["Ironworks", "Summit", "Pulse", "Apex", "Vertex", "Kinetic", "Anvil", "Ascend", "Cobalt", "Momentum"];
        const B: [&str; 6] = ["Fitness", "Athletic Club", "Gym", "Strength", "Studio", "Wellness"];
        let a = *self.rng.pick(&A);
        let b = *self.rng.pick(&B);
        format!("{a} {b}")
    }

    pub fn clinic_name(&mut self) -> String {
        const A: [&str; 10] = ["Cedar", "Riverside", "Parkview", "Meridian", "Grove", "Harbor", "Summit", "Bayside", "Elm", "Crestview"];
        const B: [&str; 6] = ["Clinic", "Health", "Medical", "Care", "Wellness Center", "Practice"];
        let a = *self.rng.pick(&A);
        let b = *self.rng.pick(&B);
        format!("{a} {b}")
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
            let u = &mut self.tower.units[i];
            u.state = UnitState::Vacating;
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
            parts.push(format!("{} office{} leased", m.offices, if m.offices > 1 { "s" } else { "" }));
        }
        if m.condos > 0 {
            parts.push(format!("{} condo{} sold", m.condos, if m.condos > 1 { "s" } else { "" }));
        }
        if m.rooms > 0 {
            parts.push(format!("{} hotel room{} booked", m.rooms, if m.rooms > 1 { "s" } else { "" }));
        }
        if m.fitness > 0 {
            parts.push(format!("{} fitness club{} leased", m.fitness, if m.fitness > 1 { "s" } else { "" }));
        }
        if m.clinic > 0 {
            parts.push(format!("{} clinic{} leased", m.clinic, if m.clinic > 1 { "s" } else { "" }));
        }
        if m.rentals > 0 {
            parts.push(format!("{} rental{} leased", m.rentals, if m.rentals > 1 { "s" } else { "" }));
        }
        if !parts.is_empty() {
            self.emit(&format!("New tenants: {}.", parts.join(", ")), LogKind::Good);
        }
        self.move_ins_today = Default::default();
    }
}
