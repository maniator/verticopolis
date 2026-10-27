//! The floors and rooms a spawn step picks from: `spawnFloors` in
//! `crowd/spawn.ts`, rebuilt on each spawn step that has room to spawn
//! (#1143 item 4, A4 in #1158). The TypeScript also builds them when the
//! crowd is full (T2 in #1170).
//!
//! Each list keeps the order in which the walk over the rooms first meets a
//! floor, as the TypeScript's `Set`s do. The lists dedupe with one bit per
//! floor, and the rooms of each floor come from a tower index built once
//! per revision, so a build hashes nothing.

use std::sync::Arc;

use crate::clock::Clock;
use crate::facilities::Kind;
use crate::tower::{Tower, UnitState};
use crate::tower_index::{floor_slot, FloorRooms};

/// A bit per floor slot, in two words: a `u128` shift is a library call on
/// wasm32.
#[derive(Default)]
struct FloorBits([u64; 2]);

impl FloorBits {
    /// Sets slot `i`'s bit; whether it was clear.
    #[inline]
    fn insert(&mut self, i: usize) -> bool {
        let (word, bit) = (i >> 6, 1u64 << (i & 63));
        let new = self.0[word] & bit == 0;
        self.0[word] |= bit;
        new
    }
}

/// Floors in the order first added, each once.
#[derive(Default)]
struct FloorList {
    floors: Vec<i64>,
    seen: FloorBits,
}

impl FloorList {
    /// Adds `floor`; whether it was new.
    #[inline]
    fn insert(&mut self, floor: i64) -> bool {
        let new = match floor_slot(floor) {
            Some(i) => self.seen.insert(i),
            None => !self.floors.contains(&floor),
        };
        if new {
            self.floors.push(floor);
        }
        new
    }
}

/// The floors with an open venue, per venue kind. A kind with none has no
/// entry.
pub struct VenueFloors(Vec<(Kind, Vec<i64>)>);

impl VenueFloors {
    pub fn get(&self, kind: &Kind) -> Option<&Vec<i64>> {
        self.0.iter().find(|(k, _)| k == kind).map(|(_, f)| f)
    }
}

pub struct SpawnFloors {
    pub leased_offices: Vec<i64>,
    pub staffed_offices: Vec<i64>,
    pub homes: Vec<i64>,
    pub open_venues: Vec<i64>,
    pub condo_floors: Vec<i64>,
    pub household_floors: Vec<i64>,
    pub hotel_floors: Vec<i64>,
    pub staff_floors: Vec<(Kind, i64)>,
    pub venues_by_kind: VenueFloors,
    units_by_floor: Arc<FloorRooms>,
    /// Operational metro station ids.
    pub metro_stations: Vec<i64>,
}

impl SpawnFloors {
    /// Room unit ids on `floor`, in unit order.
    pub fn units_on(&self, floor: i64) -> &[i64] {
        self.units_by_floor.on(floor)
    }
}

/// Adds `floor` to `kind`'s list in `lists`, which holds one list per kind.
fn add_floor(lists: &mut Vec<(Kind, FloorList)>, kind: Kind, floor: i64) {
    match lists.iter_mut().find(|(k, _)| *k == kind) {
        Some((_, list)) => {
            list.insert(floor);
        }
        None => {
            let mut list = FloorList::default();
            list.insert(floor);
            lists.push((kind, list));
        }
    }
}

/// Adds `(kind, floor)` to the staff floors unless it is there already: a
/// bit per floor for each kind, where the TypeScript keeps a `seenStaff`
/// `Set`, and a search of the list for a floor past the slots.
fn add_staff_floor(
    floors: &mut Vec<(Kind, i64)>,
    seen: &mut Vec<(Kind, FloorBits)>,
    kind: Kind,
    floor: i64,
) {
    let new = match floor_slot(floor) {
        Some(i) => {
            let at = match seen.iter().position(|(k, _)| *k == kind) {
                Some(at) => at,
                None => {
                    seen.push((kind, FloorBits::default()));
                    seen.len() - 1
                }
            };
            seen[at].1.insert(i)
        }
        None => !floors.contains(&(kind, floor)),
    };
    if new {
        floors.push((kind, floor));
    }
}

