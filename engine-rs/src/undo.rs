//! The undo and redo history: the player's steps back through a tower, kept
//! by the engine beside the tower they belong to. A step holds only what one
//! edit changed: the before-image of each unit and shaft the edit touched,
//! the cash it moved, and the few facts outside the tower it changed.
//! Applying a step puts those images back and answers the opposite step,
//! built from what it replaced, so undo and redo are one operation and a
//! step is as big as its edit, whatever the size of the tower.
//!
//! This module holds the step types and the two stacks. The journal that
//! records a step (`undo_journal.rs`) and the code that applies one
//! (`sim_undo.rs`) know the tower; the stacks know nothing about it. The
//! types are plain data (units, shafts and numbers), so a later release can
//! write the history into a save.
//!
//! A gesture (a drag, a discrete edit) opens a journal on its first change
//! and closes it at its end. The step is kept only when something changed,
//! so a misfired or empty gesture leaves no step.
//!
//! Each image says what the step expects to find as well as what it does:
//! a unit or shaft it takes out or restores is there, one it puts back is
//! not, and its tiles are free. A step that meets a tower it does not
//! expect is refused and changes nothing, so its cash never moves for an
//! edit that is not there to reverse.
//!
//! Time keeps moving, so a step can meet a build the simulation has used
//! since the step was made. A step takes a room out only while its use is as
//! the step found it ([`UnitUse`]): a room the edit built is in use once it
//! opens, and a room that was already open once anyone moved in, earned or
//! it burned. A floor or lobby tile, or a shaft, is in use once an hourly
//! pass has run with it standing ([`Step::hour_passes`]), since that pass
//! moves tenants in over the floors the tower reaches and shares the crowd
//! out among the shafts; a shaft also once anyone rides it
//! (`Transport::rides`). So an undo is never a way to sell a used build
//! back at its full price.
#![cfg_attr(not(feature = "wasm"), allow(dead_code))]
use crate::sim_undo_caps::CapHeld;
use crate::tower::{Transport, Unit, UnitState};

/// Most steps each stack keeps before the oldest is dropped.
pub(crate) const UNDO_CAP: usize = 50;

/// What a step does to one unit. `at` is the unit's place in the unit list
/// on the side where it is present, so a removed unit goes back where it
/// stood. `built` says the step's edit built the unit, so the step takes it
/// out at its full price or builds it again: a room it takes out must not
/// have opened since, nor a floor or lobby tile have stood through an hourly
/// pass. A sold unit put back and sold again is not built.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct UnitImage {
    pub(crate) id: i64,
    pub(crate) at: usize,
    pub(crate) change: UnitChange,
    pub(crate) built: bool,
}

/// What a step does to a unit, and what it expects to find there.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum UnitChange {
    /// Take the unit out. It must be in the tower, in the use it had when
    /// the step was made.
    TakeOut(UnitUse),
    /// Put the unit back with this record. It must be out of the tower, and
    /// its tiles free.
    PutBack(Unit),
    /// Put back the facts an edit owns that the edit changed, from `want`
    /// as the edit found them, where `left` has them as the edit left them.
    /// The unit must be in the tower. A fact that has changed since the
    /// edit stays as it is: the simulation names an office for the company
    /// that moves in and a burned-out room for its kind, and an undo of a
    /// price change keeps those names.
    Restore { want: UnitFacts, left: UnitFacts },
}

/// The facts of a unit an edit owns: the price, the market flag, the name,
/// the variety and the film policy (`Unit::config_eq`).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct UnitFacts {
    pub(crate) rent: Option<f64>,
    pub(crate) no_rate: bool,
    pub(crate) label: String,
    pub(crate) subtype: Option<&'static str>,
    pub(crate) film_policy: Option<&'static str>,
}

impl UnitFacts {
    pub(crate) fn of(u: &Unit) -> UnitFacts {
        UnitFacts {
            rent: u.rent,
            no_rate: u.no_rate,
            label: u.label.clone(),
            subtype: u.subtype,
            film_policy: u.extras().film_policy,
        }
    }
}

