//! One game: [`Simulation`] holds a whole tower, its people, its money and
//! its clock, and every player command and time step goes through it.
//!
//! ```
//! use verticopolis_engine::clock::GameMode;
//! use verticopolis_engine::facilities::Kind;
//! use verticopolis_engine::sim::Simulation;
//!
//! let mut sim = Simulation::new_game(42, GameMode::Classic);
//! for x in 100..124 {
//!     sim.build(Kind::Lobby, 1, x);
//! }
//! sim.tick(60.0);
//! assert!(sim.money < verticopolis_engine::sim::STARTING_MONEY);
//! ```

use indexmap::IndexSet;
use serde_json::Value;

use std::collections::HashMap;

use crate::clock::{resolve_calendar, CalendarKind, Clock, GameMode};
use crate::crowd::Crowd;
use crate::dispatch::ElevatorDispatch;
use crate::events::EventSystem;
use crate::gameplay::{GameplayEvent, GameplayEvents};
use crate::housekeeping::Housekeeping;
use crate::ledger::Ledger;
use crate::rng::Rng;
use crate::sim_loop::{weather_for, Weather};
use crate::telemetry::ElevatorTelemetry;
use crate::tower::Tower;

#[doc(hidden)]
#[derive(Clone, Copy, Debug, Default)]
pub struct MoveIns {
    pub offices: i64,
    pub condos: i64,
    pub rooms: i64,
    pub fitness: i64,
    pub clinic: i64,
    pub rentals: i64,
}

/// The newest save format version this engine writes. It loads every older
/// version back to the oldest one [`crate::identity::identity`] names.
///
/// Version 8 adds one key, `lobbyHeights` (#308), so a save is stamped with
/// the oldest version that reads it whole ([`save_version`]): 8 when it
/// holds a tall lobby, which a build from before tall lobbies refuses rather
/// than drop, and [`PLAIN_SAVE_VERSION`] otherwise, which every build from
/// version 7 on still loads.
pub const SAVE_VERSION: i64 = 9;
/// The version a save with no tall lobby is written at: the format before
/// `lobbyHeights`, which it does not need.
pub const PLAIN_SAVE_VERSION: i64 = 7;

/// The version a save is stamped with: [`SAVE_VERSION`] when it holds a tall
/// lobby, [`PLAIN_SAVE_VERSION`] when it does not.
pub fn save_version(has_tall_lobby: bool) -> i64 {
    if has_tall_lobby {
        SAVE_VERSION
    } else {
        PLAIN_SAVE_VERSION
    }
}
/// The money a new game starts with.
pub const STARTING_MONEY: f64 = 2_000_000.0;
/// How many messages [`Simulation::log`] keeps; the oldest goes first.
pub const LOG_RING_CAP: usize = 300;
#[doc(hidden)]
pub const LOG_SAVE_CAP: usize = LOG_RING_CAP;

/// How the game styles a message in its log.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LogKind {
    /// News: a guest arrived, an event started.
    Info,
    /// Good news: a new star, a milestone.
    Good,
    /// Bad news: a fire, a tenant leaving.
    Bad,
    /// A payment or a charge.
    Money,
}

impl LogKind {
    /// The kind as a save writes it: `info`, `good`, `bad` or `money`.
    pub fn as_str(self) -> &'static str {
        match self {
            LogKind::Info => "info",
            LogKind::Good => "good",
            LogKind::Bad => "bad",
            LogKind::Money => "money",
        }
    }
}

/// One message in the game's log.
#[derive(Clone, Debug)]
pub struct LogEntry {
    /// The game minute it was written ([`crate::clock::Clock::minutes`]).
    pub minute: f64,
    /// The message, in American English, ready to show a player.
    pub text: String,
    /// How to style it.
    pub kind: LogKind,
}

#[doc(hidden)]
/// A cosmetic event the renderer polls: `explosionFx` and `treasureFx`
/// carry a point, `thiefFx` a floor and whether the thief was caught. The
/// sequence numbers are what the renderer compares; nothing here is saved
/// or hashed (`SimContext.trigger*`).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PointFx {
    pub floor: i64,
    pub x: f64,
    pub seq: i64,
}

