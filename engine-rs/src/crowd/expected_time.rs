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
//! trip of every car brings), the ride per floor at the car's speed and a
//! share of a dwell at each stop it passes. A flight costs a fixed climb.
//! The lines are the people waiting for or walking to a car as the last
//! motion slice counted them, and each rider routed in the step joins the
//! line they picked, so people setting out together spread out.
//!
//! The search runs on a transit graph: a segment boards a shaft at one of
//! its stops, a car rides stop to stop, and a rider steps off onto a
//! segment. A shaft with `n` stops adds a few links per stop and way,
//! where the fewest-rides graph links every pair of stops (`n²`), and the
//! search is an A* bounded by the least a route to the goal can cost with
//! no lines and every car running, searched back from the goal once per
//! goal and kept while the graph stays the same (`expected_bound`).
//!
//! Ground lobbies that do not touch are joined by the street: a rider may
//! step out of one and walk the sidewalk into the next, for the walk across
//! the open ground between them (`crowd::street`).

use std::cmp::Reverse;
use std::collections::{BinaryHeap, VecDeque};

use super::fasthash::FastMap;
use super::line_count::Line;
use super::street;
use super::{Crowd, Route, CROWD_SECONDS_PER_MINUTE, RIDE_SECONDS_PER_FLOOR};
use crate::{dispatch::DWELL_MINUTES, facilities::Kind, tower::Tower};

/// Costs are kept in tenths of a crowd second.
const TENTHS: f64 = 10.0;
/// What stepping onto a car costs beyond its wait and ride: nobody changes
/// cars to save a second.
const BOARDING_SECONDS: f64 = 10.0;
/// What a floor of stairs costs beyond the climb: the effort, so a floor or
/// two on foot beats a long line and a tower on foot does not.
const STAIRS_EFFORT_SECONDS: f64 = 11.0;
/// What a floor of escalator costs beyond the ride: stepping off onto the
/// next one. An escalator is a ride, so nobody minds taking it a long way
/// (owner, 2026-11-16).
const ESCALATOR_STEP_OFF_SECONDS: f64 = 1.0;
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
    /// Walk the street to the next ground lobby: no ride, so no leg.
    Street,
}

#[derive(Clone, Copy)]
struct Link {
    /// The node it leads to, by its place in `Router::nodes`.
    to: u32,
    /// The cost apart from any line, in tenths of a second.
    tenths: i64,
    how: Move,
    /// The number of the line it boards at (`NO_LINE` if none).
    line: u32,
}

/// One elevator shaft's numbers for its wait.
struct Shaft {
    /// A car's round trip over the shaft's span, in crowd seconds.
    round_trip: f64,
    /// Riders one car carries.
    capacity: f64,
    cars: i64,
    /// The most cars the shaft can hold, which the bound counts as running
    /// so adding or taking away a car keeps it (`least_cost`).
    most_cars: i64,
    /// Whether the shaft runs on Auto, which sends out every car once anyone
    /// waits at its stops (`Schedule::cars_while_anyone_waits`).
    auto: bool,
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
    /// The links into each node with the least each can cost.
    into: Inbound,
    /// The A* bound toward each goal searched so far, by the goal's place:
    /// the least any route from each node can cost (`bound_toward`).
    toward: Vec<Option<Toward>>,
    /// The goals with a bound kept, oldest first, to hold the bounds under
    /// `BOUND_CELLS`.
    kept: VecDeque<u32>,
    /// The search's scratch, by node place: its best cost and how it was
    /// reached, and the places it touched, to reset them after.
    best: Vec<i64>,
    prev: Vec<(u32, Move)>,
    touched: Vec<u32>,
    /// The open nodes: (cost plus bound, push order, place, cost), kept
    /// between searches so a search allocates nothing (hot-path HP-3).
    heap: BinaryHeap<Reverse<(i64, u32, u32, i64)>>,
    /// The bound search's scratch, kept the same way.
    bound_scratch: BoundScratch,
    shafts: FastMap<i64, Shaft>,
    /// Where each passenger shaft stands, for the walk to it (`walk`).
    walks: walk::Walks,
    step: i64,
    /// Riders in line or on the way to one, and the longest wait in each
    /// line, by (shaft id, floor).
    waiting: FastMap<(i64, i64), Line>,
    /// The step before's lines, kept for the next count to fill.
    spare: FastMap<(i64, i64), Line>,
    /// The cars in service this step of each shaft the schedule stood cars
    /// down on; a shaft not listed has all its cars running.
    running: FastMap<i64, f64>,
    step_costs: StepCosts,
}

