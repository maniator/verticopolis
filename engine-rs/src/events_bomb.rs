//! Classic's bomb search: a declined ransom hides a bomb in a room, and
//! Security's guards sweep the tower floor by floor until they find it or
//! the deadline passes and it goes off (#349). Modern keeps the instant
//! answer in `events.rs`.
//!
//! What the sources agree on (the project's SimTower reference, 2026-10-30):
//! the bomb always goes off at 1:00 PM (the manual), each office sends six
//! guards who each cover a floor (kiwizoid), guards walk the peripheral
//! emergency stairs and never ride the elevators (the manual), a full-width
//! tower is hard to search in time while a small one usually is (MentalMan,
//! furdude2), and a missed bomb guts about five floors. The search pace is
//! our estimate until a run in the original measures it; each number is one
//! named constant so that run changes a number, not the shape.

use std::collections::BTreeMap;

use serde_json::{json, Value};

use crate::facilities::Kind;
use crate::gameplay::GameplayEvent;
use crate::services::with_thousands;
use crate::sim::{LogKind, PointFx, Simulation};
use crate::tower::UnitState;

/// Guards each Security office sends out.
pub const GUARDS_PER_OFFICE: usize = 6;
/// The hour of day the bomb goes off (1:00 PM).
pub const BOMB_HOUR: f64 = 13.0;
/// Game minutes a guard spends walking one tile of a floor's rooms.
pub const SWEEP_MINUTES_PER_TILE: f64 = 0.5;
/// Game minutes a guard spends on the emergency stairs per floor climbed.
pub const STAIR_MINUTES_PER_FLOOR: f64 = 2.0;

/// The next 1:00 PM at or after `now`, as a minute count.
fn deadline_after(now: f64) -> f64 {
    let today = (now / 1440.0).floor() * 1440.0 + BOMB_HOUR * 60.0;
    if today > now {
        today
    } else {
        today + 1440.0
    }
}

/// One guard on the search: the floor it is sweeping, or `None` once no
/// floor is left for it, and the minute that sweep ends.
#[derive(Clone, Debug, PartialEq)]
pub struct Guard {
    pub floor: Option<i64>,
    pub done_at: f64,
}

/// A bomb waiting to be found. `floor` and `x` are its hiding place (the
/// player never sees them), `deadline` the minute it goes off.
#[derive(Clone, Debug, PartialEq)]
pub struct BombSearch {
    pub floor: i64,
    pub x: f64,
    pub deadline: f64,
    pub guards: Vec<Guard>,
    /// Floors swept clean, in the order the guards finished them.
    pub searched: Vec<i64>,
    /// Bumped on every change a viewer can see, so a host rereads the search
    /// only when it moved.
    pub seq: i64,
}

impl BombSearch {
    /// The save's `bomb` object.
    pub fn save_state(&self) -> Value {
        json!({
            "floor": self.floor,
            "x": self.x,
            "deadline": self.deadline,
            "guards": self.guards.iter().map(|g| json!({"floor": g.floor, "doneAt": g.done_at})).collect::<Vec<_>>(),
            "searched": self.searched,
            "seq": self.seq,
        })
    }

    /// The save's `bomb` object read back; `None` for anything malformed, so
    /// a damaged save loads without a bomb instead of failing.
    pub fn from_save(v: &Value) -> Option<BombSearch> {
        let o = v.as_object()?;
        let finite = |k: &str| o.get(k).and_then(Value::as_f64).filter(|n| n.is_finite());
        let floor = finite("floor")?.trunc() as i64;
        let x = finite("x")?;
        let deadline = finite("deadline")?;
        let mut guards = Vec::new();
        for g in o.get("guards").and_then(Value::as_array)? {
            let g = g.as_object()?;
            let done_at = g
                .get("doneAt")
                .and_then(Value::as_f64)
                .filter(|n| n.is_finite())?;
            let floor = match g.get("floor") {
                Some(Value::Null) | None => None,
                Some(f) => Some(f.as_f64().filter(|n| n.is_finite())?.trunc() as i64),
            };
            guards.push(Guard { floor, done_at });
        }
        let mut searched = Vec::new();
        for f in o.get("searched").and_then(Value::as_array)? {
            searched.push(f.as_f64().filter(|n| n.is_finite())?.trunc() as i64);
        }
        let seq = (finite("seq").unwrap_or(1.0).trunc() as i64).max(1);
        Some(BombSearch {
            floor,
            x,
            deadline,
            guards,
            searched,
            seq,
        })
    }
}

