//! Gameplay events: the provider-agnostic facts the engine emits at the
//! moment a transition happens, for the host to drain and forward
//! (`_bmad-output/party-mode/analytics-engine-events-party-findings-2026-10-09.md`).
//! `conformance/events/catalog.json` is the contract; the tests below hold
//! `GameplayEvent` to it. A port of `src/engine/gameplayEventBuffer.ts`.
//!
//! Emission reads state after a transition and writes only to the buffer:
//! never the rng, the save, the clock or the hashed views. The buffer is a
//! bounded ring, so a run that never drains cannot grow memory; when it is
//! full the oldest event goes and `dropped` counts it.

use std::collections::VecDeque;

use serde_json::{json, Value};

use crate::clock::GameMode;
use crate::facilities::Kind;

/// The most events the ring holds between two drains.
pub const GAMEPLAY_RING_CAP: usize = 1024;

/// `removalMethod`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RemovalMethod {
    Sell,
    Bulldoze,
}

impl RemovalMethod {
    /// The method a command names, as the binding and the referee spell it.
    pub fn parse(s: &str) -> Option<RemovalMethod> {
        match s {
            "sell" => Some(RemovalMethod::Sell),
            "bulldoze" => Some(RemovalMethod::Bulldoze),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            RemovalMethod::Sell => "sell",
            RemovalMethod::Bulldoze => "bulldoze",
        }
    }
}

/// `emergencyKind`: the pending choice a resolution answered.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EmergencyKind {
    FireRescue,
    BombThreat,
}

impl EmergencyKind {
    pub fn as_str(self) -> &'static str {
        match self {
            EmergencyKind::FireRescue => "fireRescue",
            EmergencyKind::BombThreat => "bombThreat",
        }
    }

    /// The pending choice's kind as the save spells it.
    pub fn parse(s: &str) -> Option<EmergencyKind> {
        match s {
            "fireRescue" => Some(EmergencyKind::FireRescue),
            "bombThreat" => Some(EmergencyKind::BombThreat),
            _ => None,
        }
    }
}

/// `emergencyDecision`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EmergencyDecision {
    Accept,
    Decline,
}

impl EmergencyDecision {
    pub fn as_str(self) -> &'static str {
        match self {
            EmergencyDecision::Accept => "accept",
            EmergencyDecision::Decline => "decline",
        }
    }
}

/// `emergencySource`: the resolve command, or the daily roll's auto-decline.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EmergencySource {
    Player,
    Timeout,
}

impl EmergencySource {
    pub fn as_str(self) -> &'static str {
        match self {
            EmergencySource::Player => "player",
            EmergencySource::Timeout => "timeout",
        }
    }
}

/// One gameplay event, as the catalog names it.
#[derive(Clone, Debug, PartialEq)]
pub enum GameplayEvent {
    TowerFounded {
        mode: GameMode,
    },
    FacilityPlaced {
        kind: Kind,
        floor: i64,
        count: i64,
    },
    FacilityRemoved {
        kind: Kind,
        method: RemovalMethod,
    },
    PricingChanged {
        kind: Kind,
    },
    CapacityChanged {
        kind: Kind,
    },
    StarReached {
        star: i64,
    },
    FireStarted,
    FireGutted {
        rooms: i64,
    },
    BombDetonated {
        rooms: i64,
    },
    EmergencyResolved {
        kind: EmergencyKind,
        decision: EmergencyDecision,
        source: EmergencySource,
    },
    MilestoneReached {
        /// A milestone id from the MILESTONES table.
        id: &'static str,
    },
}

impl GameplayEvent {
    /// How many variants there are: one more than the highest `ordinal`.
    pub const VARIANTS: usize = 11;

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
        }
    }

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
        }
    }

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
            GameplayEvent::FireStarted => json!({}),
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

    /// `{ name, payload }`, the shape a drain hands the host.
    pub fn to_json(&self) -> Value {
        json!({ "name": self.name(), "payload": self.payload() })
    }
}

/// The drain buffer: a bounded ring outside the save and the hashed views.
#[derive(Clone, Debug, Default)]
pub struct GameplayEvents {
    ring: VecDeque<GameplayEvent>,
    /// Events pushed out of a full ring since the engine was made.
    pub dropped: u64,
}

