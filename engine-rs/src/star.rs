//! Port of `sim/star.ts` and `milestones.ts`.

use crate::facilities::Kind;
use crate::sim::{LogKind, Simulation};
use crate::tower::{Unit, UnitState};

pub const STAR_THRESHOLDS: [i64; 6] = [0, 0, 300, 1000, 5000, 10000];
pub const TOWER_POPULATION: i64 = 15000;

/// `isTenantFloorUnit`.
pub fn is_tenant_floor_unit(u: &Unit) -> bool {
    u.floor >= 2
        && (u.is_tenanted() || u.state == UnitState::Asleep)
        && u.kind.facility().population > 0
}

impl Simulation {
    /// `occupantPopulation`.
    pub fn occupant_population(&self) -> i64 {
        let mut pop = 0;
        for u in self.tower.room_units() {
            if u.is_present() && !u.kind.is_hotel() {
                pop += u.census_count();
                if u.kind.is_commercial() && u.kind.facility().population > 0 {
                    pop -= u
                        .hotel_customers_in
                        .unwrap_or(0)
                        .min(u.customers_in.unwrap_or(0));
                }
            }
        }
        pop
    }

    /// `ratingPopulation`.
    pub fn rating_population(&self) -> i64 {
        if self.star < 4 {
            self.tower.total_population()
        } else {
            self.occupant_population()
        }
    }

    /// `cumulativeStarGates(rung)`: every gate's met flag.
    fn cumulative_gates_met(&self, rung: i64) -> bool {
        if rung >= 3 && !self.has_operational(Kind::Security) {
            return false;
        }
        if rung >= 4 {
            if !self.has_operational(Kind::Medical) {
                return false;
            }
            if !self.recycling_demand_met() {
                return false;
            }
            if self.count_operational(Kind::HotelSuite) < 2 {
                return false;
            }
            if !self.vip_favorable {
                return false;
            }
        }
        if rung >= 5 && !self.has_operational(Kind::Metro) {
            return false;
        }
        true
    }

    /// `evaluateStar`.
    pub fn evaluate_star(&mut self) {
        if self.star >= 6 {
            return;
        }
        let pop_with_hotels = self.tower.total_population();
        let pop_occupants_only = self.occupant_population();
        let mut target = self.star;
        for s in (1..=5).rev() {
            let pop = if s >= 5 {
                pop_occupants_only
            } else {
                pop_with_hotels
            };
            if pop >= STAR_THRESHOLDS[s as usize] {
                target = s;
                break;
            }
        }
        while target >= 3 && !self.cumulative_gates_met(target) {
            target -= 1;
        }
        if target > self.star {
            self.star = target;
            self.emit(
                &format!("Congratulations! Your tower reached {} stars.", self.star),
                LogKind::Good,
            );
        }
    }

    pub fn highest_floor(&self) -> i64 {
        self.tower.units.iter().map(|u| u.floor).fold(1, i64::max)
    }

    pub fn lowest_floor(&self) -> i64 {
        self.tower.units.iter().map(|u| u.floor).fold(1, i64::min)
    }

    fn every_occupied_floor_served(&self) -> bool {
        let mut saw_one = false;
        for u in &self.tower.units {
            if !is_tenant_floor_unit(u) {
                continue;
            }
            saw_one = true;
            if !self.tower.is_floor_served(u.floor) {
                return false;
            }
        }
        saw_one
    }

    fn no_leasable_vacancy(&self) -> bool {
        !self.tower.units.iter().any(|u| {
            u.state == UnitState::Empty
                && (u.kind == Kind::Office || u.kind == Kind::Condo || u.kind.is_hotel())
        })
    }

    /// The MILESTONES table, in order, with each test's verdict.
    fn milestone_tests(&self) -> [(&'static str, &'static str, bool); 11] {
        let pop = self.population();
        [
            ("pop-500", "Getting Started", pop >= 500),
            ("pop-2500", "Rising", pop >= 2500),
            ("pop-7500", "Metropolis", pop >= 7500),
            ("pop-12000", "Almost There", pop >= 12000),
            ("star-4", "Four Stars", self.star >= 4),
            ("star-5", "Five Stars", self.star >= 5),
            ("cinema", "Showtime", self.has_operational(Kind::Cinema)),
            ("metro", "On the Map", self.has_operational(Kind::Metro)),
            ("skyline", "Touch the Sky", self.highest_floor() >= 100),
            (
                "well-served",
                "Smooth Operator",
                pop >= 5000 && self.every_occupied_floor_served(),
            ),
            (
                "full-house",
                "No Vacancy",
                pop >= 2000 && self.no_leasable_vacancy(),
            ),
        ]
    }

    /// Silently adopt every milestone already satisfied (the load path).
    pub fn adopt_milestones(&mut self) {
        for (id, _, ok) in self.milestone_tests() {
            if ok && !self.milestones.iter().any(|m| m == id) {
                self.milestones.push(id.to_string());
            }
        }
    }

    /// `checkMilestones`: the MILESTONES table in order.
    pub fn check_milestones(&mut self) {
        let tests = self.milestone_tests();
        for (id, label, ok) in tests {
            if self.milestones.iter().any(|m| m == id) {
                continue;
            }
            if !ok {
                continue;
            }
            self.milestones.push(id.to_string());
            self.emit(&format!("🏅 Milestone: {label}"), LogKind::Good);
        }
    }
}