/// `h:mm AM` for a minute count, as the log writes a time of day.
fn clock_label(minutes: f64) -> String {
    let of_day = ((minutes % 1440.0) + 1440.0) % 1440.0;
    let (h, m) = (
        (of_day / 60.0).floor() as i64,
        (of_day % 60.0).floor() as i64,
    );
    let half = if h < 12 { "AM" } else { "PM" };
    let h12 = if h % 12 == 0 { 12 } else { h % 12 };
    format!("{h12}:{m:02} {half}")
}

impl Simulation {
    /// The host's read of the search: the deadline, each floor guards are
    /// sweeping now with the tile span of its rooms (where a guard paces),
    /// and the floors already clear. The hiding place stays out. One pass
    /// over the units, read only when the search's `seq` moves.
    pub fn bomb_search_view(&self) -> Option<Value> {
        let b = self.events.bomb.as_ref()?;
        let spans = self.floor_spans();
        let sweeping: Vec<Value> = b
            .guards
            .iter()
            .filter_map(|g| g.floor)
            .filter_map(|f| {
                spans
                    .get(&f)
                    .map(|&(left, right)| json!({ "floor": f, "left": left, "right": right }))
            })
            .collect();
        Some(
            json!({ "deadline": b.deadline, "sweeping": sweeping, "searched": b.searched, "seq": b.seq }),
        )
    }

    /// A bomb going off at `epicenter` (floor, x), or nowhere when the tower
    /// had no room to hide it in: the fine, the tally, the flash, every room
    /// within two floors gutted and the gameplay event. The rooms gutted.
    pub(super) fn blast(&mut self, fine: f64, epicenter: Option<(i64, f64)>) -> i64 {
        self.money -= fine;
        self.events.bombs_detonated += 1;
        let mut destroyed = 0;
        if let Some((floor, x)) = epicenter {
            self.fx.explosion = PointFx {
                floor,
                x,
                seq: self.fx.explosion.seq + 1,
            };
            for i in 0..self.tower.units.len() {
                let u = &self.tower.units[i];
                if (u.floor - floor).abs() <= 2
                    && !u.kind.is_structural()
                    && u.state != UnitState::Construction
                    && u.state != UnitState::Gutted
                {
                    let id = u.id;
                    self.events.active.shift_remove(&id);
                    self.gut(i);
                    destroyed += 1;
                }
            }
        }
        self.gameplay
            .push(GameplayEvent::BombDetonated { rooms: destroyed });
        destroyed
    }

    /// Classic's answer to a declined ransom: hide the bomb in a random room
    /// and send Security out. With no room to hide it in, the threat was
    /// empty; with no Security, nobody searches and it simply waits for the
    /// deadline.
    pub(super) fn start_bomb_search(&mut self) {
        let targets = self.flammable_units();
        if targets.is_empty() {
            self.emit(
                "💣 The bomb threat was a hoax: there was nowhere to hide a bomb.",
                LogKind::Info,
            );
            return;
        }
        let gi = *self.rng.pick(&targets);
        let room = &self.tower.units[gi];
        let (floor, x) = (room.floor, room.x as f64 + room.width as f64 / 2.0);
        let now = self.clock.minutes;
        let deadline = deadline_after(now);
        let offices: Vec<i64> = self
            .tower
            .units
            .iter()
            .filter(|u| u.kind == Kind::Security && u.is_operational())
            .map(|u| u.floor)
            .collect();
        self.events.bomb = Some(BombSearch {
            floor,
            x,
            deadline,
            guards: Vec::new(),
            searched: Vec::new(),
            seq: 1,
        });
        let spans = self.floor_spans();
        let mut guards = Vec::with_capacity(offices.len() * GUARDS_PER_OFFICE);
        for &office in &offices {
            for _ in 0..GUARDS_PER_OFFICE {
                let next = self.next_floor_to_sweep(office, &guards, &spans);
                guards.push(sweep(next, office, now));
            }
        }
        if let Some(b) = self.events.bomb.as_mut() {
            b.guards = guards;
        }
        let when = clock_label(deadline);
        if offices.is_empty() {
            self.emit(&format!("💣 You refused the ransom. With no Security to search, the bomb goes off at {when}. Build Security!"), LogKind::Bad);
        } else {
            let n = offices.len() * GUARDS_PER_OFFICE;
            self.emit(&format!("💣 You refused the ransom. {n} Security guards are searching the tower; the bomb goes off at {when}."), LogKind::Bad);
        }
    }

    /// Each floor with a room a bomb can hide in, with the tile span of
    /// those rooms (left edge, right edge). One pass over the units.
    fn floor_spans(&self) -> BTreeMap<i64, (i64, i64)> {
        let mut spans = BTreeMap::new();
        for u in &self.tower.units {
            if u.kind.is_structural() || !u.is_operational() {
                continue;
            }
            let span = spans.entry(u.floor).or_insert((u.x, u.x + u.width));
            span.0 = span.0.min(u.x);
            span.1 = span.1.max(u.x + u.width);
        }
        spans
    }