/// Whether a restore puts a fact back: the edit changed it (`want` is not
/// `left`) and nothing has changed it since (`now` is still `left`).
pub(crate) fn puts_back<T: PartialEq>(want: &T, left: &T, now: &T) -> bool {
    want != left && now == left
}

/// What the simulation has done with a room: whether it is still being
/// built, idle, on fire or otherwise in use, who is in it, whether anyone
/// ever moved in, and the income it holds. A room leaves construction once,
/// when it opens, and nothing puts it back, so a room the step found being
/// built and finds open has been in use since, whatever a move-out or a
/// collection reset after.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct UnitUse {
    pub(crate) state: UnitState,
    pub(crate) occupants: i64,
    pub(crate) ever_occupied: bool,
    pub(crate) pending_income: f64,
}

impl UnitUse {
    pub(crate) fn of(u: &Unit) -> UnitUse {
        UnitUse {
            state: u.state,
            occupants: u.occupants,
            ever_occupied: u.ever_occupied,
            pending_income: u.pending_income,
        }
    }

    /// The use a unit a gesture places comes in with: a room is placed to
    /// be built (`Simulation::build` starts its construction straight
    /// after), and floor and lobby tiles are placed as they stay.
    pub(crate) fn placed(u: &Unit) -> UnitUse {
        let placed = UnitUse::of(u);
        if u.kind.build_minutes() > 0.0 {
            UnitUse {
                state: UnitState::Construction,
                ..placed
            }
        } else {
            placed
        }
    }

    /// Whether a room the step found being built has only opened since: it
    /// is idle, nobody has moved in and it holds no income.
    pub(crate) fn only_opened(self, now: UnitUse) -> bool {
        self.state == UnitState::Construction && now == self.as_sold()
    }

    /// The use as a sale prices it: a room still being built sells as an
    /// idle one does, so a step that sells a room again (a sale's redo) does
    /// not mind that it opened.
    pub(crate) fn as_sold(self) -> UnitUse {
        match self.state {
            UnitState::Construction => UnitUse {
                state: UnitState::Empty,
                ..self
            },
            _ => self,
        }
    }
}

/// What a step does to one shaft, with its place in the shaft list as
/// [`UnitImage`] has it. `built` says the step takes away what the edit
/// bought, at the price paid: the shaft it built, or, on a restore, the cars
/// and floors the edit added, since an undo restores the shaft as the edit
/// found it. A shaft it takes them from must not have been used since. The
/// opposite of a restore replays the edit, and what it takes away is what
/// the edit sold, so it is not built.
#[derive(Clone, Debug)]
pub(crate) struct TransportImage {
    pub(crate) id: i64,
    pub(crate) at: usize,
    pub(crate) change: TransportChange,
    pub(crate) built: bool,
}

/// What a step does to a shaft, and what it expects to find there. The
/// span, the cars, the stops and the schedule carry an edit's cash (a car,
/// a floor of shaft), so a shaft the step takes out or restores must have
/// them as the edit left them (`left`). The records are boxed, as a shaft is
/// large and a restore holds two.
#[derive(Clone, Debug)]
pub(crate) enum TransportChange {
    /// Take the shaft out.
    TakeOut { left: Box<Transport> },
    /// Put the shaft back with this record. It must be out of the tower, and
    /// its column free.
    PutBack(Box<Transport>),
    /// Put the span, the cars, the stops and the schedule back from `want`.
    Restore {
        want: Box<Transport>,
        left: Box<Transport>,
    },
}

/// A fact outside the tower an edit moved: the value the world must hold for
/// the step to apply to it (`expect`) and the value it puts there (`set`).
/// A later change to the fact (the day moved on) leaves it alone.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Swap {
    pub(crate) expect: f64,
    pub(crate) set: f64,
}

