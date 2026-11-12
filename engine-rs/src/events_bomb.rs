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
//!
//! A guard sweeps one stretch of floor at a time (`events_stairs.rs`): the
//! whole floor in a tower that fills it, one tower's part of it on a lot with
//! several towers standing apart. Guards reach a stretch only by the
//! emergency stairs, so a tower no floor joins to a Security office's own is
//! never searched, and one joined only through a shared lobby costs the walk
//! down to it and back up.

use std::collections::{BTreeMap, BTreeSet};

use super::stairs::{Stairs, Walk};
use crate::facilities::Kind;
use crate::gameplay::GameplayEvent;
use crate::services::with_thousands;
use crate::sim::{LogKind, Simulation};

#[path = "events_bomb_blast.rs"]
mod blast;
#[path = "events_bomb_save.rs"]
mod save;
#[path = "events_bomb_view.rs"]
mod view;

/// Guards each Security office sends out.
pub const GUARDS_PER_OFFICE: usize = 6;
/// The hour of day the bomb goes off (1:00 PM).
pub const BOMB_HOUR: f64 = 13.0;
/// Game minutes a guard spends walking one tile of a floor's rooms.
pub const SWEEP_MINUTES_PER_TILE: f64 = 0.5;
/// Game minutes a guard spends on the emergency stairs per floor climbed.
pub const STAIR_MINUTES_PER_FLOOR: f64 = 2.0;
/// Floors above and below the bomb its blast guts (five floors in all).
pub const BLAST_FLOORS: i64 = 2;

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
/// stretch is left for it, the tile `x` that names the stretch on that floor,
/// and the minute that sweep ends. `from` and `start` are where and when it
/// set off, `from_x` a tile of the stretch it left, `turn` the floor it went
/// down (or up) to on the way when the stairs do not lead straight there, and
/// `arrive` the minute it reached the stretch, so a host can draw the walk on
/// the emergency stairs before the walk along the rooms.
#[derive(Clone, Debug, PartialEq)]
pub struct Guard {
    pub floor: Option<i64>,
    /// `None` for a guard from a save made before towers were searched one by
    /// one: it sweeps its whole floor.
    pub x: Option<i64>,
    pub done_at: f64,
    pub from: i64,
    pub from_x: Option<i64>,
    pub turn: i64,
    pub start: f64,
    pub arrive: f64,
}

/// A stretch swept clean: its floor and a tile of it, or `None` for a whole
/// floor (a save from before towers were searched one by one).
pub type Swept = (i64, Option<i64>);

/// A bomb waiting to be found. `floor` and `x` are its hiding place (the
/// player never sees them), `deadline` the minute it goes off.
#[derive(Clone, Debug, PartialEq)]
pub struct BombSearch {
    pub floor: i64,
    pub x: f64,
    pub deadline: f64,
    pub guards: Vec<Guard>,
    /// Stretches swept clean, in the order the guards finished them.
    pub searched: Vec<Swept>,
    /// Bumped on every change a viewer can see, so a host rereads the search
    /// only when it moved.
    pub seq: i64,
}

/// The stretch a guard sets off for: its floor and first tile, the width of
/// its rooms, the floors of stairs on the way and the floor it turns at.
struct Target {
    floor: i64,
    x: i64,
    width: i64,
    floors: i64,
    turn: i64,
}

/// The stretches already swept or taken by a guard, so each is swept once.
/// Whole floors stand for the guards and sweeps of an older save.
#[derive(Default)]
struct Claims {
    stretches: BTreeSet<usize>,
    floors: BTreeSet<i64>,
}

impl Claims {
    fn claim(&mut self, stairs: &Stairs, floor: i64, x: Option<i64>) {
        match x {
            None => {
                self.floors.insert(floor);
            }
            Some(x) => {
                if let Some(i) = stairs.at(floor, x) {
                    self.stretches.insert(i);
                }
            }
        }
    }

    fn holds(&self, i: usize, floor: i64) -> bool {
        self.stretches.contains(&i) || self.floors.contains(&floor)
    }