#[doc(hidden)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ThiefFx {
    pub caught: bool,
    pub floor: i64,
    /// A tile of the stretch of floor (one tower's part of it, on a lot with
    /// several) the thief prowls.
    pub x: i64,
    pub seq: i64,
}

#[doc(hidden)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FxState {
    pub santa_seq: i64,
    pub explosion: PointFx,
    pub thief: ThiefFx,
    pub treasure: PointFx,
    pub vip_seq: i64,
}

impl Default for FxState {
    fn default() -> FxState {
        FxState {
            santa_seq: 0,
            explosion: PointFx::default(),
            thief: ThiefFx {
                caught: false,
                floor: 1,
                x: 0,
                seq: 0,
            },
            treasure: PointFx::default(),
            vip_seq: 0,
        }
    }
}

/// One game of Verticopolis.
///
/// Start one with [`Simulation::new_game`], or load one from a save with
/// [`crate::load::deserialize`]. Advance it with [`Simulation::tick`] and
/// change it only through its commands ([`build`](Simulation::build),
/// [`add_car`](Simulation::add_car), [`adjust_rent`](Simulation::adjust_rent)
/// and the rest), which apply the rules, charge the money and refuse what a
/// player could not do. The public fields are for reading; writing one skips
/// those rules.
///
/// A renderer reads the tower through [`crate::view`] or [`crate::frame`],
/// and an analytics or achievements layer drains [`Simulation::gameplay`].
pub struct Simulation {
    #[doc(hidden)]
    pub rng: Rng,
    /// The game mode, fixed when the game starts.
    pub mode: GameMode,
    /// The calendar a Modern game runs on. A Classic game always runs the canon
    /// calendar.
    pub modern_calendar: CalendarKind,
    /// Whether a new floor joins the floor next to it automatically. Only a
    /// Modern game can turn this off ([`Simulation::toggle_auto_bridge`]).
    pub auto_bridge: bool,
    /// Whether the tower was started before saves carried a build stamp. The
    /// web game shows these towers a founder badge.
    pub founder: bool,
    /// The game clock: day, hour, minute, quarter and year.
    pub clock: Clock,
    /// The people moving through the tower.
    pub crowd: Crowd,
    /// Emergencies, and the choice waiting for the player's answer.
    pub events: EventSystem,
    #[doc(hidden)]
    pub ledger: Ledger,
    /// The tower: its floors, rooms and transport. A renderer reads it through
    /// [`crate::view`] instead of walking it.
    pub tower: Tower,
    /// The player's money, in dollars. It can go negative.
    pub money: f64,
    /// The tower's rating: 1 to 5 stars, and 6 once it is a TOWER.
    pub star: i64,
    #[doc(hidden)]
    pub last_quarter_money: f64,
    #[doc(hidden)]
    /// `evaluatedTower`; `None` when the save carried no key.
    pub evaluated_tower: Option<bool>,
    #[doc(hidden)]
    /// The day the VIP inspection is due, as the save carries it (a forged
    /// save may hold a fraction, which the day comparisons then honor).
    pub vip_visit_day: f64,
    #[doc(hidden)]
    pub vip_favorable: bool,
    #[doc(hidden)]
    pub vip_visits: i64,
    #[doc(hidden)]
    pub last_vip_nag_day: i64,
    #[doc(hidden)]
    pub treasures_found: f64,
    #[doc(hidden)]
    pub extermination_due_day: Option<f64>,
    #[doc(hidden)]
    /// The infested room ids a booking billed, saved while it is due. `None`
    /// on a legacy save, which treats every infested room.
    pub extermination_room_ids: Option<Vec<i64>>,
    #[doc(hidden)]
    /// `"floor:x"` keys in insertion order.
    pub excavated: Vec<String>,
    #[doc(hidden)]
    /// The cinemas booked for a blockbuster this month, by id, as the save
    /// carries them (a forged save may hold a fraction).
    pub blockbusters: Vec<f64>,
    /// The milestone ids the tower has reached, in the order it reached them.
    /// The ids are stable across versions.
    pub milestones: Vec<String>,
    /// The recent messages, oldest first, at most [`LOG_RING_CAP`].
    /// [`crate::frame::log_since`] returns the ones after a sequence number.
    pub log: Vec<LogEntry>,
    #[doc(hidden)]
    pub log_seq: i64,
    #[doc(hidden)]
    /// Unit ids under construction, in insertion order.
    pub constructing: IndexSet<i64>,
    // ---- transient loop state (never saved) ----
    #[doc(hidden)]
    pub elevators: ElevatorDispatch,
    #[doc(hidden)]
    /// `elevatorUtil` / `elevatorHourly` / `elevatorOrigins` (never saved).
    pub telemetry: ElevatorTelemetry,
    #[doc(hidden)]
    pub housekeeping: Housekeeping,
    #[doc(hidden)]
    pub weather: Weather,
    #[doc(hidden)]
    /// The cosmetic event counters the renderer polls (never saved).
    pub fx: FxState,
    #[doc(hidden)]
    pub last_hour: i64,
    #[doc(hidden)]
    pub last_day: i64,
    #[doc(hidden)]
    pub last_month: i64,
    #[doc(hidden)]
    pub last_quarter: i64,
    #[doc(hidden)]
    pub on_hour_runs: i64,
    #[doc(hidden)]
    pub move_ins_today: MoveIns,
    #[doc(hidden)]
    pub waste_nudged: bool,
    #[doc(hidden)]
    pub suite_parking_nudged: bool,
    #[doc(hidden)]
    pub office_parking_nudged: bool,
    #[doc(hidden)]
    pub stranded_nudged: bool,
    #[doc(hidden)]
    pub metro_platform_nudged: bool,
    #[doc(hidden)]
    /// `floorReachable` memo keyed by tower revision.
    pub reach_memo: (i64, HashMap<i64, bool>),
    #[doc(hidden)]
    /// `noiseMemo`: unit id to `noiseAfflicted`, keyed by tower revision.
    pub noise_memo: (i64, HashMap<i64, bool>),
    #[doc(hidden)]
    /// The inspector's demand map memo (never saved; see
    /// `diagnostics/memo.rs`).
    pub diag_memo: crate::diagnostics::DiagMemo,
    #[doc(hidden)]
    /// The saved camera view (inert cargo the save carries).
    pub view: Option<Value>,
    /// The gameplay events since the host last drained them. Call
    /// `sim.gameplay.drain()` after each frame. Never saved.
    pub gameplay: GameplayEvents,
    #[doc(hidden)]
    /// The open extend gesture (#990) as `(id, bottom, top)`: the shaft and
    /// the furthest span the gesture has paid for (never saved, and not in
    /// the state view; see `begin_extend`).
    pub extend_gesture: Option<(i64, i64, i64)>,
}