fn tenths(seconds: f64) -> i64 {
    (seconds * TENTHS).round() as i64
}

fn link(to: u32, seconds: f64, how: Move) -> Link {
    Link {
        to,
        tenths: tenths(seconds),
        how,
        line: NO_LINE,
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

    fn add(&mut self, from: Node, to: Node, seconds: f64, how: Move) {
        let (a, b) = (self.of(from), self.of(to));
        self.links[a as usize].push(link(b, seconds, how));
    }
}

/// What one floor of stairs or escalator costs: the time it takes at the
/// mode's climbing speed, plus the effort of stairs or the step off an
/// escalator. Pricing from the speed keeps the router and the motion
/// agreeing about how long a flight takes.
fn floor_on_foot_seconds(tower: &Tower, kind: Kind) -> f64 {
    let ride = 1.0 / tower.mode.climb_speed(kind);
    match kind {
        Kind::Escalator => ride + ESCALATOR_STEP_OFF_SECONDS,
        _ => ride + STAIRS_EFFORT_SECONDS,
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
            let climb = floor_on_foot_seconds(tower, t.kind);
            for (a, here) in segs.iter().enumerate() {
                for (b, there) in segs.iter().enumerate().filter(|&(b, _)| b != a) {
                    let seconds = climb * (stops[b] - stops[a]).abs() as f64;
                    let how = Move::Flight { shaft: t.id };
                    for &s in here {
                        for &e in there {
                            let (s, e) = (Node::Segment(s), Node::Segment(e));
                            g.add(s, e, seconds, how);
                        }
                    }
                }
            }
            continue;
        }
        let ride = RIDE_SECONDS_PER_FLOOR / tower.mode.speed_of(t.kind);
        let span = (t.top - t.bottom).max(1) as f64;
        let round_trip = 2.0 * (span * ride + stops.len() as f64 * dwell);
        let shaft = Shaft {
            round_trip,
            capacity: t.kind.car_capacity().max(1.0),
            cars: t.cars,
            most_cars: t.kind.max_cars(),
            auto: t.schedule.as_ref().is_some_and(|s| s.auto_tune) && tower.mode.schedule_assist(),
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
                        g.add(car, Node::Segment(s), 0.0, off);
                    }
                }
                let Some((next, &to)) = next.and_then(|n| Some((n, stops.get(n)?))) else {
                    continue;
                };
                let ahead = Node::Car(t.id, next, way);
                let hop = (to - floor).abs() as f64 * ride + passed;
                for &s in here {
                    let on = Move::Board { shaft: t.id, floor };
                    g.add(Node::Segment(s), ahead, board + hop, on);
                }
                if behind.is_some() {
                    g.add(car, ahead, hop, Move::Ride);
                }
            }
        }
    }
    for (from, to, seconds) in street::links(tower) {
        let (from, to) = (Node::Segment(from), Node::Segment(to));
        g.add(from, to, seconds, Move::Street);
    }
    let n = g.nodes.len();
    let into = Inbound::of(&g.nodes, &g.links, &shafts);
    let step_costs = number_lines(&mut g.links);
    Router {
        revision: tower.revision,
        nodes: g.nodes,
        place: g.place,
        links: g.links,
        into,
        toward: (0..n).map(|_| None).collect(),
        kept: VecDeque::new(),
        best: vec![i64::MAX; n],
        prev: vec![(0, Move::Ride); n],
        touched: Vec::new(),
        heap: BinaryHeap::new(),
        bound_scratch: BoundScratch::default(),
        shafts,
        walks: walk::Walks::new(tower),
        step: -1,
        waiting: FastMap::default(),
        spare: FastMap::default(),
        running: FastMap::default(),
        step_costs,
    }
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
        if let Some(mut old) = crowd.router.take() {
            carry_bounds(&mut rebuilt, &mut old);
            if old.step == crowd.step {
                rebuilt.step = old.step;
                rebuilt.waiting = old.waiting;
                stand_down(&mut rebuilt, &crowd.closed_cars);
            }
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
        router.spare = std::mem::replace(&mut router.waiting, std::mem::take(shaft_lines));
        stand_down(router, closed_cars);
    }
    router
}

