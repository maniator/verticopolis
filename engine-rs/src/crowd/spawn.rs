//! Port of `crowd/spawn.ts`, `crowd/trips.ts` and `crowd/venueTrips.ts`.

use super::meals::MealOrigin;
use super::routines::push_routine_options;
pub use super::spawn_floors::{spawn_floors, SpawnFloors};
use super::visits::{push_venue_visit_options, spawn_venue_visit, VisitOrigin};
use super::{Crowd, PState, Person, Route, MAX_PEOPLE, METRO_DWELL_MAX, METRO_DWELL_MIN};
use crate::clock::Clock;
use crate::facilities::Kind;
use crate::tower::{Tower, Unit};

mod meal_trips;
mod staff;

use meal_trips::{push_meal_options, spawn_meal_outbound};
pub use staff::{max_staff_for, spawn_staff, spawn_step, StaffSpawn};

// ---- trips.ts -------------------------------------------------------------

/// `(crowd.nextId * 2654435761) | 0`: a double product (rounded past 2^53,
/// which an id above about 3.4 million reaches) then ToInt32.
fn seed_for(next_id: i64) -> i32 {
    let product = next_id as f64 * 2654435761.0;
    product.rem_euclid(4294967296.0) as u32 as i32
}

pub fn make_person(
    crowd: &mut Crowd,
    tower: &Tower,
    route: Route,
    dest_x: f64,
    origin_x: Option<i64>,
) -> usize {
    let from = route.floors[0];
    let seed = seed_for(crowd.next_id);
    let origin_spawn_x = match origin_x {
        Some(ox) => pick_x_in_segment(tower, from, seed, ox),
        None => pick_x(tower, from, seed),
    };
    let person = Person {
        id: crowd.next_id,
        seed,
        state: if route.shafts.is_empty() {
            PState::ToDest
        } else {
            PState::ToShaft
        },
        floor: from,
        fy: from as f64,
        x: origin_spawn_x as f64,
        origin_floor: from,
        shaft_id: route.shafts.first().copied(),
        floors: route.floors,
        shafts: route.shafts,
        leg: 0,
        car_index: None,
        wait: 0.0,
        trip_wait: 0.0,
        age: 0.0,
        linger: 0.0,
        dest_x,
        staff: false,
        clean_unit_id: None,
        meal_venue_id: None,
        venue_unit_id: None,
        counted_hotel_guest: false,
        origin_unit_id: None,
        dwell_seconds_left: None,
        returning: false,
        routine: None,
        linger_for: None,
    };
    crowd.next_id += 1;
    crowd.people.push(person);
    crowd.people.len() - 1
}

/// `add(crowd, tower, from, to, fromX?, toX?)`: the index of the new person.
pub fn add(
    crowd: &mut Crowd,
    tower: &Tower,
    from: i64,
    to: i64,
    from_x: Option<i64>,
    to_x: Option<i64>,
) -> Option<usize> {
    let seed = seed_for(crowd.next_id);
    let route_from_x = from_x.unwrap_or_else(|| pick_x(tower, from, seed));
    let route_to_x = to_x.unwrap_or_else(|| pick_x(tower, to, seed));
    let r = crowd.route(
        tower,
        from,
        to,
        Some(route_from_x as f64),
        Some(route_to_x as f64),
    )?;
    Some(make_person(
        crowd,
        tower,
        r,
        route_to_x as f64,
        Some(route_from_x),
    ))
}

fn abs_seed(seed: i32) -> usize {
    (seed as i64).unsigned_abs() as usize
}

pub fn pick_x(tower: &Tower, floor: i64, seed: i32) -> i64 {
    match tower.structural_tiles(floor) {
        Some(tiles) if !tiles.is_empty() => tiles[abs_seed(seed) % tiles.len()],
        _ => 2 + (abs_seed(seed) % 40) as i64,
    }
}

pub fn pick_x_in_segment(tower: &Tower, floor: i64, seed: i32, anchor_x: i64) -> i64 {
    let mut lo = anchor_x;
    let mut hi = anchor_x;
    for (start, end) in tower.segments_of(floor) {
        if anchor_x < start {
            break;
        }
        if anchor_x <= end {
            lo = start;
            hi = end;
            break;
        }
    }
    // The tiles inside [lo, hi] in pickX's order, counted and then indexed
    // in place rather than copied out.
    let Some(tiles) = tower.structural_tiles(floor) else {
        return anchor_x;
    };
    let in_run = |x: &&i64| **x >= lo && **x <= hi;
    let n = tiles.iter().filter(in_run).count();
    if n == 0 {
        return anchor_x;
    }
    *tiles.iter().filter(in_run).nth(abs_seed(seed) % n).unwrap()
}

