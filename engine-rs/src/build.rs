//! Placing and selling: [`Simulation::build`] for floors, lobbies and rooms,
//! [`Simulation::build_transport`] for elevators, stairs and escalators, and
//! [`Simulation::sell_at`]. Each build has a dry run
//! ([`Simulation::can_build`], [`Simulation::can_build_transport`]) that
//! answers with the same refusal and the full price, for a placement ghost.
//!
//! A refused command changes nothing and says why in a sentence a player can
//! read. A placed one charges the money, logs the purchase and emits its
//! gameplay events.

use crate::clock::GameMode;
use crate::facilities::*;
use crate::gameplay::{GameplayEvent, RemovalMethod};
use crate::sim::{LogKind, Simulation};
use crate::tower::UnitState;

/// What a build did.
pub struct BuildResult {
    /// Whether it was placed.
    pub ok: bool,
    /// Why it was refused, ready to show a player. `None` when placed.
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

/// The answer to a dry run: what the build would do, and its price.
pub struct CanBuild {
    /// Whether the build would be placed.
    pub ok: bool,
    /// Why it would be refused. `None` when it would be placed.
    pub reason: Option<String>,
    /// The full price, in dollars, floors and bridged tiles included. It is
    /// set even when the build would be refused.
    pub cost: f64,
}

/// Whether a tile of `kind` placed where there is no floor yet also pays for
/// the floor it lays. A lobby does, as in the original: a bare lobby tile
/// costs the lobby's price plus the floor's, and a lobby over a floor tile
/// the lobby's price alone. The catalog publishes this as `paysForFloor`.
pub fn pays_for_floor(kind: Kind) -> bool {
    kind == Kind::Lobby
}

/// The price of one bridged substrate tile: a lobby tile when the placement is
/// a lobby, a floor tile otherwise. A bridge fills only empty tiles, so a
/// bridged tile of a kind that pays for its floor ([`pays_for_floor`]) adds
/// the floor's price. Read from the facility table, the same prices the
/// catalog quotes.
fn substrate_cost(kind: Kind) -> f64 {
    let substrate = if kind == Kind::Lobby {
        Kind::Lobby
    } else {
        Kind::Floor
    };
    bare_tile_cost(substrate)
}

/// The price of a tile of `kind` placed where there is no floor yet.
fn bare_tile_cost(kind: Kind) -> f64 {
    let tile = kind.facility().cost;
    if pays_for_floor(kind) {
        tile + Kind::Floor.facility().cost
    } else {
        tile
    }
}

/// Classic's refusal for any room but the wedding hall on floor 100.
pub(crate) const CLASSIC_TOP_FLOOR_REASON: &str =
    "Only the wedding hall can be built on floor 100.";

/// The buried-treasure log line.
pub(crate) fn treasure_message(gold: f64) -> String {
    format!(
        "💰 Excavation crews unearthed buried treasure worth ${}!",
        crate::services::with_thousands(gold)
    )
}

impl Simulation {
    /// Turns automatic floor bridging off or on, and returns the new setting.
    /// Only a Modern game can turn it off; a Classic game always bridges and
    /// this returns `true`.
    pub fn toggle_auto_bridge(&mut self) -> bool {
        if self.mode.bridging_toggleable() {
            self.auto_bridge = !self.auto_bridge;
        }
        self.auto_bridge
    }

    #[doc(hidden)]
    pub fn is_unlocked(&self, kind: Kind) -> bool {
        let f = kind.facility();
        f.available_in(self.mode) && self.star >= f.min_star
    }

    /// The price of the tile a structural placement lays at `(floor, x)`: a
    /// lobby placed where there is no floor yet pays for that floor too
    /// ([`pays_for_floor`]); a lobby over a floor tile turns it into lobby
    /// for the lobby's price alone.
    fn structure_tile_cost(&self, kind: Kind, floor: i64, x: i64) -> f64 {
        if self.tower.has_structure(floor, x) {
            kind.facility().cost
        } else {
            bare_tile_cost(kind)
        }
    }

