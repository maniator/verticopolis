//! The Modern router: of the routes to a floor, a rider takes the one with
//! the shortest expected trip, the lines they would stand in included. The
//! fewest-rides search sent everyone above a sky lobby up one express
//! however long its line grew, while a slower way up stood idle (sky bridge
//! design, owner 2026-11-14). Classic keeps the fewest-rides search with its
//! walking budget, as the 1994 game routes.
//!
//! A route's cost is in tenths of a crowd second, so the search adds whole
//! numbers. Each ride costs a boarding cost, the expected wait for a car
//! (half the time between cars, plus the line ahead over the seats a round
//! trip of every car brings), the ride per floor and a share of a dwell at
//! each stop it passes. Each flight of stairs or escalator costs a fixed
//! climb. The lines are the people waiting for or walking to a car as the
//! last motion slice counted them, and each rider routed in the step joins
//! the line they picked, so people setting out together spread out instead of all taking
//! the line that was shortest when the step began.
//!
//! The search runs on a transit graph: a segment boards a shaft at one of
//! its stops, a car rides stop to stop, and a rider steps off onto a
//! segment. A shaft with `n` stops adds a few links per stop and way,
//! where the fewest-rides graph links every pair of stops (`n²`), and the
//! search is an A* bounded by the floors still to ride plus, off the goal,
//! the least a segment's way out costs.

use std::cmp::Reverse;
use std::collections::BinaryHeap;

use super::fasthash::FastMap;
use super::{Crowd, Route, CROWD_SECONDS_PER_MINUTE, RIDE_SECONDS_PER_FLOOR};
use crate::dispatch::DWELL_MINUTES;
use crate::facilities::Kind;
use crate::tower::Tower;
use crate::tower_query::floor_of_seg;

/// Costs are kept in tenths of a crowd second.
const TENTHS: f64 = 10.0;
/// What stepping onto a car costs beyond its wait and ride: nobody changes
/// cars to save a second.
const BOARDING_SECONDS: f64 = 10.0;
/// One flight of stairs, the climb included: a floor or two on foot beats a
/// long line, a tower on foot does not.
const STAIRS_FLIGHT_SECONDS: f64 = 15.0;
/// One escalator flight, the ride included.
const ESCALATOR_FLIGHT_SECONDS: f64 = 8.0;
/// The share of the stops between a rider's floors that a car makes.
const STOPS_MADE: f64 = 0.5;
/// Which way a car carries a rider: one leg rides one way.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Way {
    Up,
    Down,
}

/// A node of the transit graph: a segment, or a car of a shaft arriving at
/// one of its stops (the shaft id and the stop's place in its stop list),
/// riding one way. Boarding takes a rider straight to the car's next stop,
/// so nobody steps off where they stepped on: a wide car over a gap in the
/// floor is not a footbridge, and a leg never turns back.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Node {
    Segment(i64),
    Car(i64, usize, Way),
}

#[derive(Clone, Copy)]
enum Move {
    /// Step onto a car of `shaft` at `floor` and ride it to its next stop
    /// (the wait and the line at `floor` are read for the step).
    Board { shaft: i64, floor: i64 },
    /// Stay aboard to the next stop.
    Ride,
    /// Step off onto a segment.
    Alight { shaft: i64 },
    /// Climb a flight of stairs or ride an escalator.
    Flight { shaft: i64 },
}

#[derive(Clone, Copy)]
struct Link {
    /// The node it leads to, by its place in `Router::nodes`.
    to: u32,
    /// The floor `to` stands at.
    floor: i64,
    /// The cost apart from any line, in tenths of a second.
    tenths: i64,
    how: Move,
}

/// One elevator shaft's numbers for its wait.
struct Shaft {
    /// A car's round trip over the shaft's span, in crowd seconds.
    round_trip: f64,
    /// Riders one car carries.
    capacity: f64,
    cars: i64,
}

/// The transit graph for one tower revision, and the lines and the cars in
/// service for one step (see the module note). Never saved: a load builds a
/// fresh crowd.
pub struct Router {
    revision: i64,
    /// Each node, and the place of each in that list.
    nodes: Vec<Node>,
    place: FastMap<Node, u32>,
    /// The links out of each node, by its place.
    links: Vec<Vec<Link>>,
    /// The least that leaving each segment costs beyond the floors it
    /// covers, by place (0 for a car), which the A* bound adds off the goal
    /// (`exit_costs`).
    exit: Vec<i64>,
    /// The search's scratch, by node place: its best cost and how it was
    /// reached, and the places it touched, to reset them after.
    best: Vec<i64>,
    prev: Vec<(u32, Move)>,
    touched: Vec<u32>,
    /// The open nodes: (cost plus bound, push order, place, cost). Kept
    /// between searches so a search allocates nothing (hot-path HP-3).
    heap: BinaryHeap<Reverse<(i64, u64, u32, i64)>>,
    shafts: FastMap<i64, Shaft>,
    step: i64,
    /// Riders in line or on the way to one, by (shaft id, floor).
    waiting: FastMap<(i64, i64), i64>,
    /// The cars in service this step of each shaft the schedule stood cars
    /// down on; a shaft not listed has all its cars running.
    running: FastMap<i64, f64>,
}

