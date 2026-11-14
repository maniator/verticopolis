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
//! and a room or a shaft it takes out is in the use the step found it in.
//! Anything else refuses the step, which changes nothing, so the cash it
//! carries never moves for an edit that is no longer there to reverse, and
//! undoing a build never sells a used room or shaft back at its full price.
//!
//! Around the images, a step does what the edit commands do around theirs.
//! Taking out the last Wedding Hall calls off the VIP's visit, as a sale of
//! it does (`Simulation::remove_facility`). A shaft comes back with its cars
//! empty ([`Transport::returning`]). The people riding a shaft or a car a
//! step takes away, and those waiting on floors a shorter span no longer
//! serves, are settled on the next step of the crowd, as after the edit
//! commands that sell a car or shrink a span: a rider whose shaft or car is
//! gone gets off, and a wait no car can end runs out. A step sends no
//! gameplay event: the analytics leave undo and redo untracked
//! (`src/analyticsCore.ts`), so the build an undo takes back still counts as
//! built, and no undo reads as a sale.
#![cfg_attr(not(feature = "wasm"), allow(dead_code))]
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::sim_undo_caps::caps_held;
use crate::tower::{Transport, UnitState};
use crate::undo::{
    Step, Swap, TransportChange, TransportImage, UnitChange, UnitFacts, UnitImage, UnitUse,
};
use crate::undo_journal::Before;

pub(crate) use crate::sim_undo_check::StepRefused;

