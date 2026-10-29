//! Move-ins: the daily tenant draw and a unit's first lease.

use crate::demand::fold_origin_demand;
use crate::econ::rent_of;
use crate::facilities::Kind;
use crate::satisfaction::SatisfactionContext;
use crate::services::with_thousands;
use crate::sim::{LogKind, Simulation};
use crate::tower::UnitState;

use super::{household_price, roll_household};

impl Simulation {
    /// `attemptMoveIns`.
    pub fn attempt_move_ins(&mut self) {
        let weekend = self.clock.is_weekend();
        let parking_penalty = if self.office_parking_short() {
            0.5
        } else {
            1.0
        };
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
            if u.kind == Kind::Condo
                || u.kind == Kind::Office
                || u.kind.is_lease_amenity()
                || u.kind.is_rental()
            {
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
                    let fill_rate = if u.kind == Kind::RentalStudio {
                        0.22
                    } else {
                        0.16
                    };
                    if self.rng.chance(fill_rate * demand) {
                        filled = true;
                    }
                }
                k if k.is_hotel() => {
                    if evening && self.rng.chance(0.5 * demand) {
                        let (w, at) = self.tower.marked(i);
                        w.set_state(at, UnitState::Asleep);
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
            let (u, at) = self.tower.marked(i);
            u.set_state(at, UnitState::Occupied);
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
            let (u, at) = self.tower.marked(i);
            u.ever_occupied = true;
            if residents.is_some() {
                u.set_residents(at, residents);
            }
            u.rent = Some(asking);
            self.money += price;
            self.record_money("condos", price);
            self.move_ins_today.condos += 1;
            let who = match residents {
                Some(r) => format!(" to a household of {r}"),
                None => String::new(),
            };
            let msg = format!(
                "Condominium on {} sold{} for ${}.",
                self.floor_label(floor),
                who,
                with_thousands(price)
            );
            self.emit(&msg, LogKind::Money);
        }
        match kind {
            Kind::Office => {
                let name = self.company_name();
                self.tower.units[i].ever_occupied = true;
                self.tower.set_unit_label_at(i, name);
                self.move_ins_today.offices += 1;
            }
            Kind::FitnessClub => {
                let name = self.gym_name();
                self.tower.units[i].ever_occupied = true;
                self.tower.set_unit_label_at(i, name);
                self.move_ins_today.fitness += 1;
            }
            Kind::Clinic => {
                let name = self.clinic_name();
                self.tower.units[i].ever_occupied = true;
                self.tower.set_unit_label_at(i, name);
                self.move_ins_today.clinic += 1;
            }
            Kind::RentalStudio | Kind::RentalApartment => {
                let residents = if kind == Kind::RentalApartment {
                    Some(roll_household(&mut self.rng))
                } else {
                    None
                };
                let (u, at) = self.tower.marked(i);
                u.ever_occupied = true;
                if residents.is_some() {
                    u.set_residents(at, residents);
                }
                self.move_ins_today.rentals += 1;
            }
            _ => {}
        }
    }
}
