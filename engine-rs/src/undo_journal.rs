//! The journal an open gesture keeps: the before-image of every unit and shaft
//! its edits touch, taken the first time each is touched, and the cash the
//! edits move. It lives on the tower (`Tower::journal`), whose edit paths
//! call the `unit_*` and `transport_*` notes below just before they write, and
//! it is off the tower while the simulation advances, so time passing is never
//! part of a step. Closing the gesture turns the journal into a [`Step`]
//! (`sim_undo.rs`).
//!
//! The cash is what the edit commands themselves charge and pay back
//! ([`Journal::paid`]), never the change in the balance: a payment that is
//! not an edit (a ransom, a rescue, the exterminator) made while a gesture
//! is open is no part of its step, so no undo hands it back.
//!
//! A removed unit must go back where it stood. Its place is recorded as its
//! index in the list as the gesture found it, which is the index it has now
//! plus the earlier removals the journal already knows (`original`): units
//! added by the gesture sit after every unit that was there, and the lobby
//! brush's placements, which first take a floor tile's slot, are settled by
//! [`Journal::slots_settled`] once the brush moves them to the end.
//!
//! A unit or a shaft the gesture touched and then took out goes back as it
//! left, with the facts the gesture's edits own (a price, a name, a span)
//! as the gesture found them: time may have moved it on in between (a fire
//! gutted it, a condo sold, its income was collected), and an undo puts
//! back none of what time did.
//!
//! A build the gesture took out again leaves no image to show the use it
//! had while the gesture held it, so the journal notes that use as it goes
//! (`Journal::used_then_taken`): a room by its use, a shaft by its rides,
//! and a floor or lobby tile, or a shaft, by an hourly pass run while the
//! gesture was open (`Closed::hour_passes`).
use std::collections::HashMap;

use crate::sim_undo_check::takes_cars_or_floors;
use crate::tower::{Transport, Unit};
use crate::undo::{Step, UnitUse};

/// A unit the gesture touched, and its index in the list as the gesture
/// found it.
#[derive(Debug)]
pub(crate) struct TouchedUnit {
    pub(crate) id: i64,
    pub(crate) at: usize,
    pub(crate) before: Before,
}

/// What a touched unit was before the gesture.
#[derive(Debug)]
pub(crate) enum Before {
    /// There, as this record.
    Was(Unit),
    /// Not there: the gesture added it, and it came in with this use.
    Added(UnitUse),
    /// Not there: the gesture added it, and took it out again after the
    /// simulation used it (it holds that use).
    AddedAndUsed(UnitUse),
}

/// A shaft the gesture touched: as the gesture found it, or `None` for one
/// the gesture added.
#[derive(Debug)]
pub(crate) struct TouchedShaft {
    pub(crate) id: i64,
    pub(crate) at: usize,
    pub(crate) before: Option<Transport>,
}

/// What an open gesture has seen so far.
#[derive(Debug)]
pub(crate) struct Journal {
    label: String,
    units: Vec<TouchedUnit>,
    unit_seen: HashMap<i64, usize>,
    /// Original indexes of the units the gesture took out, ascending.
    gone: Vec<usize>,
    /// Original indexes of the floor tiles a lobby took the slot of, until
    /// the brush settles.
    slots: Vec<usize>,
    transports: Vec<TouchedShaft>,
    transport_seen: HashMap<i64, usize>,
    transports_gone: Vec<usize>,
    /// The net cash the gesture's edits moved: what they paid back less what
    /// they charged.
    cash: f64,
    /// The VIP visit day, as the gesture found it.
    vip_visit_day: f64,
    /// Whether a build dug new ground that could hold treasure.
    searched_for_treasure: bool,
    /// How many hourly passes the simulation had run when the gesture
    /// opened (`Simulation::on_hour_runs`).
    hour_passes: i64,
    /// Whether the gesture took out, or wrote over again, a floor or lobby
    /// tile it laid, a shaft it built or a shaft it bought cars or floors
    /// for: an hourly pass run while the gesture was open used it.
    took_own_build: bool,
    /// Whether a shaft the gesture built, or bought cars or floors for, was
    /// ridden before the gesture took it out or wrote over it again.
    used_then_taken: bool,
}

