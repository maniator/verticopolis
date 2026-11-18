//! Port of the retired TypeScript `src/engine/crowd/spawn.ts`,
//! `src/engine/crowd/trips.ts` and `src/engine/crowd/venueTrips.ts`.

use super::doors;
use super::meals::MealOrigin;
use super::routines::push_routine_options;
pub use super::spawn_floors::{spawn_floors, SpawnFloors};
use super::visits::{push_venue_visit_options, spawn_venue_visit, VisitOrigin};
use super::{Crowd, PState, Person, Route, MAX_PEOPLE};
use crate::clock::{Clock, GameMode};
use crate::facilities::Kind;
use crate::tower::{Tower, Unit};

mod lists;
mod meal_trips;
mod metro_trips;
mod staff;

use lists::{list_of, stamp_errand, List};
use meal_trips::{push_meal_options, spawn_meal_outbound};
pub(crate) use metro_trips::metro_arrival;
use metro_trips::metro_departure;
pub use staff::spawn_step;

// ---- src/engine/crowd/trips.ts ---------------------------------------------

/// `(crowd.nextId * 2654435761) | 0`: a double product (rounded past 2^53,
/// which an id above about 3.4 million reaches) then ToInt32.
pub(crate) fn seed_for(next_id: i64) -> i32 {
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
        from_metro: false,
        gave_up: false,
        crew_id: None,
        staff_trip: None,
        errand: None,
        walk_in: false,
        commuter: false,
        commute: None,
        start_x: origin_spawn_x as f64,
    };
    crowd.next_id += 1;
    crowd.people.push(person);
    super::floor_index::joined(crowd);
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
    // An open end takes the run of its floor nearest the trip's other end
    // that a route reaches (`doors`), so a lobby on a split lot is the one
    // under the trip. A floor with one run picks the tile it always did.
    let open = match (from_x, to_x) {
        (None, Some(tx)) => doors::route_open_end(crowd, tower, from, (to, tx as f64), true, seed),
        (Some(fx), None) => doors::route_open_end(crowd, tower, to, (from, fx as f64), false, seed),
        _ => None,
    };
    let (r, route_from_x, route_to_x) = match (open, from_x, to_x) {
        (Some((r, x)), None, Some(tx)) => (r, x, tx),
        (Some((r, x)), Some(fx), _) => (r, fx, x),
        _ => {
            let route_from_x = from_x.unwrap_or_else(|| pick_x(tower, from, seed));
            let route_to_x = to_x.unwrap_or_else(|| pick_x(tower, to, seed));
            let r = crowd.route(
                tower,
                from,
                to,
                Some(route_from_x as f64),
                Some(route_to_x as f64),
            )?;
            (r, route_from_x, route_to_x)
        }
    };
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
    for &(start, end) in tower.segment_runs(floor).iter() {
        if anchor_x < start {
            break;
        }
        if anchor_x <= end {
            lo = start;
            hi = end;
            break;
        }
    }
    // The tiles inside [lo, hi] in pickX's order, from the per-edit memo.
    let Some(tiles) = tower.run_tiles(floor, lo, hi) else {
        return anchor_x;
    };
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

/// The metro station whose platform is `platform_floor` nearest to `x`, the
/// one a rider at `x` walks to. A Modern tower may run several stations on
/// one platform; the first built wins a tie, so a tower with one station
/// always gets that one.
pub fn metro_station_for_platform(tower: &Tower, platform_floor: i64, x: f64) -> Option<i64> {
    if platform_floor >= 1 {
        return None;
    }
    let walk = |u: &Unit| {
        let (left, right) = (u.x as f64, (u.x + u.width) as f64);
        (left - x).max(x - right).max(0.0)
    };
    tower
        .metro_stations()
        .filter(|u| u.floor + 1 == platform_floor)
        .fold(None, |best: Option<&Unit>, u| match best {
            Some(b) if walk(b) <= walk(u) => Some(b),
            _ => Some(u),
        })
        .map(|u| u.id)
}

