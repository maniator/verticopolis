//! Port of `src/engine/EconomySystem.ts` and `economy/rentalIncome.ts`.

use std::collections::HashMap;

use indexmap::IndexMap;

use crate::clock::GameMode;
use crate::econ::{rent_config, rent_of};
use crate::facilities::Kind;
use crate::jsmath;
use crate::sim::{LogKind, Simulation};
use crate::tower::UnitState;

pub const COMMERCIAL_LOBBY_FLOORS: i64 = 2;
const COMMERCIAL_LOBBY_FAR_MULT: f64 = 0.5;
pub const TRAFFIC_FACTOR_MIN: f64 = 0.6;
pub const TRAFFIC_FACTOR_SPAN: f64 = 0.4;
pub const MAINTENANCE_PER_CAR_MONTHLY: f64 = 600.0;
pub const CINEMA_BOOKING_MONTHLY: f64 = 150_000.0;
pub const CINEMA_BOOKING_BLOCKBUSTER: f64 = 300_000.0;
pub const NIGHTCLUB_DJ_MONTHLY: f64 = 40_000.0;
pub const CONDO_MONTHLY_TAX_RATE: f64 = 0.015;
pub const OVERHEAD_PER_LEASABLE_UNIT_MONTHLY: f64 = 700.0;
pub const REAL_WORLD_MAINT_PERIOD_DAYS: f64 = 30.0;
pub const REAL_WORLD_QUARTER_DAYS: f64 = 90.0;

/// `ledgerCatFor`.
pub fn ledger_cat_for(kind: Kind) -> Option<&'static str> {
    Some(match kind {
        Kind::Office => "offices",
        Kind::Condo | Kind::RentalStudio | Kind::RentalApartment => "condos",
        Kind::HotelSingle | Kind::HotelDouble | Kind::HotelSuite => "hotels",
        Kind::Shop | Kind::BoutiqueBay | Kind::Clinic | Kind::Daycare => "retail",
        Kind::FastFood | Kind::Restaurant | Kind::FoodHall => "food",
        Kind::Cinema
        | Kind::PartyHall
        | Kind::AquaticCenter
        | Kind::Amusements
        | Kind::FitnessClub
        | Kind::Nightclub
        | Kind::Spa
        | Kind::SkyBar => "entertainment",
        _ => return None,
    })
}

/// `ECON.dailyTrafficIncome` (Modern).
pub fn daily_traffic_income(kind: Kind) -> Option<f64> {
    Some(match kind {
        Kind::FastFood => 2_000.0,
        Kind::Restaurant => 4_000.0,
        Kind::FoodHall => 6_500.0,
        Kind::Amusements => 4_500.0,
        Kind::BoutiqueBay => 3_500.0,
        Kind::Nightclub => 10_000.0,
        Kind::Spa => 5_000.0,
        Kind::SkyBar => 4_000.0,
        Kind::AquaticCenter => 7_000.0,
        Kind::Daycare => 3_500.0,
        Kind::Shop => 2_500.0,
        Kind::Cinema => 8_000.0,
        Kind::PartyHall => 3_000.0,
        _ => return None,
    })
}

/// `ECON.classicDailyTrafficIncome`.
pub fn classic_daily_traffic_income(kind: Kind) -> Option<f64> {
    Some(match kind {
        Kind::FastFood => 5_000.0,
        Kind::Restaurant => 10_000.0,
        Kind::Shop => 20_000.0,
        Kind::Cinema => 10_000.0,
        Kind::PartyHall => 20_000.0,
        _ => return None,
    })
}

/// `GameRules.commercialDailyIncome`.
pub fn commercial_daily_income(mode: GameMode, kind: Kind) -> Option<f64> {
    match mode {
        GameMode::Classic => classic_daily_traffic_income(kind),
        GameMode::Modern => daily_traffic_income(kind),
    }
}

/// `ECON.retailSpendPerCustomer`.
pub fn retail_spend_per_customer(kind: Kind) -> Option<f64> {
    Some(match kind {
        Kind::FastFood => 10.0,
        Kind::Restaurant => 30.0,
        Kind::FoodHall => 25.0,
        Kind::Amusements => 15.0,
        Kind::BoutiqueBay => 20.0,
        Kind::Nightclub => 30.0,
        Kind::Spa => 40.0,
        Kind::SkyBar => 35.0,
        Kind::Daycare => 25.0,
        Kind::Shop => 20.0,
        _ => return None,
    })
}

/// `GameRules.weekendMultiplier`.
pub fn weekend_multiplier(mode: GameMode, kind: Kind, is_weekend: bool) -> f64 {
    if !is_weekend {
        return 1.0;
    }
    match mode {
        GameMode::Classic => match kind {
            Kind::FastFood | Kind::Restaurant => 48.0 / 35.0,
            Kind::Shop => 30.0 / 25.0,
            _ => 1.0,
        },
        GameMode::Modern => match kind {
            Kind::FastFood => 0.7,
            Kind::Restaurant => 1.35,
            Kind::FoodHall => 1.25,
            Kind::Amusements => 1.4,
            Kind::BoutiqueBay => 1.3,
            Kind::Nightclub => 1.5,
            Kind::Spa => 1.4,
            Kind::SkyBar => 1.45,
            Kind::Daycare => 0.6,
            Kind::Shop => 1.2,
            _ => 1.0,
        },
    }
}

