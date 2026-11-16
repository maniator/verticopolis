//! The office commuters in a save: each office's desk (the workers inside,
//! on the way in and booked to leave) and the arrivals and departures booked
//! for the rest of the hour, so a reload carries on the commute where it
//! stood instead of booking it twice. The workers on the way are crowd people
//! and travel with the rest of the crowd (`save.rs`).
//!
//! `desksStale` marks a save made after an edit the desks were not squared
//! with yet (workers stranded, a venue's crew to call in), so the load
//! leaves that to its first step, as the game that saved would have. `venueStaff` marks a
//! save from a game whose venue staff commute (`CrowdMarks`).
//!
//! Both lists are written only while they hold something, so a tower whose
//! offices count by the clock (every Classic tower, and every tower while the
//! real commutes are switched off) saves neither. A save without them loads
//! as before: the first hourly pass takes the head counts as the workers
//! inside (`commuters::reconcile`).

use std::collections::BTreeMap;

use serde::ser::{Serialize, SerializeMap, SerializeSeq, Serializer};
use serde_json::{json, Map, Value};

use super::commuters::{square, Desk, Shift, UNSQUARED};
use super::save::{MAX_SAVED_PEOPLE, MAX_SAVED_WALK_INS};
use super::workplace::Workplace;
use super::workplace::{stranded, venue_bookings_due};
use super::Crowd;
use crate::charges::whole;
use crate::facilities::Kind;
use crate::sim_save::Each;
use crate::tower::Tower;

/// The most desks a save restores, one per office, staffed venue or home:
/// far above the rooms any tower holds, it only bounds what a hand-edited
/// save can make the loader keep.
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
        Some(sid) => json!([s.at, s.workplace_id, s.inbound, sid]),
        None => json!([s.at, s.workplace_id, s.inbound]),
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
    // No more workers than an office holds, which no venue's staff pass
    // (`no_venue_keeps_more_staff_than_an_office_holds`): each one inside may be sent out
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
        workplace_id: row[1].as_f64().and_then(whole)?,
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
    pub(crate) fn commuters_write<M: SerializeMap>(
        &self,
        m: &mut M,
        marks: CrowdMarks,
    ) -> Result<(), M::Error> {
        for key in marks.keys() {
            m.serialize_entry(key, &true)?;
        }
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
    pub(crate) fn commuters_save(&self, m: &mut Map<String, Value>, marks: CrowdMarks) {
        for key in marks.keys() {
            m.insert(key.into(), json!(true));
        }
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
            let stands = tower
                .get_unit(id)
                .is_some_and(|u| Workplace::of(u, tower.mode).is_some());
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

/// What a save marks beside the crowd's desks.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct CrowdMarks {
    /// `desksStale`: the next step squares the desks with an edit.
    pub desks_stale: bool,
    /// `venueStaff`: the game that saved had its venue staff commute, so a
    /// venue without a desk had nobody in. A save without it is from before
    /// they did, and its open venues start with their staff at work.
    pub venue_staff: bool,
}

impl CrowdMarks {
    /// The marks a save of `crowd` in `tower` at `hour` carries. A crowd
    /// no step has squared yet is not marked `venueStaff`: its first step
    /// has the open venues' staff at work, as a load without the mark does.
    pub(crate) fn of(crowd: &Crowd, tower: &Tower, hour: i64) -> CrowdMarks {
        let squared_once = crowd.desk_revision.is_some();
        CrowdMarks {
            desks_stale: desks_stale(crowd, tower, hour),
            venue_staff: squared_once && tower.mode.venue_staff_commute_in_person(),
        }
    }

    /// The marks set, by their save keys, in the order a save writes them.
    fn keys(self) -> impl Iterator<Item = &'static str> {
        let marks = [
            ("desksStale", self.desks_stale),
            ("venueStaff", self.venue_staff),
        ];
        marks.into_iter().filter(|m| m.1).map(|m| m.0)
    }

    /// The marks a save's crowd object carries.
    pub(crate) fn read(crowd: Option<&Value>) -> CrowdMarks {
        let set = |key: &str| crowd.and_then(|c| c.get(key)) == Some(&Value::Bool(true));
        CrowdMarks {
            desks_stale: set("desksStale"),
            venue_staff: set("venueStaff"),
        }
    }
}

/// The first squaring of a fresh crowd: each office's head count becomes
/// its workers inside, and, with `venues_at` an hour (a save from before
/// venue staff commuted), each venue staffed then with no desk starts with
/// its crew at work.
pub(super) fn adopt_head_counts(crowd: &mut Crowd, tower: &Tower, venues_at: Option<i64>) {
    for u in tower.room_units() {
        let inside = match Workplace::of(u, tower.mode) {
            Some(Workplace::Office | Workplace::Home | Workplace::Hotel) => u.occupants,
            Some(Workplace::Venue)
                if !crowd.desks.contains_key(&u.id)
                    && u.is_operational()
                    && venues_at.is_some_and(|hour| u.kind.staffed_at(hour)) =>
            {
                u.kind.staff_size()
            }
            _ => 0,
        };
        if inside > 0 {
            let desk = crowd.desks.entry(u.id).or_default();
            (desk.floor, desk.x, desk.width) = (u.floor, u.x, u.width);
            desk.inside = inside;
        }
    }
}

/// Squares a loaded tower's desks as `reconcile` does, without sending
/// anyone out: a save marks (`desksStale`) the workers a step would still
/// send out, and they go at the first step, as in the game that saved. A
/// save that marks `venueStaff` keeps a venue without a desk empty: its
/// crew was not in yet. A save without it (one from before venue staff
/// commuted, or one no step had squared) has its open venues' staff at
/// work, and its first step squares the desks as a fresh crowd's does.
pub fn restore_desks(crowd: &mut Crowd, tower: &mut Tower, hour: i64, marks: CrowdMarks) {
    if !tower.mode.office_workers_commute_in_person() {
        return;
    }
    let venues_at = (!marks.venue_staff).then_some(hour);
    adopt_head_counts(crowd, tower, venues_at);
    square(crowd, tower, false);
    if !marks.venue_staff {
        crowd.desk_revision = None;
    } else if marks.desks_stale {
        crowd.desk_revision = Some(UNSQUARED);
    }
}

/// Whether the next step's squaring with an edit (`start_commutes`) does
/// anything: sends out the workers a workplace taken away strands, or calls
/// in the crew of a venue built while it should be open.
pub fn desks_stale(crowd: &Crowd, tower: &Tower, hour: i64) -> bool {
    let squared = crowd.desk_revision == Some(tower.revision);
    let strands = || (crowd.desks.iter()).any(|(&id, d)| stranded(tower, id, d).1 > 0);
    tower.mode.office_workers_commute_in_person()
        && !squared
        && (strands() || venue_bookings_due(crowd, tower, hour))
}