fn tenths(seconds: f64) -> i64 {
    (seconds * TENTHS).round() as i64
}

fn link(to: u32, floor: i64, seconds: f64, how: Move) -> Link {
    Link {
        to,
        floor,
        tenths: tenths(seconds),
        how,
    }
}

/// Numbers the graph's nodes densely as they are first met.
#[derive(Default)]
struct Places {
    nodes: Vec<Node>,
    place: FastMap<Node, u32>,
    links: Vec<Vec<Link>>,
}

impl Places {
    fn of(&mut self, node: Node) -> u32 {
        if let Some(&p) = self.place.get(&node) {
            return p;
        }
        let p = self.nodes.len() as u32;
        self.nodes.push(node);
        self.place.insert(node, p);
        self.links.push(Vec::new());
        p
    }

    fn add(&mut self, from: Node, to: Node, floor: i64, seconds: f64, how: Move) {
        let (a, b) = (self.of(from), self.of(to));
        self.links[a as usize].push(link(b, floor, seconds, how));
    }
}

fn build(tower: &Tower) -> Router {
    let mut g = Places::default();
    let mut shafts: FastMap<i64, Shaft> = FastMap::default();
    let dwell = DWELL_MINUTES * CROWD_SECONDS_PER_MINUTE;
    let passengers = tower.transports.iter();
    for t in passengers.filter(|t| !t.kind.is_staff_only_transport()) {
        let stops = tower.stops_of(t);
        let segs: Vec<Vec<i64>> = stops.iter().map(|&f| tower.landing_segs(t, f)).collect();
        if t.kind.is_walkway() {
            let climb = match t.kind {
                Kind::Escalator => ESCALATOR_FLIGHT_SECONDS,
                _ => STAIRS_FLIGHT_SECONDS,
            };
            for (a, here) in segs.iter().enumerate() {
                for (b, there) in segs.iter().enumerate().filter(|&(b, _)| b != a) {
                    let seconds = climb * (stops[b] - stops[a]).abs() as f64;
                    let how = Move::Flight { shaft: t.id };
                    for &s in here {
                        for &e in there {
                            let (s, e) = (Node::Segment(s), Node::Segment(e));
                            g.add(s, e, stops[b], seconds, how);
                        }
                    }
                }
            }
            continue;
        }
        let span = (t.top - t.bottom).max(1) as f64;
        let round_trip = 2.0 * (span * RIDE_SECONDS_PER_FLOOR + stops.len() as f64 * dwell);
        let shaft = Shaft {
            round_trip,
            capacity: t.kind.car_capacity().max(1.0),
            cars: t.cars,
        };
        shafts.insert(t.id, shaft);
        // Each hop to the next stop carries a share of a dwell, which a ride
        // pays once too often (it does not pass its last stop), so boarding
        // takes that share back.
        let passed = STOPS_MADE * dwell;
        let board = BOARDING_SECONDS - passed;
        for (i, (&floor, here)) in stops.iter().zip(&segs).enumerate() {
            for (way, next) in [(Way::Up, Some(i + 1)), (Way::Down, i.checked_sub(1))] {
                let car = Node::Car(t.id, i, way);
                // A car arriving here from the stop behind it lets riders off.
                let behind = match way {
                    Way::Up => i.checked_sub(1),
                    Way::Down => Some(i + 1).filter(|&b| b < stops.len()),
                };
                if behind.is_some() {
                    for &s in here {
                        let off = Move::Alight { shaft: t.id };
                        g.add(car, Node::Segment(s), floor, 0.0, off);
                    }
                }
                let Some((next, &to)) = next.and_then(|n| Some((n, stops.get(n)?))) else {
                    continue;
                };
                let ahead = Node::Car(t.id, next, way);
                let hop = (to - floor).abs() as f64 * RIDE_SECONDS_PER_FLOOR + passed;
                for &s in here {
                    let on = Move::Board { shaft: t.id, floor };
                    g.add(Node::Segment(s), ahead, to, board + hop, on);
                }
                if behind.is_some() {
                    g.add(car, ahead, to, hop, Move::Ride);
                }
            }
        }
    }
    let n = g.nodes.len();
    let exit = exit_costs(&g, &shafts);
    Router {
        revision: tower.revision,
        nodes: g.nodes,
        place: g.place,
        links: g.links,
        exit,
        best: vec![i64::MAX; n],
        prev: vec![(0, Move::Ride); n],
        touched: Vec::new(),
        heap: BinaryHeap::new(),
        shafts,
        step: -1,
        waiting: FastMap::default(),
        running: FastMap::default(),
    }
}

