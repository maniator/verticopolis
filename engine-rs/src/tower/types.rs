//! The unit, transport and placement-result records a tower holds.

use serde_json::{json, Map, Value};

use crate::facilities::*;
use crate::schedule::Schedule;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnitState {
    Construction,
    Empty,
    Occupied,
    MovingIn,
    Vacating,
    Asleep,
    Dirty,
    Infested,
    Fire,
    Gutted,
}

impl UnitState {
    pub fn as_str(self) -> &'static str {
        match self {
            UnitState::Construction => "construction",
            UnitState::Empty => "empty",
            UnitState::Occupied => "occupied",
            UnitState::MovingIn => "moving_in",
            UnitState::Vacating => "vacating",
            UnitState::Asleep => "asleep",
            UnitState::Dirty => "dirty",
            UnitState::Infested => "infested",
            UnitState::Fire => "fire",
            UnitState::Gutted => "gutted",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Unit {
    pub id: i64,
    pub kind: Kind,
    pub floor: i64,
    pub x: i64,
    pub width: i64,
    pub state: UnitState,
    pub satisfaction: f64,
    pub occupants: i64,
    pub customers_in: Option<i64>,
    pub hotel_customers_in: Option<i64>,
    pub out_for_meal: Option<i64>,
    pub residents: Option<i64>,
    pub ever_occupied: bool,
    pub pending_income: f64,
    pub rent: Option<f64>,
    pub no_rate: bool,
    pub label: String,
    pub vacate_reason: Option<&'static str>,
    pub vacate_at: Option<f64>,
    pub film_policy: Option<&'static str>,
    pub subtype: Option<&'static str>,
    pub patronage_today: Option<f64>,
    pub patronage_yest: Option<f64>,
    pub profit_today: Option<f64>,
    pub profit_yest: Option<f64>,
    pub complete_at: Option<f64>,
    /// A `completeAt` the save carried that is not a number (a string, a
    /// boolean, null). The TypeScript keeps and re-saves it as is, and the
    /// completion check compares the clock against `Number(value)`, so a
    /// string that reads as a number completes then and anything else never
    /// completes. Kept beside `complete_at` so the hash and the behavior both
    /// match.
    pub complete_at_raw: Option<Value>,
    pub dirty_days: Option<i64>,
}

impl Unit {
    /// `serializeUnit` (sim/coerce.ts).
    pub fn serialize(&self) -> Value {
        let f = self.kind.facility();
        let mut m = Map::new();
        m.insert("id".into(), json!(self.id));
        m.insert("kind".into(), json!(self.kind.as_str()));
        m.insert("floor".into(), json!(self.floor));
        m.insert("x".into(), json!(self.x));
        if !(self.width == 1 && f.width == 1 && self.kind.is_structural()) {
            m.insert("width".into(), json!(self.width));
        }
        if self.state != UnitState::Empty {
            m.insert("state".into(), json!(self.state.as_str()));
        }
        if self.satisfaction != 1.0 {
            m.insert("satisfaction".into(), json!(self.satisfaction));
        }
        if self.occupants != 0 && f.attendance.is_none() {
            m.insert("occupants".into(), json!(self.occupants));
        }
        if self.ever_occupied {
            m.insert("everOccupied".into(), json!(true));
        }
        if self.pending_income != 0.0 {
            m.insert("pendingIncome".into(), json!(self.pending_income));
        }
        if self.label != f.name {
            m.insert("label".into(), json!(self.label));
        }
        if let Some(r) = self.residents {
            m.insert("residents".into(), json!(r));
        }
        if let Some(r) = self.rent {
            m.insert("rent".into(), json!(r));
        }
        if self.no_rate {
            m.insert("noRate".into(), json!(true));
        }
        if let Some(v) = self.vacate_reason {
            m.insert("vacateReason".into(), json!(v));
        }
        if let Some(v) = self.vacate_at {
            m.insert("vacateAt".into(), json!(v));
        }
        if let Some(v) = self.film_policy {
            m.insert("filmPolicy".into(), json!(v));
        }
        if let Some(v) = self.subtype {
            m.insert("subtype".into(), json!(v));
        }
        if self.kind.subtype_list().is_some() {
            if let Some(v) = self.patronage_today {
                m.insert("patronageToday".into(), json!(v));
            }
            if let Some(v) = self.patronage_yest {
                m.insert("patronageYest".into(), json!(v));
            }
            if let Some(v) = self.profit_today {
                m.insert("profitToday".into(), json!(v));
            }
            if let Some(v) = self.profit_yest {
                m.insert("profitYest".into(), json!(v));
            }
        }
        if let Some(v) = self.complete_at {
            m.insert("completeAt".into(), json!(v));
        } else if let Some(raw) = &self.complete_at_raw {
            m.insert("completeAt".into(), raw.clone());
        }

        if let Some(d) = self.dirty_days {
            if d != 0 && self.state == UnitState::Dirty {
                m.insert("dirtyDays".into(), json!(d));
            }
        }
        Value::Object(m)
    }
}

#[derive(Clone, Debug)]
pub struct Transport {
    pub id: i64,
    pub kind: Kind,
    pub x: i64,
    pub width: i64,
    pub bottom: i64,
    pub top: i64,
    pub cars: i64,
    pub car_positions: Vec<f64>,
    pub car_dir: Vec<i64>,
    pub car_load: Option<Vec<f64>>,
    pub load: i64,
    /// `skipFloors`: kept as the doubles the save carries, as the TypeScript
    /// does, so a hand-edited fraction re-saves unchanged and never matches a
    /// floor.
    pub skip_floors: Option<Vec<f64>>,
    /// True only for imported Classic PC TDT express shafts; persisted in saves.
    pub preserve_basement_stops: bool,
    pub schedule: Option<Schedule>,
}

impl Transport {
    /// `serializeTransport` (sim/coerce.ts).
    pub fn serialize(&self) -> Value {
        let mut m = Map::new();
        m.insert("id".into(), json!(self.id));
        m.insert("kind".into(), json!(self.kind.as_str()));
        m.insert("x".into(), json!(self.x));
        m.insert("width".into(), json!(self.width));
        m.insert("bottom".into(), json!(self.bottom));
        m.insert("top".into(), json!(self.top));
        m.insert("cars".into(), json!(self.cars));
        m.insert("carPositions".into(), json!(self.car_positions));
        m.insert("carDir".into(), json!(self.car_dir));
        if let Some(l) = &self.car_load {
            m.insert("carLoad".into(), json!(l));
        }
        m.insert("load".into(), json!(self.load));
        if let Some(s) = &self.skip_floors {
            m.insert("skipFloors".into(), json!(s));
        }
        if self.preserve_basement_stops {
            m.insert("preserveBasementStops".into(), json!(true));
        }
        if let Some(s) = &self.schedule {
            if !s.is_empty() {
                m.insert("schedule".into(), s.to_json());
            }
        }
        Value::Object(m)
    }

    pub fn stops_at(&self, fl: i64) -> bool {
        fl >= self.bottom
            && fl <= self.top
            && !self
                .skip_floors
                .as_ref()
                .is_some_and(|s| s.contains(&(fl as f64)))
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlaceResult {
    pub ok: bool,
    pub reason: Option<String>,
    pub unit_id: Option<i64>,
}

/// `resizeTransport`'s result: a `PlaceResult` plus what the resize did.
#[derive(Clone, Debug, PartialEq)]
pub struct ResizeResult {
    pub ok: bool,
    pub reason: Option<String>,
    pub added: i64,
    pub floor_tiles_created: i64,
}

impl ResizeResult {
    pub(super) fn fail(reason: impl Into<String>) -> ResizeResult {
        ResizeResult {
            ok: false,
            reason: Some(reason.into()),
            added: 0,
            floor_tiles_created: 0,
        }
    }
}

impl PlaceResult {
    pub(super) fn fail(reason: impl Into<String>) -> PlaceResult {
        PlaceResult {
            ok: false,
            reason: Some(reason.into()),
            unit_id: None,
        }
    }
    pub(super) fn ok() -> PlaceResult {
        PlaceResult {
            ok: true,
            reason: None,
            unit_id: None,
        }
    }
}
