//! The simulation's side of undo: opening and closing a gesture's journal
//! (`undo_journal.rs`) and applying a step (`undo.rs`). Applying a step puts
//! back the units and shafts it carries, adds the cash it recorded, and
//! answers the opposite step, built from what it replaced. Time is not
//! rewound: the clock, the people and every unit the step does not name
//! stay as they are.
//!
//! Cash is exact. The edit commands record what they charge and pay back
//! ([`Simulation::note_edit_cash`]), a step carries that, and applying it
//! adds the reverse; nothing is priced again, and money that moved for any
//! other reason (rent, a ransom, a treasure) is never part of a step. A step
//! that would take the balance below zero is refused and kept, so undoing a
//! sale never spends money the player no longer has.
//!
//! A step applies only to the tower it expects (`sim_undo_check.rs`): what
//! it takes out or restores is there, what it puts back is not and has room,
//! and a room it takes out is in the use the step found it in. Anything else
//! refuses the step, which changes nothing and stays, so the cash it carries
//! never moves for an edit that is no longer there to reverse, and undoing a
//! build never sells a used room back at its full price.
#![cfg_attr(not(feature = "wasm"), allow(dead_code))]
use crate::sim::Simulation;
use crate::sim_undo_check::caps_held;
use crate::tower::{Transport, UnitState};
use crate::undo::{Step, Swap, TransportChange, TransportImage, UnitChange, UnitImage, UnitUse};
use crate::undo_journal::Before;

pub(crate) use crate::sim_undo_check::StepRefused;

impl Simulation {
    /// Open the journal for a gesture named `label`. The port keeps the step
    /// of a journal already open before it opens this one.
    pub(crate) fn begin_undo_journal(&mut self, label: &str) {
        self.tower.journal = Some(Box::new(crate::undo_journal::Journal::new(
            label,
            self.vip_visit_day,
        )));
    }

    /// Drop the open journal without keeping a step: the tower it recorded
    /// is going away.
    pub(crate) fn discard_undo_journal(&mut self) {
        self.tower.journal = None;
    }

    /// An edit command moved `amount` of cash (negative for a charge): the
    /// open gesture's step carries it. Payments that are not edits never
    /// come here.
    pub(crate) fn note_edit_cash(&mut self, amount: f64) {
        if let Some(journal) = self.tower.journal.as_mut() {
            journal.paid(amount);
        }
    }

    /// Close the open journal into a step, or `None` when no journal was
    /// open or the gesture changed nothing.
    pub(crate) fn end_undo_journal(&mut self) -> Option<Step> {
        let closed = self.tower.journal.take()?.close();
        let units: Vec<UnitImage> = closed
            .units
            .into_iter()
            .filter_map(|seen| {
                let now = self.tower.get_unit(seen.id);
                let change = match (seen.before, now) {
                    (Before::Was(before), Some(now)) => {
                        if now.config_eq(&before) {
                            return None;
                        }
                        UnitChange::Restore(before)
                    }
                    (Before::Was(before), None) => UnitChange::PutBack(before),
                    // The undo takes the unit out while its use is the use
                    // it came in with.
                    (Before::Added(entered), Some(_)) => UnitChange::TakeOut(entered),
                    (Before::Added(_), None) => return None,
                    // Built, used and taken out again in one gesture: the
                    // image stays, finds nothing to take out, and so refuses
                    // the step, which would otherwise hand back the price of
                    // a room that was used.
                    (Before::AddedAndUsed(used), _) => UnitChange::TakeOut(used),
                };
                Some(UnitImage {
                    id: seen.id,
                    at: seen.at,
                    change,
                })
            })
            .collect();
        let transports: Vec<TransportImage> = closed
            .transports
            .into_iter()
            .filter_map(|seen| {
                let now = self.tower.get_transport(seen.id);
                let change = match (seen.before, now) {
                    (Some(before), Some(now)) => {
                        if now.config_eq(&before) {
                            return None;
                        }
                        TransportChange::Restore {
                            want: Box::new(before),
                            left: Box::new(now.clone()),
                        }
                    }
                    (Some(before), None) => TransportChange::PutBack(Box::new(before)),
                    (None, Some(now)) => TransportChange::TakeOut {
                        left: Box::new(now.clone()),
                    },
                    (None, None) => return None,
                };
                Some(TransportImage {
                    id: seen.id,
                    at: seen.at,
                    change,
                })
            })
            .collect();
        let mut step = Step {
            label: closed.label,
            money: -closed.money,
            vip_visit_day: (closed.vip_visit_day != self.vip_visit_day).then_some(Swap {
                expect: self.vip_visit_day,
                set: closed.vip_visit_day,
            }),
            units,
            transports,
            caps_held: Vec::new(),
        };
        if step.is_empty() {
            return None;
        }
        step.caps_held = caps_held(&self.tower, &step);
        Some(step)
    }

    /// The simulation is about to advance: the journal comes off the tower,
    /// so nothing time does is recorded, and goes back after.
    pub(crate) fn pause_undo_journal(&mut self) -> Option<Box<crate::undo_journal::Journal>> {
        self.tower.journal.take()
    }

    /// The simulation advanced.
    pub(crate) fn resume_undo_journal(
        &mut self,
        paused: Option<Box<crate::undo_journal::Journal>>,
    ) {
        if paused.is_some() {
            self.tower.journal = paused;
        }
    }