/// Whether a visitor sets out for a venue of `kind` at `hour`: it is open
/// now, and a show or party (an attendance venue, whose visit runs an hour
/// or more) is still on next hour. Nobody heads for a show in its last
/// hour, so nobody is still on the way, or just sitting down, when it
/// closes and sends everyone home. A meal is short enough to start in a
/// restaurant's last hour, like last orders.
pub fn open_for_visits(kind: Kind, hour: i64) -> bool {
    kind.is_open_at(hour) && (kind.attendance_cap().is_none() || kind.is_open_at((hour + 1) % 24))
}

/// Whether venue `u` in a `mode` tower can take one more visitor: its
/// staff are in, where it waits for them (`crowd::commuters`), and it is
/// not full.
pub fn venue_has_room(u: &Unit, mode: GameMode) -> bool {
    if u.kind.waits_for_staff(mode) && u.staff_in == 0 {
        return false;
    }
    let pop = u.kind.facility().population;
    if pop > 0 {
        return u.customers_in.unwrap_or(0) < pop;
    }
    match u.kind.attendance_cap() {
        None => true,
        Some(cap) => u.customers_in.unwrap_or(0) < cap,
    }
}

// ---- src/engine/crowd/venueTrips.ts ----------------------------------------

// ---- src/engine/crowd/spawn.ts ---------------------------------------------

/// A deferred spawn option: the closures of `spawnTrips`, evaluated only
/// when picked so the rng draws land in the same order.
enum Opt {
    /// `trip(from, to)` where either end may be a list pick.
    Trip(End, End),
    MetroArrival(List, f64),
    MetroDeparture(List),
    MealOutbound(usize),
    /// A visit to one of `kind`'s venues on the listed floors, drawn with
    /// the weight that follows (1 for an ordinary option).
    VenueVisit(Kind, Vec<i64>, VisitOrigin, f64),
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
    /// Whether some option weighs other than 1, so the draw walks the
    /// weights (`weighted_index`) instead of picking an index outright.
    weighted: bool,
}

impl Options {
    /// A visit to `kind` on `floors` from `origin`, drawn `weight` times as
    /// often as an ordinary option: a Modern theater's ticket prices move
    /// its share of the crowd's visits (#1950).
    pub fn push_venue_visit(
        &mut self,
        kind: Kind,
        floors: Vec<i64>,
        origin: VisitOrigin,
        weight: f64,
    ) {
        self.weighted |= weight != 1.0;
        self.opts
            .push(Opt::VenueVisit(kind, floors, origin, weight));
    }

