//! Port of `src/engine/EventSystem.ts`.

use indexmap::IndexSet;
use serde_json::{json, Value};

use crate::facilities::Kind;
use crate::rng::Rng;
use crate::sim::{LogKind, Simulation};
use crate::tower::UnitState;

#[derive(Clone, Debug)]
pub struct PendingChoice {
    pub kind: &'static str,
    pub cost: f64,
    pub message: String,
}

pub struct EventSystem {
    /// Units currently ablaze, in insertion order.
    pub active: IndexSet<i64>,
    /// The seasonal and visitor stream, separate from the main one.
    pub extra: Rng,
    pub last_santa_year: i64,
    pub pending: Option<PendingChoice>,
}

const SECURITY_RADIUS: i64 = 8;
const MEDICAL_RADIUS: i64 = 12;
const THIEF_DAILY_CHANCE: f64 = 0.025;

impl EventSystem {
    pub fn new(seed: u32) -> EventSystem {
        EventSystem {
            active: IndexSet::new(),
            extra: Rng::new(seed ^ 0x5a17a),
            last_santa_year: -1,
            pending: None,
        }
    }

    /// `saveState()`: `pending` is a literal null when there is no choice.
    pub fn save_state(&self) -> Value {
        let pending = match &self.pending {
            Some(p) => json!({ "kind": p.kind, "cost": p.cost, "message": p.message }),
            None => Value::Null,
        };
        json!({ "lastSantaYear": self.last_santa_year, "rngState": self.extra.seed(), "pending": pending })
    }

    pub fn count(&self) -> usize {
        self.active.len()
    }
}

impl Simulation {
    /// `maybeRandomEvent`: the daily roll.
    pub fn maybe_random_event(&mut self) {
        if self.events.pending.is_some() {
            self.resolve_choice(false);
        }
        self.process_fires();
        self.maybe_santa();
        self.maybe_thief();
        if self.star < 2 {
            return;
        }
        let roll = self.rng.next();
        let fire_chance = self.fire_chance();
        if self.events.active.is_empty() && roll < fire_chance {
            self.start_fire();
            if !self.events.active.is_empty() {
                let cost = self.fire_rescue_cost();
                let message = format!("🚒 Fire rescue available for ${cost}. Pay to stop the spread and save the tower now, or decline and fight it the slow way.");
                self.events.pending = Some(PendingChoice {
                    kind: "fireRescue",
                    cost,
                    message: message.clone(),
                });
                self.emit(&message, LogKind::Bad);
                if !self.has_any(Kind::Security) {
                    self.emit("Tip: a Security office fights fires for free. Build one to defend your tower.", LogKind::Bad);
                }
            }
            return;
        }
        if self.star >= 4 && roll < fire_chance + 0.05 {
            let message = "💣 A caller demands a $300,000 ransom or a bomb detonates. Pay, or have Security search the tower.".to_string();
            self.events.pending = Some(PendingChoice {
                kind: "bombThreat",
                cost: 300_000.0,
                message: message.clone(),
            });
            self.emit(&message, LogKind::Bad);
            return;
        }
        if self.rng.chance(0.15) {
            if self.rng.chance(0.5) {
                self.emit(
                    "A local newspaper praised your tower's design.",
                    LogKind::Good,
                );
            } else {
                self.emit("Tenants are happy with the tower today.", LogKind::Info);
            }
        }
    }

    /// `resolveChoice(option)`: `accept` is true.
    pub fn resolve_choice(&mut self, accept: bool) {
        let Some(p) = self.events.pending.take() else {
            return;
        };
        if p.kind == "fireRescue" {
            if accept && self.money >= p.cost {
                self.money -= p.cost;
                self.extinguish_all();
                self.emit(&format!("🚒 Fire-rescue crews saved the tower for ${}. The rooms that were ablaze are gutted. Bulldoze and rebuild them.", p.cost), LogKind::Money);
            }
            return;
        }
        if accept && self.money >= p.cost {
            self.money -= p.cost;
            self.emit(
                &format!(
                    "💣 You paid the ${} ransom; the threat passed quietly.",
                    p.cost
                ),
                LogKind::Money,
            );
        } else {
            self.bomb_threat();
        }
    }