/// The least each segment's way out costs beyond the floors it covers, by
/// place: a boarding with no line and every car running, or a flight. Any
/// route off a segment other than its goal takes one of these first, and
/// the bound adds it. Keeping it at or under each link's own cost beyond
/// its floors keeps the bound consistent, so A* still finds the cheapest
/// route (`the_exit_bound_never_overtakes_a_link`).
fn exit_costs(g: &Places, shafts: &FastMap<i64, Shaft>) -> Vec<i64> {
    let floor_of = |p: usize| match g.nodes[p] {
        Node::Segment(s) => Some(floor_of_seg(s)),
        Node::Car(..) => None,
    };
    (0..g.nodes.len())
        .map(|p| {
            let Some(floor) = floor_of(p) else {
                return 0;
            };
            let least = g.links[p].iter().map(|l| {
                let wait = match l.how {
                    Move::Board { shaft, .. } => tenths(least_headway(&shafts[&shaft])),
                    _ => 0,
                };
                l.tenths + wait - floors_bound(floor, l.floor)
            });
            least.min().unwrap_or(0).max(0)
        })
        .collect()
}

/// Half the time between cars with every car running: the least a boarding
/// waits.
fn least_headway(s: &Shaft) -> f64 {
    s.round_trip / (2.0 * s.cars.max(1) as f64)
}

/// The router for this tower revision, with the lines counted for this
/// step.
fn fresh<'a>(crowd: &'a mut Crowd, tower: &Tower) -> &'a mut Router {
    if crowd
        .router
        .as_ref()
        .is_none_or(|r| r.revision != tower.revision)
    {
        // A tower edit mid-step keeps the step's lines: they are keyed by
        // shaft and floor, not by the graph, and the crowd's count was
        // already taken at the step's first route.
        let mut rebuilt = build(tower);
        if let Some(old) = crowd.router.take().filter(|r| r.step == crowd.step) {
            rebuilt.step = old.step;
            rebuilt.waiting = old.waiting;
            stand_down(&mut rebuilt, &crowd.closed_cars);
        }
        crowd.router = Some(rebuilt);
    }
    let Crowd {
        router,
        shaft_lines,
        step,
        closed_cars,
        ..
    } = crowd;
    let router = router.as_mut().expect("built above");
    if router.step != *step {
        router.step = *step;
        router.waiting = std::mem::take(shaft_lines);
        stand_down(router, closed_cars);
    }
    router
}

/// Sets each shaft's cars in service from the cars the schedule stood down
/// (`closed_cars`, ascending by shaft). A shaft with every car stood down
/// still counts one, as the fewest-rides search would still send riders to
/// it.
fn stand_down(router: &mut Router, closed: &[(i64, i64)]) {
    router.running.clear();
    let mut at = 0;
    while at < closed.len() {
        let shaft = closed[at].0;
        let run = closed[at..].iter().take_while(|c| c.0 == shaft).count();
        at += run;
        if let Some(s) = router.shafts.get(&shaft) {
            let running = (s.cars - run as i64).max(1) as f64;
            router.running.insert(shaft, running);
        }
    }
}

/// The least any route can cost from a node at `floor` to floor `to`: every
/// ride and flight costs at least a car's ride per floor. It never
/// overestimates, so the route found is still the cheapest.
fn floors_bound(floor: i64, to: i64) -> i64 {
    ((floor - to).abs() as f64 * RIDE_SECONDS_PER_FLOOR * TENTHS).floor() as i64
}

/// The A* bound from the node at `place`, standing at `floor`, to the
/// segment `goal` on `to_floor`: the floors still to ride, plus the least
/// way out of a segment that is not the goal.
fn bound_to(router: &Router, (place, floor): (u32, i64), (goal, to_floor): (u32, i64)) -> i64 {
    let exit = if place == goal {
        0
    } else {
        router.exit[place as usize]
    };
    floors_bound(floor, to_floor) + exit
}

