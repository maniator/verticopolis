//! Port of `sim/star.ts` and `milestones.ts`.

use crate::facilities::Kind;
use crate::gameplay::GameplayEvent;
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
            let from = self.star;
            self.star = target;
            self.emit(
                &format!("Congratulations! Your tower reached {} stars.", self.star),
                LogKind::Good,
            );
            self.note_stars(from);
        }
    }

    /// `star_reached` for every rung between `from` and the current star.
    pub fn note_stars(&mut self, from: i64) {
        for star in from + 1..=self.star {
            self.gameplay.push(GameplayEvent::StarReached { star });
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
    pub(crate) fn milestone_tests(&self) -> [(&'static str, &'static str, bool); 11] {
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
            self.gameplay.push(GameplayEvent::MilestoneReached { id });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::GameMode;

    /// The four-star gates of `cumulativeStarGates`: Security (the three-star
    /// gate, carried up), Medical, recycling demand met, two operational
    /// suites, a favorable VIP review, and Metro for five. No fixture has the
    /// 5,000 residents a four-star rung needs, so each gate is pinned here on
    /// a scripted tower: the full set is built and met, then every gate is
    /// knocked out on its own and must fail by itself.
    #[test]
    fn four_star_gates_each_pinned() {
        let mut sim = Simulation::new_game(7, GameMode::Modern);
        sim.money = 1.0e9;
        sim.star = 3;
        for x in 150..230 {
            assert!(sim.build(Kind::Lobby, 1, x).ok);
        }
        for fl in 2..=3 {
            for x in 151..229 {
                assert!(sim.build(Kind::Floor, fl, x).ok, "floor {fl},{x}");
            }
        }
        assert!(sim.build_transport(Kind::ElevatorStandard, 151, 1, 3).ok);
        let settle = |sim: &mut Simulation| {
            for _ in 0..(3 * 24) {
                sim.tick(60.0);
            }
        };
        // Without Security even the three-star rung fails.
        assert!(!sim.cumulative_gates_met(3));
        assert!(sim.build(Kind::Security, 2, 160).ok, "security");
        assert!(sim.build(Kind::Medical, 2, 170).ok, "medical");
        assert!(sim.build(Kind::HotelSuite, 3, 160).ok, "suite 1");
        assert!(sim.build(Kind::HotelSuite, 3, 172).ok, "suite 2");
        sim.vip_favorable = true;
        settle(&mut sim);
        assert!(sim.cumulative_gates_met(3));
        assert_eq!(sim.count_operational(Kind::HotelSuite), 2);
        // A tiny tower has no recycling demand, so that gate is met already.
        assert!(sim.recycling_demand_met());
        assert!(sim.cumulative_gates_met(4), "every four-star gate met");
        assert!(!sim.cumulative_gates_met(5), "Metro missing");

        // The VIP gate alone.
        sim.vip_favorable = false;
        assert!(!sim.cumulative_gates_met(4), "VIP review missing");
        sim.vip_favorable = true;
        assert!(sim.cumulative_gates_met(4));

        // One suite alone.
        assert!(sim.sell_at(3, 172), "sell suite 2");
        assert!(!sim.cumulative_gates_met(4), "second suite missing");
        assert!(sim.build(Kind::HotelSuite, 3, 172).ok, "suite 2 again");
        settle(&mut sim);
        assert!(sim.cumulative_gates_met(4));

        // Medical alone.
        assert!(sim.sell_at(2, 170), "sell medical");
        assert!(!sim.cumulative_gates_met(4), "Medical missing");
        assert!(
            sim.cumulative_gates_met(3),
            "Security still carries the three-star rung"
        );
    }
}
