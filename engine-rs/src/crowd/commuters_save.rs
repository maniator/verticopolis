//! The office commuters in a save: each office's desk (the workers inside,
//! on the way in and booked to leave) and the arrivals and departures booked
//! for the rest of the hour, so a reload carries on the commute where it
//! stood instead of booking it twice. The workers on the way are crowd people
//! and travel with the rest of the crowd (`save.rs`).
//!
//! Both lists are written only while they hold something, so a tower whose
//! offices count by the clock (every Classic tower, and every tower while the
//! real commutes are switched off) saves neither. A save without them loads
//! as before: the first hourly pass takes the head counts as the workers
//! inside (`commuters::reconcile`).

use std::collections::BTreeMap;

use serde::ser::{Serialize, SerializeMap, SerializeSeq, Serializer};
use serde_json::{json, Map, Value};

use super::commuters::{is_office, Desk, Shift};
use super::save::{MAX_SAVED_PEOPLE, MAX_SAVED_WALK_INS};
use super::Crowd;
use crate::charges::whole;
use crate::facilities::Kind;
use crate::sim_save::Each;
use crate::tower::Tower;

/// The most desks a save restores, one per office: far above the offices
/// any tower holds, it only bounds what a hand-edited save can make the
/// loader keep.
const MAX_SAVED_DESKS: usize = 10_000;

/// A desk as the save writes it: `[officeId, floor, x, width, inside,
/// coming, going]`.
fn desk_json(id: i64, d: &Desk) -> Value {
    json!([id, d.floor, d.x, d.width, d.inside, d.coming, d.going])
}

/// A booking's row: `[at, office, inbound]`, with the station it is held
/// for as a fourth entry only when it has one, so a save without held
/// arrivals is written as before.
fn shift_json(s: &Shift) -> Value {
    match s.station {
        Some(sid) => json!([s.at, s.office_id, s.inbound, sid]),
        None => json!([s.at, s.office_id, s.inbound]),
    }
}

fn desk_from(v: &Value) -> Option<(i64, Desk)> {
    let row = v.as_array().filter(|r| r.len() == 7)?;
    let n: Vec<i64> = row
        .iter()
        .map(|n| n.as_f64().and_then(whole))
        .collect::<Option<_>>()?;
    // Head counts are never negative, and an office is at least a tile wide.
    if n[3] < 1 || n[4..].iter().any(|&c| c < 0) {
        return None;
    }
    // No more workers than an office holds: each one inside may be sent out
    // as a person on the first hourly pass (`commuters::reconcile`), so a
    // forged count must not make that pass endless (#2230).
    let most = Kind::Office.facility().population;
    let desk = Desk {
        floor: n[1],
        x: n[2],
        width: n[3],
        inside: n[4].min(most),
        coming: n[5].min(most),
        going: n[6].min(most),
    };
    Some((n[0], desk))
}

fn shift_from(v: &Value) -> Option<Shift> {
    let row = v.as_array().filter(|r| r.len() == 3 || r.len() == 4)?;
    let station = match row.get(3) {
        Some(sid) => Some(sid.as_f64().and_then(whole)?),
        None => None,
    };
    Some(Shift {
        at: row[0].as_f64().filter(|n| n.is_finite())?,
        office_id: row[1].as_f64().and_then(whole)?,
        inbound: row[2].as_bool()?,
        station,
    })
}

/// The desks as the save streams them: one small row at a time, so a tower
/// with thousands of offices builds no list of them beside the save's text.
struct DeskRows<'a>(&'a BTreeMap<i64, Desk>);

impl Serialize for DeskRows<'_> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut seq = s.serialize_seq(Some(self.0.len()))?;
        for (&id, d) in self.0 {
            seq.serialize_element(&desk_json(id, d))?;
        }
        seq.end()
    }
}

impl Crowd {
    /// Writes the desks and the booked commutes into the crowd's save map
    /// as [`Crowd::commuters_save`] adds them, each only when it holds
    /// something.
    pub(crate) fn commuters_write<M: SerializeMap>(&self, m: &mut M) -> Result<(), M::Error> {
        if !self.desks.is_empty() {
            m.serialize_entry("desks", &DeskRows(&self.desks))?;
        }
        if !self.shifts.is_empty() {
            m.serialize_entry("shifts", &Each(&self.shifts, shift_json))?;
        }
        Ok(())
    }

    /// Adds the desks and the booked commutes to the crowd's save object,
    /// each only when it holds something.
    pub(crate) fn commuters_save(&self, m: &mut Map<String, Value>) {
        if !self.desks.is_empty() {
            let rows = self.desks.iter().map(|(&id, d)| desk_json(id, d));
            m.insert("desks".into(), Value::Array(rows.collect()));
        }
        if !self.shifts.is_empty() {
            let rows = self.shifts.iter().map(shift_json);
            m.insert("shifts".into(), Value::Array(rows.collect()));
        }
    }

    /// The desks and the bookings a save's crowd object carries. A row that
    /// does not read is skipped, and a second desk for one office keeps the
    /// first.
    pub(crate) fn commuters_restore(&mut self, o: &Map<String, Value>) {
        if let Some(rows) = o.get("desks").and_then(Value::as_array) {
            for (id, desk) in rows.iter().filter_map(desk_from) {
                if self.desks.len() == MAX_SAVED_DESKS {
                    break;
                }
                self.desks.entry(id).or_insert(desk);
            }
        }
        if let Some(rows) = o.get("shifts").and_then(Value::as_array) {
            let rows = rows.iter().take(MAX_SAVED_WALK_INS);
            self.shifts.extend(rows.filter_map(shift_from));
            self.sort_shifts();
        }
    }

    /// Bounds the workers a save's desks can send out at once. The first
    /// pass after a load (`commuters::reconcile`) walks the workers of an
    /// office that no longer stands out of the building, one person each. A
    /// save taken just after a bulldoze holds a few such desks; a forged one
    /// could hold thousands. Desks of offices that are gone are kept in id
    /// order while their workers fit beside the saved people under the
    /// people a save may hold, and the rest are dropped.
    pub(crate) fn bound_gone_desks(&mut self, tower: &Tower) {
        let mut room = MAX_SAVED_PEOPLE.saturating_sub(self.people.len()) as i64;
        self.desks.retain(|&id, desk| {
            let stands = tower.get_unit(id).is_some_and(|u| is_office(u, tower.mode));
            if stands {
                return true;
            }
            let fits = desk.inside <= room;
            if fits {
                room -= desk.inside;
            }
            fits
        });
    }
}
