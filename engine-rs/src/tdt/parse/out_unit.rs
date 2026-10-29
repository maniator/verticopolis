//! The unit record the importer writes into the save.

use serde_json::{json, Map, Value};

use super::jnum;
use crate::facilities::Kind;

/// A unit as the importer writes it into the save.
pub(super) struct OutUnit {
    pub(super) id: i64,
    pub(super) kind: Kind,
    pub(super) floor: i64,
    pub(super) x: i64,
    pub(super) width: i64,
    pub(super) state: &'static str,
    pub(super) occupants: i64,
    pub(super) ever_occupied: bool,
    pub(super) rent: Option<f64>,
    pub(super) no_rate: bool,
    pub(super) subtype: Option<&'static str>,
    pub(super) complete_at: Option<i64>,
}

impl OutUnit {
    pub(super) fn to_json(&self) -> Value {
        let mut m = Map::new();
        m.insert("id".into(), json!(self.id));
        m.insert("kind".into(), json!(self.kind.as_str()));
        m.insert("floor".into(), json!(self.floor));
        m.insert("x".into(), json!(self.x));
        m.insert("width".into(), json!(self.width));
        m.insert("state".into(), json!(self.state));
        m.insert("satisfaction".into(), json!(1));
        m.insert("occupants".into(), json!(self.occupants));
        m.insert("everOccupied".into(), json!(self.ever_occupied));
        m.insert("pendingIncome".into(), json!(0));
        m.insert("label".into(), json!(self.kind.facility().name));
        if let Some(r) = self.rent {
            m.insert("rent".into(), jnum(r));
        }
        if self.no_rate {
            m.insert("noRate".into(), json!(true));
        }
        if let Some(s) = self.subtype {
            m.insert("subtype".into(), json!(s));
        }
        if let Some(c) = self.complete_at {
            m.insert("completeAt".into(), json!(c));
        }
        Value::Object(m)
    }
}
