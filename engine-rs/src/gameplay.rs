//! Gameplay events: facts the engine reports the moment something happens,
//! such as a room placed, a star reached or a fire started, for a host to
//! feed achievements, analytics or sound.
//!
//! The engine pushes each event into [`Simulation::gameplay`](crate::sim::Simulation::gameplay),
//! a ring of at most [`GAMEPLAY_RING_CAP`]. Drain it after each frame. If a
//! host never drains, the oldest events go and
//! [`GameplayEvents::dropped`] counts them. Events carry only enums and
//! bounded integers: no names, money or free text.
//!
//! [`CATALOG_JSON`] is the contract: every event's name, payload fields and
//! meaning, versioned. [`check_event`] checks a drained event against it.
//!
//! ```
//! use verticopolis_engine::clock::GameMode;
//! use verticopolis_engine::facilities::Kind;
//! use verticopolis_engine::gameplay::GameplayEvent;
//! use verticopolis_engine::sim::Simulation;
//!
//! let mut sim = Simulation::new_game(1, GameMode::Classic);
//! sim.build(Kind::Lobby, 1, 100);
//! let events = sim.gameplay.drain();
//! assert_eq!(events[0], GameplayEvent::TowerFounded { mode: GameMode::Classic });
//! assert_eq!(events[1].name(), "facility_placed");
//! println!("{}", events[1].to_json());
//! ```

use std::collections::VecDeque;

mod check;
pub use check::{check_catalog, check_event};

use serde_json::{json, Value};

use crate::clock::GameMode;
use crate::facilities::Kind;

/// The most events the ring holds between two drains.
pub const GAMEPLAY_RING_CAP: usize = 1024;

/// How a player removed something, in [`GameplayEvent::FacilityRemoved`]
/// and [`Simulation::remove_facility`](crate::sim::Simulation::remove_facility).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RemovalMethod {
    /// Sold with the sell tool.
    Sell,
    /// Cleared with the bulldozer.
    Bulldoze,
}

impl RemovalMethod {
    /// `sell` or `bulldoze`.
    pub fn parse(s: &str) -> Option<RemovalMethod> {
        match s {
            "sell" => Some(RemovalMethod::Sell),
            "bulldoze" => Some(RemovalMethod::Bulldoze),
            _ => None,
        }
    }

    /// `sell` or `bulldoze`.
    pub fn as_str(self) -> &'static str {
        match self {
            RemovalMethod::Sell => "sell",
            RemovalMethod::Bulldoze => "bulldoze",
        }
    }
}

/// Which offer an [`GameplayEvent::EmergencyResolved`] answered.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EmergencyKind {
    /// Pay to stop a fire spreading.
    FireRescue,
    /// Pay a bomb threat's ransom.
    BombThreat,
}

impl EmergencyKind {
    /// `fireRescue` or `bombThreat`.
    pub fn as_str(self) -> &'static str {
        match self {
            EmergencyKind::FireRescue => "fireRescue",
            EmergencyKind::BombThreat => "bombThreat",
        }
    }

    /// `fireRescue` or `bombThreat`.
    pub fn parse(s: &str) -> Option<EmergencyKind> {
        match s {
            "fireRescue" => Some(EmergencyKind::FireRescue),
            "bombThreat" => Some(EmergencyKind::BombThreat),
            _ => None,
        }
    }
}

/// What took effect when an offer was answered.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EmergencyDecision {
    /// Paid.
    Accept,
    /// Declined, or accepted without the money to pay.
    Decline,
}

impl EmergencyDecision {
    /// `accept` or `decline`.
    pub fn as_str(self) -> &'static str {
        match self {
            EmergencyDecision::Accept => "accept",
            EmergencyDecision::Decline => "decline",
        }
    }
}

/// Who answered an offer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EmergencySource {
    /// The player, with [`Simulation::resolve_choice`](crate::sim::Simulation::resolve_choice).
    Player,
    /// Nobody answered by the next day, so the engine declined.
    Timeout,
}

