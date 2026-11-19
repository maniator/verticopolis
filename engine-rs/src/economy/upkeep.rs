//! Upkeep, monthly rent and the retail day roll-over.

use indexmap::IndexMap;

use super::films::{fills_blockbuster_slot, theater_audience};
use super::screens::{put_screens, screens};
use super::visitors::{
    climb_steps, counts_set_audience, expected_visitors, served_visitors, set_audience,
    venue_day_ends_in_the_morning, NEW_FILM_DRAW,
};
use super::{
    is_overhead_kind, ledger_cat_for, rental_message, service_maintenance_monthly,
    MAINTENANCE_PER_CAR_MONTHLY, NIGHTCLUB_DJ_MONTHLY, REAL_WORLD_MAINT_PERIOD_DAYS,
};
use crate::econ::rent_of;
use crate::facilities::Kind;
use crate::jsmath;
use crate::services::with_thousands;
use crate::sim::{LogKind, Simulation};
use crate::tower::UnitState;

#[doc(hidden)]
impl Simulation {
    /// `payMaintenance`: the per-period upkeep. A theater's film is paid
    /// for when it is shown (`change_film`), never each period (#1950).
    pub fn pay_maintenance(&mut self) {
        let mut cost = 0.0;
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
        // Rooms only: a floor or lobby tile owes no upkeep, tax or overhead
        // (`structural_tiles_owe_nothing`), and tiles are most of the units.
        let rooms = self.tower.room_index();
        for &i in rooms.iter() {
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
            if u.kind == Kind::Nightclub && operational {
                charge("entertainment", NIGHTCLUB_DJ_MONTHLY);
            }
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
        // Rooms only: a rental is never a floor or lobby tile.
        let rooms = self.tower.room_index();
        for &i in rooms.iter() {
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

    /// `rollOverRetailDay`: at midnight a restaurant's day ends, and a party
    /// hall or theatre open through the night starts counting its audience
    /// (#1500). A shop's and a fast food's day ends in the morning instead
    /// ([`Self::roll_over_morning_venues`]).
    pub fn roll_over_retail_day(&mut self) {
        // Rooms only: the tower's floor tiles never carry a venue.
        let rooms = self.tower.room_index();
        // The theaters whose film fills a blockbuster slot tonight.
        let mode = self.tower.mode;
        let mut full_houses: Vec<f64> = Vec::new();
        for &i in rooms.iter() {
            let u = &self.tower.units[i];
            if !u.is_operational() {
                continue;
            }
            if u.kind == Kind::Cinema {
                // A theatre counts the draw its film had overnight, and the
                // film is a day older (#1932).
                let audience = theater_audience(mode, u);
                let (u, at) = self.tower.marked(i);
                u.set_visitors_yest(at, Some(u8::try_from(audience).unwrap_or(u8::MAX)));
                let mut films = screens(mode, u);
                for film in &mut films {
                    film.days = Some(film.days.unwrap_or(0).saturating_add(1));
                }
                put_screens(mode, u, films);
                if fills_blockbuster_slot(mode, u) {
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
            if u.kind.subtype_list().is_none() || venue_day_ends_in_the_morning(u.kind) {
                continue;
            }
            self.close_venue_day(i);
        }
        self.blockbusters = full_houses;
    }

    /// A shop's and a fast food's day ends when shops open, about 10:00, as
    /// in the original (#1500): its served count, and the census that reads
    /// it, change then, not at midnight.
    pub fn roll_over_morning_venues(&mut self) {
        let rooms = self.tower.room_index();
        for &i in rooms.iter() {
            let u = &self.tower.units[i];
            if u.is_operational() && venue_day_ends_in_the_morning(u.kind) {
                self.close_venue_day(i);
            }
        }
    }

    /// Ends the day of the shop, fast food or restaurant at unit index `i`:
    /// its served count follows the day's expected visitors and patronage,
    /// and today's tallies become yesterday's. The day that ended is the
    /// calendar day before today, whose weekend sets the caps, for a venue
    /// whose day ends at midnight and for one whose day ends at 10:00.
    fn close_venue_day(&mut self, i: usize) {
        let ended_weekend = self.clock.is_weekend_on(self.clock.day() - 1);
        {
            let u = &self.tower.units[i];
            let tally = u.extras();
            let has_data = tally.patronage_today.is_some()
                || tally.patronage_yest.is_some()
                || tally.profit_today.is_some()
                || tally.profit_yest.is_some()
                // An imported venue arrives with its count alone (#1500).
                || u.visitors_yest.is_some();
            if !has_data {
                return;
            }
        }
        let u = &self.tower.units[i];
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
}

#[cfg(test)]
#[path = "upkeep_audience_tests.rs"]
mod upkeep_audience_tests;

/// The monthly passes walk rooms only, which holds while no floor or lobby
/// tile owes upkeep, condo tax, overhead or a DJ, or pays rent. A rule that
/// charges a tile must walk the tiles again.
#[cfg(test)]
#[test]
fn structural_tiles_owe_nothing() {
    let tiles: Vec<Kind> = crate::facilities::FACILITIES
        .iter()
        .map(|f| f.kind)
        .filter(|k| k.is_structural())
        .collect();
    assert!(tiles.contains(&Kind::Floor) && tiles.contains(&Kind::Lobby));
    for kind in tiles {
        assert_eq!(service_maintenance_monthly(kind), None, "{kind:?}");
        assert!(!is_overhead_kind(kind), "{kind:?}");
        assert!(!matches!(kind, Kind::Condo | Kind::Nightclub), "{kind:?}");
        assert!(!kind.is_rental(), "{kind:?}");
    }
}
