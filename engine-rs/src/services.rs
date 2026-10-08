//! Port of `sim/services.ts`: recycling, parking, advisories, extermination.

use crate::demand::RECYCLING_POP_PER_CENTER;
use crate::facilities::Kind;
use crate::sim::{LogKind, Simulation};
use crate::star::is_tenant_floor_unit;
use crate::tower::{Unit, UnitState};

pub const PARKING_WORKERS_PER_SPACE: f64 = 24.0;
pub const METRO_PLATFORM_CUTOFF_MSG: &str = "Your metro platform is cut off. Build a passenger elevator, stairs, or an escalator down to the platform so commuters can reach the station.";

pub struct ParkingDemand {
    pub office_pop: f64,
    pub offices: f64,
    pub suites: f64,
    pub total: f64,
}

impl Simulation {
    pub fn recycling_centers(&self) -> i64 {
        self.count_operational(Kind::Recycling)
    }

    pub fn recycling_capacity(&self) -> f64 {
        self.recycling_centers() as f64 * RECYCLING_POP_PER_CENTER
    }

    pub fn recycling_demand_met(&self) -> bool {
        self.tower.total_population() as f64 <= self.recycling_capacity()
    }

    pub fn parking_demand(&self) -> ParkingDemand {
        if self.star < Kind::Parking.facility().min_star {
            return ParkingDemand {
                office_pop: 0.0,
                offices: 0.0,
                suites: 0.0,
                total: 0.0,
            };
        }
        let mut office_pop = 0.0;
        let mut suites = 0.0;
        for u in self.tower.room_units() {
            if u.kind == Kind::Office && u.is_tenanted() {
                office_pop += Kind::Office.facility().population as f64;
            } else if u.kind == Kind::HotelSuite && u.is_operational() {
                suites += 1.0;
            }
        }
        let offices = (office_pop / PARKING_WORKERS_PER_SPACE).ceil();
        ParkingDemand {
            office_pop,
            offices,
            suites,
            total: offices + suites,
        }
    }

    pub fn suite_parking_short(&self) -> bool {
        let d = self.parking_demand();
        d.suites > 0.0 && (self.tower.functional_parking_spots() as f64) < d.suites
    }

    pub fn office_parking_short(&self) -> bool {
        if self.star < Kind::Parking.facility().min_star {
            return false;
        }
        let d = self.parking_demand();
        let for_offices = (self.tower.functional_parking_spots() as f64 - d.suites).max(0.0);
        for_offices * PARKING_WORKERS_PER_SPACE < d.office_pop
    }

    pub fn nudge_service_shortfalls(&mut self) {
        let waste_short = self.star >= 3 && !self.recycling_demand_met();
        if waste_short && !self.waste_nudged {
            let pop = self.tower.total_population();
            let need = (pop as f64 / RECYCLING_POP_PER_CENTER).ceil();
            let msg = format!(
                "♻️ Garbage is piling up: {} population needs {} Recycling Center(s) (you have {}). 4★ requires demand met.",
                pop,
                need,
                self.recycling_centers()
            );
            self.emit(&msg, LogKind::Info);
        }
        self.waste_nudged = waste_short;
        let suite_short = self.star >= 3 && self.suite_parking_short();
        if suite_short && !self.suite_parking_nudged {
            let d = self.parking_demand();
            let msg = format!(
                "🚗 Hotel suites need a working parking space each: {} suite(s), {} space(s) chained to a ramp.",
                d.suites,
                self.tower.functional_parking_spots()
            );
            self.emit(&msg, LogKind::Info);
        }
        self.suite_parking_nudged = suite_short;
    }

    pub fn nudge_stranded(&mut self) {
        let stranded = !self.stranded_floors(true).is_empty();
        if stranded && !self.stranded_nudged {
            self.emit(
                "A floor with tenant space is reachable only by a long stair climb no one will make. Nobody will move in or visit. Add an elevator that reaches it, then check it in the inspector.",
                LogKind::Info,
            );
        }
        self.stranded_nudged = stranded;
    }

    pub fn nudge_metro_platform(&mut self) {
        let orphaned = self.tower.units.iter().any(|u| {
            u.kind == Kind::Metro && u.is_operational() && !self.tower.is_metro_platform_served(u)
        });
        if orphaned && !self.metro_platform_nudged {
            self.emit(METRO_PLATFORM_CUTOFF_MSG, LogKind::Info);
        }
        self.metro_platform_nudged = orphaned;
    }

