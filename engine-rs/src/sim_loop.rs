// The time step (from the TypeScript reference's `sim/loop.ts`) and the
// weather hash.

use crate::crowd::{motion, spawn, CROWD_SECONDS_PER_MINUTE};
use crate::economy::films::fills_blockbuster_slot;
use crate::facilities::Kind;
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
    /// Advances the game by `dt_minutes` game minutes.
    ///
    /// Any `dt` works: the engine splits it into steps of at most 30 minutes
    /// that never cross an hour, so hourly rules always run. The same seed,
    /// the same commands and the same sequence of `dt` give the same game.
    /// A host that runs on display frames should let
    /// [`FrameStepper`](crate::fixed_step::FrameStepper) choose the `dt`, so
    /// the tower comes out the same at any frame rate.
    ///
    /// ```
    /// use verticopolis_engine::clock::GameMode;
    /// use verticopolis_engine::sim::Simulation;
    ///
    /// let mut sim = Simulation::new_game(1, GameMode::Classic);
    /// let day = sim.clock.day();
    /// sim.tick(24.0 * 60.0);
    /// assert_eq!(sim.clock.day(), day + 1);
    /// ```
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

    #[doc(hidden)]
    /// One simulation step. An open undo gesture is paused around it, so
    /// what time does to the tower is never part of an undo step.
    pub fn advance_step(&mut self, dt_minutes: f64) {
        let paused = self.pause_undo_journal();
        self.advance_step_inner(dt_minutes);
        self.resume_undo_journal(paused);
    }

    fn advance_step_inner(&mut self, dt_minutes: f64) {
        self.clock.advance(dt_minutes);
        // While a bomb search runs, everyone but Security's guards holds
        // still: no one arrives, walks or rides, and the cars stay put
        // (owner, 2026-11-13). The guards walk the emergency stairs.
        if !self.bomb_lockdown() {
            self.move_people_and_cars(dt_minutes);
        }
        self.finish_construction_and_search();

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

    /// The crowd's and the cars' share of a step: demand, arrivals, the
    /// cars' moves and the walks, and the staff jobs those walks finished.
    fn move_people_and_cars(&mut self, dt_minutes: f64) {
        let rush = self.rush_factor();
        let population = self.elevators.accumulate(&self.tower, dt_minutes, rush);
        self.crowd.begin_step();
        // The renderer's queue projection, built once a step at its start
        // (`Crowd::queue_view`), as the TypeScript loop primes it.
        self.crowd.queue_view(&self.tower);
        // A fractional id (a forged save) matches no cinema, so only whole
        // ids reach the crowd's set, refilled in place so a step allocates
        // nothing.
        self.crowd.blockbusters.clear();
        self.crowd.blockbusters.extend(
            self.blockbusters
                .iter()
                .filter(|b| b.fract() == 0.0)
                .map(|b| *b as i64),
        );
        spawn::spawn_step(
            &mut self.crowd,
            (dt_minutes * CROWD_SECONDS_PER_MINUTE).min(CROWD_MAX_STEP),
            &mut self.tower,
            &self.clock,
            Some(self.weather),
            population,
        );
        let move_minutes = dt_minutes.min(CROWD_MAX_STEP / CROWD_SECONDS_PER_MINUTE);
        let mut left = move_minutes;
        let mut staff_moved = false;
        while left > 0.0 {
            let chunk = left.min(2.5);
            let calls = self.crowd.elevator_calls(&self.tower);
            let (hour, weekend) = (self.clock.hour(), self.clock.is_weekend());
            self.elevators
                .move_cars(&mut self.tower, chunk, &calls, hour, weekend);
            self.elevators.swap_closed_cars(&mut self.crowd.closed_cars);
            self.elevators.swap_open_cars(&mut self.crowd.open_cars);
            motion::advance(
                &mut self.crowd,
                chunk * CROWD_SECONDS_PER_MINUTE,
                &mut self.tower,
            );
            // The rooms cleaned, and where the housekeepers who came free go
            // next, chunk by chunk so a long step loses no time between rooms.
            staff_moved |= self.staff_after_chunk();
            left -= chunk;
        }
        self.staff_after_step(staff_moved);
    }

    #[doc(hidden)]
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
        // Crews come in two hours early, and none sets out during a bomb
        // search, when everyone but the guards stands still.
        if self.crews_on_duty() && !self.bomb_lockdown() {
            self.bring_in_crews();
        }
        if hour >= shift.start && hour < shift.end {
            self.resolve_extermination();
            if !self.bomb_lockdown() {
                self.dispatch_housekeepers();
            }
        }
        self.send_idle_crews_out();
        self.update_satisfaction();
        self.attempt_move_ins();
        self.collect_traffic_income();
        self.sample_elevator_util();
        self.evaluate_star();
    }

    #[doc(hidden)]
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
        // A rebooked film opens tonight, after the spent one's last count.
        self.rebook_spent_films();
        self.ledger.end_day();
    }

    /// Settles the bomb search up to now before any new Security office
    /// joins it, so guards already out move on from the minutes they
    /// finished, and an office opening late in a long step cannot take a
    /// floor they reached first (or join a search that already ended).
    /// A Security office that opens inside the step joins at the minute it
    /// opened (Modern), after the search has run up to that minute, so a
    /// long step plays out as shorter ones would. The clock is set back to
    /// each opening only for that catch-up, then restored.
    pub(crate) fn finish_construction_and_search(&mut self) {
        if self.events.bomb.is_some() && self.mode.security_joins_bomb_search() {
            let now = self.clock.minutes;
            for at in self.security_openings_by(now) {
                self.clock.minutes = at;
                self.advance_bomb_search();
                self.finish_construction();
                self.clock.minutes = now;
                if self.events.bomb.is_none() {
                    break;
                }
            }
        }
        self.advance_bomb_search();
        self.finish_construction();
    }

    /// The minutes at which Security offices still under construction open
    /// by `now`, earliest first. Empty when nothing is being built.
    fn security_openings_by(&self, now: f64) -> Vec<f64> {
        let mut at: Vec<f64> = self
            .constructing
            .iter()
            .filter_map(|id| self.tower.get_unit(*id))
            .filter(|u| u.kind == Kind::Security && u.state == UnitState::Construction)
            .filter_map(|u| u.extras().complete_at)
            .filter(|t| *t <= now)
            .collect();
        at.sort_by(f64::total_cmp);
        at
    }

    #[doc(hidden)]
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
            // `minutes >= (u.completeAt ?? 0)`: a non-numeric value the save
            // carried goes through `Number()`, so NaN never completes.
            let threshold = match (u.extras().complete_at, &u.extras().complete_at_raw) {
                (Some(v), _) => v,
                (None, Some(raw)) => crate::load::js_number(Some(raw)),
                (None, None) => 0.0,
            };
            if self.clock.minutes >= threshold {
                let (name, floor, x, kind) = (u.kind.facility().name, u.floor, u.x, u.kind);
                let mode = self.tower.mode;
                let (u, at) = self.tower.marked_by_id(id).unwrap();
                u.set_state(at, UnitState::Empty);
                u.extras_mut().complete_at = None;
                u.extras_mut().complete_at_raw = None;
                let full_house = kind == Kind::Cinema && fills_blockbuster_slot(mode, u);
                self.constructing.shift_remove(&id);
                let msg = format!(
                    "{} on {} is now open for business.",
                    name,
                    self.floor_label(floor)
                );
                self.emit(&msg, LogKind::Good);
                if kind == Kind::Security {
                    self.join_bomb_search(floor, x);
                }
                // A theater opens with its mode's first film free: a Classic
                // new film fills the house tonight (#1932), so it is a
                // blockbuster from its first evening rather than from the
                // next rollover. A Modern theater opens with a feature.
                if full_house && !self.blockbusters.contains(&(id as f64)) {
                    self.blockbusters.push(id as f64);
                }
            }
        }
    }

    #[doc(hidden)]
    /// `floorLabel`: "floor N" above ground, "B{n}" below.
    pub fn floor_label(&self, floor: i64) -> String {
        if floor >= 1 {
            format!("floor {floor}")
        } else {
            format!("B{}", 1 - floor)
        }
    }
}