pub fn spawn_floors(tower: &Tower, clock: &Clock) -> SpawnFloors {
    let hour = clock.hour();
    let weekend = clock.is_weekend();
    let mut leased = FloorList::default();
    let mut staffed = FloorList::default();
    let mut homes = FloorList::default();
    let mut venues = FloorList::default();
    let mut metro_stations: Vec<i64> = Vec::new();
    let mut condo_floors = FloorList::default();
    let mut household_floors = FloorList::default();
    let mut hotel_floors = FloorList::default();
    let mut staff_floors: Vec<(Kind, i64)> = Vec::new();
    let mut staff_seen: Vec<(Kind, FloorBits)> = Vec::new();
    let mut venues_by_kind: Vec<(Kind, FloorList)> = Vec::new();
    for u in tower.room_units() {
        if u.kind.is_staff_kind() {
            if u.is_operational() {
                add_staff_floor(&mut staff_floors, &mut staff_seen, u.kind, u.floor);
            }
            continue;
        }
        if u.kind == Kind::WeddingHall {
            if u.is_operational() {
                add_floor(&mut venues_by_kind, u.kind, u.floor);
            }
            continue;
        }
        if u.kind == Kind::Metro {
            if u.is_operational() {
                metro_stations.push(u.id);
            }
            continue;
        }
        if !(u.is_tenanted() || u.state == UnitState::Asleep) {
            continue;
        }
        if u.kind == Kind::Office {
            if !weekend {
                leased.insert(u.floor);
            }
            if u.occupants > 0 {
                staffed.insert(u.floor);
            }
        } else if u.kind == Kind::Condo || u.kind.is_rental() {
            homes.insert(u.floor);
            if u.kind != Kind::RentalStudio || u.visible_occupants() > 0 {
                condo_floors.insert(u.floor);
            }
            if u.kind.has_household() {
                household_floors.insert(u.floor);
            }
        } else if u.kind.is_hotel() {
            homes.insert(u.floor);
            hotel_floors.insert(u.floor);
        } else if u.kind.is_ambient_venue() && u.kind.is_open_at(hour) {
            venues.insert(u.floor);
            add_floor(&mut venues_by_kind, u.kind, u.floor);
        } else if u.kind.attendance_cap().is_some() && u.kind.is_open_at(hour) {
            add_floor(&mut venues_by_kind, u.kind, u.floor);
        }
    }
    SpawnFloors {
        leased_offices: leased.floors,
        staffed_offices: staffed.floors,
        homes: homes.floors,
        open_venues: venues.floors,
        condo_floors: condo_floors.floors,
        household_floors: household_floors.floors,
        hotel_floors: hotel_floors.floors,
        staff_floors,
        venues_by_kind: VenueFloors(
            venues_by_kind
                .into_iter()
                .map(|(k, list)| (k, list.floors))
                .collect(),
        ),
        units_by_floor: tower.floor_rooms(),
        metro_stations,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use indexmap::IndexSet;

    use super::*;
    use crate::facilities::{MAX_FLOOR, MIN_FLOOR};
    use crate::tower_index::FLOOR_SLOTS;

    /// The lists as `spawn_floors` built them before #1143 item 4, with
    /// hashed sets and maps: a frozen copy that proves the containers
    /// changed and nothing else. It shares the rules' predicates, so it
    /// cannot catch a rule bug; when a rule changes on purpose, delete it
    /// rather than edit both.
    struct Before {
        lists: [Vec<i64>; 7],
        staff_floors: Vec<(Kind, i64)>,
        venues_by_kind: HashMap<Kind, Vec<i64>>,
        units_by_floor: HashMap<i64, Vec<i64>>,
        metro_stations: Vec<i64>,
    }

    fn before(tower: &Tower, clock: &Clock) -> Before {
        let hour = clock.hour();
        let weekend = clock.is_weekend();
        let mut leased: IndexSet<i64> = IndexSet::new();
        let mut staffed: IndexSet<i64> = IndexSet::new();
        let mut homes: IndexSet<i64> = IndexSet::new();
        let mut venues: IndexSet<i64> = IndexSet::new();
        let mut metro_stations: Vec<i64> = Vec::new();
        let mut condo_floors: IndexSet<i64> = IndexSet::new();
        let mut household_floors: IndexSet<i64> = IndexSet::new();
        let mut hotel_floors: IndexSet<i64> = IndexSet::new();
        let mut staff_floors: Vec<(Kind, i64)> = Vec::new();
        let mut venues_by_kind: HashMap<Kind, IndexSet<i64>> = HashMap::new();
        let mut units_by_floor: HashMap<i64, Vec<i64>> = HashMap::new();
        for u in tower.room_units() {
            units_by_floor.entry(u.floor).or_default().push(u.id);
            if u.kind.is_staff_kind() {
                if u.is_operational() && !staff_floors.contains(&(u.kind, u.floor)) {
                    staff_floors.push((u.kind, u.floor));
                }
                continue;
            }
            if u.kind == Kind::WeddingHall {
                if u.is_operational() {
                    venues_by_kind.entry(u.kind).or_default().insert(u.floor);
                }
                continue;
            }
            if u.kind == Kind::Metro {
                if u.is_operational() {
                    metro_stations.push(u.id);
                }
                continue;
            }
            if !(u.is_tenanted() || u.state == UnitState::Asleep) {
                continue;
            }
            if u.kind == Kind::Office {
                if !weekend {
                    leased.insert(u.floor);
                }
                if u.occupants > 0 {
                    staffed.insert(u.floor);
                }
            } else if u.kind == Kind::Condo || u.kind.is_rental() {
                homes.insert(u.floor);
                if u.kind != Kind::RentalStudio || u.visible_occupants() > 0 {
                    condo_floors.insert(u.floor);
                }
                if u.kind.has_household() {
                    household_floors.insert(u.floor);
                }
            } else if u.kind.is_hotel() {
                homes.insert(u.floor);
                hotel_floors.insert(u.floor);
            } else if u.kind.is_ambient_venue() && u.kind.is_open_at(hour) {
                venues.insert(u.floor);
                venues_by_kind.entry(u.kind).or_default().insert(u.floor);
            } else if u.kind.attendance_cap().is_some() && u.kind.is_open_at(hour) {
                venues_by_kind.entry(u.kind).or_default().insert(u.floor);
            }
        }
        let list = |s: IndexSet<i64>| s.into_iter().collect::<Vec<i64>>();
        Before {
            lists: [
                list(leased),
                list(staffed),
                list(homes),
                list(venues),
                list(condo_floors),
                list(household_floors),
                list(hotel_floors),
            ],
            staff_floors,
            venues_by_kind: venues_by_kind
                .into_iter()
                .map(|(k, s)| (k, list(s)))
                .collect(),
            units_by_floor,
            metro_stations,
        }
    }

    /// The lists answer as before; which of the ten outputs had anything in.
    fn assert_as_before(tower: &Tower, clock: &Clock) -> [bool; 10] {
        let at = format!("day {} hour {}", clock.day(), clock.hour());
        let now = spawn_floors(tower, clock);
        let was = before(tower, clock);
        let lists = [
            &now.leased_offices,
            &now.staffed_offices,
            &now.homes,
            &now.open_venues,
            &now.condo_floors,
            &now.household_floors,
            &now.hotel_floors,
        ];
        for (i, (now, was)) in lists.iter().zip(&was.lists).enumerate() {
            assert_eq!(*now, was, "{at}: list {i}");
        }
        assert_eq!(now.staff_floors, was.staff_floors, "{at}");
        assert_eq!(now.metro_stations, was.metro_stations, "{at}");
        assert_eq!(now.venues_by_kind.0.len(), was.venues_by_kind.len(), "{at}");
        for (kind, floors) in &was.venues_by_kind {
            assert_eq!(now.venues_by_kind.get(kind), Some(floors), "{at}: {kind:?}");
        }
        for floor in MIN_FLOOR - 1..=MAX_FLOOR + 1 {
            let was = was.units_by_floor.get(&floor).map_or(&[][..], |v| v);
            assert_eq!(now.units_on(floor), was, "{at}: floor {floor}");
        }
        let mut filled = [false; 10];
        for (i, list) in lists.iter().enumerate() {
            filled[i] = !list.is_empty();
        }
        filled[7] = !now.staff_floors.is_empty();
        filled[8] = !now.metro_stations.is_empty();
        filled[9] = !now.venues_by_kind.0.is_empty();
        filled
    }

    #[test]
    fn the_fixture_towers_list_the_floors_as_before() {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../conformance/fixtures/");
        let mut filled = [false; 10];
        let mut seen = |now: [bool; 10]| {
            for (seen, now) in filled.iter_mut().zip(now) {
                *seen |= now;
            }
        };
        for name in [
            "split-tower-4",
            "sixseven_2",
            "towerone_6",
            "sixseven-december",
        ] {
            let path = format!("{dir}{name}.vctower");
            let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
            let raw = crate::load::decode_vctower(&text).expect("decodes");
            let mut sim = crate::load::deserialize(&raw).expect("loads");
            // Every hour of the tower's week, weekend included, on the
            // rooms as loaded.
            let calendar = sim.clock.calendar;
            let week_start = (sim.clock.day() - sim.clock.day_of_week()) * 1440;
            let mut weekend = [false; 2];
            for hour in 0..calendar.week_days * 24 {
                let clock = Clock::new((week_start + hour * 60) as f64, calendar);
                weekend[clock.is_weekend() as usize] = true;
                seen(assert_as_before(&sim.tower, &clock));
            }
            assert_eq!(weekend, [true, true], "{name}");
            // And on the rooms as a day of play (12 ticks of 120 game
            // minutes) changes them.
            for _ in 0..12 {
                sim.tick(120.0);
                seen(assert_as_before(&sim.tower, &sim.clock));
            }
        }
        // Every output had floors at some point, so none was compared only
        // empty against empty.
        assert_eq!(filled, [true; 10]);
    }

    #[test]
    fn a_floor_past_the_slots_takes_the_slow_path() {
        assert_eq!(floor_slot(MIN_FLOOR), Some(0));
        assert_eq!(
            floor_slot(MIN_FLOOR + FLOOR_SLOTS as i64 - 1),
            Some(FLOOR_SLOTS - 1)
        );
        for floor in [
            MIN_FLOOR - 1,
            MIN_FLOOR + FLOOR_SLOTS as i64,
            i64::MIN,
            i64::MAX,
            200,
            -50,
        ] {
            assert_eq!(floor_slot(floor), None, "{floor}");
        }
        let mut list = FloorList::default();
        let added: Vec<bool> = [5, 200, 5, -50, 200, 7, -50]
            .into_iter()
            .map(|floor| list.insert(floor))
            .collect();
        assert_eq!(added, [true, true, false, true, false, true, false]);
        assert_eq!(list.floors, [5, 200, -50, 7]);
        // Staff floors dedupe per kind, past the slots too.
        let (mut floors, mut seen) = (Vec::new(), Vec::new());
        for (kind, floor) in [
            (Kind::Security, 5),
            (Kind::Medical, 5),
            (Kind::Security, 200),
            (Kind::Security, 5),
            (Kind::Medical, 200),
            (Kind::Security, 200),
            (Kind::Medical, 5),
        ] {
            add_staff_floor(&mut floors, &mut seen, kind, floor);
        }
        assert_eq!(
            floors,
            [
                (Kind::Security, 5),
                (Kind::Medical, 5),
                (Kind::Security, 200),
                (Kind::Medical, 200),
            ]
        );
    }
}
