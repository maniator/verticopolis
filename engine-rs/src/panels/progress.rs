//! The star ladder and the milestone checklist as the stats screen reads them
//! (`nextStarThreshold`, `nextStarRequirements`, `milestoneProgress` in
//! `src/engine/sim/star.ts`). Gates and milestones come back as stable ids
//! with a verdict; the labels and descriptions stay in TypeScript.

use serde_json::{json, Value};

use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::star::{STAR_THRESHOLDS, TOWER_POPULATION};

/// The milestone ids in table order (`MILESTONES` in `src/engine/milestones.ts`).
/// `milestone_progress` reads the saved set against this list, so it does not
/// evaluate the eleven tests (`Simulation::milestone_tests`); a test keeps the
/// two tables equal.
pub const MILESTONE_IDS: [&str; 11] = [
    "pop-500",
    "pop-2500",
    "pop-7500",
    "pop-12000",
    "star-4",
    "star-5",
    "cinema",
    "metro",
    "skyline",
    "well-served",
    "full-house",
];

/// One rung's progress (`NextStarView`): the population bar and the
/// facility gates by id, in ladder order.
#[derive(Debug, Clone, PartialEq)]
pub struct NextStar {
    pub star: i64,
    pub is_tower: bool,
    pub pop_have: i64,
    pub pop_need: i64,
    pub pop_met: bool,
    pub gates: Vec<(&'static str, bool)>,
    pub all_met: bool,
}

impl Simulation {
    /// `nextStarThreshold`: the population the next rung needs, `None` from
    /// 5 stars up.
    pub fn next_star_threshold(&self) -> Option<i64> {
        if self.star >= 5 {
            return None;
        }
        STAR_THRESHOLDS.get((self.star + 1) as usize).copied()
    }

    /// `cumulativeStarGates(rung)`: the facility gates up to `rung`, in ladder
    /// order, as `(id, met)`. Empty below 3 stars; a rung above 5 reads as 5.
    pub fn cumulative_star_gates(&self, rung: i64) -> Vec<(&'static str, bool)> {
        let mut gates = Vec::new();
        if rung >= 3 {
            gates.push((
                "security",
                self.count_operational(Kind::Security)
                    >= crate::star::SECURITY_OFFICES_FOR_THREE_STARS,
            ));
        }
        if rung >= 4 {
            gates.push(("medical", self.has_operational(Kind::Medical)));
            gates.push(("recycling", self.recycling_demand_met()));
            gates.push(("suites", self.count_operational(Kind::HotelSuite) >= 2));
            gates.push(("vip", self.vip_favorable));
        }
        if rung >= 5 {
            gates.push(("metro", self.has_operational(Kind::Metro)));
        }
        gates
    }

    /// `nextStarRequirements` as typed fields, or `None` once the tower is a
    /// TOWER. The TOWER rung asks for the Wedding Hall and the metro instead
    /// of the cumulative ladder.
    pub fn next_star(&self) -> Option<NextStar> {
        if self.star >= 6 {
            return None;
        }
        let star = self.star + 1;
        let is_tower = star == 6;
        let pop_have = if star >= 5 {
            self.occupant_population()
        } else {
            self.tower.total_population()
        };
        let pop_need = if is_tower {
            TOWER_POPULATION
        } else {
            STAR_THRESHOLDS.get(star as usize).copied().unwrap_or(0)
        };
        let pop_met = pop_have >= pop_need;
        let gates = if is_tower {
            vec![
                ("weddingHall", self.has_operational(Kind::WeddingHall)),
                ("metro", self.has_operational(Kind::Metro)),
            ]
        } else {
            self.cumulative_star_gates(star)
        };
        let all_met = pop_met && gates.iter().all(|(_, met)| *met);
        Some(NextStar {
            star,
            is_tower,
            pop_have,
            pop_need,
            pop_met,
            gates,
            all_met,
        })
    }

    /// `nextStarRequirements`: the checklist toward the next rung, or `null`
    /// once the tower is a TOWER.
    pub fn next_star_requirements(&self) -> Value {
        let Some(n) = self.next_star() else {
            return Value::Null;
        };
        json!({
            "star": n.star,
            "isTower": n.is_tower,
            "popHave": n.pop_have,
            "popNeed": n.pop_need,
            "popMet": n.pop_met,
            "gates": n.gates.iter().map(|(id, met)| json!({ "id": id, "met": met })).collect::<Vec<_>>(),
            "allMet": n.all_met,
        })
    }

    /// `milestoneProgress`: the milestones in table order with whether each is
    /// achieved (the saved set, not today's test).
    pub fn milestone_progress(&self) -> Value {
        let list: Vec<Value> = MILESTONE_IDS
            .iter()
            .map(|id| json!({ "id": id, "done": self.milestones.iter().any(|m| m == id) }))
            .collect();
        let achieved = list.iter().filter(|m| m["done"] == true).count();
        json!({ "achieved": achieved, "total": list.len(), "list": list })
    }
}