pub fn inside_x(crowd: &mut Crowd, u: &Unit, inset: i64) -> i64 {
    let lo = (u.x + inset).min(u.x + u.width - 1);
    let hi = lo.max(u.x + u.width - inset - 1);
    crowd.rng.int(lo, hi)
}

pub fn metro_station_for_platform(tower: &Tower, platform_floor: i64) -> Option<i64> {
    if platform_floor >= 1 {
        return None;
    }
    tower
        .units
        .iter()
        .find(|u| u.kind == Kind::Metro && u.floor + 1 == platform_floor)
        .map(|u| u.id)
}

pub fn venue_has_room(u: &Unit) -> bool {
    let pop = u.kind.facility().population;
    if pop > 0 {
        return u.customers_in.unwrap_or(0) < pop;
    }
    match u.kind.attendance_cap() {
        None => true,
        Some(cap) => u.customers_in.unwrap_or(0) < cap,
    }
}

// ---- venueTrips.ts ---------------------------------------------------------

fn metro_arrival(crowd: &mut Crowd, tower: &Tower, station: &Unit, to: i64) {
    let Some(i) = add(crowd, tower, station.floor + 1, to, None, None) else {
        return;
    };
    crowd.people[i].x = inside_x(crowd, station, 2) as f64;
}

fn metro_departure(crowd: &mut Crowd, tower: &Tower, station: &Unit, from: i64) {
    let Some(i) = add(crowd, tower, from, station.floor + 1, None, None) else {
        return;
    };
    crowd.people[i].dest_x = inside_x(crowd, station, 2) as f64;
    crowd.people[i].linger_for = Some(crowd.rng.int(METRO_DWELL_MIN, METRO_DWELL_MAX) as f64);
}

// ---- spawn.ts --------------------------------------------------------------

#[derive(Clone, Copy)]
enum List {
    LeasedOffices,
    StaffedOffices,
    Homes,
    OpenVenues,
}

/// A deferred spawn option: the closures of `spawnTrips`, evaluated only
/// when picked so the rng draws land in the same order.
enum Opt {
    /// `trip(from, to)` where either end may be a list pick.
    Trip(End, End),
    MetroArrival(List),
    MetroDeparture(List),
    MealOutbound(usize),
    VenueVisit(Kind, Vec<i64>, VisitOrigin),
    SchoolDeparture,
    SchoolReturn,
    SalesCall,
}

#[derive(Clone, Copy)]
enum End {
    Fixed(i64),
    Pick(List),
}

pub struct MealPool {
    pub origin_kind: MealOrigin,
    pub floors: Vec<i64>,
}

/// Collected options plus the meal pools they index.
pub struct Options {
    opts: Vec<Opt>,
    pools: Vec<MealPool>,
    venue_floors: Vec<i64>,
    venue_kinds: &'static [Kind],
}

impl Options {
    pub fn push_venue_visit(&mut self, kind: Kind, floors: Vec<i64>, origin: VisitOrigin) {
        self.opts.push(Opt::VenueVisit(kind, floors, origin));
    }
    pub fn push_school_departure(&mut self) {
        self.opts.push(Opt::SchoolDeparture);
    }
    pub fn push_school_return(&mut self) {
        self.opts.push(Opt::SchoolReturn);
    }
    pub fn push_sales_call(&mut self) {
        self.opts.push(Opt::SalesCall);
    }
}

fn list_of(floors: &SpawnFloors, l: List) -> &[i64] {
    match l {
        List::LeasedOffices => &floors.leased_offices,
        List::StaffedOffices => &floors.staffed_offices,
        List::Homes => &floors.homes,
        List::OpenVenues => &floors.open_venues,
    }
}

/// A full crowd spawns no one: `spawn_trips` returns on it before any draw,
/// and `spawn_step` skips the floor lists on it (#1143 item 4).
fn crowd_is_full(crowd: &Crowd) -> bool {
    crowd.people.len() >= MAX_PEOPLE
}

