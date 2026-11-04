//! The port's undo and redo (`undoCapture`, `undoCommit`, `undoDiscard`,
//! `undoClear`, `undo`, `redo`, `undoNotice`). The engine keeps the steps
//! (`crate::undo`) beside the tower they belong to. A gesture opens a
//! journal on the tower when it starts and closes it at its end; the step it
//! leaves holds only what the edit changed (`undo_journal.rs`). A step back
//! or forward applies those images and the cash the edit moved, and keeps
//! the opposite step. Adopting another tower (`loadSave`, `foundTower`, a
//! file, `restore`) forgets the steps, so no host has to.
//!
//! A gesture that changed the tower is always kept as a step, even when the
//! host opens another gesture or drops this one before closing it: the
//! steps apply one after another, so an edit left out of them would let an
//! older step meet a tower it does not know. An edit made with no gesture
//! open is in no step; a step that then meets a tower it does not expect is
//! refused (`sim_undo_check.rs`), and a host stops a drag whose gesture an
//! undo, a redo or another gesture closed.
use super::Engine;
use crate::sim_undo::StepRefused;

/// `undo` and `redo` answer `[status, generation]`, the shape `restore`
/// answers. A step that was put back is `1` (as a done swap is), a step the
/// restore refused is `0` (`lastReason()` says why), and nothing to step to
/// is [`NOTHING_TO_STEP`].
pub(crate) const NOTHING_TO_STEP: f64 = 2.0;

/// The message when the undo stack is empty.
pub(crate) const NOTHING_TO_UNDO: &str = "Nothing to undo.";

/// The message when the redo stack is empty.
pub(crate) const NOTHING_TO_REDO: &str = "Nothing to redo.";

/// Which way a step goes.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Way {
    Undo,
    Redo,
}

impl Engine {
    /// Open the journal for a gesture named `label` ("Bulldoze"), before its
    /// first change. A gesture already open is closed first, and kept as a
    /// step if it changed something.
    pub(crate) fn port_undo_capture(&mut self, label: &str) {
        self.port_undo_commit();
        self.sim.begin_undo_journal(label);
    }

    /// Close the gesture under way, keeping its step only if the edit
    /// changed something. Answers whether a step was kept.
    pub(crate) fn port_undo_commit(&mut self) -> bool {
        match self.sim.end_undo_journal() {
            Some(step) => {
                self.undo.keep(step);
                true
            }
            None => false,
        }
    }

    /// Drop the gesture under way: a host that knows nothing legitimate is
    /// pending (a long-press peek). A gesture that did change the tower is
    /// kept all the same, so no gesture's edit is left out of the steps.
    pub(crate) fn port_undo_discard(&mut self) {
        self.port_undo_commit();
    }

    /// Forget every step: the host adopted a different tower by a route that
    /// does not clear them itself.
    pub(crate) fn port_undo_clear(&mut self) {
        self.sim.discard_undo_journal();
        self.undo.clear();
    }

    /// Step back through the newest undo step. See [`NOTHING_TO_STEP`].
    pub(crate) fn port_undo(&mut self) -> Vec<f64> {
        self.step(Way::Undo)
    }

    /// Step forward through the newest redo step.
    pub(crate) fn port_redo(&mut self) -> Vec<f64> {
        self.step(Way::Redo)
    }

    /// What the last `undo` or `redo` has for the player ("Undid: Bulldoze",
    /// "Nothing to undo."); none after a refused step, which has a reason.
    pub(crate) fn port_undo_notice(&self) -> Option<String> {
        self.undo_notice.clone()
    }

    /// `[undo, redo]`: how many steps each stack holds.
    pub(crate) fn port_undo_depths(&self) -> Vec<f64> {
        let (undo, redo) = self.undo.depths();
        vec![undo as f64, redo as f64]
    }

    /// An undo or a redo. A gesture under way is closed first, so a step
    /// taken mid-drag undoes the drag. The opposite step is kept only once
    /// this one has applied. A step that is refused (the balance cannot pay
    /// for it, a room it would take out has been used or is burning, or the
    /// tower is not the one it expects) changes nothing and stays where it
    /// was.
    fn step(&mut self, way: Way) -> Vec<f64> {
        self.undo_notice = None;
        self.port_undo_commit();
        let step = match way {
            Way::Undo => self.undo.pop_undo(),
            Way::Redo => self.undo.pop_redo(),
        };
        let Some(step) = step else {
            self.reason = None;
            let nothing = match way {
                Way::Undo => NOTHING_TO_UNDO,
                Way::Redo => NOTHING_TO_REDO,
            };
            self.undo_notice = Some(nothing.to_owned());
            return vec![NOTHING_TO_STEP, self.generation as f64];
        };
        self.reason = None;
        match self.sim.apply_undo_step(&step) {
            Ok(back) => {
                let said = match way {
                    Way::Undo => {
                        self.undo.push_redo(back);
                        "Undid"
                    }
                    Way::Redo => {
                        self.undo.push_undo(back);
                        "Redid"
                    }
                };
                self.undo_notice = Some(format!("{said}: {}", step.label));
                // The same tower, changed under its readers: hosts treat the
                // move like any swap and read it afresh.
                self.mirror = crate::save_delta::SaveMirror::default();
                self.generation += 1;
                self.swap_record(true)
            }
            Err(why) => {
                let verb = match way {
                    Way::Undo => {
                        self.undo.push_undo(step);
                        "undo"
                    }
                    Way::Redo => {
                        self.undo.push_redo(step);
                        "redo"
                    }
                };
                self.refuse_swap(refusal(why, verb))
            }
        }
    }
}

/// What the player reads when a step is refused; `verb` is "undo" or "redo".
pub(crate) fn refusal(why: StepRefused, verb: &str) -> String {
    match why {
        StepRefused::NotEnoughMoney => format!("Not enough money to {verb} that."),
        StepRefused::InUse => {
            format!("Can't {verb} that: the room has been in use since. Sell it instead.")
        }
        StepRefused::OnFire => format!("Can't {verb} that while the room is on fire."),
        StepRefused::PriceFixed => format!("Can't {verb} that: a sold condo keeps its price."),
        StepRefused::Stale => format!("Can't {verb} that: the tower has changed since."),
    }
}

#[cfg(test)]
#[path = "wasm_port_undo_tests.rs"]
mod tests;