impl Simulation {
    #[doc(hidden)]
    // `new Simulation(seed, mode, modernCalendar, startUnbridged)`.
    pub fn new(
        seed: u32,
        mode: GameMode,
        modern_calendar: CalendarKind,
        start_unbridged: bool,
    ) -> Simulation {
        let modern_calendar = if mode.lets_player_choose_calendar() {
            modern_calendar
        } else {
            CalendarKind::RealWorld
        };
        Simulation {
            rng: Rng::new(seed),
            mode,
            modern_calendar,
            auto_bridge: if mode.bridging_toggleable() {
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
                t.allows_escalator_on_office_floors = mode.escalators_on_office_floors();
                t.mode = mode;
                t
            },
            money: STARTING_MONEY,
            star: 1,
            last_quarter_money: 0.0,
            evaluated_tower: Some(false),
            vip_visit_day: -1.0,
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
            elevators: ElevatorDispatch::new(),
            telemetry: ElevatorTelemetry::default(),
            housekeeping: Housekeeping::default(),
            weather: weather_for(0),
            fx: FxState::default(),
            last_hour: -1,
            last_day: 0,
            last_month: -1,
            last_quarter: -1,
            on_hour_runs: 0,
            move_ins_today: MoveIns::default(),
            waste_nudged: false,
            suite_parking_nudged: false,
            office_parking_nudged: false,
            stranded_nudged: false,
            metro_platform_nudged: false,
            extermination_room_ids: None,
            reach_memo: (-1, HashMap::new()),
            noise_memo: (-1, HashMap::new()),
            diag_memo: Default::default(),
            view: None,
            gameplay: GameplayEvents::default(),
            extend_gesture: None,
        }
    }

