//! Port of `src/engine/sim/loop.ts` and the weather hash from `sim/build.ts`.

use crate::crowd::{motion, spawn, CROWD_SECONDS_PER_MINUTE};
use crate::sim::{LogKind, Simulation};
use crate::tower::UnitState;

pub const CROWD_MAX_STEP: f64 = 60.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Weather {
    Clear,
    Cloudy,
    Rain,
}

/// `weatherFor(day)`.
pub fn weather_for(day: i64) -> Weather {
    let mut h = (day as i32 as u32).wrapping_mul(2654435761);
    h ^= h >> 13;
    h = h.wrapping_mul(1274126177);
    let r = ((h >> 8) & 0xffff) as f64 / 65536.0;
    if r < 0.62 {
        Weather::Clear
    } else if r < 0.85 {
        Weather::Cloudy
    } else {
        Weather::Rain
    }
}

impl Simulation {
    /// `tick(dtMinutes)`: the v2 loop of sub-steps that never skip an hour.
    pub fn tick(&mut self, dt_minutes: f64) {
        const EPS: f64 = 1e-6;
        let mut remaining = dt_minutes;
        while remaining > EPS {
            let to_next_hour = 60.0 - (self.clock.minute_of_day() % 60.0);
            let cap = if to_next_hour > EPS {
                to_next_hour.min(30.0)
            } else {
                30.0
            };
            let step = remaining.min(cap);
            self.advance_step(step);
            remaining -= step;
        }
    }

    pub fn advance_step(&mut self, dt_minutes: f64) {
        self.clock.advance(dt_minutes);
        let rush = self.rush_factor();
        self.elevators.accumulate(&self.tower, dt_minutes, rush);
        self.crowd.begin_step();
        self.crowd.blockbusters = self.blockbusters.iter().copied().collect();
        spawn::spawn_step(
            &mut self.crowd,
            (dt_minutes * CROWD_SECONDS_PER_MINUTE).min(CROWD_MAX_STEP),
            &mut self.tower,
            &self.clock,
            Some(self.weather),
        );
        let move_minutes = dt_minutes.min(CROWD_MAX_STEP / CROWD_SECONDS_PER_MINUTE);
        let mut left = move_minutes;
        while left > 0.0 {
            let chunk = left.min(2.5);
            let calls = self.crowd.elevator_calls(&self.tower);
            let (hour, weekend) = (self.clock.hour(), self.clock.is_weekend());
            self.elevators
                .move_cars(&mut self.tower, chunk, &calls, hour, weekend);
            motion::advance(
                &mut self.crowd,
                chunk * CROWD_SECONDS_PER_MINUTE,
                &mut self.tower,
            );
            left -= chunk;
        }
        let staff_jobs = self.crowd.take_staff_results();
        for job in &staff_jobs {
            self.on_housekeeper_result(job.unit_id, job.ok);
        }
        if !staff_jobs.is_empty() {
            self.dispatch_housekeepers();
        }
        self.finish_construction();

        let hour = self.clock.hour();
        if hour != self.last_hour {
            self.last_hour = hour;
            self.on_hour();
        }
        let day = self.clock.day();
        if day != self.last_day {
            self.last_day = day;
            self.on_day();
        }
    }

    pub fn on_hour(&mut self) {
        self.on_hour_runs += 1;
        self.update_presence();
        let hour = self.clock.hour();
        if hour == 8 {
            self.hotel_checkout();
        }
        if (14..17).contains(&hour) {
            self.hotel_late_checkout();
        }
        let shift = self.mode.housekeeping_shift();
        if hour >= shift.start && hour < shift.end {
            self.resolve_extermination();
            self.dispatch_housekeepers();
        }
        self.update_satisfaction();
        self.attempt_move_ins();
        self.collect_traffic_income();
        self.evaluate_star();
    }

    pub fn on_day(&mut self) {
        self.weather = weather_for(self.clock.day());
        let period =
            (self.clock.day() as f64 / self.clock.calendar.maint_period_days as f64).floor() as i64;
        if period != self.last_month {
            self.last_month = period;
            self.collect_monthly_rent();
            self.pay_maintenance();
            self.roll_condo_relocations();
        }
        let q = self.clock.quarter();
        if q != self.last_quarter {
            self.last_quarter = q;
            self.last_quarter_money = self.money;
            self.collect_rent();
        }
        self.maybe_random_event();
        self.maybe_vip_stay();
        self.check_vip();
        self.report_move_ins();
        self.check_milestones();
        self.nudge_stranded();
        self.nudge_metro_platform();
        self.nudge_service_shortfalls();
        self.roll_over_retail_day();
        self.ledger.end_day();
    }

    pub fn finish_construction(&mut self) {
        if self.constructing.is_empty() {
            return;
        }
        let ids: Vec<i64> = self.constructing.iter().copied().collect();
        for id in ids {
            let Some(u) = self.tower.get_unit(id) else {
                self.constructing.shift_remove(&id);
                continue;
            };
            if u.state != UnitState::Construction {
                self.constructing.shift_remove(&id);
                continue;
            }
            if self.clock.minutes >= u.complete_at.unwrap_or(0.0) {
                let (name, floor) = (u.kind.facility().name, u.floor);
                let u = self.tower.get_unit_mut(id).unwrap();
                u.state = UnitState::Empty;
                u.complete_at = None;
                self.constructing.shift_remove(&id);
                let msg = format!(
                    "{} on {} is now open for business.",
                    name,
                    self.floor_label(floor)
                );
                self.emit(&msg, LogKind::Good);
            }
        }
    }

    /// `floorLabel`: "floor N" above ground, "B{n}" below.
    pub fn floor_label(&self, floor: i64) -> String {
        if floor >= 1 {
            format!("floor {floor}")
        } else {
            format!("B{}", 1 - floor)
        }
    }
}
