//! Port of `economy/housekeeping.ts`.

use std::collections::{HashMap, HashSet};

use crate::crowd::spawn::{spawn_staff, StaffSpawn};
use crate::facilities::Kind;
use crate::sim::{LogKind, Simulation};
use crate::tower::UnitState;

pub const HK_MAIDS_PER_UNIT: i64 = 6;
pub const HK_CLEAN_MINUTES: f64 = 8.0;
pub const INFEST_DAYS: i64 = 3;

#[derive(Default)]
pub struct Housekeeping {
    /// room id -> (crew id, floor)
    assigned_room: HashMap<i64, (i64, i64)>,
    maids_out: HashMap<i64, i64>,
    floors_busy: HashMap<i64, HashSet<i64>>,
    cleaned_today: i64,
    nudged_day: i64,
    initialized: bool,
}

impl Housekeeping {
    fn nudged_day(&mut self) -> &mut i64 {
        if !self.initialized {
            self.nudged_day = -1;
            self.initialized = true;
        }
        &mut self.nudged_day
    }

    pub fn reset_shift(&mut self) {
        self.assigned_room.clear();
        self.maids_out.clear();
        self.floors_busy.clear();
    }

    fn assign_room(&mut self, room_id: i64, crew_id: i64, floor: i64) {
        self.assigned_room.insert(room_id, (crew_id, floor));
        *self.maids_out.entry(crew_id).or_insert(0) += 1;
        self.floors_busy.entry(crew_id).or_default().insert(floor);
    }

    fn release_assignment(&mut self, room_id: i64) {
        let Some((crew_id, floor)) = self.assigned_room.remove(&room_id) else { return };
        let left = self.maids_out.get(&crew_id).copied().unwrap_or(0) - 1;
        if left > 0 {
            self.maids_out.insert(crew_id, left);
        } else {
            self.maids_out.remove(&crew_id);
        }
        if let Some(s) = self.floors_busy.get_mut(&crew_id) {
            s.remove(&floor);
        }
    }
}

fn format_floors(floors: &[i64]) -> String {
    let mut sorted: Vec<i64> = floors.to_vec();
    sorted.sort();
    sorted.dedup();
    let mut parts: Vec<String> = Vec::new();
    let mut i = 0;
    while i < sorted.len() {
        let mut j = i;
        while j + 1 < sorted.len() && sorted[j + 1] == sorted[j] + 1 {
            j += 1;
        }
        parts.push(if j > i {
            format!("{}–{}", sorted[i], sorted[j])
        } else {
            format!("{}", sorted[i])
        });
        i = j + 1;
    }
    parts.join(", ")
}

impl Simulation {
    /// `Housekeeping.beforeCheckout`.
    pub fn housekeeping_before_checkout(&mut self) {
        let leftover = self
            .tower
            .units
            .iter()
            .filter(|u| u.kind.is_hotel() && u.state == UnitState::Dirty)
            .count() as i64;
        let cleaned = self.housekeeping.cleaned_today;
        if cleaned > 0 || leftover > 0 {
            let behind = if leftover > 0 {
                format!(" {leftover} room(s) went unserved; add crews or improve staff transport.")
            } else {
                String::new()
            };
            let kind = if leftover > 0 { LogKind::Bad } else { LogKind::Info };
            self.emit(&format!("Housekeeping cleaned {cleaned} hotel room(s).{behind}"), kind);
        }
        self.housekeeping.cleaned_today = 0;
        self.escalate_infestations();
        self.spread_cockroaches();
    }

    fn escalate_infestations(&mut self) {
        let mut floors: Vec<i64> = Vec::new();
        for u in self.tower.units.iter_mut() {
            if u.state != UnitState::Dirty || !u.kind.is_hotel() {
                continue;
            }
            let days = u.dirty_days.unwrap_or(0) + 1;
            if days >= INFEST_DAYS {
                u.state = UnitState::Infested;
                u.occupants = 0;
                u.dirty_days = None;
                floors.push(u.floor);
            } else {
                u.dirty_days = Some(days);
            }
        }
        if !floors.is_empty() {
            let fix = if self.mode.is_modern() {
                "Call an exterminator, or bulldoze and rebuild."
            } else {
                "Bulldoze and rebuild to clear them."
            };
            let msg = format!(
                "🪳 {} neglected room(s) on floor(s) {} became cockroach-infested and can no longer be cleaned. {}",
                floors.len(),
                format_floors(&floors),
                fix
            );
            self.emit(&msg, LogKind::Bad);
        }
    }

    fn spread_cockroaches(&mut self) {
        let sources: Vec<(i64, i64, i64)> = self
            .tower
            .units
            .iter()
            .filter(|u| u.kind.is_hotel() && u.state == UnitState::Infested)
            .map(|u| (u.floor, u.x, u.width))
            .collect();
        if sources.is_empty() {
            return;
        }
        let mut floors: Vec<i64> = Vec::new();
        for (floor, x, width) in sources {
            for nx in [x + width, x - 1] {
                let Some(nid) = self.tower.room_at(floor, nx).map(|n| n.id) else { continue };
                let n = self.tower.get_unit_mut(nid).unwrap();
                if n.kind.is_hotel() && matches!(n.state, UnitState::Asleep | UnitState::Empty) {
                    n.state = UnitState::Dirty;
                    n.occupants = 0;
                    floors.push(n.floor);
                }
            }
        }
        if !floors.is_empty() {
            let msg = format!(
                "🪳 Cockroaches spread from infested rooms into {} more room{} on floor(s) {}. Clear the infested source.",
                floors.len(),
                if floors.len() > 1 { "s" } else { "" },
                format_floors(&floors)
            );
            self.emit(&msg, LogKind::Bad);
        }
    }

