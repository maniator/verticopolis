//! Port of `src/engine/sim/build.ts`: the money-aware build, transport build
//! and sell paths.

use crate::clock::GameMode;
use crate::facilities::*;
use crate::gameplay::{GameplayEvent, RemovalMethod};
use crate::sim::{LogKind, Simulation};
use crate::tower::{ResizeResult, UnitState};

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

/// The price of one bridged or laid substrate tile: a lobby tile when the
/// placement is a lobby, a floor tile otherwise. Read from the facility table,
/// the same prices the catalog quotes.
fn substrate_cost(kind: Kind) -> f64 {
    if kind == Kind::Lobby {
        Kind::Lobby.facility().cost
    } else {
        Kind::Floor.facility().cost
    }
}

/// The buried-treasure line (`sim/build.ts`).
pub(crate) fn treasure_message(gold: f64) -> String {
    format!(
        "💰 Excavation crews unearthed buried treasure worth ${}!",
        crate::services::with_thousands(gold)
    )
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
        money_check(f.cost + ((missing + bridge) as f64) * Kind::Floor.facility().cost)
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
                self.tower.set_unit_subtype(id, Some(name));
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
                let (u, at) = self.tower.marked_by_id(id).unwrap();
                u.set_state(at, UnitState::Construction);
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
                    self.emit(&treasure_message(gold), LogKind::Money);
                    // `triggerTreasure(floor, x + Math.floor(f.width / 2))`.
                    self.fx.treasure = crate::sim::PointFx {
                        floor,
                        x: (x + f.width.div_euclid(2)) as f64,
                        seq: self.fx.treasure.seq + 1,
                    };
                }
            }
        }
        self.gameplay.push(GameplayEvent::FacilityPlaced {
            kind,
            floor: floor + hgt - 1,
            count: 1,
        });
        BuildResult {
            ok: true,
            reason: None,
        }
    }

    /// The dry run `build_transport` makes first: whether a shaft of `kind`
    /// at `x` spanning `bottom..=top` would be placed, and its full price.
    /// An elevator costs the catalog `cost` plus `transportFloorCost` for
    /// each floor past its first; stairs and escalators cost the catalog
    /// `cost`. Refusals come in `build_transport`'s order (locked, then money,
    /// then placement) with its reasons, and every answer carries the price
    /// `build_transport` checks the balance against. That price is the
    /// shaft's only for a transport kind with `top` above `bottom`: an
    /// inverted span prices below the base, and a room kind at its own
    /// price, and both are refused by the placement rules (as the
    /// TypeScript `buildTransport` refuses them, after the same money check).
    pub fn can_build_transport(&self, kind: Kind, x: i64, bottom: i64, top: i64) -> CanBuild {
        let f = kind.facility();
        // Saturating, as are the placement checks, so an out-of-range span
        // from a native host prices without overflowing: an elevator's price
        // then outruns any ordinary balance, so the money check refuses it
        // (failing that, the span rule does), and a fixed-price shaft reaches
        // the placement rules. Any span the tower can hold is exact.
        let span = top.saturating_sub(bottom);
        let extra = if kind.is_elevator() {
            span as f64 * crate::charges::TRANSPORT_FLOOR_COST
        } else {
            0.0
        };
        let cost = f.cost + extra;
        let refuse = |reason: String| CanBuild {
            ok: false,
            reason: Some(reason),
            cost,
        };
        if !self.is_unlocked(kind) {
            return refuse(format!("{} unlocks at {}★.", f.name, f.min_star));
        }
        if self.money < cost {
            return refuse("Not enough money.".into());
        }
        let v = self.tower.validate_transport(kind, x, bottom, top);
        if !v.ok {
            return CanBuild {
                ok: false,
                reason: v.reason,
                cost,
            };
        }
        CanBuild {
            ok: true,
            reason: None,
            cost,
        }
    }

    pub fn build_transport(&mut self, kind: Kind, x: i64, bottom: i64, top: i64) -> BuildResult {
        let quote = self.can_build_transport(kind, x, bottom, top);
        if !quote.ok {
            return BuildResult {
                ok: false,
                reason: quote.reason,
            };
        }
        let res = self.tower.place_transport(kind, x, bottom, top);
        if !res.ok {
            return BuildResult {
                ok: false,
                reason: res.reason,
            };
        }
        self.money -= quote.cost;
        self.gameplay.push(GameplayEvent::FacilityPlaced {
            kind,
            floor: top,
            count: 1,
        });
        BuildResult {
            ok: true,
            reason: None,
        }
    }

    /// `sellAt(floor, x)`: sell whatever stands at a tile, a room before
    /// the shaft or floor beneath it, then the shaft, then the floor tile.
    /// The refund and the refusals are `remove_facility`'s.
    pub fn sell_at(&mut self, floor: i64, x: i64) -> bool {
        let t = self.tower.transport_at(floor, x).map(|t| t.id);
        let u = self.tower.unit_at(floor, x).map(|u| (u.id, u.kind));
        let id = match (u, t) {
            (Some((id, kind)), _) if !kind.is_structural() => id,
            (_, Some(id)) => id,
            (Some((id, _)), None) => id,
            (None, None) => return false,
        };
        self.remove_facility(id, RemovalMethod::Sell).ok
    }

    /// `tower.setCars(id, cars)` with its `capacity_changed`. Both engines
    /// emit from this layer (TypeScript `Simulation.setCars`, #906); the
    /// binding, the referee and the charges call it, and the tower stays silent.
    pub fn set_cars(&mut self, id: i64, cars: i64) -> bool {
        let ok = self.tower.set_cars(id, cars);
        if ok {
            self.note_capacity(id);
        }
        ok
    }

    /// `tower.resizeTransport(id, bottom, top)` with its `capacity_changed`,
    /// when the span actually moved.
    pub fn resize_transport(&mut self, id: i64, bottom: i64, top: i64) -> ResizeResult {
        let span = |sim: &Simulation| {
            sim.tower
                .transports
                .iter()
                .find(|t| t.id == id)
                .map(|t| (t.bottom, t.top))
        };
        let before = span(self);
        let r = self.tower.resize_transport(id, bottom, top);
        if r.ok && span(self) != before {
            self.note_capacity(id);
        }
        r
    }

    fn note_capacity(&mut self, id: i64) {
        if let Some(kind) = self
            .tower
            .transports
            .iter()
            .find(|t| t.id == id)
            .map(|t| t.kind)
        {
            self.gameplay.push(GameplayEvent::CapacityChanged { kind });
        }
    }
}

#[cfg(test)]
#[path = "build_tests.rs"]
mod tests;
