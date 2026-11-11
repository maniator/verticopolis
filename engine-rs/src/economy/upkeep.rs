//! Upkeep, monthly rent and the retail day roll-over.

use indexmap::IndexMap;

use super::films::draws_full_house;
use super::visitors::{
    climb_steps, counts_set_audience, expected_visitors, served_visitors, set_audience,
    showing_draw, NEW_FILM_DRAW,
};
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
    /// `payMaintenance`: the per-period upkeep and, where the mode books
    /// films (Modern), each theatre's booking, which starts a fresh film.
    /// Classic charges for a film only when the player changes it.
    pub fn pay_maintenance(&mut self) {
        let mut cost = 0.0;
        let books_films = self.tower.mode.film_changes().is_none();
        if books_films {
            self.blockbusters.clear();
        }
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
        // The theatres booked this period, each starting a fresh film.
        let mut booked: Vec<usize> = Vec::new();
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
            if u.kind == Kind::Cinema && operational && books_films {
                let blockbuster = match u.extras().film_policy {
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
                booked.push(i);
            }
            if u.kind == Kind::Nightclub && operational {
                charge("entertainment", NIGHTCLUB_DJ_MONTHLY);
            }
        }
        if books_films {
            self.blockbusters = new_blockbusters;
        }
        for i in booked {
            let mut extras = self.tower.units[i].extras_mut();
            extras.film_days = Some(0);
            extras.film_classic = false;
        }
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

    /// `rollOverRetailDay`: each venue's day ends, and a party hall or theatre
    /// open through the night starts counting its audience (#1500).
    pub fn roll_over_retail_day(&mut self) {
        // The day that just ended: its weekend sets the venues' caps.
        let ended_weekend = self.clock.is_weekend_on(self.clock.day() - 1);
        // Rooms only: the tower's floor tiles never carry a venue.
        let rooms = self.tower.room_index();
        // Where the player changes films (Classic), the theatres whose film
        // draws a full house tonight are the blockbusters.
        let changes_films = self.tower.mode.film_changes().is_some();
        let mut full_houses: Vec<f64> = Vec::new();
        for &i in rooms.iter() {
            let u = &self.tower.units[i];
            if !u.is_operational() {
                continue;
            }
            if u.kind == Kind::Cinema {
                // A theatre counts the draw its film had overnight, and the
                // film is a day older (#1932).
                let days_shown = u.extras().film_days.unwrap_or(0);
                let draw = showing_draw(i64::from(days_shown), u.extras().film_classic);
                let audience = set_audience(u.kind, draw).unwrap_or(0);
                let (u, at) = self.tower.marked(i);
                u.set_visitors_yest(at, Some(u8::try_from(audience).unwrap_or(u8::MAX)));
                u.extras_mut().film_days = Some(days_shown.saturating_add(1));
                if changes_films && draws_full_house(u) {
                    full_houses.push(u.id as f64);
                }
                continue;
            }
            if counts_set_audience(u.kind) {
                // A hall counts its audience from the morning after it opens.
                if u.visitors_yest.is_none() {
                    let audience = set_audience(u.kind, NEW_FILM_DRAW).unwrap_or(0);
                    let (u, at) = self.tower.marked(i);
                    u.set_visitors_yest(at, Some(u8::try_from(audience).unwrap_or(u8::MAX)));
                }
                continue;
            }
            if u.kind.subtype_list().is_none() {
                continue;
            }
            let tally = u.extras();
            let has_data = tally.patronage_today.is_some()
                || tally.patronage_yest.is_some()
                || tally.profit_today.is_some()
                || tally.profit_yest.is_some()
                // An imported venue arrives with its count alone (#1500).
                || u.visitors_yest.is_some();
            if !has_data {
                continue;
            }
            let served_before = u.visitors_yest.map(i64::from);
            let steps = climb_steps(self.rng.initial_seed, self.clock.day() - 1, u.id);
            let (u, at) = self.tower.marked(i);
            if let Some(expected) = expected_visitors(u.kind, ended_weekend, served_before, steps) {
                let patronage = u.extras().patronage_today.unwrap_or(0.0);
                let served = served_visitors(expected, patronage);
                // Served never exceeds a cap, and every cap fits a byte.
                u.set_visitors_yest(at, Some(u8::try_from(served).unwrap_or(u8::MAX)));
            }
            let mut tally = u.extras_mut();
            tally.patronage_yest = Some(tally.patronage_today.unwrap_or(0.0));
            tally.patronage_today = Some(0.0);
            tally.profit_yest = Some(tally.profit_today.unwrap_or(0.0));
            tally.profit_today = Some(0.0);
        }
        if changes_films {
            self.blockbusters = full_houses;
        }
    }
}

#[cfg(test)]
#[path = "upkeep_audience_tests.rs"]
mod upkeep_audience_tests;
