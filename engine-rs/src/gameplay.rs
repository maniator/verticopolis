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
mod tests {
    use super::*;
    use crate::facilities::FACILITIES;
    use crate::sim::Simulation;

    fn catalog() -> Value {
        let text = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../conformance/events/catalog.json"
        ))
        .expect("catalog");
        serde_json::from_str(&text).expect("catalog parses")
    }

    /// One event of every variant, so a variant added without a catalog
    /// entry (or the reverse) fails below.
    fn one_of_each() -> Vec<GameplayEvent> {
        vec![
            GameplayEvent::TowerFounded {
                mode: GameMode::Modern,
            },
            GameplayEvent::FacilityPlaced {
                kind: Kind::Office,
                floor: 2,
                count: 1,
            },
            GameplayEvent::FacilityRemoved {
                kind: Kind::Condo,
                method: RemovalMethod::Bulldoze,
            },
            GameplayEvent::PricingChanged { kind: Kind::Office },
            GameplayEvent::CapacityChanged {
                kind: Kind::ElevatorStandard,
            },
            GameplayEvent::StarReached { star: 6 },
            GameplayEvent::FireStarted,
            GameplayEvent::FireGutted { rooms: 3 },
            GameplayEvent::BombDetonated { rooms: 0 },
            GameplayEvent::EmergencyResolved {
                kind: EmergencyKind::BombThreat,
                decision: EmergencyDecision::Decline,
                source: EmergencySource::Timeout,
            },
            GameplayEvent::MilestoneReached { id: "full-house" },
        ]
    }

    #[test]
    fn the_catalog_passes_its_own_rules() {
        check_catalog(&catalog()).expect("catalog is valid");
    }

    #[test]
    fn gameplay_event_matches_the_catalog() {
        let cat = catalog();
        let events = one_of_each();
        let ours: Vec<&str> = events.iter().map(GameplayEvent::name).collect();
        let theirs: Vec<&str> = cat["events"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["name"].as_str().unwrap())
            .collect();
        assert_eq!(ours, theirs, "variants and catalog entries, in order");
        let ordinals: Vec<usize> = events.iter().map(GameplayEvent::ordinal).collect();
        assert_eq!(ordinals, (0..theirs.len()).collect::<Vec<_>>());
        assert_eq!(GameplayEvent::VARIANTS, theirs.len());
        assert!(events.iter().all(|e| e.ordinal() < GameplayEvent::VARIANTS));
        for e in &events {
            check_event(&cat, &e.to_json()).unwrap_or_else(|err| panic!("{err}"));
        }
        // The closed sets the engine draws from are the catalog's sets.
        let enum_of = |name: &str| -> Vec<String> {
            cat["enums"][name]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap().to_string())
                .collect()
        };
        let kinds: Vec<String> = FACILITIES.iter().map(|f| f.key.to_string()).collect();
        assert_eq!(enum_of("facilityKind"), kinds);
        let sim = Simulation::new_game(1, GameMode::Classic);
        let milestones: Vec<String> = sim
            .milestone_tests()
            .iter()
            .map(|(id, _, _)| id.to_string())
            .collect();
        assert_eq!(enum_of("milestoneId"), milestones);
        assert_eq!(enum_of("mode"), ["classic", "modern"]);
        assert_eq!(
            enum_of("removalMethod"),
            [
                RemovalMethod::Sell.as_str(),
                RemovalMethod::Bulldoze.as_str()
            ]
        );
        assert_eq!(
            enum_of("emergencyDecision"),
            [
                EmergencyDecision::Accept.as_str(),
                EmergencyDecision::Decline.as_str()
            ]
        );
        assert_eq!(
            enum_of("emergencySource"),
            [
                EmergencySource::Player.as_str(),
                EmergencySource::Timeout.as_str()
            ]
        );
        assert_eq!(
            enum_of("emergencyKind"),
            [
                EmergencyKind::FireRescue.as_str(),
                EmergencyKind::BombThreat.as_str()
            ]
        );
        assert_eq!(
            EmergencyKind::parse("bombThreat"),
            Some(EmergencyKind::BombThreat)
        );
        assert_eq!(EmergencyKind::parse("ransom"), None);
        // The floor bounds are the grid's, and the TypeScript ring holds as
        // many events as this one.
        let floor = &cat["events"][1]["payload"]["floor"];
        assert_eq!(
            (floor["min"].as_i64(), floor["max"].as_i64()),
            (
                Some(crate::facilities::MIN_FLOOR),
                Some(crate::facilities::MAX_FLOOR)
            )
        );
        let ts = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../src/engine/gameplayEventBuffer.ts"
        ))
        .expect("the TypeScript buffer");
        assert!(ts.contains(&format!("GAMEPLAY_RING_CAP = {GAMEPLAY_RING_CAP};")));
        assert_eq!(serde_json::from_str::<Value>(CATALOG_JSON).unwrap(), cat);
        // A value outside a set, a stray field and an unknown name all fail.
        let mut bad = GameplayEvent::StarReached { star: 1 }.to_json();
        assert!(check_event(&cat, &bad).unwrap_err().contains("star"));
        bad = json!({ "name": "star_reached", "payload": { "star": 3, "towerName": "x" } });
        assert!(check_event(&cat, &bad).unwrap_err().contains("towerName"));
        bad = json!({ "name": "tower_renamed", "payload": {} });
        assert!(check_event(&cat, &bad)
            .unwrap_err()
            .contains("not in the catalog"));
    }

    #[test]
    fn the_catalog_refuses_a_string_field_that_is_not_a_catalog_enum() {
        let mut cat = catalog();
        cat["events"][0]["payload"]["towerName"] = json!({ "type": "string" });
        assert!(check_catalog(&cat)
            .unwrap_err()
            .contains("closed enums and small integers only"));
        let mut cat = catalog();
        cat["events"][0]["payload"]["mode"] = json!({ "type": "enum", "enum": "freeText" });
        assert!(check_catalog(&cat)
            .unwrap_err()
            .contains("not in the catalog"));
        let mut cat = catalog();
        cat["events"][0]["payload"]["money"] = json!({ "type": "number" });
        assert!(check_catalog(&cat).unwrap_err().contains("not allowed"));
        let mut cat = catalog();
        cat["events"][0]["payload"]["cash"] =
            json!({ "type": "integer", "min": 0, "max": 2_000_000_000i64 });
        assert!(check_catalog(&cat).unwrap_err().contains("within 100000"));
        // Names and prose the generated TypeScript declaration could not carry.
        let mut cat = catalog();
        cat["events"][0]["name"] = json!("1st_tower");
        assert!(check_catalog(&cat).unwrap_err().contains("snake_case"));
        let mut cat = catalog();
        cat["enums"][""] = json!(["x"]);
        assert!(check_catalog(&cat).unwrap_err().contains("camelCase"));
        let mut cat = catalog();
        cat["events"][0]["payload"]["tower-name"] = json!({ "type": "enum", "enum": "mode" });
        assert!(check_catalog(&cat).unwrap_err().contains("camelCase"));
        let mut cat = catalog();
        cat["events"][0]["semantics"] = json!("ends the doc */ early");
        assert!(check_catalog(&cat).unwrap_err().contains("without */"));
        let mut cat = catalog();
        cat.as_object_mut().unwrap().remove("catalogVersion");
        assert!(check_catalog(&cat).unwrap_err().contains("catalogVersion"));
        let mut cat = catalog();
        cat["enums"]["event"] = json!(["x"]);
        assert!(check_catalog(&cat).unwrap_err().contains("reserved"));
        assert!(check_catalog(&json!([]))
            .unwrap_err()
            .contains("must be an object"));
        let mut cat = catalog();
        cat["catalogVersion"] = json!(1e20);
        assert!(check_catalog(&cat).unwrap_err().contains("catalogVersion"));
        let mut cat = catalog();
        cat["events"][1]["payload"]["floor"]["min"] = json!(i64::MIN);
        assert!(check_catalog(&cat).unwrap_err().contains("within 100000"));
        // A whole number written with a fraction reads as JavaScript reads it.
        let mut cat = catalog();
        cat["events"][1]["payload"]["count"]["max"] = json!(1000.0);
        check_catalog(&cat).expect("1000.0 is a whole number");
        assert!(check_event(
            &cat,
            &json!({ "name": "star_reached", "payload": { "star": 3.0 } })
        )
        .is_ok());
    }

    #[test]
    fn a_full_ring_drops_the_oldest_and_counts_it() {
        let mut buf = GameplayEvents::default();
        for star in 0..(GAMEPLAY_RING_CAP as i64 + 5) {
            buf.push(GameplayEvent::StarReached { star });
        }
        assert_eq!(buf.len(), GAMEPLAY_RING_CAP);
        assert_eq!(buf.dropped, 5);
        let drained = buf.drain();
        assert_eq!(drained[0], GameplayEvent::StarReached { star: 5 });
        assert!(buf.is_empty());
        assert_eq!(buf.dropped, 5, "draining keeps the running count");
    }

    #[test]
    fn the_buffer_never_reaches_the_save_or_the_hashed_views() {
        use crate::canonical::canonical_json;
        use crate::scenario::state_view;
        let mut sim = Simulation::new_game(9, GameMode::Modern);
        sim.gameplay.drain();
        let save = sim.serialize().to_string();
        let state = canonical_json(&state_view(&sim));
        let crowd = canonical_json(&sim.crowd.view());
        for i in 0..(GAMEPLAY_RING_CAP + 3) {
            sim.gameplay.push(GameplayEvent::FacilityPlaced {
                kind: Kind::Office,
                floor: (i % 50) as i64,
                count: 1,
            });
        }
        assert_eq!(sim.gameplay.len(), GAMEPLAY_RING_CAP);
        assert!(sim.gameplay.dropped > 0);
        assert_eq!(sim.serialize().to_string(), save);
        assert_eq!(canonical_json(&state_view(&sim)), state);
        assert_eq!(canonical_json(&sim.crowd.view()), crowd);
        sim.gameplay.drain();
        assert_eq!(sim.serialize().to_string(), save);
        assert_eq!(canonical_json(&state_view(&sim)), state);
        assert_eq!(canonical_json(&sim.crowd.view()), crowd);
    }

    #[test]
    fn a_new_game_founds_once_and_a_load_emits_nothing() {
        let mut sim = Simulation::new_game(3, GameMode::Classic);
        let founded = batch_json(&sim.gameplay.drain());
        assert_eq!(
            founded,
            json!([{ "name": "tower_founded", "payload": { "mode": "classic" } }])
        );
        let loaded = crate::load::deserialize(&sim.serialize()).expect("loads");
        assert!(loaded.gameplay.is_empty());
        // A real four-star save, with its milestones, stars, shafts and prices.
        let text = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../src/tests/fixtures/towerone-star4.vctower"
        ))
        .expect("fixture");
        let raw = crate::load::decode_vctower(&text).expect("decodes");
        assert!(crate::load::deserialize(&raw)
            .expect("loads")
            .gameplay
            .is_empty());
    }

    /// A founded tower with a lobby row and a floor above, its founding
    /// drained (the twin of `tower()` in `src/engine/gameplayEmission.test.ts`).
    fn tower() -> Simulation {
        let mut sim = Simulation::new_game(7, GameMode::Classic);
        sim.money = 1e9;
        for x in 170..210 {
            assert!(sim.build(Kind::Lobby, 1, x).ok);
        }
        for x in 170..210 {
            assert!(sim.build(Kind::Floor, 2, x).ok);
        }
        sim.gameplay.drain();
        sim
    }

    fn drained(sim: &mut Simulation) -> Value {
        let cat = catalog();
        let out = batch_json(&sim.gameplay.drain());
        for e in out.as_array().unwrap() {
            check_event(&cat, e).unwrap_or_else(|err| panic!("{err}"));
        }
        out
    }

    #[test]
    fn placements_report_the_kind_placed_and_the_top_story() {
        let mut sim = Simulation::new_game(3, GameMode::Classic);
        sim.money = 1e9;
        sim.gameplay.drain();
        assert!(sim.build(Kind::Floor, 1, 180).ok);
        assert!(!sim.build(Kind::Office, 1, 180).ok);
        let first = drained(&mut sim);
        assert_eq!(
            first,
            json!([{ "name": "facility_placed", "payload": { "kind": "lobby", "floor": 1, "count": 1 } }])
        );
        let mut sim = tower();
        sim.star = 5; // the party hall unlocks late; the rating itself emits nothing here
        assert!(sim.build(Kind::PartyHall, 2, 180).ok);
        assert!(sim.build_transport(Kind::ElevatorStandard, 172, 1, 2).ok);
        assert_eq!(
            drained(&mut sim),
            json!([
                { "name": "facility_placed", "payload": { "kind": "partyHall", "floor": 3, "count": 1 } },
                { "name": "facility_placed", "payload": { "kind": "elevatorStandard", "floor": 2, "count": 1 } }
            ])
        );
    }

    #[test]
    fn the_sell_command_reports_and_the_raw_tower_removal_does_not() {
        let mut sim = tower();
        assert!(sim.build(Kind::Office, 2, 180).ok);
        assert!(sim.build_transport(Kind::Stairs, 200, 1, 2).ok);
        sim.gameplay.drain();
        assert!(sim.sell_at(2, 180));
        assert!(sim.sell_at(2, 200));
        assert!(sim.sell_at(2, 209));
        assert_eq!(
            drained(&mut sim),
            json!([
                { "name": "facility_removed", "payload": { "kind": "office", "method": "sell" } },
                { "name": "facility_removed", "payload": { "kind": "stairs", "method": "sell" } },
                { "name": "facility_removed", "payload": { "kind": "floor", "method": "sell" } }
            ])
        );
        let id = sim.tower.unit_at(2, 190).unwrap().id;
        assert!(sim.tower.remove_unit(id).is_some());
        assert!(sim.gameplay.is_empty());
    }

    #[test]
    fn price_and_capacity_edits_report_changes_and_not_no_ops() {
        let mut sim = tower();
        assert!(sim.build(Kind::Office, 2, 180).ok);
        assert!(sim.build(Kind::Office, 2, 190).ok);
        assert!(sim.build_transport(Kind::ElevatorStandard, 172, 1, 2).ok);
        sim.gameplay.drain();
        let office = sim.tower.unit_at(2, 180).unwrap().id;
        assert!(sim.adjust_rent(office, 1).is_some());
        let price = sim.price_unit(office, 9000.0).unwrap();
        assert!(sim.price_unit(office, price).is_some()); // the same price
        assert!(sim.set_no_rate(office));
        assert!(sim.set_no_rate(office)); // already off the market
        assert!(sim
            .apply_rent_batch(Kind::Office, crate::rent::BatchTarget::Default, false)
            .is_some_and(|r| r.changed > 0));
        assert!(sim
            .apply_rent_batch(Kind::Office, crate::rent::BatchTarget::Default, false)
            .is_some_and(|r| r.changed == 0));
        let shaft = sim.tower.transport_at(1, 172).unwrap().id;
        assert!(sim.set_cars(shaft, 3));
        assert!(!sim.set_cars(shaft, 3));
        assert!(sim.resize_transport(shaft, 1, 2).ok); // the same span
        assert!(sim.resize_transport(shaft, 1, 3).ok);
        let names: Vec<String> = drained(&mut sim)
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["name"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(
            names,
            [
                "pricing_changed",
                "pricing_changed",
                "pricing_changed",
                "pricing_changed",
                "capacity_changed",
                "capacity_changed"
            ]
        );
    }

    #[test]
    fn stars_milestones_fires_bombs_and_resolutions_report_in_order() {
        let mut sim = tower();
        sim.star = 4;
        sim.note_stars(1);
        sim.check_milestones();
        sim.check_milestones();
        assert_eq!(
            drained(&mut sim),
            json!([
                { "name": "star_reached", "payload": { "star": 2 } },
                { "name": "star_reached", "payload": { "star": 3 } },
                { "name": "star_reached", "payload": { "star": 4 } },
                { "name": "milestone_reached", "payload": { "id": "star-4" } }
            ])
        );
        sim.star = 1;
        assert!(sim.build(Kind::Office, 2, 180).ok);
        assert!(sim.build(Kind::Office, 2, 190).ok);
        for u in sim.tower.units.iter_mut() {
            if u.state == crate::tower::UnitState::Construction {
                u.state = crate::tower::UnitState::Empty;
            }
        }
        sim.gameplay.drain();
        sim.start_fire();
        sim.events.pending = Some(crate::events::PendingChoice {
            kind: "fireRescue",
            cost: 1000.0,
            message: String::new(),
        });
        sim.resolve_choice(true);
        sim.money = 10.0;
        sim.events.pending = Some(crate::events::PendingChoice {
            kind: "fireRescue",
            cost: 1000.0,
            message: String::new(),
        });
        sim.resolve_choice(true);
        assert_eq!(
            drained(&mut sim),
            json!([
                { "name": "fire_started", "payload": {} },
                { "name": "emergency_resolved", "payload": { "kind": "fireRescue", "decision": "accept", "source": "player" } },
                { "name": "fire_gutted", "payload": { "rooms": 1 } },
                { "name": "emergency_resolved", "payload": { "kind": "fireRescue", "decision": "decline", "source": "player" } }
            ])
        );
        sim.money = 1e9;
        sim.events.pending = Some(crate::events::PendingChoice {
            kind: "bombThreat",
            cost: 300_000.0,
            message: String::new(),
        });
        sim.maybe_random_event();
        let events = drained(&mut sim);
        assert_eq!(
            events[0],
            json!({ "name": "emergency_resolved", "payload": { "kind": "bombThreat", "decision": "decline", "source": "timeout" } })
        );
        assert_eq!(events[1]["name"], "bomb_detonated");
        assert!(events[1]["payload"]["rooms"].as_i64().unwrap() > 0);
    }
}