    fn gut(&mut self, i: usize) {
        let u = &mut self.tower.units[i];
        u.state = UnitState::Gutted;
        u.occupants = 0;
        u.ever_occupied = false;
        u.residents = None;
        u.satisfaction = 0.0;
        u.pending_income = 0.0;
        u.patronage_today = None;
        u.patronage_yest = None;
        u.profit_today = None;
        u.profit_yest = None;
        u.dirty_days = None;
        u.label = u.kind.facility().name.to_string();
    }

    fn extinguish_all(&mut self) {
        let ids: Vec<i64> = self.events.active.iter().copied().collect();
        for id in ids {
            if let Some(idx) = self.tower.units.iter().position(|u| u.id == id) {
                if self.tower.units[idx].state == UnitState::Fire {
                    self.gut(idx);
                }
            }
        }
        self.events.active.clear();
    }

    pub fn fire_chance(&self) -> f64 {
        let mut chance = 0.025;
        if self.has_operational(Kind::Security) {
            chance *= 0.45;
        }
        if self.has_operational(Kind::Medical) {
            chance *= 0.5;
        }
        chance
    }

    fn fire_rescue_cost(&self) -> f64 {
        (150_000.0 + ((self.star - 2).max(0) as f64) * 120_000.0).min(500_000.0)
    }

    /// `flammableUnits`: indices of real, finished, unburned rooms.
    fn flammable_units(&self) -> Vec<usize> {
        (0..self.tower.units.len())
            .filter(|&i| {
                let u = &self.tower.units[i];
                !u.kind.is_structural()
                    && u.state != UnitState::Construction
                    && u.state != UnitState::Fire
                    && u.state != UnitState::Gutted
            })
            .collect()
    }

    /// `startFire`.
    pub fn start_fire(&mut self) {
        let candidates = self.flammable_units();
        if candidates.is_empty() {
            return;
        }
        let i = *self.rng.pick(&candidates);
        let u = &mut self.tower.units[i];
        u.state = UnitState::Fire;
        u.occupants = 0;
        let (id, name, floor) = (u.id, u.kind.facility().name, u.floor);
        self.events.active.insert(id);
        let msg = format!(
            "🔥 Fire broke out in {} on {}!",
            name,
            self.floor_label(floor)
        );
        self.emit(&msg, LogKind::Bad);
    }

    fn service_within(&self, kind: Kind, floor: i64, radius: i64) -> bool {
        self.tower
            .units
            .iter()
            .any(|u| u.kind == kind && u.is_operational() && (u.floor - floor).abs() <= radius)
    }

    pub fn control_chance(&self, floor: i64) -> f64 {
        let sec = self.service_within(Kind::Security, floor, SECURITY_RADIUS);
        let med = self.service_within(Kind::Medical, floor, MEDICAL_RADIUS);
        0.5 + (if sec { 0.2 } else { 0.0 }) + (if med { 0.3 } else { 0.0 })
    }

    fn spread_fire_to(&mut self, target: Option<i64>) {
        let Some(tid) = target else { return };
        let Some(idx) = self.tower.units.iter().position(|u| u.id == tid) else {
            return;
        };
        if !self.tower.units[idx].is_operational() {
            return;
        }
        let kind = self.tower.units[idx].kind;
        let mut ops = 0;
        for x in &self.tower.units {
            if x.kind == kind && x.is_operational() {
                ops += 1;
                if ops > 1 {
                    break;
                }
            }
        }
        if ops <= 1 {
            return;
        }
        let u = &mut self.tower.units[idx];
        u.state = UnitState::Fire;
        u.occupants = 0;
        let (id, name, floor) = (u.id, kind.facility().name, u.floor);
        self.events.active.insert(id);
        let msg = format!(
            "The fire spread to {} on {}!",
            name,
            self.floor_label(floor)
        );
        self.emit(&msg, LogKind::Bad);
    }

