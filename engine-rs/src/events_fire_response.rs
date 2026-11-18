//! Who answers a fire (#1889): Security's guards, who walk the emergency
//! stairs to it, and the paid rescue helicopter.
//!
//! What the sources agree on (the project's SimTower reference, 2026-10-30):
//! the same Security personnel who search for bombs fight fires, they use the
//! peripheral emergency stairs only, and "their effectiveness is determined
//! by how close they are to the fire's origin" (manual p.36). Fire Rescue is
//! a helicopter that sprays the fire (furdude2), always puts it out (manual
//! p.63) and "arrives too late to save the first two buildings" (MentalMan):
//! the rooms ablaze when it lands are gutted. How fast guards climb is the
//! bomb search's pace (`STAIR_MINUTES_PER_FLOOR`); the helicopter's flight
//! times are our estimate until a run in the original measures them. Each is
//! one named constant, so that run changes a number, not the shape.
//!
//! The fire's odds keep their daily roll in `events.rs`: Security's part of
//! the containment chance now comes from guards who reached the fire by the
//! stairs, not from any office within reach of the floor.

use serde_json::{json, Value};

use super::bomb::{GUARDS_PER_OFFICE, STAIR_MINUTES_PER_FLOOR, SWEEP_MINUTES_PER_TILE};
use super::stairs::Stairs;
use crate::facilities::Kind;
use crate::gameplay::{FireOutcome, GameplayEvent};
use crate::services::with_thousands;
use crate::sim::{LogKind, Simulation};

#[path = "events_fire_save.rs"]
mod save;

/// Game minutes between two guards of one office setting off, so they file
/// down the stairs one behind the other.
pub const FIRE_GUARD_STAGGER_MINUTES: f64 = 1.0;
/// Game minutes the rescue helicopter flies before it reaches the fire.
pub const HELICOPTER_FLIGHT_MINUTES: f64 = 30.0;
/// Game minutes it hovers spraying the fire once there.
pub const HELICOPTER_SPRAY_MINUTES: f64 = 20.0;
/// Game minutes it takes to fly off again.
pub const HELICOPTER_DEPART_MINUTES: f64 = 15.0;

/// One guard answering the fire: the floor it set off from, the corners of
/// its walk on the emergency stairs (as the bomb search's guards keep them),
/// the stairs tile `left` where it steps off on the fire's floor, the tile
/// `at` in the burning room where it fights, the minutes it left, reached
/// the floor and reached its spot, and the floors of stairs it climbed.
#[derive(Clone, Debug, PartialEq)]
pub struct FireGuard {
    pub from: i64,
    pub route: Vec<(i64, i64)>,
    pub left: i64,
    pub at: i64,
    pub start: f64,
    pub arrive: f64,
    pub done: f64,
    pub floors: i64,
}

/// The rescue helicopter: the minutes it was called, reaches the fire, and
/// is gone again.
#[derive(Clone, Debug, PartialEq)]
pub struct Helicopter {
    pub called: f64,
    pub arrive: f64,
    pub leave: f64,
}

/// The answer to one fire: its origin room (floor, left tile, width), the
/// guards sent to it, the helicopter if one was called, and whether the
/// fire is out. `seq` moves with every change a viewer can see.
#[derive(Clone, Debug, PartialEq)]
pub struct FireResponse {
    pub floor: i64,
    pub x: i64,
    pub width: i64,
    pub guards: Vec<FireGuard>,
    pub helicopter: Option<Helicopter>,
    pub out: bool,
    pub seq: i64,
}

impl FireResponse {
    /// Whether a guard has reached the fire by minute `now` from an office
    /// within `radius` floors of `floor`: Security's part of containing the
    /// blaze on that floor.
    pub fn guards_fighting(&self, now: f64, floor: i64, radius: i64) -> bool {
        self.guards
            .iter()
            .any(|g| g.done <= now && (g.from - floor).abs() <= radius)
    }

    /// Who put the fire out by minute `now`: the helicopter once it landed,
    /// Security when a guard reached it, or nobody.
    fn outcome(&self, now: f64) -> FireOutcome {
        if self.helicopter.as_ref().is_some_and(|h| h.arrive <= now) {
            FireOutcome::Rescue
        } else if self.guards.iter().any(|g| g.done <= now) {
            FireOutcome::Security
        } else {
            FireOutcome::BurnedOut
        }
    }
}