/// `ECON.serviceMaintenanceMonthly`.
pub fn service_maintenance_monthly(kind: Kind) -> Option<f64> {
    Some(match kind {
        Kind::Security => 2_000.0,
        Kind::Medical => 5_000.0,
        Kind::Housekeeping => 1_000.0,
        Kind::Recycling => 4_000.0,
        Kind::Metro => 8_000.0,
        _ => return None,
    })
}

/// `isOverheadKind`.
fn is_overhead_kind(kind: Kind) -> bool {
    rent_config(kind).is_some() || daily_traffic_income(kind).is_some()
}

impl Simulation {
    pub fn has_operational(&self, kind: Kind) -> bool {
        self.count_operational(kind) > 0
    }

    pub fn count_operational(&self, kind: Kind) -> i64 {
        self.tower
            .units
            .iter()
            .filter(|u| u.kind == kind && u.is_operational())
            .count() as i64
    }

    pub fn has_any(&self, kind: Kind) -> bool {
        self.tower.units.iter().any(|u| u.kind == kind)
    }

    /// `collectRent`: quarterly lease income.
    pub fn collect_rent(&mut self) {
        let mut sums: IndexMap<Kind, (f64, i64)> = IndexMap::new();
        for u in &self.tower.units {
            if !matches!(u.kind, Kind::Office | Kind::FitnessClub | Kind::Clinic) {
                continue;
            }
            if !u.is_tenanted() || !self.tower.is_floor_served(u.floor) {
                continue;
            }
            let b = sums.entry(u.kind).or_insert((0.0, 0));
            b.0 += rent_of(u.kind, u.rent, u.no_rate);
            b.1 += 1;
        }
        let scale = self
            .mode
            .quarterly_rent_scale(self.clock.calendar.quarter_days);
        for (kind, (sum, n)) in sums {
            let amt = jsmath::round(sum * scale);
            if amt <= 0.0 {
                continue;
            }
            self.money += amt;
            self.record_money(ledger_cat_for(kind).unwrap_or("upkeep"), amt);
            let msg = match kind {
                Kind::Office => format!("Quarterly office rent collected: ${amt} ({n} offices)."),
                Kind::FitnessClub => {
                    format!("Fitness Club membership dues collected: ${amt} ({n} clubs).")
                }
                _ => format!("Clinic lease collected: ${amt} ({n} clinics)."),
            };
            self.emit(&msg, LogKind::Money);
        }
    }

    /// `collectTrafficIncome`: hourly venue takings.
    pub fn collect_traffic_income(&mut self) {
        let demand_map = crate::demand::compute_demand_map(self);
        let mut reach_cache: HashMap<(i64, i64), bool> = HashMap::new();
        let rain = self.weather == Weather::Rain;
        let rain_metro_relief = rain && self.has_operational(Kind::Metro);
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
                    let u = &mut self.tower.units[i];
                    if attends {
                        u.sync_attendance_occupants();
                    } else {
                        u.occupants = 0;
                    }
                }
                continue;
            }
            {
                let u = &mut self.tower.units[i];
                u.state = UnitState::Occupied;
                if attends {
                    u.sync_attendance_occupants();
                } else {
                    u.occupants = kind.facility().population;
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
        for u in self.tower.units.iter_mut() {
            if !u.kind.is_hotel() {
                continue;
            }
            if u.state == UnitState::Asleep {
                if deferred < defer_count {
                    deferred += 1.0;
                    continue;
                }
                revenue += rent_of(u.kind, u.rent, u.no_rate);
                u.state = UnitState::Dirty;
                u.occupants = 0;
            }
        }
        if revenue > 0.0 {
            self.money += revenue;
            self.record_money("hotels", revenue);
            self.emit(
                &format!("Hotel guests checked out: ${revenue} earned overnight."),
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
        for u in self.tower.units.iter_mut() {
            if u.kind.is_hotel() && u.state == UnitState::Asleep {
                revenue += rent_of(u.kind, u.rent, u.no_rate);
                u.state = UnitState::Dirty;
                u.occupants = 0;
            }
        }
        if revenue > 0.0 {
            self.money += revenue;
            self.record_money("hotels", revenue);
            self.emit(
                &format!("Late hotel checkouts: ${revenue} earned."),
                LogKind::Money,
            );
        }
    }

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
                "{} paid: ${cost}.",
                if monthly {
                    "Monthly maintenance"
                } else {
                    "Maintenance"
                }
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
        self.emit(
            &format!("Monthly rent collected: ${amt} ({n} rentals)."),
            LogKind::Money,
        );
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

use crate::sim_loop::Weather;