pub fn spawn_trips(crowd: &mut Crowd, tower: &mut Tower, clock: &Clock, floors: &SpawnFloors) {
    if crowd_is_full(crowd) {
        return;
    }
    let morning = clock.is_morning();
    let evening = clock.is_evening();
    let day = !morning && !evening && !clock.is_night();
    let reachable_metros: Vec<i64> = floors
        .metro_stations
        .iter()
        .copied()
        .filter(|&id| tower.is_metro_platform_served(tower.get_unit(id).unwrap()))
        .collect();
    let has_metro = !reachable_metros.is_empty();
    let mut options = Options {
        opts: Vec::new(),
        pools: Vec::new(),
        venue_floors: Vec::new(),
        venue_kinds: &[],
    };
    let o = &mut options.opts;
    let lo = !floors.leased_offices.is_empty();
    let so = !floors.staffed_offices.is_empty();
    let hm = !floors.homes.is_empty();
    let ov = !floors.open_venues.is_empty();
    if morning {
        if lo {
            o.push(Opt::Trip(End::Fixed(1), End::Pick(List::LeasedOffices)));
        }
        if hm {
            o.push(Opt::Trip(End::Pick(List::Homes), End::Fixed(1)));
        }
        if has_metro {
            if lo {
                o.push(Opt::MetroArrival(List::LeasedOffices));
            }
            if hm {
                o.push(Opt::MetroDeparture(List::Homes));
            }
        }
    } else if evening {
        if so {
            o.push(Opt::Trip(End::Pick(List::StaffedOffices), End::Fixed(1)));
        }
        if hm {
            o.push(Opt::Trip(End::Fixed(1), End::Pick(List::Homes)));
        }
        if ov {
            o.push(Opt::Trip(End::Fixed(1), End::Pick(List::OpenVenues)));
        }
        if has_metro {
            if so {
                o.push(Opt::MetroDeparture(List::StaffedOffices));
            }
            if hm {
                o.push(Opt::MetroArrival(List::Homes));
            }
            if ov {
                o.push(Opt::MetroArrival(List::OpenVenues));
            }
        }
    } else if day {
        if ov {
            o.push(Opt::Trip(End::Fixed(1), End::Pick(List::OpenVenues)));
        }
        if lo && crowd.rng.chance(0.3) {
            o.push(Opt::Trip(End::Fixed(1), End::Pick(List::LeasedOffices)));
        }
        if has_metro && ov {
            o.push(Opt::MetroArrival(List::OpenVenues));
        }
    } else if ov {
        o.push(Opt::Trip(End::Pick(List::OpenVenues), End::Fixed(1)));
        if has_metro {
            o.push(Opt::MetroDeparture(List::OpenVenues));
        }
    }

    push_meal_options(crowd, tower, clock, floors, &mut options);
    push_venue_visit_options(crowd, tower, clock, floors, &mut options);
    push_routine_options(crowd, tower, clock, floors, &mut options);

    if options.opts.is_empty() {
        return;
    }
    let idx = (crowd.rng.next() * options.opts.len() as f64).floor() as usize;
    let hour = clock.hour();
    match &options.opts[idx] {
        Opt::Trip(a, b) => {
            let from = match *a {
                End::Fixed(f) => f,
                End::Pick(l) => *crowd.rng.pick(list_of(floors, l)),
            };
            let to = match *b {
                End::Fixed(f) => f,
                End::Pick(l) => *crowd.rng.pick(list_of(floors, l)),
            };
            add(crowd, tower, from, to, None, None);
        }
        Opt::MetroArrival(l) => {
            let sid = *crowd.rng.pick(&reachable_metros);
            let to = *crowd.rng.pick(list_of(floors, *l));
            let station = tower.get_unit(sid).unwrap().clone();
            metro_arrival(crowd, tower, &station, to);
        }
        Opt::MetroDeparture(l) => {
            let sid = *crowd.rng.pick(&reachable_metros);
            let from = *crowd.rng.pick(list_of(floors, *l));
            let station = tower.get_unit(sid).unwrap().clone();
            metro_departure(crowd, tower, &station, from);
        }
        Opt::MealOutbound(pi) => {
            let pi = *pi;
            spawn_meal_outbound(
                crowd,
                tower,
                &options.pools[pi],
                &options.venue_floors,
                options.venue_kinds,
                hour,
                floors,
            );
        }
        Opt::VenueVisit(kind, venue_floors, origin) => {
            let (kind, venue_floors, origin) = (*kind, venue_floors.clone(), *origin);
            spawn_venue_visit(crowd, tower, kind, &venue_floors, floors, hour, origin);
        }
        Opt::SchoolDeparture => super::routines::spawn_school_departure(crowd, tower, floors),
        Opt::SchoolReturn => super::routines::spawn_school_return(crowd, tower, floors),
        Opt::SalesCall => super::routines::spawn_sales_call(crowd, tower, floors),
    }
}

#[cfg(test)]
mod tests;
