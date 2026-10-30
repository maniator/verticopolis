//! Hourly venue takings and hotel checkouts.

use std::collections::HashMap;

use super::{
    commercial_daily_income, ledger_cat_for, retail_spend_per_customer, weekend_multiplier,
    COMMERCIAL_LOBBY_FAR_MULT, COMMERCIAL_LOBBY_FLOORS, TRAFFIC_FACTOR_MIN, TRAFFIC_FACTOR_SPAN,
};
use crate::econ::rent_of;
use crate::facilities::Kind;
use crate::jsmath;
use crate::services::with_thousands;
use crate::sim::{LogKind, Simulation};
use crate::sim_loop::Weather;
use crate::tower::UnitState;

impl Simulation {
    /// `collectTrafficIncome`: hourly venue takings.
    pub fn collect_traffic_income(&mut self) {
        let demand_map = crate::demand::compute_demand_map(self);
        let mut reach_cache: HashMap<(i64, i64), bool> = HashMap::new();
        let rain = self.weather == Weather::Rain;
        let rain_metro_relief = rain && self.metro_helps_business();
        let is_weekend = self.clock.is_weekend();
        let hour = self.clock.hour();
        let mode = self.mode;
        for i in self.tower.room_indices() {
            let (kind, floor, x, id, state) = {
                let u = &self.tower.units[i];
                (u.kind, u.floor, u.x, u.id, u.state)
            };
            let Some(daily) = commercial_daily_income(mode, kind) else {
                continue;
            };
            if !self.tower.units[i].is_operational() {
                continue;
            }
            let attendance_cap = kind.attendance_cap();
            let attends = attendance_cap.is_some();
            let key = (floor, self.tower.segment_start_x(floor, x));
            let draws = match reach_cache.get(&key) {
                Some(&h) => h,
                None => {
                    let h = self.unit_reachable(floor, x);
                    reach_cache.insert(key, h);
                    h
                }
            };
            if !draws || !kind.is_open_at(hour) {
                if state == UnitState::Occupied {
                    let (u, at) = self.tower.marked(i);
                    if attends {
                        u.sync_attendance_occupants(at);
                    } else {
                        u.set_occupants(at, 0);
                    }
                }
                continue;
            }
            {
                let (u, at) = self.tower.marked(i);
                u.set_state(at, UnitState::Occupied);
                if attends {
                    u.sync_attendance_occupants(at);
                } else {
                    u.set_occupants(at, kind.facility().population);
                }
            }
            let customers = self.tower.units[i].customers_in.unwrap_or(0);
            let frac = match attendance_cap {
                None => demand_map.fraction_by_unit.get(&id).copied().unwrap_or(0.0),
                Some(cap) if cap > 0 => ((customers.max(0)) as f64 / cap as f64).min(1.0),
                Some(_) => 0.0,
            };
            let rain_mult = if rain && attendance_cap.is_none() {
                (if rain_metro_relief { 0.7 } else { 0.5 })
                    * (if kind == Kind::FastFood { 0.6 } else { 1.0 })
            } else {
                1.0
            };
            let film_mult = if kind == Kind::Cinema && self.blockbusters.contains(&(id as f64)) {
                2.2
            } else {
                1.0
            };
            let lobby_mult = if kind.is_commercial()
                && kind != Kind::SkyBar
                && self.tower.nearest_lobby_floor_distance(floor) > COMMERCIAL_LOBBY_FLOORS
            {
                COMMERCIAL_LOBBY_FAR_MULT
            } else {
                1.0
            };
            let weekend_mult = if attendance_cap.is_some() {
                1.0
            } else {
                weekend_multiplier(mode, kind, is_weekend)
            };
            let view_mult = if kind == Kind::SkyBar {
                mode.view_premium(floor)
            } else {
                1.0
            };
            let traffic_factor = TRAFFIC_FACTOR_MIN + self.rng.next() * TRAFFIC_FACTOR_SPAN;
            let open_h = kind.open_hours_per_day() as f64;
            let hourly = (daily / open_h)
                * frac
                * rain_mult
                * film_mult
                * lobby_mult
                * weekend_mult
                * view_mult
                * traffic_factor;
            let u = &mut self.tower.units[i];
            u.pending_income += hourly;
            let spend = retail_spend_per_customer(kind);
            let is_retail = kind.subtype_list().is_some() && spend.is_some_and(|s| s > 0.0);
            if is_retail {
                let cust_per_hour = daily / (spend.unwrap() * open_h);
                u.patronage_today = Some(
                    u.patronage_today.unwrap_or(0.0)
                        + cust_per_hour
                            * frac
                            * rain_mult
                            * lobby_mult
                            * weekend_mult
                            * traffic_factor,
                );
            }
            if u.pending_income >= 1.0 {
                let earned = u.pending_income.floor();
                u.pending_income -= earned;
                if is_retail {
                    u.profit_today = Some(u.profit_today.unwrap_or(0.0) + earned);
                }
                self.money += earned;
                if let Some(cat) = ledger_cat_for(kind) {
                    self.record_money(cat, earned);
                }
            }
        }
    }

    /// `hotelCheckout`: the 08:00 event.
    pub fn hotel_checkout(&mut self) {
        self.housekeeping_before_checkout();
        let presence = self.mode.hotel_daytime_presence();
        let mut defer_count = 0.0;
        if presence > 0.0 {
            let asleep = self
                .tower
                .units
                .iter()
                .filter(|u| u.kind.is_hotel() && u.state == UnitState::Asleep)
                .count() as f64;
            defer_count = jsmath::round(presence * asleep);
        }
        let mut revenue = 0.0;
        let mut deferred = 0.0;
        for (u, at) in self.tower.marked_units() {
            if !u.kind.is_hotel() {
                continue;
            }
            if u.state == UnitState::Asleep {
                if deferred < defer_count {
                    deferred += 1.0;
                    continue;
                }
                revenue += rent_of(u.kind, u.rent, u.no_rate);
                u.set_state(at, UnitState::Dirty);
                u.set_occupants(at, 0);
            }
        }
        if revenue > 0.0 {
            self.money += revenue;
            self.record_money("hotels", revenue);
            self.emit(
                &format!(
                    "Hotel guests checked out: ${} earned overnight.",
                    with_thousands(revenue)
                ),
                LogKind::Money,
            );
        }
        self.housekeeping.reset_shift();
    }

    /// `hotelLateCheckout` (Modern only).
    pub fn hotel_late_checkout(&mut self) {
        if self.mode.hotel_daytime_presence() <= 0.0 {
            return;
        }
        let mut revenue = 0.0;
        for (u, at) in self.tower.marked_units() {
            if u.kind.is_hotel() && u.state == UnitState::Asleep {
                revenue += rent_of(u.kind, u.rent, u.no_rate);
                u.set_state(at, UnitState::Dirty);
                u.set_occupants(at, 0);
            }
        }
        if revenue > 0.0 {
            self.money += revenue;
            self.record_money("hotels", revenue);
            self.emit(
                &format!("Late hotel checkouts: ${} earned.", with_thousands(revenue)),
                LogKind::Money,
            );
        }
    }
}