/// Sets each shaft's cars in service from the cars the schedule stood down
/// (`closed_cars`, ascending by shaft). A shaft with every car stood down
/// still counts one, as the fewest-rides search would still send riders to
/// it. A shaft on Auto keeps its whole fleet: the cars it parks while its
/// stops are empty all come out for the first rider in line, so pricing it
/// by its parked row kept riders away from it, and with nobody in line its
/// cars never came out (an express on one car beside three full twins).
fn stand_down(router: &mut Router, closed: &[(i64, i64)]) {
    router.step_costs.all_changed();
    router.running.clear();
    let mut at = 0;
    while at < closed.len() {
        let shaft = closed[at].0;
        let run = closed[at..].iter().take_while(|c| c.0 == shaft).count();
        at += run;
        if let Some(s) = router.shafts.get(&shaft).filter(|s| !s.auto) {
            let running = (s.cars - run as i64).max(1) as f64;
            router.running.insert(shaft, running);
        }
    }
}

/// The cheapest route from segment `from`, standing at `x` on it, to `to`,
/// the walk to the first shaft included. Ties go to the first node reached.
fn cheapest(router: &mut Router, from: i64, x: Option<f64>, to: i64) -> Option<Route> {
    if from == to {
        return Some(Route {
            floors: vec![from],
            shafts: vec![],
        });
    }
    let start = *router.place.get(&Node::Segment(from))?;
    let goal = *router.place.get(&Node::Segment(to))?;
    let key = walk::route_key(start, goal, x);
    if let Some(kept) = router.step_costs.route(key) {
        return kept.clone();
    }
    let found = walk::search_from(router, start, x, goal);
    let route = found.then(|| walk::walk_back(router, start, goal));
    for p in router.touched.drain(..) {
        router.best[p as usize] = i64::MAX;
    }
    router.step_costs.keep_route(key, &route);
    route
}

/// The A* search on the router's scratch: whether `goal` was reached. An
/// entry whose node was since reached for less is skipped, and the bound
/// drops by at most a link's cost, so `goal`'s first pop is the cheapest.
fn search(router: &mut Router, start: u32, goal: u32) -> bool {
    let (bound, fresh) = bound_toward(router, goal, Some(start));
    let radius = bound.least[start as usize];
    if radius == UNREACHABLE {
        keep_bound(router, goal, (bound, fresh));
        return false;
    }
    let mut heap = std::mem::take(&mut router.heap);
    heap.clear();
    let mut order = 0_u32;
    router.best[start as usize] = 0;
    router.touched.push(start);
    heap.push(Reverse((i64::from(radius), order, start, 0_i64)));
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
            let Some(ahead) = bound.ahead(l.to, radius) else {
                continue;
            };
            // A link costs at least its own share: no line to price past it.
            if router.best[l.to as usize] <= cost + l.tenths {
                continue;
            }
            let next = cost + line_cost(router, &l);
            if router.best[l.to as usize] <= next {
                continue;
            }
            if router.best[l.to as usize] == i64::MAX {
                router.touched.push(l.to);
            }
            router.best[l.to as usize] = next;
            router.prev[l.to as usize] = (at, l.how);
            order += 1;
            heap.push(Reverse((next + i64::from(ahead), order, l.to, next)));
        }
    }
    keep_bound(router, goal, (bound, fresh));
    router.heap = heap;
    found
}

/// The quickest expected route from segment `from`, standing at `x`, to `to`.
pub fn fastest_path(
    crowd: &mut Crowd,
    tower: &Tower,
    from: i64,
    x: Option<f64>,
    to: i64,
) -> Option<Route> {
    cheapest(fresh(crowd, tower), from, x, to)
}

#[path = "expected_lines.rs"]
mod lines;
#[cfg(test)]
pub use lines::router_lines;
pub use lines::{join_line, keep_lines, spare_lines};

#[path = "expected_bound.rs"]
mod bound;
#[path = "expected_costs.rs"]
mod costs;
#[path = "expected_walk.rs"]
mod walk;
use bound::{bound_toward, carry_bounds, keep_bound, BoundScratch, Inbound, Toward, UNREACHABLE};
use costs::{line_cost, number_lines, StepCosts, NO_LINE};

#[cfg(test)]
#[path = "expected_time_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "expected_bound_tests.rs"]
mod bound_tests;
