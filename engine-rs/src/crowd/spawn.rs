//! Port of `crowd/spawn.ts`, `crowd/trips.ts` and `crowd/venueTrips.ts`.

use std::collections::HashMap;

use indexmap::IndexSet;

use crate::housekeeping::HK_MAIDS_PER_UNIT;

use super::meals::{
    matches_meal_origin_kind, meal_window_for, outbound_weight, staff_on_shift, MealOrigin,
};
use super::routines::push_routine_options;
use super::visits::{push_venue_visit_options, spawn_venue_visit, VisitOrigin};
use super::{
    Crowd, PState, Person, Route, CROWD_SECONDS_PER_MINUTE, MAX_PEOPLE, METRO_DWELL_MAX,
    METRO_DWELL_MIN,
};
use crate::clock::Clock;
use crate::facilities::Kind;
use crate::jsmath;
use crate::sim_loop::{weather_for, Weather};
use crate::tower::{Tower, Unit};

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
    let mut tiles: Vec<i64> = Vec::new();
    for u in &tower.units {
        if u.kind.is_structural() && u.floor == floor {
            for i in 0..u.width {
                tiles.push(u.x + i);
            }
        }
    }
    if tiles.is_empty() {
        return 2 + (abs_seed(seed) % 40) as i64;
    }
    tiles[abs_seed(seed) % tiles.len()]
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
    let mut tiles: Vec<i64> = Vec::new();
    for u in &tower.units {
        if u.kind.is_structural() && u.floor == floor {
            for i in 0..u.width {
                let x = u.x + i;
                if x >= lo && x <= hi {
                    tiles.push(x);
                }
            }
        }
    }
    if tiles.is_empty() {
        return anchor_x;
    }
    tiles[abs_seed(seed) % tiles.len()]
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

pub struct SpawnFloors {
    pub leased_offices: Vec<i64>,
    pub staffed_offices: Vec<i64>,
    pub homes: Vec<i64>,
    pub open_venues: Vec<i64>,
    pub condo_floors: Vec<i64>,
    pub household_floors: Vec<i64>,
    pub hotel_floors: Vec<i64>,
    pub staff_floors: Vec<(Kind, i64)>,
    pub venues_by_kind: HashMap<Kind, Vec<i64>>,
    /// Room unit ids per floor, in unit order.
    pub units_by_floor: HashMap<i64, Vec<i64>>,
    /// Operational metro station ids.
    pub metro_stations: Vec<i64>,
}

impl SpawnFloors {
    pub fn units_on(&self, floor: i64) -> &[i64] {
        self.units_by_floor
            .get(&floor)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
    }
}

