//! The simulation root: a port of `src/engine/Simulation.ts` and the
//! serialize side of `src/engine/sim/serialization.ts`.

use indexmap::IndexSet;
use serde_json::{json, Map, Value};

use crate::clock::{resolve_calendar, CalendarKind, Clock, GameMode};
use crate::crowd::Crowd;
use crate::events::EventSystem;
use crate::ledger::Ledger;
use crate::rng::Rng;
use crate::tower::Tower;

pub const SAVE_VERSION: i64 = 7;
/// `ECON.startingMoney`.
pub const STARTING_MONEY: f64 = 2_000_000.0;
pub const LOG_RING_CAP: usize = 300;
pub const LOG_SAVE_CAP: usize = LOG_RING_CAP;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LogKind {
    Info,
    Good,
    Bad,
    Money,
}

impl LogKind {
    pub fn as_str(self) -> &'static str {
        match self {
            LogKind::Info => "info",
            LogKind::Good => "good",
            LogKind::Bad => "bad",
            LogKind::Money => "money",
        }
    }
}

#[derive(Clone, Debug)]
pub struct LogEntry {
    pub minute: f64,
    pub text: String,
    pub kind: LogKind,
}

pub struct Simulation {
    pub rng: Rng,
    pub mode: GameMode,
    pub modern_calendar: CalendarKind,
    pub auto_bridge: bool,
    pub founder: bool,
    pub clock: Clock,
    pub crowd: Crowd,
    pub events: EventSystem,
    pub ledger: Ledger,
    pub tower: Tower,
    pub money: f64,
    pub star: i64,
    pub last_quarter_money: f64,
    pub evaluated_tower: bool,
    pub vip_visit_day: i64,
    pub vip_favorable: bool,
    pub vip_visits: i64,
    pub last_vip_nag_day: i64,
    pub treasures_found: f64,
    pub extermination_due_day: Option<f64>,
    /// `"floor:x"` keys in insertion order.
    pub excavated: Vec<String>,
    pub blockbusters: Vec<i64>,
    pub milestones: Vec<String>,
    pub log: Vec<LogEntry>,
    pub log_seq: i64,
    /// Unit ids under construction, in insertion order.
    pub constructing: IndexSet<i64>,
}

impl Simulation {
    /// `new Simulation(seed, mode, modernCalendar, startUnbridged)`.
    pub fn new(
        seed: u32,
        mode: GameMode,
        modern_calendar: CalendarKind,
        start_unbridged: bool,
    ) -> Simulation {
        let bridging_toggleable = mode == GameMode::Modern;
        let modern_calendar = if mode == GameMode::Classic {
            CalendarKind::RealWorld
        } else {
            modern_calendar
        };
        Simulation {
            rng: Rng::new(seed),
            mode,
            modern_calendar,
            auto_bridge: if bridging_toggleable {
                !start_unbridged
            } else {
                true
            },
            founder: false,
            clock: Clock::new(0.0, resolve_calendar(mode, modern_calendar)),
            crowd: Crowd::new(seed),
            events: EventSystem::new(seed),
            ledger: Ledger::new(),
            tower: {
                let mut t = Tower::new();
                t.allows_escalator_on_office_floors = mode == GameMode::Modern;
                t
            },
            money: STARTING_MONEY,
            star: 1,
            last_quarter_money: 0.0,
            evaluated_tower: false,
            vip_visit_day: -1,
            vip_favorable: false,
            vip_visits: 0,
            last_vip_nag_day: -100,
            treasures_found: 0.0,
            extermination_due_day: None,
            excavated: Vec::new(),
            blockbusters: Vec::new(),
            milestones: Vec::new(),
            log: Vec::new(),
            log_seq: 0,
            constructing: IndexSet::new(),
        }
    }

    /// `Simulation.newGame(seed, mode)` with the default calendar, bridged.
    pub fn new_game(seed: u32, mode: GameMode) -> Simulation {
        let mut sim = Simulation::new(seed, mode, CalendarKind::RealWorld, false);
        sim.emit(
            "Welcome! Lay a lobby on the ground line to open your tower.",
            LogKind::Info,
        );
        sim
    }

    /// `sim.emit(text, kind)`: append to the ring, no dedupe.
    pub fn emit(&mut self, text: &str, kind: LogKind) {
        self.log.push(LogEntry {
            minute: self.clock.minutes,
            text: text.to_string(),
            kind,
        });
        self.log_seq += 1;
        if self.log.len() > LOG_RING_CAP {
            self.log.remove(0);
        }
    }

    /// `serialize()`: the saved game as JSON. Absent optional fields are left
    /// out of the map, which is what the canonical writer expects.
    pub fn serialize(&self) -> Value {
        let mut m = Map::new();
        m.insert("version".into(), json!(SAVE_VERSION));
        m.insert("seed".into(), json!(self.rng.seed()));
        m.insert("initialSeed".into(), json!(self.rng.initial_seed));
        m.insert("money".into(), json!(self.money));
        m.insert("star".into(), json!(self.star));
        m.insert("minutes".into(), json!(self.clock.minutes));
        m.insert("mode".into(), json!(self.mode.as_str()));
        m.insert(
            "modernCalendar".into(),
            json!(self.modern_calendar.as_str()),
        );
        if !self.auto_bridge {
            m.insert("autoBridge".into(), json!(false));
        }
        if self.founder {
            m.insert("founder".into(), json!(true));
        }
        m.insert("lastQuarterMoney".into(), json!(self.last_quarter_money));
        m.insert(
            "units".into(),
            Value::Array(self.tower.units.iter().map(|u| u.serialize()).collect()),
        );
        m.insert(
            "transports".into(),
            Value::Array(
                self.tower
                    .transports
                    .iter()
                    .map(|t| t.serialize())
                    .collect(),
            ),
        );
        m.insert("nextId".into(), json!(self.tower.next_id));
        m.insert("towerName".into(), json!(self.tower.tower_name));
        m.insert(
            "builtWeddingHall".into(),
            json!(self.tower.built_wedding_hall),
        );
        m.insert("evaluatedTower".into(), json!(self.evaluated_tower));
        m.insert("vipVisitDay".into(), json!(self.vip_visit_day));
        m.insert("vipFavorable".into(), json!(self.vip_favorable));
        m.insert("vipVisits".into(), json!(self.vip_visits));
        m.insert("lastVipNagDay".into(), json!(self.last_vip_nag_day));
        m.insert("treasuresFound".into(), json!(self.treasures_found));
        if let Some(d) = self.extermination_due_day {
            m.insert("exterminationDueDay".into(), json!(d));
        }
        m.insert("events".into(), self.events.save_state());
        m.insert("excavated".into(), json!(self.excavated));
        m.insert("blockbusters".into(), json!(self.blockbusters));
        m.insert("milestones".into(), json!(self.milestones));
        m.insert("ledger".into(), self.ledger.serialize());
        if !self.log.is_empty() {
            let start = self.log.len().saturating_sub(LOG_SAVE_CAP);
            let log: Vec<Value> = self.log[start..]
                .iter()
                .map(|e| json!({ "minute": e.minute, "text": e.text, "kind": e.kind.as_str() }))
                .collect();
            m.insert("log".into(), Value::Array(log));
        }
        Value::Object(m)
    }
}
