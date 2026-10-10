//! Port of `src/engine/sim/build.ts`: the money-aware build, transport build
//! and sell paths.

use crate::clock::GameMode;
use crate::facilities::*;
use crate::sim::{LogKind, Simulation};
use crate::tower::UnitState;

pub struct BuildResult {
    pub ok: bool,
    pub reason: Option<String>,
}

impl BuildResult {
    fn fail(reason: impl Into<String>) -> BuildResult {
        BuildResult {
            ok: false,
            reason: Some(reason.into()),
        }
    }
}

pub struct CanBuild {
    pub ok: bool,
    pub reason: Option<String>,
    pub cost: f64,
}

fn substrate_cost(kind: Kind) -> f64 {
    if kind == Kind::Lobby {
        5000.0
    } else {
        500.0
    }
}

impl Simulation {
    /// `toggleAutoBridge()`: Modern flips the bridging preference, Classic
    /// always bridges and never flips (`rules.bridgingToggleable()`).
    pub fn toggle_auto_bridge(&mut self) -> bool {
        if self.mode.bridging_toggleable() {
            self.auto_bridge = !self.auto_bridge;
        }
        self.auto_bridge
    }

    pub fn is_unlocked(&self, kind: Kind) -> bool {
        let f = kind.facility();
        if f.modern_only && self.mode != GameMode::Modern {
            return false;
        }
        self.star >= f.min_star
    }

    pub fn can_build(&self, kind: Kind, floor: i64, x: i64) -> CanBuild {
        let kind = ground_floor_structure_kind(kind, floor);
        let f = kind.facility();
        if !self.is_unlocked(kind) {
            let reason = if f.modern_only && self.mode != GameMode::Modern {
                format!("{} is a Modern-only facility.", f.name)
            } else {
                format!("{} unlocks at {}★.", f.name, f.min_star)
            };
            return CanBuild {
                ok: false,
                reason: Some(reason),
                cost: f.cost,
            };
        }
        let money_check = |cost: f64| CanBuild {
            ok: self.money >= cost,
            reason: if self.money >= cost {
                None
            } else {
                Some("Not enough money.".into())
            },
            cost,
        };
        // `!isRoomKind(kind)`: floor, lobby and every transport kind take the
        // structural branch, where `canPlace` refuses a transport by name.
        if !kind.is_room() {
            if !self.auto_bridge {
                let c = self.tower.can_place(kind, floor, x);
                if !c.ok {
                    return CanBuild {
                        ok: false,
                        reason: c.reason,
                        cost: f.cost,
                    };
                }
                return money_check(f.cost);
            }
            let bridge = self.tower.bridge_fill_plan(kind, floor, x, 1, 1).len() as f64;
            let c = self.tower.can_place(kind, floor, x);
            if !c.ok {
                let horizontal = if kind == Kind::Lobby {
                    floor == 1
                } else {
                    floor < 2
                };
                let rescued = horizontal
                    && bridge > 0.0
                    && self
                        .tower
                        .can_place_structure_ignoring_support(kind, floor, x)
                        .ok;
                if !rescued {
                    return CanBuild {
                        ok: false,
                        reason: c.reason,
                        cost: f.cost,
                    };
                }
            }
            return money_check(f.cost + bridge * substrate_cost(kind));
        }
        let pre = self.tower.can_place_room_ignoring_floor(kind, floor, x);
        if !pre.ok {
            return CanBuild {
                ok: false,
                reason: pre.reason,
                cost: f.cost,
            };
        }
        let hgt = kind.floors();
        let missing = self.tower.missing_floor_count(floor, x, f.width, hgt);
        if missing > 0 && !self.tower.span_connects(floor, x, f.width, hgt) {
            let reason = if floor >= 2 {
                "Rooms must sit on the floor below: no floating overhangs."
            } else {
                "Build next to the tower. You can't build in midair."
            };
            return CanBuild {
                ok: false,
                reason: Some(reason.into()),
                cost: f.cost,
            };
        }
        let bridge = if self.auto_bridge {
            self.tower
                .bridge_fill_plan(kind, floor, x, f.width, hgt)
                .len() as i64
        } else {
            0
        };
        money_check(f.cost + ((missing + bridge) as f64) * 500.0)
    }