#[doc(hidden)]
impl Simulation {
    /// Open the journal for a gesture named `label`. The port keeps the step
    /// of a journal already open before it opens this one.
    pub(crate) fn begin_undo_journal(&mut self, label: &str) {
        self.tower.journal = Some(Box::new(crate::undo_journal::Journal::new(
            label,
            self.on_hour_runs,
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

    /// An edit command sets the VIP visit day (a Wedding Hall built, the
    /// last one sold): the open gesture's step puts it back. The day time
    /// moves (`Simulation::check_vip`) is set directly and is no part of
    /// a step, so an undo never brings the VIP back early.
    pub(crate) fn edit_vip_visit_day(&mut self, day: f64) {
        if let Some(journal) = self.tower.journal.as_mut() {
            journal.vip_day_moved(self.vip_visit_day, day);
        }
        self.vip_visit_day = day;
    }

    /// Run `f`, which is no edit (the player's answer to an emergency, a
    /// fire started by hand), with the open gesture's journal off the
    /// tower, as it is while the simulation advances: what it does to the
    /// tower is time's doing and no part of the gesture's step.
    pub(crate) fn outside_the_gesture<R>(&mut self, f: impl FnOnce(&mut Simulation) -> R) -> R {
        let paused = self.pause_undo_journal();
        let done = f(self);
        self.resume_undo_journal(paused);
        done
    }

    /// A build dug new ground that could hold treasure: the open gesture's
    /// step can never be undone.
    pub(crate) fn note_treasure_search(&mut self) {
        if let Some(journal) = self.tower.journal.as_mut() {
            journal.searched_for_treasure();
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
                let built = !matches!(seen.before, Before::Was(_));
                let change = match (seen.before, now) {
                    (Before::Was(before), Some(now)) => {
                        if now.config_eq(&before) {
                            return None;
                        }
                        UnitChange::Restore {
                            want: UnitFacts::of(&before),
                            left: UnitFacts::of(now),
                        }
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
                    built,
                })
            })
            .collect();
        let transports: Vec<TransportImage> = closed
            .transports
            .into_iter()
            .filter_map(|seen| {
                let now = self.tower.get_transport(seen.id);
                // The rides a shaft had when the gesture found it (none, for
                // one it built), so a ride while the gesture was open counts
                // as use too. An undo takes away what the edit bought: the
                // shaft it built, or the cars and floors a restore takes back
                // (`TransportImage::built`), but not a sold shaft it puts back.
                let (change, built) = match (seen.before, now) {
                    (Some(before), Some(now)) => {
                        if now.config_eq(&before) {
                            return None;
                        }
                        let rides = before.rides;
                        let restore = TransportChange::Restore {
                            want: Box::new(before),
                            left: Box::new(Transport {
                                rides,
                                ..now.clone()
                            }),
                        };
                        (restore, true)
                    }
                    (Some(before), None) => (TransportChange::PutBack(Box::new(before)), false),
                    (None, Some(now)) => {
                        let take_out = TransportChange::TakeOut {
                            left: Box::new(Transport {
                                rides: 0,
                                ..now.clone()
                            }),
                        };
                        (take_out, true)
                    }
                    (None, None) => return None,
                };
                Some(TransportImage {
                    id: seen.id,
                    at: seen.at,
                    change,
                    built,
                })
            })
            .collect();
        let mut step = Step {
            label: closed.label,
            money: -closed.money,
            vip_visit_day: closed.vip_visit_day,
            units,
            transports,
            caps_held: Vec::new(),
            searched_for_treasure: closed.searched_for_treasure,
            // A build the gesture took out again was used while it stood:
            // by a ride, or by an hourly pass run since the gesture opened.
            used_in_gesture: closed.used_then_taken
                || (closed.took_own_build && self.on_hour_runs != closed.hour_passes),
            hour_passes: closed.hour_passes,
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
        if self.edit_refusal().is_some() {
            return Err(StepRefused::BombSearch);
        }
        self.check_undo_step(step)?;
        let day_found = self.vip_visit_day;
        let mut back = Step {
            label: step.label.clone(),
            units: Vec::new(),
            transports: Vec::new(),
            money: -step.money,
            vip_visit_day: None,
            caps_held: Vec::new(),
            // A step that searched, or whose builds were used inside their
            // gesture, is refused, so it never reaches here.
            searched_for_treasure: false,
            used_in_gesture: false,
            hour_passes: self.on_hour_runs,
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
        let took_out_a_hall = self.apply_unit_images(step, &mut back);
        self.apply_transport_images(step, shafts_now, &mut back);
        self.money += step.money;
        if let Some(swap) = step
            .vip_visit_day
            .filter(|s| s.expect == self.vip_visit_day)
        {
            self.vip_visit_day = swap.set;
        }
        if took_out_a_hall
            && self.tower.built_wedding_hall != Some(true)
            && self.evaluated_tower != Some(true)
        {
            self.vip_visit_day = -1.0;
        }
        // The opposite step puts back exactly what this one did to the day.
        back.vip_visit_day = (self.vip_visit_day != day_found).then_some(Swap {
            expect: self.vip_visit_day,
            set: day_found,
        });
        // An elevator's extend gesture bills each floor once against its
        // high-water mark; a step moves the span, so the mark goes with it.
        self.end_extend();
        self.tower.revision += 1;
        self.tower.meta_revision += 1;
        back.caps_held = caps_held(&self.tower, &back);
        Ok(back)
    }

    /// Apply the unit images: every unit a check found where the step
    /// expects it. Answers whether a Wedding Hall went.
    fn apply_unit_images(&mut self, step: &Step, back: &mut Step) -> bool {
        let mut out = Vec::new();
        let mut put = Vec::new();
        let mut inserts = Vec::new();
        let mut took_out_a_hall = false;
        for img in &step.units {
            let now = self
                .tower
                .by_id
                .get(&img.id)
                .map(|&i| (i, self.tower.units[i].clone()));
            let (change, at) = match (&img.change, now) {
                (UnitChange::TakeOut(_), Some((at, now))) => {
                    out.push(img.id);
                    took_out_a_hall |= now.kind == Kind::WeddingHall;
                    (UnitChange::PutBack(now), at)
                }
                (UnitChange::Restore { want, left }, Some((at, now))) => {
                    put.push((back.units.len(), img.id, want, left));
                    // `left` is the unit once `want` is on it, read below.
                    let found = UnitFacts::of(&now);
                    (
                        UnitChange::Restore {
                            want: found.clone(),
                            left: found,
                        },
                        at,
                    )
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
                built: img.built,
            });
        }
        self.tower.remove_units(&out);
        for (k, id, want, left) in put {
            self.tower.put_unit_facts(id, want, left);
            if let (Some(u), UnitChange::Restore { left, .. }) =
                (self.tower.get_unit(id), &mut back.units[k].change)
            {
                *left = UnitFacts::of(u);
            }
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
        took_out_a_hall
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
                    let shaft = want.returning();
                    let left = Box::new(shaft.clone());
                    inserts.push((at, shaft));
                    TransportChange::TakeOut { left }
                }
                _ => unreachable!("the step was checked against the tower"),
            };
            // The opposite of a restore runs the edit the other way: an
            // undo's takes back what the edit sold, at the sale's price, and
            // a redo's what it bought.
            let built = match change {
                TransportChange::Restore { .. } => !img.built,
                _ => img.built,
            };
            back.transports.push(TransportImage {
                id: img.id,
                at,
                change,
                built,
            });
        }
        for id in out {
            self.tower.remove_transport(id);
        }
        for (k, want) in put {
            let mut shrank = false;
            if let Some(t) = self.tower.get_transport_mut(want.id) {
                let before = t.car_positions.len();
                t.take_config_from(want);
                shrank = t.car_positions.len() < before;
                if let TransportChange::Restore { left, .. } = &mut back.transports[k].change {
                    **left = t.clone();
                }
            }
            // A step that takes cars away lets their riders off now, as a
            // sale does, so the opposite step cannot seat them again (#855).
            if shrank {
                self.let_off_riders_past_fleet(want.id);
            }
        }
        inserts.sort_by_key(|&(at, _)| at);
        for (at, shaft) in inserts {
            self.tower.insert_transport_at(at, shaft);
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

#[cfg(test)]
#[path = "sim_undo_use_tests.rs"]
mod use_tests;

#[cfg(test)]
#[path = "sim_undo_ground_tests.rs"]
mod ground_tests;

#[cfg(test)]
#[path = "sim_undo_hour_tests.rs"]
mod hour_tests;

#[cfg(test)]
#[path = "sim_undo_floor_end_tests.rs"]
mod floor_end_tests;

#[cfg(test)]
#[path = "sim_undo_cleanup_tests.rs"]
mod cleanup_tests;

#[cfg(test)]
#[path = "sim_undo_site_tests.rs"]
mod site_tests;

#[cfg(test)]
#[path = "sim_undo_root_tests.rs"]
mod root_tests;
