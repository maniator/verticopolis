//! Upkeep, monthly rent and the retail day roll-over.

use indexmap::IndexMap;

use super::{
    is_overhead_kind, ledger_cat_for, rental_message, service_maintenance_monthly,
    CINEMA_BOOKING_BLOCKBUSTER, CINEMA_BOOKING_MONTHLY, MAINTENANCE_PER_CAR_MONTHLY,
    NIGHTCLUB_DJ_MONTHLY, REAL_WORLD_MAINT_PERIOD_DAYS,
};
use crate::econ::rent_of;
use crate::facilities::Kind;
use crate::jsmath;
use crate::services::with_thousands;
use crate::sim::{LogKind, Simulation};
use crate::tower::UnitState;

impl Simulation {
    /// `payMaintenance`: the per-period upkeep and film bookings.
    pub fn pay_maintenance(&mut self) {
        let mut cost = 0.0;
        self.blockbusters.clear();
        let scale = self.clock.calendar.maint_period_days as f64 / REAL_WORLD_MAINT_PERIOD_DAYS;
        let mut charges: Vec<(&'static str, f64)> = Vec::new();
        let mut charge = |cat: &'static str, raw: f64| {
            let a = jsmath::round(raw * scale);
            cost += a;
            charges.push((cat, -a));
        };
        for t in &self.tower.transports {
            if t.kind.is_elevator() {
                charge("upkeep", t.cars as f64 * MAINTENANCE_PER_CAR_MONTHLY);
            }
        }
        let tax_rate = self.mode.condo_hold_tax_rate();
        let overhead = self.mode.operating_overhead_per_unit();
        let mut new_blockbusters: Vec<f64> = Vec::new();
        for i in 0..self.tower.units.len() {
            let u = &self.tower.units[i];
            if let Some(m) = service_maintenance_monthly(u.kind) {
                if u.state != UnitState::Gutted {
                    charge("upkeep", m);
                }
            }
            let operational = u.is_operational();
            if tax_rate > 0.0 && u.kind == Kind::Condo && !u.ever_occupied && operational {
                charge(
                    "condos",
                    (rent_of(u.kind, u.rent, u.no_rate) * tax_rate).ceil(),
                );
            }
            if overhead > 0.0
                && operational
                && is_overhead_kind(u.kind)
                && !(u.kind == Kind::Condo && u.ever_occupied)
            {
                charge(ledger_cat_for(u.kind).unwrap_or("upkeep"), overhead);
            }
            if u.kind == Kind::Cinema && operational {
                let blockbuster = match u.film_policy {
                    Some("blockbuster") => true,
                    Some("feature") => false,
                    _ => self.rng.chance(0.4),
                };
                let booking = if blockbuster {
                    CINEMA_BOOKING_BLOCKBUSTER
                } else {
                    CINEMA_BOOKING_MONTHLY
                };
                if blockbuster {
                    new_blockbusters.push(u.id as f64);
                }
                charge("entertainment", booking);
            }
            if u.kind == Kind::Nightclub && operational {
                charge("entertainment", NIGHTCLUB_DJ_MONTHLY);
            }
        }
        self.blockbusters = new_blockbusters;
        for (cat, a) in charges {
            self.record_money(cat, a);
        }
        if cost > 0.0 {
            self.money -= cost;
            let monthly =
                self.clock.calendar.maint_period_days as f64 == REAL_WORLD_MAINT_PERIOD_DAYS;
            let msg = format!(
                "{} paid: ${}.",
                if monthly {
                    "Monthly maintenance"
                } else {
                    "Maintenance"
                },
                with_thousands(cost)
            );
            self.emit(&msg, LogKind::Money);
        }
    }

    /// `collectMonthlyRent`: Modern rental income.
    pub fn collect_monthly_rent(&mut self) {
        let mut by_cat: IndexMap<&'static str, f64> = IndexMap::new();
        let mut sum = 0.0;
        let mut n = 0;
        for i in 0..self.tower.units.len() {
            let (kind, floor, x, rent, no_rate, tenanted) = {
                let u = &self.tower.units[i];
                (u.kind, u.floor, u.x, u.rent, u.no_rate, u.is_tenanted())
            };
            if !kind.is_rental() || !tenanted || !self.unit_reachable(floor, x) {
                continue;
            }
            let r = rent_of(kind, rent, no_rate);
            sum += r;
            n += 1;
            let cat = ledger_cat_for(kind).unwrap_or("upkeep");
            *by_cat.entry(cat).or_insert(0.0) += r;
        }
        let scale = self.clock.calendar.maint_period_days as f64 / REAL_WORLD_MAINT_PERIOD_DAYS;
        let amt = jsmath::round(sum * scale);
        if amt <= 0.0 {
            return;
        }
        self.money += amt;
        for (cat, cat_sum) in by_cat {
            self.record_money(cat, jsmath::round(cat_sum * scale));
        }
        self.emit(&rental_message(amt, n), LogKind::Money);
    }

    /// `rollOverRetailDay`.
    pub fn roll_over_retail_day(&mut self) {
        for u in self.tower.units.iter_mut() {
            if u.kind.subtype_list().is_none() || !u.is_operational() {
                continue;
            }
            let has_data = u.patronage_today.is_some()
                || u.patronage_yest.is_some()
                || u.profit_today.is_some()
                || u.profit_yest.is_some();
            if !has_data {
                continue;
            }
            u.patronage_yest = Some(u.patronage_today.unwrap_or(0.0));
            u.patronage_today = Some(0.0);
            u.profit_yest = Some(u.profit_today.unwrap_or(0.0));
            u.profit_today = Some(0.0);
        }
    }
}