/// One step: the images that undo an edit (or, applied again, redo it), the
/// edit's name, and the cash it moved. Ids are never handed out twice, so a
/// step does not move the tower's id counter.
#[derive(Clone, Debug)]
pub(crate) struct Step {
    pub(crate) label: String,
    pub(crate) units: Vec<UnitImage>,
    pub(crate) transports: Vec<TransportImage>,
    /// What applying the step adds to the balance: exactly the reverse of
    /// what the edit moved, never recomputed at today's prices.
    pub(crate) money: f64,
    /// The VIP inspection day, when the edit moved it.
    pub(crate) vip_visit_day: Option<Swap>,
    /// Whether the edit dug new ground that could hold treasure. The dig and
    /// its luck stay, so undoing the edit would make every search free: the
    /// step is refused (`sim_undo_check.rs`).
    pub(crate) searched_for_treasure: bool,
    /// Whether a floor or lobby tile the edit laid, or a shaft it built or
    /// bought cars or floors for, was used and then sold again inside the
    /// same gesture, so no image is left to show the use: the step's cash
    /// would make the use free, and the step is refused
    /// (`sim_undo_check.rs`).
    pub(crate) used_in_gesture: bool,
    /// How many hourly passes the simulation had run when the step's edit
    /// began (`Simulation::on_hour_runs`): a floor or lobby tile, or a
    /// shaft, the step takes away at its full price must not have stood
    /// through one since.
    pub(crate) hour_passes: i64,
    /// How many units and shafts the tower held under each cap the step
    /// adds under, when it was made: a tower that came in over a cap may be
    /// left as far over as the edit found it (`sim_undo_check.rs`).
    pub(crate) caps_held: Vec<CapHeld>,
}

impl Step {
    /// How many units and shafts the step carries: its size, which grows
    /// with the edit whatever the size of the tower.
    #[cfg(test)]
    pub(crate) fn weight(&self) -> usize {
        self.units.len() + self.transports.len()
    }
}

/// The two stacks.
#[derive(Debug, Default)]
pub(crate) struct UndoHistory {
    undo: Vec<Step>,
    redo: Vec<Step>,
}

impl UndoHistory {
    /// Keep a closed gesture's step as the newest undo step. The redo steps
    /// go: a fresh edit ends that trail.
    pub(crate) fn keep(&mut self, step: Step) {
        self.redo.clear();
        self.undo.push(step);
        if self.undo.len() > UNDO_CAP {
            self.undo.remove(0);
        }
    }

    /// Take the newest undo step off, for the tower to apply.
    pub(crate) fn pop_undo(&mut self) -> Option<Step> {
        self.undo.pop()
    }

    /// Take the newest redo step off.
    pub(crate) fn pop_redo(&mut self) -> Option<Step> {
        self.redo.pop()
    }

    /// Keep `step` as the newest undo step: where an undone edit's redo
    /// lands, or a step that could not be applied yet.
    pub(crate) fn push_undo(&mut self, step: Step) {
        self.undo.push(step);
        if self.undo.len() > UNDO_CAP {
            self.undo.remove(0);
        }
    }

    /// Keep `step` as the newest redo step.
    pub(crate) fn push_redo(&mut self, step: Step) {
        self.redo.push(step);
        if self.redo.len() > UNDO_CAP {
            self.redo.remove(0);
        }
    }

    /// Forget the redo steps: one could never apply again, and those after
    /// it were made on top of it.
    pub(crate) fn clear_redo(&mut self) {
        self.redo.clear();
    }

    /// Forget every step: another tower was adopted.
    pub(crate) fn clear(&mut self) {
        self.undo.clear();
        self.redo.clear();
    }

    /// How many steps each stack holds: `(undo, redo)`.
    pub(crate) fn depths(&self) -> (usize, usize) {
        (self.undo.len(), self.redo.len())
    }
}

#[cfg(test)]
#[path = "undo_tests.rs"]
mod tests;