/// What a closed journal hands over.
pub(crate) struct Closed {
    pub(crate) label: String,
    pub(crate) units: Vec<TouchedUnit>,
    pub(crate) transports: Vec<TouchedShaft>,
    /// The net cash the gesture's edits moved.
    pub(crate) money: f64,
    pub(crate) vip_visit_day: f64,
    pub(crate) searched_for_treasure: bool,
    /// The hourly passes the simulation had run when the gesture opened.
    pub(crate) hour_passes: i64,
    /// See [`Journal`]'s field of the same name.
    pub(crate) took_own_build: bool,
    /// See [`Journal`]'s field of the same name.
    pub(crate) used_then_taken: bool,
}

/// The index a unit had in the list as the gesture found it, from the index
/// `now` it has: every earlier removal at or before it pushes it one on.
/// Original indexes in `gone` are distinct and ascending. The number of
/// earlier removals that push this unit on is a prefix: for its jth member,
/// `gone[j] - j <= now`. Find that prefix in logarithmic time.
fn original(gone: &[usize], now: usize) -> usize {
    let (mut lo, mut hi) = (0, gone.len());
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        if gone[mid] - mid <= now {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    now + lo
}

/// Whether shaft `t`, which the gesture found as `found`, has cars or
/// floors the gesture bought (`None` when it has not), and if so whether it
/// has been ridden since the gesture found it.
fn bought_and_ridden(found: &Transport, t: &Transport) -> Option<bool> {
    takes_cars_or_floors(t, found).then_some(t.rides != found.rides)
}

fn note_gone(gone: &mut Vec<usize>, at: usize) {
    let place = gone.partition_point(|&g| g < at);
    // Each original slot leaves at most once. A duplicate would invalidate
    // the prefix invariant used by original(), rather than just cost time.
    debug_assert!(gone.get(place) != Some(&at), "an index leaves once");
    gone.insert(place, at);
}

impl Journal {
    pub(crate) fn new(label: &str, vip_visit_day: f64, hour_passes: i64) -> Journal {
        Journal {
            label: label.to_owned(),
            units: Vec::new(),
            unit_seen: HashMap::new(),
            gone: Vec::new(),
            slots: Vec::new(),
            transports: Vec::new(),
            transport_seen: HashMap::new(),
            transports_gone: Vec::new(),
            cash: 0.0,
            vip_visit_day,
            searched_for_treasure: false,
            hour_passes,
            took_own_build: false,
            used_then_taken: false,
        }
    }

    /// The unit at index `i` is about to be written in place.
    pub(crate) fn unit_edit(&mut self, i: usize, u: &Unit) {
        if self.unit_seen.contains_key(&u.id) {
            return;
        }
        self.see_unit(original(&self.gone, i), u);
    }

    /// The unit at index `i` is about to leave the list. A unit the gesture
    /// added that the simulation has used since is marked, so the step
    /// never hands back its price (`sim_undo.rs`). One the gesture found
    /// goes back as it leaves, less what the gesture's edits changed.
    pub(crate) fn unit_out(&mut self, i: usize, u: &Unit) {
        let at = match self.unit_seen.get(&u.id) {
            Some(&k) => match &mut self.units[k].before {
                Before::Was(found) => {
                    *found = u.with_edit_facts_of(found);
                    self.units[k].at
                }
                &mut Before::Added(entered) => {
                    let now = UnitUse::of(u);
                    if now != entered {
                        self.units[k].before = Before::AddedAndUsed(now);
                    }
                    // A tile's use shows only in the hours it stood.
                    self.took_own_build |= u.kind.is_structural();
                    return;
                }
                Before::AddedAndUsed(_) => return,
            },
            None => {
                let at = original(&self.gone, i);
                self.see_unit(at, u);
                at
            }
        };
        note_gone(&mut self.gone, at);
    }

    /// The floor tile at index `i` is about to give its slot to a lobby: it
    /// is gone, but the list keeps its length until the brush settles.
    pub(crate) fn unit_slot(&mut self, i: usize, u: &Unit) {
        let at = match self.unit_seen.get(&u.id) {
            Some(&k) if matches!(self.units[k].before, Before::Was(_)) => self.units[k].at,
            Some(_) => return,
            None => {
                let at = original(&self.gone, i);
                self.see_unit(at, u);
                at
            }
        };
        self.slots.push(at);
    }

    /// The lobby brush moved what it placed to the end of the list: the slots
    /// it took are now gaps in the list.
    pub(crate) fn slots_settled(&mut self) {
        for at in std::mem::take(&mut self.slots) {
            note_gone(&mut self.gone, at);
        }
    }

    /// Unit `u` is about to be added to the list. Its use as it comes in
    /// ([`UnitUse::placed`]) is the use an undo expects to find.
    pub(crate) fn unit_in(&mut self, u: &Unit) {
        if self.unit_seen.contains_key(&u.id) {
            return;
        }
        self.unit_seen.insert(u.id, self.units.len());
        self.units.push(TouchedUnit {
            id: u.id,
            at: 0,
            before: Before::Added(UnitUse::placed(u)),
        });
    }

    fn see_unit(&mut self, at: usize, u: &Unit) {
        self.unit_seen.insert(u.id, self.units.len());
        self.units.push(TouchedUnit {
            id: u.id,
            at,
            before: Before::Was(u.clone()),
        });
    }

    /// The shaft at index `i` is about to be written in place. One the
    /// gesture bought cars or floors for may be about to lose them.
    pub(crate) fn transport_edit(&mut self, i: usize, t: &Transport) {
        match self.transport_seen.get(&t.id) {
            Some(&k) => {
                if let Some(found) = &self.transports[k].before {
                    let bought = bought_and_ridden(found, t);
                    self.note_own_build_taken(bought);
                }
            }
            None => self.see_transport(original(&self.transports_gone, i), t),
        }
    }

    /// A build of the gesture's is about to be written over or taken out:
    /// `ridden` says whether it was ridden first, or is `None` when it is
    /// not the gesture's.
    fn note_own_build_taken(&mut self, ridden: Option<bool>) {
        if let Some(ridden) = ridden {
            self.took_own_build = true;
            self.used_then_taken |= ridden;
        }
    }

    /// The shaft at index `i` is about to leave the list. One the gesture
    /// found goes back as it leaves, with the span, the cars, the stops and
    /// the schedule it had. The use of one the gesture built, or bought cars
    /// or floors for, is noted, so the step never hands back what the
    /// gesture paid for it (`sim_undo.rs`).
    pub(crate) fn transport_out(&mut self, i: usize, t: &Transport) {
        let at = match self.transport_seen.get(&t.id) {
            Some(&k) => {
                let Some(found) = self.transports[k].before.take() else {
                    self.note_own_build_taken(Some(t.rides > 0));
                    return;
                };
                self.note_own_build_taken(bought_and_ridden(&found, t));
                let mut leaving = t.clone();
                leaving.take_config_from(&found);
                self.transports[k].before = Some(leaving);
                self.transports[k].at
            }
            None => {
                let at = original(&self.transports_gone, i);
                self.see_transport(at, t);
                at
            }
        };
        note_gone(&mut self.transports_gone, at);
    }

    /// Shaft `id` was just added to the list.
    pub(crate) fn transport_in(&mut self, id: i64) {
        if self.transport_seen.contains_key(&id) {
            return;
        }
        self.transport_seen.insert(id, self.transports.len());
        self.transports.push(TouchedShaft {
            id,
            at: 0,
            before: None,
        });
    }

    fn see_transport(&mut self, at: usize, t: &Transport) {
        self.transport_seen.insert(t.id, self.transports.len());
        self.transports.push(TouchedShaft {
            id: t.id,
            at,
            before: Some(t.clone()),
        });
    }

    /// An edit command moved `amount` of cash: negative for a charge,
    /// positive for a refund.
    pub(crate) fn paid(&mut self, amount: f64) {
        self.cash += amount;
    }

    /// A build dug new ground that could hold treasure.
    pub(crate) fn searched_for_treasure(&mut self) {
        self.searched_for_treasure = true;
    }

    /// Close the journal.
    pub(crate) fn close(self) -> Closed {
        Closed {
            money: self.cash,
            label: self.label,
            units: self.units,
            transports: self.transports,
            vip_visit_day: self.vip_visit_day,
            searched_for_treasure: self.searched_for_treasure,
            hour_passes: self.hour_passes,
            took_own_build: self.took_own_build,
            used_then_taken: self.used_then_taken,
        }
    }
}

impl Step {
    /// Whether this step carries nothing to apply.
    pub(crate) fn is_empty(&self) -> bool {
        self.units.is_empty()
            && self.transports.is_empty()
            && self.money == 0.0
            && self.vip_visit_day.is_none()
            && !self.searched_for_treasure
    }
}

#[cfg(test)]
#[path = "undo_journal_tests.rs"]
mod tests;