#[doc(hidden)]
impl Simulation {
    /// Send every operational Security office's guards to the room at index
    /// `i`, which just caught fire, by the emergency stairs from minute `now`.
    /// An office no stairs join to the fire sends nobody.
    pub(super) fn dispatch_fire_guards(&mut self, i: usize, now: f64) {
        let room = &self.tower.units[i];
        let (floor, x, width) = (room.floor, room.x, room.width);
        let stairs = Stairs::of(&self.tower);
        let offices: Vec<(i64, i64)> = self
            .tower
            .units
            .iter()
            .filter(|u| u.kind == Kind::Security && u.is_operational())
            .map(|u| (u.floor, u.x))
            .collect();
        let mut guards = Vec::new();
        for office in offices {
            guards.extend(fire_guards(&stairs, (floor, x, width), office, now));
        }
        let new_id = self.tower.units[i].id;
        let (seq, helicopter) = self.close_previous_fire(new_id, now);
        self.announce_fire_guards(guards.len());
        self.events.fire = Some(FireResponse {
            floor,
            x,
            width,
            guards,
            helicopter,
            out: false,
            seq,
        });
    }

    /// Settle the answer to an earlier fire before room `new_id`'s replaces
    /// it: report the earlier fire out when nothing but the new room burns
    /// (the day's containment roll can put it out in the same roll that
    /// starts this one), and hand over a paid helicopter still in the air so
    /// it lands on this fire. Returns the new answer's `seq` and helicopter.
    fn close_previous_fire(&mut self, new_id: i64, now: f64) -> (i64, Option<Helicopter>) {
        let Some(old) = self.events.fire.take() else {
            return (1, None);
        };
        let old_burning = self.events.active.iter().any(|&id| id != new_id);
        if !old.out && !old_burning {
            let by = old.outcome(now);
            self.gameplay.push(GameplayEvent::FireOut { by });
        }
        let flying = old.helicopter.filter(|h| h.arrive > now);
        (old.seq + 1, flying)
    }

    /// A Security office at (`office`, `x`) just opened. In a mode where a
    /// late office answers, its guards set out for the fire burning now.
    pub(crate) fn join_fire_response(&mut self, office: i64, x: i64) {
        if !self.mode.security_joins_fire() {
            return;
        }
        let Some(r) = self.events.fire.as_ref().filter(|r| !r.out) else {
            return;
        };
        let room = (r.floor, r.x, r.width);
        let stairs = Stairs::of(&self.tower);
        let fresh = fire_guards(&stairs, room, (office, x), self.clock.minutes);
        if fresh.is_empty() {
            return;
        }
        self.announce_fire_guards(fresh.len());
        if let Some(r) = self.events.fire.as_mut() {
            r.guards.extend(fresh);
            r.seq += 1;
        }
    }

    fn announce_fire_guards(&mut self, n: usize) {
        if n > 0 {
            self.emit(
                &format!("🕵️ {n} Security guards are taking the emergency stairs to the fire."),
                LogKind::Info,
            );
        }
    }

    /// A paid rescue: the helicopter sets off now and puts the fire out
    /// when it lands ([`Simulation::advance_fire_response`]).
    pub(super) fn call_helicopter(&mut self, cost: f64) {
        let now = self.clock.minutes;
        if self.events.fire.is_none() {
            if let Some(i) = self.first_fire() {
                self.dispatch_fire_guards(i, now);
            }
        }
        let Some(r) = self.events.fire.as_mut() else {
            return;
        };
        let arrive = now + HELICOPTER_FLIGHT_MINUTES;
        r.helicopter = Some(Helicopter {
            called: now,
            arrive,
            leave: arrive + HELICOPTER_SPRAY_MINUTES + HELICOPTER_DEPART_MINUTES,
        });
        r.seq += 1;
        self.emit(
            &format!(
                "🚒 The Fire Rescue helicopter is on its way for ${}. It puts the fire out when it arrives.",
                with_thousands(cost)
            ),
            LogKind::Money,
        );
    }

    /// Whether a fire rescue helicopter is in the air or at the fire.
    pub fn helicopter_flying(&self) -> bool {
        self.events
            .fire
            .as_ref()
            .is_some_and(|r| r.helicopter.is_some())
    }

    /// The index of the first room still ablaze, the fire's origin when an
    /// older save carried no response.
    fn first_fire(&self) -> Option<usize> {
        let id = *self.events.active.first()?;
        self.tower.index_of(id)
    }