    #[doc(hidden)]
    /// `recordMoney(cat, amount)`.
    pub fn record_money(&mut self, cat: &'static str, amount: f64) {
        self.ledger.record(cat, amount);
    }

    /// How many people live and work in the tower: the number the star
    /// ratings count.
    pub fn population(&self) -> i64 {
        self.tower.total_population()
    }

    #[doc(hidden)]
    /// `floorReachable(floor)`: memoized per tower revision, no rng.
    pub fn floor_reachable(&mut self, floor: i64) -> bool {
        if floor == 1 {
            return true;
        }
        if self.reach_memo.0 != self.tower.revision {
            self.reach_memo = (self.tower.revision, HashMap::new());
        }
        if let Some(&hit) = self.reach_memo.1.get(&floor) {
            return hit;
        }
        let hit = self.crowd.floor_reachable(&self.tower, floor);
        self.reach_memo.1.insert(floor, hit);
        hit
    }

    #[doc(hidden)]
    /// `positionReachable(floor, x)`.
    pub fn position_reachable(&mut self, floor: i64, x: i64) -> bool {
        if floor == 1 {
            return true;
        }
        if self.tower.segments_of(floor).len() <= 1 {
            return self.floor_reachable(floor);
        }
        self.crowd.position_reachable(&self.tower, floor, x)
    }

    #[doc(hidden)]
    /// `unitReachable` (sim/demand.ts).
    pub fn unit_reachable(&mut self, floor: i64, x: i64) -> bool {
        self.position_reachable(floor, x)
    }

    /// Starts a new game: an empty lot, [`STARTING_MONEY`], 07:00 on day 0.
    ///
    /// The same `seed` and the same commands give the same game. A Modern
    /// game gets the real-world calendar and automatic floor bridging; use
    /// [`Simulation::new_game_with`] to choose them.
    ///
    /// ```
    /// use verticopolis_engine::clock::GameMode;
    /// use verticopolis_engine::sim::Simulation;
    ///
    /// let sim = Simulation::new_game(7, GameMode::Modern);
    /// assert_eq!(sim.star, 1);
    /// assert_eq!(sim.population(), 0);
    /// ```
    pub fn new_game(seed: u32, mode: GameMode) -> Simulation {
        Simulation::new_game_with(seed, mode, CalendarKind::RealWorld, false)
    }

    /// Starts a new game with a choice of calendar and bridging. Both apply
    /// to a Modern game only: a Classic game always runs the canon calendar
    /// with bridging on, whatever these say.
    ///
    /// ```
    /// use verticopolis_engine::clock::{CalendarKind, GameMode};
    /// use verticopolis_engine::sim::Simulation;
    ///
    /// let sim = Simulation::new_game_with(7, GameMode::Modern, CalendarKind::Canon, true);
    /// assert!(!sim.auto_bridge);
    /// ```
    pub fn new_game_with(
        seed: u32,
        mode: GameMode,
        modern_calendar: CalendarKind,
        start_unbridged: bool,
    ) -> Simulation {
        let mut sim = Simulation::new(seed, mode, modern_calendar, start_unbridged);
        sim.emit(
            "Welcome! Lay a lobby on the ground line to open your tower.",
            LogKind::Info,
        );
        sim.gameplay
            .push(GameplayEvent::TowerFounded { mode: sim.mode });
        sim
    }

    #[doc(hidden)]
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
}