    fn is_stranded_candidate(u: &Unit, rentable: bool) -> bool {
        if is_tenant_floor_unit(u) {
            return true;
        }
        if !rentable {
            return false;
        }
        u.floor >= 2
            && u.is_operational()
            && (u.kind.facility().population > 0 || u.kind.is_hotel())
    }

    /// `strandedFloors(scope)`: sorted ascending.
    pub fn stranded_floors(&mut self, rentable: bool) -> Vec<i64> {
        let mut candidates: indexmap::IndexSet<i64> = indexmap::IndexSet::new();
        for u in &self.tower.units {
            if !Self::is_stranded_candidate(u, rentable) {
                continue;
            }
            if !self.tower.is_floor_served(u.floor) {
                continue;
            }
            candidates.insert(u.floor);
        }
        let mut out: Vec<i64> = Vec::new();
        for floor in candidates {
            if !self.floor_reachable(floor) {
                out.push(floor);
            }
        }
        out.sort();
        out
    }

    /// `resolveExtermination`.
    pub fn resolve_extermination(&mut self) {
        let Some(due) = self.extermination_due_day else {
            return;
        };
        if (self.clock.day() as f64) < due {
            return;
        }
        self.extermination_due_day = None;
        let billed = self.extermination_room_ids.take();
        let mut cleared = 0;
        for u in self.tower.units.iter_mut() {
            if !u.kind.is_hotel() || u.state != UnitState::Infested {
                continue;
            }
            if let Some(b) = &billed {
                if !b.contains(&u.id) {
                    continue;
                }
            }
            u.state = UnitState::Empty;
            u.satisfaction = 1.0;
            u.occupants = 0;
            u.dirty_days = None;
            cleared += 1;
        }
        if cleared > 0 {
            self.emit(
                &format!("🧹 The exterminator cleared {cleared} infested room(s). They can be rented again."),
                LogKind::Good,
            );
        }
    }

    /// `maybeVipStay`.
    pub fn maybe_vip_stay(&mut self) {
        if self.vip_favorable || self.star < 3 {
            return;
        }
        let suites: Vec<f64> = self
            .tower
            .units
            .iter()
            .filter(|u| {
                u.kind == Kind::HotelSuite
                    && u.state == UnitState::Asleep
                    && self.tower.is_floor_served(u.floor)
            })
            .map(|u| u.satisfaction)
            .collect();
        if suites.is_empty() {
            return;
        }
        let happy = suites.iter().any(|&s| s >= 0.7);
        if happy && !self.suite_parking_short() {
            self.vip_favorable = true;
            self.vip_visits += 1;
            self.emit(
                "A VIP enjoyed their suite. Your tower earned a favorable review (4★ unlocked).",
                LogKind::Good,
            );
        } else if self.clock.day().saturating_sub(self.last_vip_nag_day) >= 5 {
            self.last_vip_nag_day = self.clock.day();
            self.vip_visits += 1;
            let msg = if happy {
                "🚗 The VIP circled the block and left. Every hotel suite needs a working parking space (chained to a ramp)."
            } else {
                "A VIP's suite stay was underwhelming. Improve suite access and try again."
            };
            self.emit(msg, LogKind::Info);
        }
    }

    /// `checkVip`.
    pub fn check_vip(&mut self) {
        if self.evaluated_tower == Some(true) || self.vip_visit_day < 0 {
            return;
        }
        if self.tower.built_wedding_hall != Some(true) {
            self.vip_visit_day = -1;
            return;
        }
        if self.clock.day() < self.vip_visit_day {
            return;
        }
        self.vip_visit_day = -1;
        self.vip_visits += 1;
        let pop = self.rating_population();
        let ok = self.has_operational(Kind::WeddingHall)
            && self.star >= 5
            && self.has_operational(Kind::Metro)
            && pop >= crate::star::TOWER_POPULATION;
        if ok {
            self.star = 6;
            self.evaluated_tower = Some(true);
            self.emit(
                "The VIP was impressed! Your building is now a TOWER. You win!",
                LogKind::Good,
            );
        } else {
            self.emit("The VIP was unimpressed. Grow your population and amenities, then rebuild interest.", LogKind::Bad);
            self.vip_visit_day = self.clock.day() + 5;
        }
    }
}
