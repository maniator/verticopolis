//! Port of `src/engine/EventSystem.ts`.

use indexmap::IndexSet;
use serde_json::{json, Value};

use crate::facilities::Kind;
use crate::gameplay::{EmergencyDecision, EmergencyKind, EmergencySource, GameplayEvent};
use crate::rng::Rng;
use crate::services::with_thousands;
use crate::sim::{LogKind, PointFx, Simulation, ThiefFx};
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
    /// `counts`: emergency tallies for this tower instance (read by the
    /// shell; never saved). A spreading blaze is the same fire, so only the
    /// ignition counts; bomb losses are not fire losses.
    pub fires_started: i64,
    pub fires_gut_rooms: i64,
    pub bombs_detonated: i64,
    /// The seasonal and visitor stream, separate from the main one.
    pub extra: Rng,
    /// The year Santa last came, as the save carries it (a forged save may
    /// hold a fraction, which then never equals a year).
    pub last_santa_year: f64,
    pub pending: Option<PendingChoice>,
}

const SECURITY_RADIUS: i64 = 8;
const MEDICAL_RADIUS: i64 = 12;
const THIEF_DAILY_CHANCE: f64 = 0.025;

impl EventSystem {
    pub fn new(seed: u32) -> EventSystem {
        EventSystem {
            active: IndexSet::new(),
            fires_started: 0,
            fires_gut_rooms: 0,
            bombs_detonated: 0,
            extra: Rng::new(seed ^ 0x5a17a),
            last_santa_year: -1.0,
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
    /// `setFilmPolicy(id, policy)`: the policy as stored, or `None` when the
    /// unit is not a cinema. A policy outside the three the type allows is
    /// refused the same way, since the TypeScript cannot be called with one.
    pub fn set_film_policy(&mut self, id: i64, policy: &str) -> Option<&'static str> {
        let policy: &'static str = match policy {
            "auto" => "auto",
            "feature" => "feature",
            "blockbuster" => "blockbuster",
            _ => return None,
        };
        let u = self.tower.get_unit_mut(id)?;
        if u.kind != Kind::Cinema {
            return None;
        }
        u.film_policy = Some(policy);
        Some(policy)
    }

    /// `maybeRandomEvent`: the daily roll.
    pub fn maybe_random_event(&mut self) {
        if self.events.pending.is_some() {
            self.resolve_choice_from(false, EmergencySource::Timeout);
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
                let message = format!("🚒 Fire rescue available for ${}. Pay to stop the spread and save the tower now, or decline and fight it the slow way. Either way the rooms already ablaze burn down to gutted shells you'll rebuild; the fee just limits how far the fire spreads.", with_thousands(cost));
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

    /// `resolveChoice(option)`: `accept` is true. The player's answer.
    pub fn resolve_choice(&mut self, accept: bool) {
        self.resolve_choice_from(accept, EmergencySource::Player);
    }

    /// `EventSystem.resolveChoice(option, source)`: the daily roll's
    /// auto-decline comes through here as a timeout.
    pub fn resolve_choice_from(&mut self, accept: bool, source: EmergencySource) {
        let Some(p) = self.events.pending.take() else {
            return;
        };
        // What takes effect: an accept the tower cannot afford is a decline.
        // One test drives both the event and the branches below.
        let paid = accept && self.money >= p.cost;
        // Anything but a fire rescue is answered as a bomb threat, as the
        // branches below (and the TypeScript) treat it.
        let kind = EmergencyKind::parse(p.kind).unwrap_or(EmergencyKind::BombThreat);
        self.gameplay.push(GameplayEvent::EmergencyResolved {
            kind,
            decision: if paid {
                EmergencyDecision::Accept
            } else {
                EmergencyDecision::Decline
            },
            source,
        });
        if kind == EmergencyKind::FireRescue {
            if paid {
                self.money -= p.cost;
                self.extinguish_all();
                self.emit(&format!("🚒 Fire-rescue crews saved the tower for ${}. The rooms that were ablaze are gutted. Bulldoze and rebuild them.", with_thousands(p.cost)), LogKind::Money);
            }
            return;
        }
        if paid {
            self.money -= p.cost;
            self.emit(
                &format!(
                    "💣 You paid the ${} ransom; the threat passed quietly.",
                    with_thousands(p.cost)
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
        let mut gutted = 0;
        for id in ids {
            if let Some(idx) = self.tower.units.iter().position(|u| u.id == id) {
                if self.tower.units[idx].state == UnitState::Fire {
                    self.gut(idx);
                    self.events.fires_gut_rooms += 1;
                    gutted += 1;
                }
            }
        }
        self.events.active.clear();
        self.note_gutted(gutted);
    }

    /// `fire_gutted` for one step that gutted `rooms` (none for zero).
    fn note_gutted(&mut self, rooms: i64) {
        if rooms > 0 {
            self.gameplay.push(GameplayEvent::FireGutted { rooms });
        }
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
        self.events.fires_started += 1;
        self.gameplay.push(GameplayEvent::FireStarted);
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
        let mut gutted = 0;
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
                self.events.fires_gut_rooms += 1;
                gutted += 1;
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
        self.note_gutted(gutted);
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
        if day_of_year < holiday_start
            || self.star < 3
            || year as f64 == self.events.last_santa_year
        {
            return;
        }
        if !self.events.extra.chance(0.4) {
            return;
        }
        self.events.last_santa_year = year as f64;
        self.emit(
            "🎅 Santa was spotted crossing the sky above your tower for the holidays!",
            LogKind::Good,
        );
        self.fx.santa_seq += 1;
    }

    fn maybe_thief(&mut self) {
        if self.star < 2 {
            return;
        }
        if !self.events.extra.chance(THIEF_DAILY_CHANCE) {
            return;
        }
        // The floor places the cosmetic (`triggerThief`); the draw also keeps
        // the event stream in step with the TypeScript.
        let floor = self.thief_floor();
        if self.has_any(Kind::Security) {
            self.emit(
                "🕵️ Security caught a thief prowling the tower. Nothing was taken.",
                LogKind::Good,
            );
            self.fx.thief = ThiefFx {
                caught: true,
                floor,
                seq: self.fx.thief.seq + 1,
            };
            return;
        }
        self.fx.thief = ThiefFx {
            caught: false,
            floor,
            seq: self.fx.thief.seq + 1,
        };
        let loss = 5_000.0 + self.events.extra.int(0, 20_000) as f64;
        self.money -= loss;
        self.emit(
            &format!(
                "🕵️ A thief slipped through the tower and made off with ${}. Build Security.",
                with_thousands(loss)
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
            self.emit(&format!("💣 A bomb threat was called in. Security swept the tower and found nothing. The evacuation cost ${}.", with_thousands(cost)), LogKind::Info);
            return;
        }
        let fine = 15_000.0 + self.rng.int(0, 15_000) as f64;
        self.money -= fine;
        self.events.bombs_detonated += 1;
        let targets = self.flammable_units();
        let mut destroyed = 0;
        if !targets.is_empty() {
            let gi = *self.rng.pick(&targets);
            let ground = &self.tower.units[gi];
            let epicenter = ground.floor;
            self.fx.explosion = PointFx {
                floor: epicenter,
                x: ground.x as f64 + ground.width as f64 / 2.0,
                seq: self.fx.explosion.seq + 1,
            };
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
        self.gameplay
            .push(GameplayEvent::BombDetonated { rooms: destroyed });
        self.emit(&format!("💣 A bomb detonated with no security to stop it. {destroyed} room(s) across ~5 floors were gutted, plus a ${} fine. Build Security!", with_thousands(fine)), LogKind::Bad);
    }
}