pub fn spawn_floors(tower: &Tower, clock: &Clock) -> SpawnFloors {
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
        if !(u.is_tenanted() || u.state == crate::tower::UnitState::Asleep) {
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
    SpawnFloors {
        leased_offices: leased.into_iter().collect(),
        staffed_offices: staffed.into_iter().collect(),
        homes: homes.into_iter().collect(),
        open_venues: venues.into_iter().collect(),
        condo_floors: condo_floors.into_iter().collect(),
        household_floors: household_floors.into_iter().collect(),
        hotel_floors: hotel_floors.into_iter().collect(),
        staff_floors,
        venues_by_kind: venues_by_kind
            .into_iter()
            .map(|(k, s)| (k, s.into_iter().collect()))
            .collect(),
        units_by_floor,
        metro_stations,
    }
}

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

pub fn spawn_trips(crowd: &mut Crowd, tower: &mut Tower, clock: &Clock, floors: &SpawnFloors) {
    if crowd.people.len() >= MAX_PEOPLE {
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

fn push_meal_options(
    crowd: &mut Crowd,
    tower: &Tower,
    clock: &Clock,
    floors: &SpawnFloors,
    options: &mut Options,
) {
    let Some(window) = meal_window_for(clock.hour()) else {
        return;
    };
    let (start, end) = window.bounds();
    let hour_frac = clock.minute_of_day() / 60.0 - start as f64;
    let t = (hour_frac / (end - start) as f64).clamp(0.0, 1.0);
    let outbound = outbound_weight(t);
    let venue_floors: Vec<i64> = window
        .venues()
        .iter()
        .flat_map(|k| floors.venues_by_kind.get(k).cloned().unwrap_or_default())
        .collect();
    if venue_floors.is_empty() {
        return;
    }
    let shift = tower.mode.housekeeping_shift();
    let mut pools: Vec<MealPool> = Vec::new();
    let mut push = |origin_kind: MealOrigin, list: Vec<i64>| {
        if !list.is_empty() && origin_kind.weight() > 0.0 {
            pools.push(MealPool {
                origin_kind,
                floors: list,
            });
        }
    };
    for &kind in window.origins() {
        match kind {
            MealOrigin::Office => push(MealOrigin::Office, floors.staffed_offices.clone()),
            MealOrigin::Condo => push(MealOrigin::Condo, floors.condo_floors.clone()),
            MealOrigin::Hotel => push(MealOrigin::Hotel, floors.hotel_floors.clone()),
            MealOrigin::Staff => {
                let on_shift: Vec<i64> = floors
                    .staff_floors
                    .iter()
                    .filter(|(k, _)| staff_on_shift(*k, clock.hour(), shift))
                    .map(|(_, f)| *f)
                    .collect();
                push(MealOrigin::Staff, on_shift);
            }
        }
    }
    if pools.is_empty() {
        return;
    }
    let outbound_base = jsmath::round(outbound * 3.0).max(0.0) as i64;
    for (pi, pool) in pools.iter().enumerate() {
        for _ in 0..outbound_base {
            let w = pool.origin_kind.weight();
            if w >= 1.0 || crowd.rng.chance(w) {
                options.opts.push(Opt::MealOutbound(pi));
            }
        }
    }
    options.pools = pools;
    options.venue_floors = venue_floors;
    options.venue_kinds = window.venues();
}

fn spawn_meal_outbound(
    crowd: &mut Crowd,
    tower: &mut Tower,
    pool: &MealPool,
    venue_floors: &[i64],
    venue_kinds: &[Kind],
    hour: i64,
    floors: &SpawnFloors,
) {
    let origin_floor = *crowd.rng.pick(&pool.floors);
    let shift = tower.mode.housekeeping_shift();
    let candidates: Vec<i64> = floors
        .units_on(origin_floor)
        .iter()
        .copied()
        .filter(|&id| {
            let u = tower.get_unit(id).unwrap();
            matches_meal_origin_kind(u, pool.origin_kind)
                && (pool.origin_kind != MealOrigin::Staff || staff_on_shift(u.kind, hour, shift))
                && u.visible_occupants() > 0
        })
        .collect();
    if candidates.is_empty() {
        return;
    }
    let origin_id = *crowd.rng.pick(&candidates);
    let venue_floor = *crowd.rng.pick(venue_floors);
    let venue_candidates: Vec<i64> = floors
        .units_on(venue_floor)
        .iter()
        .copied()
        .filter(|&id| {
            let u = tower.get_unit(id).unwrap();
            venue_kinds.contains(&u.kind)
                && u.is_tenanted()
                && u.kind.is_open_at(hour)
                && venue_has_room(u)
        })
        .collect();
    if venue_candidates.is_empty() {
        return;
    }
    let venue_id = *crowd.rng.pick(&venue_candidates);
    let (ox, vx, vw) = {
        let o = tower.get_unit(origin_id).unwrap();
        let v = tower.get_unit(venue_id).unwrap();
        (o.x, v.x, v.width)
    };
    let Some(i) = add(crowd, tower, origin_floor, venue_floor, Some(ox), Some(vx)) else {
        return;
    };
    crowd.people[i].dest_x = crowd.rng.int(vx, vx + vw - 1) as f64;
    crowd.people[i].meal_venue_id = Some(venue_id);
    crowd.people[i].origin_unit_id = Some(origin_id);
    let origin = tower.get_unit_mut(origin_id).unwrap();
    origin.out_for_meal = Some(origin.out_for_meal.unwrap_or(0) + 1);
    tower.bump_meal_overlay_revision();
}

#[derive(Debug, PartialEq, Eq)]
pub enum StaffSpawn {
    Sent,
    Full,
    NoRoute,
}

pub fn spawn_staff(
    crowd: &mut Crowd,
    tower: &Tower,
    from: i64,
    to: i64,
    dest_x: f64,
    clean_unit_id: i64,
    clean_minutes: f64,
    from_x: Option<f64>,
) -> StaffSpawn {
    if crowd.staff_count >= max_staff_for(tower) {
        return StaffSpawn::Full;
    }
    let Some(r) = crowd.staff_route(tower, from, to, from_x, Some(dest_x)) else {
        return StaffSpawn::NoRoute;
    };
    let i = make_person(crowd, tower, r, dest_x, None);
    let p = &mut crowd.people[i];
    if let Some(fx) = from_x {
        p.x = fx;
    }
    p.staff = true;
    p.clean_unit_id = Some(clean_unit_id);
    p.linger_for = Some(clean_minutes * CROWD_SECONDS_PER_MINUTE);
    crowd.staff_count += 1;
    StaffSpawn::Sent
}

pub fn max_staff_for(tower: &Tower) -> i64 {
    tower
        .units
        .iter()
        .filter(|u| u.kind == Kind::Housekeeping)
        .count() as i64
        * HK_MAIDS_PER_UNIT
}

/// `spawnStep`.
pub fn spawn_step(
    crowd: &mut Crowd,
    dt_sec: f64,
    tower: &mut Tower,
    clock: &Clock,
    weather: Option<Weather>,
) {
    let mut time_rate = 2.2;
    if clock.is_night() {
        time_rate = 0.3;
    } else if clock.is_weekend() {
        time_rate = 1.2;
    }
    let pop_factor = (0.4 + tower.total_population() as f64 / 2000.0).min(3.0);
    let sky = weather.unwrap_or_else(|| weather_for(clock.day()));
    let weather_factor = if sky == Weather::Rain {
        tower.mode.rain_crowd_factor()
    } else {
        1.0
    };
    crowd.spawn_acc += dt_sec * time_rate * pop_factor * weather_factor;
    if crowd.spawn_acc < 1.0 {
        return;
    }
    let floors = spawn_floors(tower, clock);
    let mut guard = 0;
    while crowd.spawn_acc >= 1.0 && guard < 8 {
        guard += 1;
        crowd.spawn_acc -= 1.0;
        spawn_trips(crowd, tower, clock, &floors);
    }
}

#[cfg(test)]
mod tests {
    use super::seed_for;

    #[test]
    fn seed_matches_the_javascript_expression() {
        // Node: (id * 2654435761) | 0 for each id.
        assert_eq!(seed_for(1), -1640531535);
        assert_eq!(seed_for(2), 1013904226);
        assert_eq!(seed_for(3_400_000), -1911161536);
        assert_eq!(seed_for(10_000_000), -568160640);
    }
}