    fn can_start_new_room(&self) -> bool {
        let s = self.mode.housekeeping_shift();
        let h = self.clock.minute_of_day() / 60.0;
        h >= s.start as f64 && h < s.cutoff
    }

    /// `Housekeeping.dispatch`.
    pub fn dispatch_housekeepers(&mut self) {
        if !self.can_start_new_room() {
            return;
        }
        // (id, floor, x, width)
        let crews: Vec<(i64, i64, i64, i64)> = self
            .tower
            .units
            .iter()
            .filter(|u| u.kind == Kind::Housekeeping && u.is_operational())
            .map(|u| (u.id, u.floor, u.x, u.width))
            .collect();
        if crews.is_empty() {
            return;
        }
        let modern = self.mode.is_modern();
        // (id, floor, x, width, dirtyDays)
        let mut candidates: Vec<(i64, i64, i64, i64, i64)> = self
            .tower
            .units
            .iter()
            .filter(|u| u.kind.is_hotel() && u.state == UnitState::Dirty && !self.housekeeping.assigned_room.contains_key(&u.id))
            .map(|u| (u.id, u.floor, u.x, u.width, u.dirty_days.unwrap_or(0)))
            .collect();
        if modern {
            let mut dist_by_floor: HashMap<i64, Option<i64>> = HashMap::new();
            let mut nearest = |floor: i64, tower: &crate::tower::Tower| -> Option<i64> {
                if let Some(d) = dist_by_floor.get(&floor) {
                    return *d;
                }
                let mut best: Option<i64> = None;
                for c in &crews {
                    if !tower.staff_connected(c.1, floor) {
                        continue;
                    }
                    let d = (c.1 - floor).abs();
                    if best.is_none_or(|b| d < b) {
                        best = Some(d);
                    }
                }
                dist_by_floor.insert(floor, best);
                best
            };
            let scores: HashMap<i64, Option<f64>> = candidates
                .iter()
                .map(|r| {
                    let d = nearest(r.1, &self.tower);
                    (r.0, d.map(|d| r.4 as f64 * 10.0 - d as f64 * 1.0))
                })
                .collect();
            candidates.sort_by(|a, b| {
                let sa = scores[&a.0];
                let sb = scores[&b.0];
                if sa == sb {
                    return a.0.cmp(&b.0);
                }
                match (sa, sb) {
                    (None, _) => std::cmp::Ordering::Greater,
                    (_, None) => std::cmp::Ordering::Less,
                    (Some(x), Some(y)) => {
                        if y > x {
                            std::cmp::Ordering::Greater
                        } else {
                            std::cmp::Ordering::Less
                        }
                    }
                }
            });
        }
        let mut unreachable = 0;
        for room in &candidates {
            let (rid, rfloor, rx, rw, _) = *room;
            let mut reachable = false;
            let mut transient = false;
            let mut no_route = false;
            let order: Vec<(i64, i64, i64, i64)> = if modern {
                let mut o = crews.clone();
                o.sort_by(|c1, c2| {
                    ((c1.1 - rfloor).abs())
                        .cmp(&(c2.1 - rfloor).abs())
                        .then(c1.0.cmp(&c2.0))
                });
                o
            } else {
                crews.clone()
            };
            for crew in &order {
                let (cid, cfloor, cx, cw) = *crew;
                if !self.tower.staff_connected(cfloor, rfloor) {
                    continue;
                }
                reachable = true;
                if self.housekeeping.maids_out.get(&cid).copied().unwrap_or(0) >= HK_MAIDS_PER_UNIT {
                    transient = true;
                    continue;
                }
                if self.housekeeping.floors_busy.get(&cid).is_some_and(|s| s.contains(&rfloor)) {
                    transient = true;
                    continue;
                }
                // Both x's are `x + width / 2`; widths are even in the catalog,
                // and the TypeScript passes the float through to the router.
                let dest_x = rx + rw / 2;
                let from_x = cx + cw / 2;
                let sent = spawn_staff(
                    &mut self.crowd,
                    &self.tower,
                    cfloor,
                    rfloor,
                    dest_x,
                    rid,
                    HK_CLEAN_MINUTES,
                    Some(from_x),
                );
                if sent == StaffSpawn::Full {
                    transient = true;
                    break;
                }
                if sent == StaffSpawn::NoRoute {
                    no_route = true;
                    continue;
                }
                self.housekeeping.assign_room(rid, cid, rfloor);
                break;
            }
            if self.housekeeping.assigned_room.contains_key(&rid) {
                continue;
            }
            if !reachable || (no_route && !transient) {
                unreachable += 1;
            }
        }
        let day = self.clock.day();
        if unreachable > 0 && *self.housekeeping.nudged_day() != day {
            *self.housekeeping.nudged_day() = day;
            self.emit(
                &format!("🧹 Housekeeping can't reach {unreachable} dirty room(s). Staff travel by service elevator or stairs, not escalators or passenger elevators."),
                LogKind::Bad,
            );
        }
    }

    /// `Housekeeping.onResult`.
    pub fn on_housekeeper_result(&mut self, room_id: i64, ok: bool) {
        self.housekeeping.release_assignment(room_id);
        if let Some(room) = self.tower.get_unit_mut(room_id) {
            if ok && room.state == UnitState::Dirty {
                room.state = UnitState::Empty;
                room.satisfaction = 1.0;
                room.dirty_days = None;
                self.housekeeping.cleaned_today += 1;
            }
        }
    }
}