impl EmergencySource {
    /// `player` or `timeout`.
    pub fn as_str(self) -> &'static str {
        match self {
            EmergencySource::Player => "player",
            EmergencySource::Timeout => "timeout",
        }
    }
}

/// One gameplay event. [`CATALOG_JSON`] holds the full meaning of each, under
/// its [`name`](GameplayEvent::name).
#[derive(Clone, Debug, PartialEq)]
pub enum GameplayEvent {
    /// `tower_founded`: a new game started. A load never emits it.
    TowerFounded {
        /// The game's mode.
        mode: GameMode,
    },
    /// `facility_placed`: a build was placed and charged.
    FacilityPlaced {
        /// The kind placed.
        kind: Kind,
        /// The top floor it reaches.
        floor: i64,
        /// How many of `kind` it placed (more than one for a floor run).
        count: i64,
    },
    /// `facility_removed`: a player sold or bulldozed a room or a shaft.
    FacilityRemoved {
        /// The kind removed.
        kind: Kind,
        /// How it was removed.
        method: RemovalMethod,
    },
    /// `pricing_changed`: a price moved, once per command.
    PricingChanged {
        /// The kind repriced.
        kind: Kind,
    },
    /// `capacity_changed`: an elevator's cars or span changed.
    CapacityChanged {
        /// The shaft's kind.
        kind: Kind,
    },
    /// `star_reached`: the rating rose to `star` (6 is TOWER), one event per
    /// star gained.
    StarReached {
        /// The new rating.
        star: i64,
    },
    /// `fire_started`: a room caught fire. A fire spreading is the same fire.
    FireStarted,
    /// `fire_gutted`: a fire burned rooms down to empty shells.
    FireGutted {
        /// How many rooms, at least 1.
        rooms: i64,
    },
    /// `bomb_detonated`: a bomb went off before Security found it.
    BombDetonated {
        /// How many rooms the blast destroyed.
        rooms: i64,
    },
    /// `bomb_found`: Security found the bomb in time.
    BombFound,
    /// `emergency_resolved`: an offer was answered.
    EmergencyResolved {
        /// Which offer.
        kind: EmergencyKind,
        /// What took effect.
        decision: EmergencyDecision,
        /// Who answered.
        source: EmergencySource,
    },
    /// `milestone_reached`: the tower reached a milestone. A load never
    /// emits it.
    MilestoneReached {
        /// The milestone's id, stable across versions.
        id: &'static str,
    },
}

impl GameplayEvent {
    #[doc(hidden)]
    /// How many variants there are: one more than the highest `ordinal`.
    pub const VARIANTS: usize = 12;

    #[doc(hidden)]
    /// The event's position in the catalog. Exhaustive, so a new variant
    /// cannot compile without a place; `VARIANTS` and the catalog test then
    /// hold the count, `one_of_each` and the catalog to it.
    pub fn ordinal(&self) -> usize {
        match self {
            GameplayEvent::TowerFounded { .. } => 0,
            GameplayEvent::FacilityPlaced { .. } => 1,
            GameplayEvent::FacilityRemoved { .. } => 2,
            GameplayEvent::PricingChanged { .. } => 3,
            GameplayEvent::CapacityChanged { .. } => 4,
            GameplayEvent::StarReached { .. } => 5,
            GameplayEvent::FireStarted => 6,
            GameplayEvent::FireGutted { .. } => 7,
            GameplayEvent::BombDetonated { .. } => 8,
            GameplayEvent::EmergencyResolved { .. } => 9,
            GameplayEvent::MilestoneReached { .. } => 10,
            GameplayEvent::BombFound => 11,
        }
    }

