//! The port's lifecycle, events, log and text getters (facade slice 7, PR
//! 1b; the contract is
//! `architecture-rust-facade-2026-10-20/engine-port-contract.md`). A tower
//! swap (`loadSave`, `restore`, `foundTower`) replaces the simulation inside
//! this same `Engine`, so the game keeps one handle for its whole session:
//! a done swap moves [`Engine::generation`] and answers `[status,
//! generation]`; a refused one changes nothing.
use crate::charges::{whole, INVALID_REQUEST};
use crate::clock::{CalendarKind, GameMode};
use crate::gameplay::GameplayEvents;
use crate::save_delta::SaveMirror;
use crate::schedule::SCHEDULE_HOURS;
use crate::sim::{LogKind, Simulation};
use crate::view::layout::{CALENDARS, MODES};

use super::port::record;
use super::Engine;

/// The log kinds by code, as `logAfter` and `logLine` carry them.
pub(crate) const LOG_KINDS: [&str; 4] = ["info", "good", "bad", "money"];

/// The most home floors a schedule carries: one per car.
const SCHEDULE_HOMES: usize = 8;

/// `scheduleShaft`'s slots: whether a weekday row is set, its 24 hours,
/// the same for the weekend, the two timings (NaN when unset), then the
/// home-floor count and up to [`SCHEDULE_HOMES`] floors.
pub(crate) const SCHEDULE_LEN: usize = 2 * (1 + SCHEDULE_HOURS) + 2 + 1 + SCHEDULE_HOMES;

fn log_kind(code: f64) -> Option<LogKind> {
    match whole(code)? {
        0 => Some(LogKind::Info),
        1 => Some(LogKind::Good),
        2 => Some(LogKind::Bad),
        3 => Some(LogKind::Money),
        _ => None,
    }
}

fn log_code(kind: LogKind) -> f64 {
    LOG_KINDS
        .iter()
        .position(|k| *k == kind.as_str())
        .map_or(f64::NAN, |i| i as f64)
}

/// A code into one of the layout's tables.
fn table<'a>(code: f64, names: &[&'a str]) -> Option<&'a str> {
    let i = usize::try_from(whole(code)?).ok()?;
    names.get(i).copied()
}

/// The schedule's slots as the JSON `Schedule::coerce` reads, or `None` when
/// they break the input classes (contract section 3): exactly
/// [`SCHEDULE_LEN`] slots, each row flag 0 or 1, a set row's hours and the
/// home floors safe integers, the home-floor count a safe integer up to
/// [`SCHEDULE_HOMES`], and each timing finite or NaN for unset. The ranges
/// stay with `Schedule::coerce`, which clamps them as it does for the legacy
/// setter and a save.
fn schedule_json(slots: &[f64]) -> Option<serde_json::Value> {
    if slots.len() != SCHEDULE_LEN {
        return None;
    }
    let ints = |xs: &[f64]| xs.iter().map(|&x| whole(x)).collect::<Option<Vec<i64>>>();
    let mut active = serde_json::Map::new();
    for (name, at) in [("weekday", 0), ("weekend", 1 + SCHEDULE_HOURS)] {
        match whole(slots[at])? {
            0 => {}
            1 => {
                let hours = ints(&slots[at + 1..at + 1 + SCHEDULE_HOURS])?;
                active.insert(name.into(), serde_json::json!(hours));
            }
            _ => return None,
        }
    }
    let timing = 2 * (1 + SCHEDULE_HOURS);
    let mut v = serde_json::json!({ "activeCars": active });
    for (i, name) in ["waitingCarResponse", "standardFloorDeparture"]
        .iter()
        .enumerate()
    {
        let t = slots[timing + i];
        if t.is_finite() {
            v[*name] = serde_json::json!(t);
        } else if !t.is_nan() {
            return None;
        }
    }
    let homes = timing + 2;
    let n = whole(slots[homes])
        .and_then(|n| usize::try_from(n).ok())
        .filter(|&n| n <= SCHEDULE_HOMES)?;
    if n > 0 {
        v["homeFloors"] = serde_json::json!(ints(&slots[homes + 1..homes + 1 + n])?);
    }
    Some(v)
}

impl Engine {
    /// `[status, generation]`, the answer every swap gives.
    fn swap_record(&self, done: bool) -> Vec<f64> {
        vec![f64::from(u8::from(done)), self.generation as f64]
    }

    /// Put `next` in place of the tower. The replaced tower's undrained
    /// gameplay events and drop count go ahead of `next`'s own, oldest
    /// first, as `GameplayEventBuffer.inherit` does for `GameApp.adoptSim`,
    /// unless the replaced tower was the title screen's backdrop.
    fn adopt(&mut self, mut next: Simulation) {
        let prev = std::mem::take(&mut self.sim.gameplay);
        if !self.backdrop {
            let mut buf: GameplayEvents = prev;
            for e in next.gameplay.drain() {
                buf.push(e);
            }
            buf.dropped += next.gameplay.dropped;
            next.gameplay = buf;
        }
        self.sim = next;
        self.mirror = SaveMirror::default();
        self.drained.clear();
        self.backdrop = false;
        self.generation += 1;
    }

    fn refuse_swap(&mut self, reason: String) -> Vec<f64> {
        self.reason = Some(reason);
        self.swap_record(false)
    }

    /// Load a save (the `stored` and `legacy` sources).
    pub(crate) fn port_load_save(&mut self, text: &str) -> Vec<f64> {
        self.reason = None;
        match crate::load_stream::load_save_text(text.as_bytes()) {
            Ok(next) => {
                self.adopt(next);
                self.swap_record(true)
            }
            Err(e) => self.refuse_swap(e.to_string()),
        }
    }

