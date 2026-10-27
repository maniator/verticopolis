//! Port of `economy/housekeeping.ts`.

use std::collections::{HashMap, HashSet};

use crate::crowd::fasthash::FastMap;
use crate::crowd::spawn::{spawn_staff, StaffSpawn};
use crate::facilities::Kind;
use crate::sim::{LogKind, Simulation};
use crate::tower::{Tower, UnitState};

pub const HK_MAIDS_PER_UNIT: i64 = 6;
pub const HK_CLEAN_MINUTES: f64 = 8.0;
pub const INFEST_DAYS: i64 = 3;

/// A housekeeping unit as dispatch reads it: (id, floor, x, width).
type Crew = (i64, i64, i64, i64);
/// A dirty hotel room no crew holds yet: (id, floor, x, width, dirtyDays).
type Candidate = (i64, i64, i64, i64, i64);

/// Each floor's crew order for dispatch, kept from one pass to the next
/// while the tower revision, the mode and the operational crews stay the
/// same, since the orders read nothing else (#1143 item 6). Never saved: a
/// load builds a fresh `Housekeeping`.
struct CrewOrders {
    revision: i64,
    modern: bool,
    crews: Vec<Crew>,
    /// `comps[i]` is the staff component of `crews[i]`'s floor.
    comps: Vec<Option<i64>>,
    by_floor: FastMap<i64, Vec<Crew>>,
}

impl CrewOrders {
    fn new(tower: &Tower, modern: bool, crews: Vec<Crew>) -> Self {
        let comps = crews.iter().map(|c| tower.staff_component(c.1)).collect();
        CrewOrders {
            revision: tower.revision,
            modern,
            crews,
            comps,
            by_floor: FastMap::default(),
        }
    }

    fn holds(&self, tower: &Tower, modern: bool, crews: &[Crew]) -> bool {
        self.revision == tower.revision && self.modern == modern && self.crews == crews
    }

    /// The crews that can reach `floor` by staff transport, in the order
    /// dispatch tries them: nearest first in Modern (floor distance, then
    /// id), tower order in Classic. A crew on `floor` or in its staff
    /// component is what `staff_connected` answers; skipping the others here
    /// is what the loop did crew by crew, and filtering before a sort on a
    /// total order keeps the order. Each floor costs one scan, and in Modern
    /// one sort, until the key changes, where the TypeScript's
    /// `crewOrderByFloor` sorts once per floor per pass in Modern and the Rust
    /// used to clone the crews for every dirty room and, in Modern, sort them.
    fn for_floor(&mut self, tower: &Tower, floor: i64) -> &[Crew] {
        debug_assert_eq!(self.revision, tower.revision, "orders kept past an edit");
        let (crews, comps, modern) = (&self.crews, &self.comps, self.modern);
        self.by_floor.get_or_insert_with(floor, || {
            let here = tower.staff_component(floor);
            let mut order: Vec<Crew> = crews
                .iter()
                .zip(comps)
                .filter(|&(c, cc)| c.1 == floor || (cc.is_some() && *cc == here))
                .map(|(c, _)| *c)
                .collect();
            if modern {
                order.sort_by(|c1, c2| {
                    ((c1.1 - floor).abs())
                        .cmp(&(c2.1 - floor).abs())
                        .then(c1.0.cmp(&c2.0))
                });
            }
            order
        })
    }
}

pub struct Housekeeping {
    /// room id -> (crew id, floor)
    assigned_room: HashMap<i64, (i64, i64)>,
    maids_out: HashMap<i64, i64>,
    floors_busy: HashMap<i64, HashSet<i64>>,
    cleaned_today: i64,
    /// `hkYesterday`: yesterday's shift result (rooms cleaned, rooms left
    /// dirty), latched at the morning checkout; `None` before the first one.
    /// Read by the stats screen and the facility diagnostics, never saved.
    pub yesterday: Option<(i64, i64)>,
    /// Day the "can't reach" nudge last fired; -1 before the first.
    nudged_day: i64,
    crew_orders: Option<CrewOrders>,
}

impl Default for Housekeeping {
    fn default() -> Self {
        Housekeeping {
            assigned_room: HashMap::new(),
            maids_out: HashMap::new(),
            floors_busy: HashMap::new(),
            cleaned_today: 0,
            yesterday: None,
            nudged_day: -1,
            crew_orders: None,
        }
    }
}

impl Housekeeping {
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
        let Some((crew_id, floor)) = self.assigned_room.remove(&room_id) else {
            return;
        };
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