    /// The event's name in the catalog, such as `facility_placed`.
    pub fn name(&self) -> &'static str {
        match self {
            GameplayEvent::TowerFounded { .. } => "tower_founded",
            GameplayEvent::FacilityPlaced { .. } => "facility_placed",
            GameplayEvent::FacilityRemoved { .. } => "facility_removed",
            GameplayEvent::PricingChanged { .. } => "pricing_changed",
            GameplayEvent::CapacityChanged { .. } => "capacity_changed",
            GameplayEvent::StarReached { .. } => "star_reached",
            GameplayEvent::FireStarted => "fire_started",
            GameplayEvent::FireGutted { .. } => "fire_gutted",
            GameplayEvent::BombDetonated { .. } => "bomb_detonated",
            GameplayEvent::EmergencyResolved { .. } => "emergency_resolved",
            GameplayEvent::MilestoneReached { .. } => "milestone_reached",
            GameplayEvent::BombFound => "bomb_found",
        }
    }

    /// The event's payload fields as a JSON object.
    pub fn payload(&self) -> Value {
        match self {
            GameplayEvent::TowerFounded { mode } => json!({ "mode": mode.as_str() }),
            GameplayEvent::FacilityPlaced { kind, floor, count } => {
                json!({ "kind": kind.as_str(), "floor": floor, "count": count })
            }
            GameplayEvent::FacilityRemoved { kind, method } => {
                json!({ "kind": kind.as_str(), "method": method.as_str() })
            }
            GameplayEvent::PricingChanged { kind } | GameplayEvent::CapacityChanged { kind } => {
                json!({ "kind": kind.as_str() })
            }
            GameplayEvent::StarReached { star } => json!({ "star": star }),
            GameplayEvent::FireStarted | GameplayEvent::BombFound => json!({}),
            GameplayEvent::FireGutted { rooms } | GameplayEvent::BombDetonated { rooms } => {
                json!({ "rooms": rooms })
            }
            GameplayEvent::EmergencyResolved {
                kind,
                decision,
                source,
            } => {
                json!({ "kind": kind.as_str(), "decision": decision.as_str(), "source": source.as_str() })
            }
            GameplayEvent::MilestoneReached { id } => json!({ "id": id }),
        }
    }

    /// The event as `{ "name": ..., "payload": {...} }`, the shape
    /// [`CATALOG_JSON`] describes.
    pub fn to_json(&self) -> Value {
        json!({ "name": self.name(), "payload": self.payload() })
    }
}

/// The events waiting for the host to drain them. Never saved.
#[derive(Clone, Debug, Default)]
pub struct GameplayEvents {
    ring: VecDeque<GameplayEvent>,
    /// Events pushed out of a full ring since the engine was made.
    pub dropped: u64,
}

impl GameplayEvents {
    #[doc(hidden)]
    pub fn push(&mut self, e: GameplayEvent) {
        if self.ring.len() >= GAMEPLAY_RING_CAP {
            self.ring.pop_front();
            self.dropped += 1;
        }
        self.ring.push_back(e);
    }

    /// Every buffered event, oldest first; the ring is empty afterwards.
    pub fn drain(&mut self) -> Vec<GameplayEvent> {
        self.ring.drain(..).collect()
    }

    /// How many events are waiting.
    pub fn len(&self) -> usize {
        self.ring.len()
    }

    /// The buffered events, oldest first, left in place.
    pub fn iter(&self) -> impl Iterator<Item = &GameplayEvent> {
        self.ring.iter()
    }

    /// Whether no events are waiting.
    pub fn is_empty(&self) -> bool {
        self.ring.is_empty()
    }
}

#[doc(hidden)]
/// The drained batch as the JSON array the binding returns and the
/// conformance lock hashes.
pub fn batch_json(events: &[GameplayEvent]) -> Value {
    Value::Array(events.iter().map(GameplayEvent::to_json).collect())
}

/// The gameplay event catalog as JSON: every event's name, cardinality,
/// payload fields and meaning. The conformance suite holds the engine to it.
// A static, so the reference shows the name and type without printing the
// whole file as the value.
pub static CATALOG_JSON: &str = include_str!("gameplay/catalog.json");

#[cfg(test)]
mod tests;