    /// The nearest floor in `spans` that no guard has swept or is sweeping,
    /// from `from`, with its span's width; the upper one when two are as
    /// near. `None` when every floor is covered.
    fn next_floor_to_sweep(
        &self,
        from: i64,
        busy: &[Guard],
        spans: &BTreeMap<i64, (i64, i64)>,
    ) -> Option<(i64, i64)> {
        let b = self.events.bomb.as_ref()?;
        spans
            .iter()
            .filter(|(f, _)| !b.searched.contains(f))
            .filter(|(f, _)| !busy.iter().chain(&b.guards).any(|g| g.floor == Some(**f)))
            .min_by_key(|(f, _)| ((*f - from).abs(), -**f))
            .map(|(&f, &(left, right))| (f, right - left))
    }

    /// One step of the search: guards who finished a floor move on (a big
    /// step can finish several floors for one guard), then a guard who
    /// swept the bomb's floor by the deadline finds it, and otherwise at the
    /// deadline it goes off.
    pub fn advance_bomb_search(&mut self) {
        let Some(b) = self.events.bomb.as_ref() else {
            return;
        };
        // Nothing after the deadline can change the outcome.
        let now = self.clock.minutes.min(b.deadline);
        let moved = b
            .guards
            .iter()
            .any(|g| g.floor.is_some_and(|f| f != b.floor) && g.done_at <= now);
        if moved {
            self.move_finished_guards(now);
        }
        let Some(b) = self.events.bomb.as_ref() else {
            return;
        };
        let deadline = b.deadline;
        let found = b
            .guards
            .iter()
            .any(|g| g.floor == Some(b.floor) && g.done_at <= now);
        if found {
            let floor = b.floor;
            self.events.bomb = None;
            let cost = 2_000.0 + self.rng.int(0, 3_000) as f64;
            self.money -= cost;
            self.gameplay.push(GameplayEvent::BombFound);
            let at = self.floor_label(floor);
            self.emit(&format!("💣 Security found the bomb on {at} and defused it in time. The evacuation cost ${}.", with_thousands(cost)), LogKind::Good);
        } else if self.clock.minutes >= deadline {
            let (floor, x) = (b.floor, b.x);
            self.events.bomb = None;
            let fine = 15_000.0 + self.rng.int(0, 15_000) as f64;
            let destroyed = self.blast(fine, Some((floor, x)));
            self.emit(&format!("💣 Security ran out of time and the bomb went off on {}. {destroyed} room(s) across ~5 floors were gutted, plus a ${} fine.", self.floor_label(floor), with_thousands(fine)), LogKind::Bad);
        }
    }

    /// Every guard whose sweep of a floor without the bomb has ended by
    /// `now` marks it clear and starts the next, from the minute it finished,
    /// until each is busy past `now` or out of floors. One walk of the rooms.
    fn move_finished_guards(&mut self, now: f64) {
        let spans = self.floor_spans();
        loop {
            let Some(b) = self.events.bomb.as_ref() else {
                return;
            };
            let bomb_floor = b.floor;
            // The earliest finish goes first (the lowest index on a tie), so
            // one long step hands out floors in the order short steps would.
            let Some(i) = b
                .guards
                .iter()
                .enumerate()
                .filter(|(_, g)| g.floor.is_some_and(|f| f != bomb_floor) && g.done_at <= now)
                .min_by(|(_, a), (_, b)| a.done_at.total_cmp(&b.done_at))
                .map(|(i, _)| i)
            else {
                break;
            };
            let Some(b) = self.events.bomb.as_mut() else {
                return;
            };
            let done = b.guards[i].clone();
            let from = done.floor.unwrap_or(bomb_floor);
            b.searched.push(from);
            b.guards[i].floor = None;
            let next = self.next_floor_to_sweep(from, &[], &spans);
            if let Some(b) = self.events.bomb.as_mut() {
                b.guards[i] = sweep(next, from, done.done_at);
            }
        }
        if let Some(b) = self.events.bomb.as_mut() {
            b.seq += 1;
        }
    }
}

/// A guard leaving `from` at minute `start` to sweep `next` (a floor and its
/// rooms' width): the stairs there, then the walk along the rooms.
fn sweep(next: Option<(i64, i64)>, from: i64, start: f64) -> Guard {
    match next {
        Some((f, width)) => Guard {
            floor: Some(f),
            done_at: start
                + (f - from).abs() as f64 * STAIR_MINUTES_PER_FLOOR
                + width as f64 * SWEEP_MINUTES_PER_TILE,
        },
        None => Guard {
            floor: None,
            done_at: start,
        },
    }
}

#[cfg(test)]
#[path = "events_bomb_tests.rs"]
mod tests;