    /// What a dispatch pass works from, in one walk of the rooms in tower
    /// order: the operational crews, and the dirty hotel rooms no crew holds.
    fn crews_and_rooms(&self, tower: &Tower) -> (Vec<Crew>, Vec<Candidate>) {
        let mut crews = Vec::new();
        let mut rooms = Vec::new();
        for u in tower.room_units() {
            if u.kind == Kind::Housekeeping {
                if u.is_operational() {
                    crews.push((u.id, u.floor, u.x, u.width));
                }
            } else if u.kind.is_hotel()
                && u.state == UnitState::Dirty
                && !self.assigned_room.contains_key(&u.id)
            {
                rooms.push((u.id, u.floor, u.x, u.width, u.dirty_days.unwrap_or(0)));
            }
        }
        (crews, rooms)
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
            let kind = if leftover > 0 {
                LogKind::Bad
            } else {
                LogKind::Info
            };
            self.emit(
                &format!("Housekeeping cleaned {cleaned} hotel room(s).{behind}"),
                kind,
            );
        }
        self.housekeeping.yesterday = Some((cleaned, leftover));
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
                let Some(nid) = self.tower.room_at(floor, nx).map(|n| n.id) else {
                    continue;
                };
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
        if self.tower.housekeeping_units() == 0 {
            return;
        }
        // The room walk reads live state (dirt, assignments, fires and
        // construction) that changes without a revision bump.
        let (crews, mut candidates) = self.housekeeping.crews_and_rooms(&self.tower);
        // With no crew or no room the pass would assign, count and log
        // nothing.
        if crews.is_empty() || candidates.is_empty() {
            return;
        }
        let modern = self.mode.is_modern();
        // Taken out for the pass and put back after the room loop, which has
        // no early return.
        let mut orders = match self.housekeeping.crew_orders.take() {
            Some(o) if o.holds(&self.tower, modern, &crews) => o,
            _ => CrewOrders::new(&self.tower, modern, crews),
        };
        if modern {
            // The nearest staff-connected crew heads its floor's order.
            let mut scored: Vec<(Option<f64>, Candidate)> = candidates
                .into_iter()
                .map(|r| {
                    let order = orders.for_floor(&self.tower, r.1);
                    let d = order.first().map(|c| (c.1 - r.1).abs());
                    (d.map(|d| r.4 as f64 * 10.0 - d as f64 * 1.0), r)
                })
                .collect();
            scored.sort_by(|(sa, a), (sb, b)| {
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
            candidates = scored.into_iter().map(|(_, r)| r).collect();
        }
        let mut unreachable = 0;
        for room in &candidates {
            let (rid, rfloor, rx, rw, _) = *room;
            let mut reachable = false;
            let mut transient = false;
            let mut no_route = false;
            for crew in orders.for_floor(&self.tower, rfloor) {
                let (cid, cfloor, cx, cw) = *crew;
                reachable = true;
                if self.housekeeping.maids_out.get(&cid).copied().unwrap_or(0) >= HK_MAIDS_PER_UNIT
                {
                    transient = true;
                    continue;
                }
                if self
                    .housekeeping
                    .floors_busy
                    .get(&cid)
                    .is_some_and(|s| s.contains(&rfloor))
                {
                    transient = true;
                    continue;
                }
                // `x + width / 2` as a float, as the TypeScript passes it: a
                // kept-legacy odd width lands on a half tile.
                let dest_x = rx as f64 + rw as f64 / 2.0;
                let from_x = cx as f64 + cw as f64 / 2.0;
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
        self.housekeeping.crew_orders = Some(orders);
        let day = self.clock.day();
        if unreachable > 0 && self.housekeeping.nudged_day != day {
            self.housekeeping.nudged_day = day;
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

#[cfg(test)]
#[path = "housekeeping_dispatch_tests.rs"]
mod housekeeping_dispatch_tests;

#[cfg(test)]
mod tests {
    use crate::clock::GameMode;
    use crate::facilities::Kind;
    use crate::sim::Simulation;
    use crate::tower::UnitState;

    #[test]
    fn the_morning_checkout_latches_yesterdays_shift() {
        let mut sim = Simulation::new_game(9, GameMode::Classic);
        sim.money = 1e9;
        sim.star = 3;
        for x in 170..200 {
            assert!(sim.build(Kind::Lobby, 1, x).ok);
            assert!(sim.build(Kind::Floor, 2, x).ok);
        }
        assert!(sim.build(Kind::HotelSingle, 2, 172).ok);
        assert!(sim.build(Kind::HotelSingle, 2, 180).ok);
        assert_eq!(sim.housekeeping.yesterday, None);
        for u in sim
            .tower
            .units
            .iter_mut()
            .filter(|u| u.kind == Kind::HotelSingle)
        {
            u.state = UnitState::Dirty;
        }
        sim.housekeeping.cleaned_today = 3;
        sim.housekeeping_before_checkout();
        assert_eq!(sim.housekeeping.yesterday, Some((3, 2)));
        assert_eq!(sim.housekeeping.cleaned_today, 0);
        // A quiet day latches the zero result too.
        for u in sim
            .tower
            .units
            .iter_mut()
            .filter(|u| u.kind == Kind::HotelSingle)
        {
            u.state = UnitState::Empty;
        }
        sim.housekeeping_before_checkout();
        assert_eq!(sim.housekeeping.yesterday, Some((0, 0)));
    }
}