/// What `l` costs, the wait and the line at a boarding included: half the
/// time between cars, plus the line ahead over the seats a round trip of
/// every car in service brings.
fn cost_of(router: &Router, l: &Link) -> i64 {
    let Move::Board { shaft, floor } = l.how else {
        return l.tenths;
    };
    let line = router.waiting.get(&(shaft, floor)).copied().unwrap_or(0) as f64;
    let s = &router.shafts[&shaft];
    let cars = s.cars.max(1) as f64;
    let running = router.running.get(&shaft).copied().unwrap_or(cars);
    let headway = s.round_trip / (2.0 * running);
    l.tenths + tenths(headway + line / (running * s.capacity) * s.round_trip)
}

/// The cheapest route from segment `from` to segment `to`. Ties go to the
/// node reached first, in the graph's built order.
fn cheapest(router: &mut Router, from: i64, to: i64) -> Option<Route> {
    if from == to {
        return Some(Route {
            floors: vec![from],
            shafts: vec![],
        });
    }
    let start = *router.place.get(&Node::Segment(from))?;
    let goal = *router.place.get(&Node::Segment(to))?;
    let found = search(router, start, goal);
    let route = found.then(|| walk_back(router, start, goal));
    for p in router.touched.drain(..) {
        router.best[p as usize] = i64::MAX;
    }
    route
}

/// The A* search itself, on the router's scratch: whether `goal` was
/// reached. A heap entry carries the cost it was pushed with, and one whose
/// node has since been reached for less is skipped. The bound never drops
/// by more than a link costs, so the first time `goal` comes off the heap
/// its cost is the least.
fn search(router: &mut Router, start: u32, goal: u32) -> bool {
    let to_floor = floor_of_seg(segment(router, goal));
    let bound = |router: &Router, place: u32, floor: i64| {
        bound_to(router, (place, floor), (goal, to_floor))
    };
    let mut heap = std::mem::take(&mut router.heap);
    heap.clear();
    let mut order = 0_u64;
    let from_floor = floor_of_seg(segment(router, start));
    router.best[start as usize] = 0;
    router.touched.push(start);
    let first = bound(router, start, from_floor);
    heap.push(Reverse((first, order, start, 0_i64)));
    let mut found = false;
    while let Some(Reverse((_, _, at, cost))) = heap.pop() {
        if cost > router.best[at as usize] {
            continue;
        }
        if at == goal {
            found = true;
            break;
        }
        for i in 0..router.links[at as usize].len() {
            let l = router.links[at as usize][i];
            let next = cost + cost_of(router, &l);
            if router.best[l.to as usize] <= next {
                continue;
            }
            if router.best[l.to as usize] == i64::MAX {
                router.touched.push(l.to);
            }
            router.best[l.to as usize] = next;
            router.prev[l.to as usize] = (at, l.how);
            order += 1;
            let ahead = bound(router, l.to, l.floor);
            heap.push(Reverse((next + ahead, order, l.to, next)));
        }
    }
    router.heap = heap;
    found
}

/// The segment id of the node at `place`. Only a segment's place is asked:
/// a route starts and ends on one, and a rider boards and climbs from one.
fn segment(router: &Router, place: u32) -> i64 {
    match router.nodes[place as usize] {
        Node::Segment(s) => s,
        Node::Car(..) => unreachable!("a car node read as a segment"),
    }
}

/// The route as segments and the shaft of each leg, from the search's trail.
fn walk_back(router: &Router, start: u32, goal: u32) -> Route {
    let seg = |p: u32| segment(router, p);
    let mut floors = vec![seg(goal)];
    let mut shafts = Vec::new();
    let mut cur = goal;
    while cur != start {
        let (back, how) = router.prev[cur as usize];
        match how {
            Move::Flight { shaft } => {
                shafts.push(shaft);
                floors.push(seg(back));
            }
            Move::Alight { shaft } => shafts.push(shaft),
            Move::Board { .. } => floors.push(seg(back)),
            Move::Ride => {}
        }
        cur = back;
    }
    floors.reverse();
    shafts.reverse();
    Route { floors, shafts }
}

/// The route with the shortest expected trip between two segments.
pub fn fastest_path(crowd: &mut Crowd, tower: &Tower, from: i64, to: i64) -> Option<Route> {
    cheapest(fresh(crowd, tower), from, to)
}

/// Puts a rider routed this step in the line for their first car, so the
/// next rider routed in the step sees it.
pub fn join_line(crowd: &mut Crowd, r: &Route) {
    let (Some(&shaft), Some(&floor)) = (r.shafts.first(), r.floors.first()) else {
        return;
    };
    if let Some(router) = crowd.router.as_mut() {
        if router.shafts.contains_key(&shaft) {
            *router.waiting.get_or_insert_with((shaft, floor), || 0) += 1;
        }
    }
}

#[cfg(test)]
#[path = "expected_time_tests.rs"]
mod tests;