    /// One step of the answer to a fire: guards go out to a fire an older
    /// save left burning, the helicopter puts it out when it lands, the end
    /// of the fire is reported once, and the answer is dropped when the fire
    /// is out and the helicopter gone. Nothing to do, and no scan, while no
    /// fire burns.
    pub fn advance_fire_response(&mut self) {
        let now = self.clock.minutes;
        if self.events.fire.is_none() {
            if self.events.active.is_empty() {
                return;
            }
            let Some(i) = self.first_fire() else { return };
            self.dispatch_fire_guards(i, now);
        }
        let Some(r) = self.events.fire.as_ref() else {
            return;
        };
        let landed = r.helicopter.as_ref().is_some_and(|h| h.arrive <= now);
        if landed && !self.events.active.is_empty() {
            self.extinguish_all();
            // Classic names what happened only (#549).
            let fix = if self.mode.advises_fixes() {
                " Bulldoze and rebuild them."
            } else {
                ""
            };
            self.emit(&format!("🚒 The Fire Rescue helicopter put the fire out. The rooms that were ablaze are gutted.{fix}"), LogKind::Good);
        }
        let Some(r) = self.events.fire.as_mut() else {
            return;
        };
        if !r.out && self.events.active.is_empty() {
            r.out = true;
            r.seq += 1;
            let by = r.outcome(now);
            self.gameplay.push(GameplayEvent::FireOut { by });
        }
        let Some(r) = self.events.fire.as_ref() else {
            return;
        };
        let gone = r.helicopter.as_ref().is_none_or(|h| h.leave <= now);
        if r.out && gone {
            self.events.fire = None;
        }
    }

    /// The host's read of the answer to a fire: the origin room, each guard
    /// still out (in the bomb search's guard shape, `right` the tile it
    /// fights from), the helicopter and the minute the fire went out, if it
    /// is. Read when the frame's `fireResponseSeq` moves.
    pub fn fire_response_view(&self) -> Option<Value> {
        let r = self.events.fire.as_ref()?;
        let guards: Vec<Value> = if r.out {
            Vec::new()
        } else {
            r.guards
                .iter()
                .map(|g| {
                    let route: Vec<Value> = g.route.iter().map(|&(f, x)| json!([f, x])).collect();
                    json!({
                        "floor": r.floor, "left": g.left, "right": g.at, "from": g.from,
                        "route": route, "start": g.start, "arrive": g.arrive, "done": g.done,
                    })
                })
                .collect()
        };
        let helicopter = r.helicopter.as_ref().map(|h| {
            json!({
                "called": h.called, "arrive": h.arrive,
                "sprayEnd": h.arrive + HELICOPTER_SPRAY_MINUTES, "leave": h.leave,
            })
        });
        Some(json!({
            "floor": r.floor, "x": r.x, "width": r.width, "guards": guards,
            "helicopter": helicopter, "out": r.out, "seq": r.seq,
        }))
    }
}

/// One office's guards setting out at minute `now` from (`office`, `ox`)
/// for the burning room (floor, left tile, width): none when no stairs join
/// the two. They file out a minute apart and spread across the room.
fn fire_guards(
    stairs: &Stairs,
    room: (i64, i64, i64),
    (office, ox): (i64, i64),
    now: f64,
) -> Vec<FireGuard> {
    let (floor, x, width) = room;
    let (Some(fire), Some(home)) = (stairs.at(floor, x), stairs.at(office, ox)) else {
        return Vec::new();
    };
    let walk = stairs.walk_from(home);
    let Some(floors) = walk.floors[fire] else {
        return Vec::new();
    };
    let route = stairs.route(&walk, home, fire);
    let left = route.last().map_or(ox, |&(_, sx)| sx);
    (0..GUARDS_PER_OFFICE)
        .map(|k| {
            let start = now + k as f64 * FIRE_GUARD_STAGGER_MINUTES;
            let arrive = start + floors as f64 * STAIR_MINUTES_PER_FLOOR;
            let at = x + (k as i64 * width) / GUARDS_PER_OFFICE as i64;
            FireGuard {
                from: office,
                route: route.clone(),
                left,
                at,
                start,
                arrive,
                done: arrive + (at - left).abs() as f64 * SWEEP_MINUTES_PER_TILE,
                floors,
            }
        })
        .collect()
}

#[cfg(test)]
impl Simulation {
    /// Tests only: run the clock to the minute the called helicopter lands
    /// and take that step of the answer, so a paid rescue's outcome shows.
    pub(crate) fn land_helicopter(&mut self) {
        let arrive = self
            .events
            .fire
            .as_ref()
            .and_then(|r| r.helicopter.as_ref())
            .map(|h| h.arrive)
            .expect("a helicopter was called");
        self.clock.minutes = self.clock.minutes.max(arrive);
        self.advance_fire_response();
    }
}

#[cfg(test)]
#[path = "events_fire_response_tests.rs"]
mod tests;