impl GameplayEvents {
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

    pub fn len(&self) -> usize {
        self.ring.len()
    }

    /// The buffered events, oldest first, left in place.
    pub fn iter(&self) -> impl Iterator<Item = &GameplayEvent> {
        self.ring.iter()
    }

    pub fn is_empty(&self) -> bool {
        self.ring.is_empty()
    }
}

/// The drained batch as the JSON array the binding returns and the
/// conformance lock hashes.
pub fn batch_json(events: &[GameplayEvent]) -> Value {
    Value::Array(events.iter().map(GameplayEvent::to_json).collect())
}

/// A JSON number that is a whole number JavaScript holds exactly, as
/// `Number.isSafeInteger` reads it: `3` and `3.0` alike (the parsed text
/// cannot tell them apart in TypeScript, so neither side may either), and
/// nothing past 2^53 - 1 in magnitude.
fn whole(v: &Value) -> Option<i64> {
    const SAFE: i64 = 9_007_199_254_740_991;
    v.as_i64()
        .or_else(|| {
            v.as_f64()
                .filter(|f| f.fract() == 0.0 && f.abs() <= SAFE as f64)
                .map(|f| f as i64)
        })
        .filter(|n| n.unsigned_abs() <= SAFE as u64)
}

/// `snake_case` from a lowercase letter: an event name.
fn is_event_name(s: &str) -> bool {
    s.starts_with(|c: char| c.is_ascii_lowercase())
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// Enum set names whose generated type would collide with one the
/// declaration already exports.
const RESERVED_SETS: [&str; 5] = [
    "catalogVersion",
    "event",
    "eventName",
    "eventPayloads",
    "eventVersions",
];

/// `camelCase` from a lowercase letter: an enum set or a payload field, both
/// of which become TypeScript identifiers in the generated declaration.
fn is_camel_name(s: &str) -> bool {
    s.starts_with(|c: char| c.is_ascii_lowercase()) && s.chars().all(|c| c.is_ascii_alphanumeric())
}

/// Prose the generated declaration carries in a doc comment: non-empty and
/// unable to close that comment early.
fn prose(v: Option<&Value>) -> bool {
    v.and_then(Value::as_str)
        .is_some_and(|s| !s.is_empty() && !s.contains("*/"))
}

/// Check a catalog's shape and its payload rule: every field is a closed
/// enum the catalog defines or a bounded integer, so a free-text, money or
/// name field cannot enter the contract. The twin of `checkCatalog` in
/// `src/engine/gameplayCatalog.ts`; both refuse the same catalogs.
pub fn check_catalog(catalog: &Value) -> Result<(), String> {
    if !catalog.is_object() {
        return Err("catalog: must be an object".into());
    }
    if !catalog
        .get("catalogVersion")
        .and_then(whole)
        .is_some_and(|v| v >= 1)
    {
        return Err("catalog: catalogVersion must be a whole number from 1".into());
    }
    if !prose(catalog.get("about")) {
        return Err("catalog: about must be a non-empty string without */".into());
    }
    let enums = catalog
        .get("enums")
        .and_then(Value::as_object)
        .ok_or("catalog: enums must be an object")?;
    for (name, values) in enums {
        if !is_camel_name(name) {
            return Err(format!("enum {name}: name must be camelCase"));
        }
        if RESERVED_SETS.contains(&name.as_str()) {
            return Err(format!(
                "enum {name}: name is reserved by the generated declaration"
            ));
        }
        let values = values
            .as_array()
            .filter(|v| !v.is_empty())
            .ok_or_else(|| format!("enum {name}: must be a non-empty array"))?;
        let mut seen = std::collections::HashSet::new();
        for v in values {
            let s = v
                .as_str()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| format!("enum {name}: values must be non-empty strings"))?;
            if !seen.insert(s) {
                return Err(format!("enum {name}: {s} is listed twice"));
            }
        }
    }
    let events = catalog
        .get("events")
        .and_then(Value::as_array)
        .ok_or("catalog: events must be an array")?;
    let mut names = std::collections::HashSet::new();
    for e in events {
        let name = e
            .get("name")
            .and_then(Value::as_str)
            .filter(|s| is_event_name(s))
            .ok_or("event: name must be snake_case")?;
        if !names.insert(name) {
            return Err(format!("event {name}: listed twice"));
        }
        if !e.get("version").and_then(whole).is_some_and(|v| v >= 1) {
            return Err(format!(
                "event {name}: version must be a whole number from 1"
            ));
        }
        if !matches!(
            e.get("cardinality").and_then(Value::as_str),
            Some("per_occurrence") | Some("per_tower")
        ) {
            return Err(format!(
                "event {name}: cardinality must be per_occurrence or per_tower"
            ));
        }
        for key in ["semantics", "history"] {
            if !prose(e.get(key)) {
                return Err(format!(
                    "event {name}: {key} must be a non-empty string without */"
                ));
            }
        }
        let payload = e
            .get("payload")
            .and_then(Value::as_object)
            .ok_or_else(|| format!("event {name}: payload must be an object"))?;
        for (field, spec) in payload {
            let where_ = format!("event {name} field {field}");
            if !is_camel_name(field) {
                return Err(format!("{where_}: name must be camelCase"));
            }
            match spec.get("type").and_then(Value::as_str) {
                Some("enum") => {
                    let set = spec
                        .get("enum")
                        .and_then(Value::as_str)
                        .ok_or_else(|| format!("{where_}: enum must name a catalog enum"))?;
                    if !enums.contains_key(set) {
                        return Err(format!("{where_}: enum {set} is not in the catalog"));
                    }
                }
                Some("integer") => {
                    let min = spec.get("min").and_then(whole);
                    let max = spec.get("max").and_then(whole);
                    match (min, max) {
                        (Some(lo), Some(hi))
                            if lo <= hi && lo.unsigned_abs() <= 100_000 && hi.unsigned_abs() <= 100_000 => {}
                        _ => {
                            return Err(format!(
                                "{where_}: an integer needs whole min and max within 100000"
                            ))
                        }
                    }
                }
                other => {
                    return Err(format!(
                        "{where_}: type {} is not allowed; payloads carry closed enums and small integers only",
                        other.unwrap_or("(none)")
                    ))
                }
            }
        }
    }
    Ok(())
}