    fn process_fires(&mut self) {
        if self.events.active.is_empty() {
            return;
        }
        let ids: Vec<i64> = self.events.active.iter().copied().collect();
        for id in ids {
            let Some(idx) = self.tower.units.iter().position(|u| u.id == id) else {
                self.events.active.shift_remove(&id);
                continue;
            };
            if self.tower.units[idx].state != UnitState::Fire {
                self.events.active.shift_remove(&id);
                continue;
            }
            let (floor, x, width, name) = {
                let u = &self.tower.units[idx];
                (u.floor, u.x, u.width, u.kind.facility().name)
            };
            let control = self.control_chance(floor);
            if self.rng.chance(control) {
                self.gut(idx);
                self.events.active.shift_remove(&id);
                let msg = format!("🔥 The {} on {} burned down. Only a gutted shell remains. Bulldoze the rubble and rebuild.", name, self.floor_label(floor));
                self.emit(&msg, LogKind::Bad);
            } else {
                let adjacent = self
                    .tower
                    .room_at(floor, x - 1)
                    .or_else(|| self.tower.room_at(floor, x + width))
                    .map(|u| u.id);
                self.spread_fire_to(adjacent);
                let above = self.tower.room_at(floor + 1, x).map(|u| u.id);
                self.spread_fire_to(above);
            }
        }
        if !self.events.active.is_empty() {
            for u in self.tower.units.iter_mut() {
                if u.is_tenanted() || u.state == UnitState::Asleep {
                    u.satisfaction = (u.satisfaction - 0.05).max(0.0);
                }
            }
        }
    }

    fn maybe_santa(&mut self) {
        let cal = self.clock.calendar;
        let year = self.clock.year();
        let day_of_year = ((self.clock.day() % cal.year_days) + cal.year_days) % cal.year_days;
        let holiday_start = cal.year_days
            - (crate::jsmath::round((cal.year_days as f64 * 20.0) / 360.0) as i64).max(1);
        if day_of_year < holiday_start || self.star < 3 || year == self.events.last_santa_year {
            return;
        }
        if !self.events.extra.chance(0.4) {
            return;
        }
        self.events.last_santa_year = year;
        self.emit(
            "🎅 Santa was spotted crossing the sky above your tower for the holidays!",
            LogKind::Good,
        );
    }

    fn maybe_thief(&mut self) {
        if self.star < 2 {
            return;
        }
        if !self.events.extra.chance(THIEF_DAILY_CHANCE) {
            return;
        }
        // The floor only places the cosmetic; the draw stays so the event
        // stream matches the TypeScript.
        let _floor = self.thief_floor();
        if self.has_any(Kind::Security) {
            self.emit(
                "🕵️ Security caught a thief prowling the tower. Nothing was taken.",
                LogKind::Good,
            );
            return;
        }
        let loss = 5_000.0 + self.events.extra.int(0, 20_000) as f64;
        self.money -= loss;
        self.emit(
            &format!(
                "🕵️ A thief slipped through the tower and made off with ${loss}. Build Security."
            ),
            LogKind::Bad,
        );
    }

    fn thief_floor(&mut self) -> i64 {
        let mut floors: IndexSet<i64> = IndexSet::new();
        for u in &self.tower.units {
            if u.is_present() {
                floors.insert(u.floor);
            }
        }
        if floors.is_empty() {
            return 1;
        }
        let v: Vec<i64> = floors.into_iter().collect();
        *self.events.extra.pick(&v)
    }

    /// `bombThreat`.
    pub fn bomb_threat(&mut self) {
        if self.has_any(Kind::Security) {
            let cost = 2_000.0 + self.rng.int(0, 3_000) as f64;
            self.money -= cost;
            self.emit(&format!("💣 A bomb threat was called in. Security swept the tower and found nothing. The evacuation cost ${cost}."), LogKind::Info);
            return;
        }
        let fine = 15_000.0 + self.rng.int(0, 15_000) as f64;
        self.money -= fine;
        let targets = self.flammable_units();
        let mut destroyed = 0;
        if !targets.is_empty() {
            let gi = *self.rng.pick(&targets);
            let epicenter = self.tower.units[gi].floor;
            for i in 0..self.tower.units.len() {
                let u = &self.tower.units[i];
                if (u.floor - epicenter).abs() <= 2
                    && !u.kind.is_structural()
                    && u.state != UnitState::Construction
                    && u.state != UnitState::Gutted
                {
                    let id = u.id;
                    self.events.active.shift_remove(&id);
                    self.gut(i);
                    destroyed += 1;
                }
            }
        }
        self.emit(&format!("💣 A bomb detonated with no security to stop it. {destroyed} room(s) across ~5 floors were gutted, plus a ${fine} fine. Build Security!"), LogKind::Bad);
    }
}