    pub fn build(&mut self, kind: Kind, floor: i64, x: i64) -> BuildResult {
        let kind = ground_floor_structure_kind(kind, floor);
        let can = self.can_build(kind, floor, x);
        if !can.ok {
            return BuildResult {
                ok: false,
                reason: can.reason,
            };
        }
        let f = kind.facility();
        let hgt = kind.floors();
        let quoted_bridge = if self.auto_bridge {
            self.tower
                .bridge_fill_plan(kind, floor, x, f.width, hgt)
                .len() as f64
        } else {
            0.0
        };
        if kind.is_room() {
            if let Err(reason) = self.tower.ensure_floor_under(floor, x, f.width, hgt) {
                return BuildResult::fail(reason);
            }
        }
        let laid_bridge = if self.auto_bridge {
            self.tower.fill_bridge(kind, floor, x, f.width, hgt)
        } else {
            Vec::new()
        };
        let res = self.tower.place(kind, floor, x);
        if !res.ok {
            for id in laid_bridge {
                self.tower.remove_unit(id);
            }
            return BuildResult {
                ok: false,
                reason: res.reason,
            };
        }
        self.money -= can.cost - (quoted_bridge - laid_bridge.len() as f64) * substrate_cost(kind);
        if let Some(id) = res.unit_id {
            if let Some(list) = kind.subtype_list() {
                let name = *self.rng.pick(list);
                self.tower.get_unit_mut(id).unwrap().subtype = Some(name);
            }
            if self.mode == GameMode::Classic {
                if let Some(ladder) = crate::econ::classic_ladder(kind) {
                    let cfg = crate::econ::rent_config(kind).unwrap();
                    let v = ladder[2];
                    self.tower.get_unit_mut(id).unwrap().rent =
                        if v == cfg.default { None } else { Some(v) };
                }
            }
            let dur = kind.build_minutes();
            if dur > 0.0 {
                let u = self.tower.get_unit_mut(id).unwrap();
                u.state = UnitState::Construction;
                u.complete_at = Some(self.clock.minutes + dur);
                self.constructing.insert(id);
            }
            if kind == Kind::WeddingHall {
                self.emit(
                    "Wedding Hall built! A VIP will inspect your tower soon.",
                    LogKind::Good,
                );
                self.vip_visit_day = (self.clock.day() + 3) as f64;
            }
            if floor <= 0 && kind.is_room() {
                let mut fresh = false;
                for fl in floor..floor + hgt {
                    for i in 0..f.width {
                        let key = format!("{fl}:{}", x + i);
                        if !self.excavated.contains(&key) {
                            fresh = true;
                            self.excavated.push(key);
                        }
                    }
                }
                if fresh && self.treasures_found < 3.0 && self.rng.chance(0.18) {
                    self.treasures_found += 1.0;
                    let gold = 400_000.0 + self.rng.int(0, 200_000) as f64;
                    self.money += gold;
                    self.emit(
                        &format!(
                            "💰 Excavation crews unearthed buried treasure worth ${}!",
                            gold
                        ),
                        LogKind::Money,
                    );
                    // `triggerTreasure(floor, x + Math.floor(f.width / 2))`.
                    self.fx.treasure = crate::sim::PointFx {
                        floor,
                        x: (x + f.width.div_euclid(2)) as f64,
                        seq: self.fx.treasure.seq + 1,
                    };
                }
            }
        }
        BuildResult {
            ok: true,
            reason: None,
        }
    }

    pub fn build_transport(&mut self, kind: Kind, x: i64, bottom: i64, top: i64) -> BuildResult {
        let f = kind.facility();
        if !self.is_unlocked(kind) {
            return BuildResult::fail(format!("{} unlocks at {}★.", f.name, f.min_star));
        }
        let total = crate::econ::transport_build_cost(kind, top - bottom);
        if self.money < total {
            return BuildResult::fail("Not enough money.");
        }
        let res = self.tower.place_transport(kind, x, bottom, top);
        if !res.ok {
            return BuildResult {
                ok: false,
                reason: res.reason,
            };
        }
        self.money -= total;
        BuildResult {
            ok: true,
            reason: None,
        }
    }

    pub fn sell_at(&mut self, floor: i64, x: i64) -> bool {
        let t = self.tower.transport_at(floor, x).map(|t| (t.id, t.kind));
        let u = self
            .tower
            .unit_at(floor, x)
            .map(|u| (u.id, u.kind, u.state));
        if let Some((id, kind, state)) = u {
            if !kind.is_structural() {
                if state == UnitState::Fire {
                    return false;
                }
                self.tower.remove_unit(id);
                self.money += if state == UnitState::Gutted {
                    crate::econ::GUTTED_RESALE_REFUND
                } else {
                    kind.resale_refund()
                };
                if kind == Kind::WeddingHall
                    && self.tower.built_wedding_hall != Some(true)
                    && self.evaluated_tower != Some(true)
                {
                    self.vip_visit_day = -1.0;
                }
                return true;
            }
        }
        if let Some((id, kind)) = t {
            self.tower.remove_transport(id);
            self.money += kind.resale_refund();
            return true;
        }
        if let Some((id, kind, _)) = u {
            if self.tower.removal_reason(id).is_some() {
                return false;
            }
            self.tower.remove_unit(id);
            self.money += kind.resale_refund();
            return true;
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use crate::clock::GameMode;
    use crate::facilities::Kind;
    use crate::sim::Simulation;

    /// `canBuild` sends every kind that is not a room down the structural
    /// branch, where a transport is refused by name, as the TypeScript does.
    #[test]
    fn can_build_refuses_a_transport_kind_by_name() {
        let sim = Simulation::new_game(1, GameMode::Classic);
        let c = sim.can_build(Kind::ElevatorStandard, 1, 180);
        assert!(!c.ok);
        assert_eq!(
            c.reason.as_deref(),
            Some("Use placeTransport for vertical transport.")
        );
        assert_eq!(c.cost, Kind::ElevatorStandard.facility().cost);
    }
}