    /// Everything swept so far and every stretch a guard is headed for.
    fn of(stairs: &Stairs, b: &BombSearch) -> Claims {
        let mut c = Claims::default();
        for &(f, x) in &b.searched {
            c.claim(stairs, f, x);
        }
        for g in &b.guards {
            if let Some(f) = g.floor {
                c.claim(stairs, f, g.x);
            }
        }
        c
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

#[doc(hidden)]
impl Simulation {
    /// The answer to a declined ransom in both modes: hide the bomb in a random room
    /// and send Security out. With no room to hide it in, the threat was
    /// empty; with no Security, nobody searches and it simply waits for the
    /// deadline.
    pub(super) fn start_bomb_search(&mut self) {
        let targets = self.flammable_units();
        if targets.is_empty() {
            self.emit(
                "💣 The bomb threat was a hoax: there was nowhere to hide a bomb.",
                LogKind::Good,
            );
            return;
        }
        let gi = *self.rng.pick(&targets);
        let room = &self.tower.units[gi];
        let (floor, x) = (room.floor, room.x as f64 + room.width as f64 / 2.0);
        let now = self.clock.minutes;
        let deadline = deadline_after(now);
        let offices: Vec<(i64, i64)> = self
            .tower
            .units
            .iter()
            .filter(|u| u.kind == Kind::Security && u.is_operational())
            .map(|u| (u.floor, u.x))
            .collect();
        self.events.bomb = Some(BombSearch {
            floor,
            x,
            deadline,
            guards: Vec::new(),
            searched: Vec::new(),
            seq: 1,
        });
        let mut guards = Vec::with_capacity(offices.len() * GUARDS_PER_OFFICE);
        if !offices.is_empty() {
            let stairs = Stairs::of(&self.tower);
            let rooms = self.stretch_rooms(&stairs);
            let mut claims = Claims::default();
            for &(office, ox) in &offices {
                guards.extend(self.send_guards(&stairs, &rooms, &mut claims, office, ox, now));
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

    /// A Security office at (`office`, `x`) just opened. In a mode where late
    /// offices join, its guards set out from there now.
    pub(crate) fn join_bomb_search(&mut self, office: i64, x: i64) {
        let Some(b) = self.events.bomb.as_ref() else {
            return;
        };
        if !self.mode.security_joins_bomb_search() {
            return;
        }
        let now = self.clock.minutes;
        let stairs = Stairs::of(&self.tower);
        let rooms = self.stretch_rooms(&stairs);
        let mut claims = Claims::of(&stairs, b);
        let fresh = self.send_guards(&stairs, &rooms, &mut claims, office, x, now);
        if let Some(b) = self.events.bomb.as_mut() {
            b.guards.extend(fresh);
            b.seq += 1;
        }
        self.emit(
            &format!("💣 {GUARDS_PER_OFFICE} more Security guards joined the bomb search."),
            LogKind::Good,
        );
    }

    /// One office's guards setting out at minute `now` from its stretch, each
    /// to the nearest stretch by the stairs that nobody has claimed. An
    /// office on no stretch of floor (never placed by the game) sends guards
    /// with nowhere to go.
    fn send_guards(
        &self,
        stairs: &Stairs,
        rooms: &BTreeMap<usize, (i64, i64)>,
        claims: &mut Claims,
        office: i64,
        x: i64,
        now: f64,
    ) -> Vec<Guard> {
        let start = stairs.at(office, x);
        let walk = start.map(|s| stairs.walk_from(s));
        (0..GUARDS_PER_OFFICE)
            .map(|_| {
                let next = start
                    .zip(walk.as_ref())
                    .and_then(|(s, w)| next_stretch(stairs, rooms, claims, s, w));
                if let Some(t) = &next {
                    claims.claim(stairs, t.floor, Some(t.x));
                }
                sweep(next, office, Some(x), now)
            })
            .collect()
    }

    /// Whether guard `g` is sweeping the bomb's stretch.
    fn sweeps_bomb(stairs: &Stairs, b: &BombSearch, g: &Guard) -> bool {
        if g.floor != Some(b.floor) {
            return false;
        }
        let Some(x) = g.x else {
            return true;
        };
        let here = stairs.at(b.floor, x);
        here.is_some() && here == stairs.at(b.floor, b.x.floor() as i64)
    }

    /// One step of the search: guards who finished a stretch move on (a big
    /// step can finish several for one guard), then a guard who swept the
    /// bomb's stretch by the deadline finds it, and otherwise at the deadline
    /// it goes off. The stairs are mapped only when a sweep has ended.
    pub fn advance_bomb_search(&mut self) {
        let Some(b) = self.events.bomb.as_ref() else {
            return;
        };
        // Nothing after the deadline can change the outcome.
        let now = self.clock.minutes.min(b.deadline);
        let due = b
            .guards
            .iter()
            .any(|g| g.floor.is_some() && g.done_at <= now);
        let mut found = false;
        if due {
            let stairs = Stairs::of(&self.tower);
            self.move_finished_guards(now, &stairs);
            if let Some(b) = self.events.bomb.as_ref() {
                found = b
                    .guards
                    .iter()
                    .any(|g| g.done_at <= now && Self::sweeps_bomb(&stairs, b, g));
            }
        }
        let Some(b) = self.events.bomb.as_ref() else {
            return;
        };
        let deadline = b.deadline;
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

    /// Every guard whose sweep of a stretch without the bomb has ended by
    /// `now` marks it clear and starts the next, from the minute it finished,
    /// until each is busy past `now` or out of stretches. One walk of the
    /// rooms.
    fn move_finished_guards(&mut self, now: f64, stairs: &Stairs) {
        let rooms = self.stretch_rooms(stairs);
        let Some(b) = self.events.bomb.as_ref() else {
            return;
        };
        let mut claims = Claims::of(stairs, b);
        let mut moved = false;
        loop {
            let Some(b) = self.events.bomb.as_ref() else {
                return;
            };
            // The earliest finish goes first (the lowest index on a tie), so
            // one long step hands out stretches in the order short steps would.
            let Some(i) = b
                .guards
                .iter()
                .enumerate()
                .filter(|(_, g)| {
                    g.floor.is_some() && g.done_at <= now && !Self::sweeps_bomb(stairs, b, g)
                })
                .min_by(|(_, a), (_, b)| a.done_at.total_cmp(&b.done_at))
                .map(|(i, _)| i)
            else {
                break;
            };
            let bomb_tile = b.x.floor() as i64;
            let Some(b) = self.events.bomb.as_mut() else {
                return;
            };
            let done = b.guards[i].clone();
            let from = done.floor.unwrap_or(b.floor);
            b.searched.push((from, done.x));
            // A guard from an older save swept its whole floor: it leaves
            // from the floor's first stretch with rooms.
            let start = match done.x {
                Some(x) => stairs.at(from, x),
                None => rooms
                    .keys()
                    .copied()
                    .find(|&s| stairs.stretch(s).floor == from)
                    .or_else(|| stairs.at(from, bomb_tile)),
            };
            let from_x = start.map(|s| stairs.stretch(s).first);
            let next = start.and_then(|s| {
                let walk = stairs.walk_from(s);
                next_stretch(stairs, &rooms, &claims, s, &walk)
            });
            if let Some(t) = &next {
                claims.claim(stairs, t.floor, Some(t.x));
            }
            b.guards[i] = sweep(next, from, from_x, done.done_at);
            moved = true;
        }
        if moved {
            if let Some(b) = self.events.bomb.as_mut() {
                b.seq += 1;
            }
        }
    }
}

/// The nearest stretch by the stairs from `start` (along `walk`) that has
/// rooms and nobody has claimed; the upper one when two are as near, the
/// left one on one floor. `None` when every stretch the stairs reach is
/// covered.
fn next_stretch(
    stairs: &Stairs,
    rooms: &BTreeMap<usize, (i64, i64)>,
    claims: &Claims,
    start: usize,
    walk: &Walk,
) -> Option<Target> {
    rooms
        .iter()
        .filter_map(|(&i, &(left, right))| {
            let s = stairs.stretch(i);
            let floors = walk.floors[i]?;
            (!claims.holds(i, s.floor)).then_some((i, s.floor, floors, right - left))
        })
        .min_by_key(|&(i, floor, floors, _)| (floors, -floor, i))
        .map(|(i, floor, floors, width)| Target {
            floor,
            x: stairs.stretch(i).first,
            width,
            floors,
            turn: stairs.turn_floor(walk, start, i),
        })
}

/// A guard leaving `from` (a tile `from_x` of its stretch) at minute `start`
/// for `next`: the stairs there, then the walk along the rooms.
fn sweep(next: Option<Target>, from: i64, from_x: Option<i64>, start: f64) -> Guard {
    match next {
        Some(t) => {
            let arrive = start + t.floors as f64 * STAIR_MINUTES_PER_FLOOR;
            Guard {
                floor: Some(t.floor),
                x: Some(t.x),
                done_at: arrive + t.width as f64 * SWEEP_MINUTES_PER_TILE,
                from,
                from_x,
                turn: t.turn,
                start,
                arrive,
            }
        }
        None => Guard {
            floor: None,
            x: None,
            done_at: start,
            from,
            from_x,
            turn: from,
            start,
            arrive: start,
        },
    }
}

#[cfg(test)]
#[path = "events_bomb_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "events_bomb_split_tests.rs"]
mod split_tests;