    /// The dry run [`build`](Simulation::build) makes first: whether a
    /// `kind` at `(floor, x)` would be placed, why not, and its full price.
    /// Changes nothing.
    ///
    /// ```
    /// use verticopolis_engine::clock::GameMode;
    /// use verticopolis_engine::facilities::Kind;
    /// use verticopolis_engine::sim::Simulation;
    ///
    /// let sim = Simulation::new_game(1, GameMode::Classic);
    /// let quote = sim.can_build(Kind::Lobby, 1, 100);
    /// assert!(quote.ok);
    /// assert!(quote.cost > 0.0);
    /// ```
    pub fn can_build(&self, kind: Kind, floor: i64, x: i64) -> CanBuild {
        let kind = ground_floor_structure_kind(kind, floor);
        let f = kind.facility();
        if !self.is_unlocked(kind) {
            let reason = if !f.available_in(self.mode) {
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
                return money_check(self.structure_tile_cost(kind, floor, x));
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
            return money_check(
                self.structure_tile_cost(kind, floor, x) + bridge * substrate_cost(kind),
            );
        }
        let pre = self.tower.can_place_room_ignoring_floor(kind, floor, x);
        if !pre.ok {
            return CanBuild {
                ok: false,
                reason: pre.reason,
                cost: f.cost,
            };
        }
        // Floor slabs end at `MAX_FLOOR`: the wedding hall's upper stories stand above them.
        let hgt = kind.floors().min(MAX_FLOOR + 1 - floor);
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
        // Classic keeps floor 100 for the wedding hall alone. This sits after
        // every shared refusal reason, so the TypeScript reasons still win where
        // both engines refuse.
        if self.mode == GameMode::Classic
            && kind != Kind::WeddingHall
            && floor <= MAX_FLOOR
            && floor + kind.floors() > MAX_FLOOR
        {
            return CanBuild {
                ok: false,
                reason: Some(CLASSIC_TOP_FLOOR_REASON.into()),
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

    /// Places a floor tile, a lobby tile or a room with its left edge at
    /// tile `x` and its bottom on `floor`, and charges for it.
    ///
    /// A room needs a floor under each of its tiles or bridges the gap when
    /// [`auto_bridge`](Simulation::auto_bridge) is on, paying for the floor it
    /// lays. Floors and lobbies are laid one tile at a time; to lay a run, call
    /// [`paint_brush`](Simulation::paint_brush). A refused build changes
    /// nothing. Floor 1 is the ground floor and basements are 0 and below.
    ///
    /// ```
    /// use verticopolis_engine::clock::GameMode;
    /// use verticopolis_engine::facilities::Kind;
    /// use verticopolis_engine::sim::Simulation;
    ///
    /// let mut sim = Simulation::new_game(1, GameMode::Classic);
    /// assert!(sim.build(Kind::Lobby, 1, 100).ok);
    ///
    /// // Offices open at one star, but not on a bare lot five floors up.
    /// let refused = sim.build(Kind::Office, 5, 300);
    /// assert!(!refused.ok);
    /// println!("{}", refused.reason.unwrap());
    /// ```
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
        let hgt = kind.floors().min(MAX_FLOOR + 1 - floor);
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
            self.tower.remove_units(&laid_bridge);
            return BuildResult {
                ok: false,
                reason: res.reason,
            };
        }
        let price = can.cost - (quoted_bridge - laid_bridge.len() as f64) * substrate_cost(kind);
        self.money -= price;
        self.note_edit_cash(-price);
        if let Some(id) = res.unit_id {
            if let Some(list) = kind.subtype_list() {
                let name = *self.rng.pick(list);
                self.tower.set_unit_subtype(id, Some(name));
            }
            if self.mode == GameMode::Classic {
                if let Some(ladder) = crate::econ::classic_ladder(kind) {
                    let cfg = crate::econ::rent_config(kind).unwrap();
                    let v = ladder[crate::rent::AVERAGE_RUNG];
                    self.tower.get_unit_mut(id).unwrap().rent =
                        if v == cfg.default { None } else { Some(v) };
                }
            }
            let dur = kind.build_minutes();
            if dur > 0.0 {
                let (u, at) = self.tower.marked_by_id(id).unwrap();
                u.set_state(at, UnitState::Construction);
                u.extras_mut().complete_at = Some(self.clock.minutes + dur);
                self.constructing.insert(id);
            }
            if kind == Kind::WeddingHall {
                self.emit(
                    "Wedding Hall built! A VIP will inspect your tower soon.",
                    LogKind::Good,
                );
                self.edit_vip_visit_day((self.clock.day() + 3) as f64);
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
                // A search the player could undo would be free.
                if fresh && self.treasures_found < 3.0 {
                    self.note_treasure_search();
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
            floor: (floor + hgt - 1).min(MAX_FLOOR),
            count: 1,
        });
        BuildResult {
            ok: true,
            reason: None,
        }
    }

    /// The dry run [`build_transport`](Simulation::build_transport) makes
    /// first: whether a shaft of `kind` at `x` spanning `bottom..=top` would
    /// be placed, why not, and its full price. Changes nothing.
    ///
    /// An elevator costs the catalog `cost` plus `transportFloorCost` for
    /// each floor past its first; stairs and escalators cost the catalog
    /// `cost`. Refusals come in the build's order: not unlocked yet, then
    /// money, then placement. The price is only a shaft's price for a
    /// transport kind with `top` above `bottom`; anything else is refused.
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

    /// Places an elevator, stairs or an escalator with its left edge at tile
    /// `x`, serving floors `bottom` to `top`, and charges for it. A new
    /// elevator starts with one car for every six floors it serves, up to its
    /// kind's limit; [`add_car`](Simulation::add_car) adds more. Stairs and
    /// escalators span exactly two floors.
    ///
    /// ```
    /// use verticopolis_engine::clock::GameMode;
    /// use verticopolis_engine::facilities::Kind;
    /// use verticopolis_engine::sim::Simulation;
    ///
    /// let mut sim = Simulation::new_game(1, GameMode::Classic);
    /// for x in 100..124 {
    ///     sim.build(Kind::Lobby, 1, x);
    /// }
    /// for floor in 2..=4 {
    ///     for x in 100..124 {
    ///         sim.build(Kind::Floor, floor, x);
    ///     }
    /// }
    /// let shaft = sim.build_transport(Kind::ElevatorStandard, 110, 1, 4);
    /// assert!(shaft.ok, "{:?}", shaft.reason);
    /// ```
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
        self.note_edit_cash(-quote.cost);
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

    /// Sells whatever stands at a tile: a room first, then a shaft, then the
    /// floor or lobby tile. Returns whether anything was sold. The refund and
    /// the refusals are [`remove_facility`](Simulation::remove_facility)'s
    /// with [`RemovalMethod::Sell`].
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
}

#[path = "build_capacity.rs"]
mod capacity;

#[cfg(test)]
#[path = "build_tests.rs"]
mod tests;