    /// The option a draw `r` lands on.
    fn drawn(&self, r: f64) -> usize {
        if !self.weighted {
            return (r * self.opts.len() as f64).floor() as usize;
        }
        weighted_index(
            r,
            self.opts.iter().map(|o| match o {
                Opt::VenueVisit(_, _, _, w) | Opt::MetroArrival(_, w) => *w,
                _ => 1.0,
            }),
        )
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

/// The index a draw `r` in [0, 1) lands on when each entry counts its
/// weight: the first whose running total passes `r` times the whole. With
/// whole-number weights it lands where `Rng::pick` lands on a list holding
/// each entry `weight` times, so all ones pick as `Rng::pick` does and a
/// tower whose theaters all charge Normal draws as it did before ticket
/// prices (#1950).
/// The weights are walked twice (the total, then the draw) and never
/// collected, so a draw allocates nothing.
pub(crate) fn weighted_index(r: f64, weights: impl Iterator<Item = f64> + Clone) -> usize {
    let total: f64 = weights.clone().sum();
    let target = r * total;
    let mut sum = 0.0;
    let mut last = 0;
    for (i, w) in weights.enumerate() {
        sum += w;
        if target < sum {
            return i;
        }
        last = i;
    }
    last
}

/// The tenants' and visitors' sample is full. Housekeepers on shift,
/// walk-in customers (`walk_ins`) and office workers and venue staff on
/// their way (`commuters`) are counted apart: they are real people, and would
/// otherwise crowd the rest out of the picture.
fn crowd_is_full(crowd: &Crowd) -> bool {
    crowd
        .people
        .len()
        .saturating_sub(crowd.staff_count.max(0) as usize)
        .saturating_sub(crowd.walk_in_count.max(0) as usize)
        .saturating_sub(crowd.commuter_count.max(0) as usize)
        >= MAX_PEOPLE
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
    // A rider arrives only off a train standing at their station.
    let minute = clock.minute_of_day();
    let arriving: Vec<i64> = reachable_metros
        .iter()
        .copied()
        .filter(|&id| super::metro_train::train_in_at(tower, minute, id))
        .collect();
    let off_train = super::metro_train::arrival_weight(tower, &reachable_metros);
    let mut options = Options {
        opts: Vec::new(),
        pools: Vec::new(),
        venue_floors: Vec::new(),
        venue_kinds: &[],
        weighted: !arriving.is_empty(),
    };
    let o = &mut options.opts;
    // Modern office workers come and go as real commuters (`commuters`);
    // Classic offices keep the clock's trips until the 1994 rush is measured.
    let clock_offices = !tower.mode.office_workers_commute_in_person();
    let lo = clock_offices && !floors.leased_offices.is_empty();
    let so = clock_offices && !floors.staffed_offices.is_empty();
    // Modern residents leave and come home as real people (`commuters`)
    // too; Classic homes keep the clock's trips.
    let hm = !tower.mode.residents_commute_in_person() && !floors.homes.is_empty();
    if morning {
        if lo {
            o.push(Opt::Trip(End::Fixed(1), End::Pick(List::LeasedOffices)));
        }
        if hm {
            o.push(Opt::Trip(End::Pick(List::Homes), End::Fixed(1)));
        }
        if has_metro {
            if lo && !arriving.is_empty() {
                o.push(Opt::MetroArrival(List::LeasedOffices, off_train));
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
        if has_metro {
            if so {
                o.push(Opt::MetroDeparture(List::StaffedOffices));
            }
            if hm && !arriving.is_empty() {
                o.push(Opt::MetroArrival(List::Homes, off_train));
            }
        }
    } else if day && lo && crowd.rng.chance(0.3) {
        o.push(Opt::Trip(End::Fixed(1), End::Pick(List::LeasedOffices)));
    }
    // No one-way trip runs to or from a shop, restaurant or other open
    // venue: one that did walked to the venue's floor, stood a game minute
    // and vanished there (or appeared there and walked out). Their
    // customers come and go as real round trips instead: walk-ins
    // (`walk_ins`), meal trips and venue visits, each staying its
    // `dwell_seconds_range`.

    push_meal_options(crowd, tower, clock, floors, &mut options);
    push_venue_visit_options(crowd, tower, clock, floors, &mut options);
    push_routine_options(crowd, tower, clock, floors, &mut options);

    if options.opts.is_empty() {
        return;
    }
    let idx = options.drawn(crowd.rng.next());
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
            let i = add(crowd, tower, from, to, None, None);
            // Every floor-list trip runs between a list and the lobby: in
            // to the list's floor, or out of it.
            match (*a, *b) {
                (_, End::Pick(l)) => stamp_errand(crowd, i, l, true),
                (End::Pick(l), _) => stamp_errand(crowd, i, l, false),
                _ => {}
            }
        }
        Opt::MetroArrival(l, _) => {
            let sid = *crowd.rng.pick(&arriving);
            let to = *crowd.rng.pick(list_of(floors, *l));
            let station = tower.get_unit(sid).unwrap().clone();
            let i = metro_arrival(crowd, tower, &station, to);
            stamp_errand(crowd, i, *l, true);
        }
        Opt::MetroDeparture(l) => {
            let sid = *crowd.rng.pick(&reachable_metros);
            let from = *crowd.rng.pick(list_of(floors, *l));
            let station = tower.get_unit(sid).unwrap().clone();
            let i = metro_departure(crowd, tower, &station, from);
            stamp_errand(crowd, i, *l, false);
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
        Opt::VenueVisit(kind, venue_floors, origin, _) => {
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