    /// Apply `step` to the tower and answer the step that reverses it.
    pub(crate) fn apply_undo_step(&mut self, step: &Step) -> Result<Step, StepRefused> {
        debug_assert!(
            self.tower.journal.is_none(),
            "a step applies outside a gesture"
        );
        self.check_undo_step(step)?;
        let mut back = Step {
            label: step.label.clone(),
            units: Vec::new(),
            transports: Vec::new(),
            money: -step.money,
            vip_visit_day: step.vip_visit_day.map(Swap::reversed),
            caps_held: Vec::new(),
        };
        // The shafts as they are now, before the units: putting a lobby back
        // syncs the express stops, and the opposite step must hold each shaft
        // as this step found it.
        let shafts_now: Vec<(usize, Option<Box<Transport>>)> = step
            .transports
            .iter()
            .map(|img| match self.tower.transport_index(img.id) {
                Some(i) => (i, Some(Box::new(self.tower.transports[i].clone()))),
                None => (img.at, None),
            })
            .collect();
        self.apply_unit_images(step, &mut back);
        self.apply_transport_images(step, shafts_now, &mut back);
        self.money += step.money;
        if let Some(swap) = step
            .vip_visit_day
            .filter(|s| s.expect == self.vip_visit_day)
        {
            self.vip_visit_day = swap.set;
        }
        // An elevator's extend gesture bills each floor once against its
        // high-water mark; a step moves the span, so the mark goes with it.
        self.end_extend();
        self.tower.revision += 1;
        self.tower.meta_revision += 1;
        back.caps_held = caps_held(&self.tower, &back);
        Ok(back)
    }

    /// Apply the unit images: every unit a check found where the step
    /// expects it.
    fn apply_unit_images(&mut self, step: &Step, back: &mut Step) {
        let mut out = Vec::new();
        let mut put = Vec::new();
        let mut inserts = Vec::new();
        for img in &step.units {
            let now = self
                .tower
                .by_id
                .get(&img.id)
                .map(|&i| (i, self.tower.units[i].clone()));
            let (change, at) = match (&img.change, now) {
                (UnitChange::TakeOut(_), Some((at, now))) => {
                    out.push(img.id);
                    (UnitChange::PutBack(now), at)
                }
                (UnitChange::Restore(want), Some((at, now))) => {
                    put.push(want);
                    (UnitChange::Restore(now), at)
                }
                (UnitChange::PutBack(want), None) => {
                    let unit = want.returning();
                    let entered = UnitUse::of(&unit);
                    inserts.push((img.at, unit));
                    (UnitChange::TakeOut(entered), img.at)
                }
                _ => unreachable!("the step was checked against the tower"),
            };
            back.units.push(UnitImage {
                id: img.id,
                at,
                change,
            });
        }
        self.tower.remove_units(&out);
        for want in put {
            self.tower.put_unit_config(want.id, want);
        }
        self.tower.insert_units_at(inserts);
        for img in &step.units {
            match self.tower.get_unit(img.id) {
                Some(u) if u.state == UnitState::Construction => {
                    self.constructing.insert(img.id);
                }
                _ => {
                    self.constructing.shift_remove(&img.id);
                }
            }
        }
    }

    /// Apply the shaft images. `now` is each image's shaft as the step found
    /// it, with its place, which the opposite step keeps.
    fn apply_transport_images(
        &mut self,
        step: &Step,
        now: Vec<(usize, Option<Box<Transport>>)>,
        back: &mut Step,
    ) {
        let mut out = Vec::new();
        let mut put = Vec::new();
        let mut inserts = Vec::new();
        for (img, (at, now)) in step.transports.iter().zip(now) {
            let change = match (&img.change, now) {
                (TransportChange::TakeOut { .. }, Some(now)) => {
                    out.push(img.id);
                    TransportChange::PutBack(now)
                }
                (TransportChange::Restore { want, .. }, Some(now)) => {
                    put.push((back.transports.len(), want));
                    // `left` is the shaft once `want` is on it, read below.
                    TransportChange::Restore {
                        want: now.clone(),
                        left: now,
                    }
                }
                (TransportChange::PutBack(want), None) => {
                    inserts.push((at, want));
                    TransportChange::TakeOut { left: want.clone() }
                }
                _ => unreachable!("the step was checked against the tower"),
            };
            back.transports.push(TransportImage {
                id: img.id,
                at,
                change,
            });
        }
        for id in out {
            self.tower.remove_transport(id);
        }
        for (k, want) in put {
            if let Some(t) = self.tower.get_transport_mut(want.id) {
                t.take_config_from(want);
                if let TransportChange::Restore { left, .. } = &mut back.transports[k].change {
                    **left = t.clone();
                }
            }
        }
        inserts.sort_by_key(|&(at, _)| at);
        for (at, want) in inserts {
            self.tower.insert_transport_at(at, Transport::clone(want));
        }
    }
}

#[cfg(test)]
#[path = "sim_undo_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "sim_undo_random_tests.rs"]
mod random_tests;

#[cfg(test)]
#[path = "sim_undo_guard_tests.rs"]
mod guard_tests;

#[cfg(test)]
#[path = "sim_undo_check_tests.rs"]
mod check_tests;