    /// Load an undo or redo snapshot (the `history` source), keeping the
    /// live camera and auto-bridge preference, as the approved contract
    /// says and as the app's history adoption does (`keepCamera`): the view
    /// the host last stamped with `setCamera` stays, so a reader that rebuilds
    /// on the generation move reads the camera under the player.
    pub(crate) fn port_restore(&mut self, text: &str) -> Vec<f64> {
        self.reason = None;
        match crate::load_stream::load_save_text(text.as_bytes()) {
            Ok(mut next) => {
                next.auto_bridge = self.sim.auto_bridge;
                next.view = self.sim.view.take();
                self.adopt(next);
                self.swap_record(true)
            }
            Err(e) => self.refuse_swap(e.to_string()),
        }
    }

    /// Found a tower (the `found` source); the seed is a whole number that
    /// fits 32 bits unsigned, the mode and calendar codes index the layout's
    /// `modes` and `calendars`.
    pub(crate) fn port_found(
        &mut self,
        seed: f64,
        mode: f64,
        calendar: f64,
        unbridged: bool,
    ) -> Vec<f64> {
        self.reason = None;
        let seed = whole(seed).and_then(|s| u32::try_from(s).ok());
        let mode = table(mode, &MODES).and_then(GameMode::parse);
        let calendar = table(calendar, &CALENDARS).and_then(CalendarKind::parse);
        let (Some(seed), Some(mode), Some(calendar)) = (seed, mode, calendar) else {
            return self.refuse_swap(INVALID_REQUEST.into());
        };
        self.adopt(Simulation::new_game_with(seed, mode, calendar, unbridged));
        self.swap_record(true)
    }

    /// Slice 5a's undo signature on this engine: the tower signature with
    /// the balance beside it.
    pub(crate) fn port_undo_signature(&self) -> String {
        format!("{}:{}", self.sim.tower_signature(), self.sim.money)
    }

    /// Drain the gameplay events into this batch: `[dropped, count]`, the
    /// drop count since the engine was made and the batch's size. Each
    /// event's `{ name, payload }` text is `eventText(i)` until the next drain.
    pub(crate) fn port_drain_events(&mut self) -> Vec<f64> {
        self.drained = self.sim.gameplay.drain();
        vec![self.sim.gameplay.dropped as f64, self.drained.len() as f64]
    }

    pub(crate) fn port_event_text(&self, i: f64) -> Option<String> {
        let i = usize::try_from(whole(i)?).ok()?;
        self.drained.get(i).map(|e| e.to_json().to_string())
    }

    /// Mark the current tower as the title screen's scenery: the next done
    /// swap discards its events and drops.
    pub(crate) fn port_set_backdrop(&mut self, on: bool) {
        self.backdrop = on;
    }

    /// `[revision, full, ids...]`: the units whose label or subtype changed
    /// after the meta revision `since`, or, with `full` 1, every unit that
    /// carries one (a `since` the log no longer reaches, or 0).
    pub(crate) fn port_unit_meta_changed(&self, since: f64) -> Vec<f64> {
        let tower = &self.sim.tower;
        let since = crate::view::whole_revision(Some(since)).filter(|&s| s > 0);
        let (full, ids) = crate::view::meta_changed(tower, since);
        [tower.meta_revision as f64, f64::from(u8::from(full))]
            .into_iter()
            .chain(ids.into_iter().map(|id| id as f64))
            .collect()
    }

    pub(crate) fn port_unit_label(&self, id: f64) -> Option<String> {
        self.sim.tower.get_unit(whole(id)?).map(|u| u.label.clone())
    }

    pub(crate) fn port_unit_subtype(&self, id: f64) -> Option<String> {
        self.sim
            .tower
            .get_unit(whole(id)?)?
            .subtype
            .map(str::to_string)
    }

    /// The log lines after `seq` as triples `[seq, kindCode, minute]`,
    /// oldest first; each line's text is `logText(seq)`.
    pub(crate) fn port_log_after(&self, seq: f64) -> Vec<f64> {
        let Some(seq) = whole(seq) else {
            return Vec::new();
        };
        let first = self.sim.log_seq - self.sim.log.len() as i64 + 1;
        self.sim
            .log
            .iter()
            .enumerate()
            .map(|(i, e)| (first + i as i64, e))
            .filter(|(n, _)| *n > seq)
            .flat_map(|(n, e)| [n as f64, log_code(e.kind), e.minute])
            .collect()
    }

    pub(crate) fn port_log_text(&self, seq: f64) -> Option<String> {
        let seq = whole(seq)?;
        let first = self.sim.log_seq - self.sim.log.len() as i64 + 1;
        let i = usize::try_from(seq - first).ok()?;
        self.sim.log.get(i).map(|e| e.text.clone())
    }

    /// Add a line to the tower's log.
    pub(crate) fn port_log_line(&mut self, text: &str, kind: f64) -> Vec<f64> {
        self.reason = None;
        let Some(kind) = log_kind(kind) else {
            return self.refuse(INVALID_REQUEST, &[]);
        };
        self.sim.emit(text, kind);
        record(true, 0.0, &[])
    }

    /// Set an elevator's schedule from its [`SCHEDULE_LEN`] slots.
    pub(crate) fn port_schedule_shaft(&mut self, id: f64, slots: &[f64]) -> Vec<f64> {
        self.reason = None;
        let (Some(id), Some(raw)) = (whole(id), schedule_json(slots)) else {
            return self.refuse(INVALID_REQUEST, &[]);
        };
        let done = self.sim.tower.set_schedule(id, &raw);
        self.finish(self.sim.money, done, None, &[])
    }
}

#[cfg(test)]
#[path = "wasm_port_life_tests.rs"]
mod tests;