/// Check one drained event against a checked catalog: a known name, exactly
/// `{ name, payload }`, exactly the catalog's fields, each enum value listed
/// and each integer in range.
pub fn check_event(catalog: &Value, event: &Value) -> Result<(), String> {
    let name = event
        .get("name")
        .and_then(Value::as_str)
        .ok_or("event: name must be a string")?;
    let entry = catalog["events"]
        .as_array()
        .and_then(|a| a.iter().find(|e| e["name"] == name))
        .ok_or_else(|| format!("event {name}: not in the catalog"))?;
    let spec = entry["payload"]
        .as_object()
        .ok_or_else(|| format!("event {name}: the catalog entry has no payload"))?;
    let payload = match (event.as_object().map(|o| o.len()), event.get("payload")) {
        (Some(2), Some(Value::Object(p))) => p,
        _ => return Err(format!("event {name}: must be exactly {{ name, payload }}")),
    };
    for k in payload.keys() {
        if !spec.contains_key(k) {
            return Err(format!("event {name}: field {k} is not in the catalog"));
        }
    }
    for (field, s) in spec {
        let v = payload
            .get(field)
            .ok_or_else(|| format!("event {name}: field {field} is missing"))?;
        let ok = match s["type"].as_str() {
            Some("enum") => {
                let set = s["enum"].as_str().unwrap_or_default();
                v.as_str().is_some_and(|x| {
                    catalog["enums"][set]
                        .as_array()
                        .is_some_and(|vals| vals.iter().any(|y| y == x))
                })
            }
            Some("integer") => whole(v).is_some_and(|n| {
                whole(&s["min"]).is_some_and(|lo| n >= lo)
                    && whole(&s["max"]).is_some_and(|hi| n <= hi)
            }),
            _ => false,
        };
        if !ok {
            return Err(format!(
                "event {name}: field {field} = {v} is outside the catalog"
            ));
        }
    }
    Ok(())
}

/// The catalog both engines are held to, compiled in so the referee can
/// check every drained event without a file path.
pub const CATALOG_JSON: &str = include_str!("../../conformance/events/catalog.json");

#[cfg(test)]
mod tests;
