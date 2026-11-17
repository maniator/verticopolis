//! What a link costs the Modern router (`expected_time`, `cost_of`), and
//! what the router has already worked out this step, kept until the lines
//! it read change: each line's cost at a boarding, and the routes it found.
//! A search reads a boarding's cost at every visit, three map lookups each,
//! and the riders who weigh another way after an hour in one line
//! (`line_count`) ask the same route one after another while nobody joins
//! a line. What is kept is what the search would work out again, so the
//! routes are the same (hot-path HP-8: the record names this as the
//! equivalent).

use super::super::fasthash::FastMap;
use super::super::Route;
use super::{tenths, Link, Move, Router};

/// A kept route's start and goal places and where the rider stands
/// (`walk::route_key`).
type RouteKey = (u32, u32, u64);
/// `Link::line` of a link that boards no car.
pub(super) const NO_LINE: u32 = u32::MAX;
/// The most routes kept at once: past it the kept ones go and are searched
/// again if asked, which holds the memory to a few hundred KiB.
const MOST_ROUTES: usize = 1024;

/// The costs and routes kept for the lines as they stand (see the module
/// note).
pub(super) struct StepCosts {
    /// The number of each line a link boards at, by (shaft id, floor).
    number: FastMap<(i64, i64), u32>,
    /// Each line's cost over its link's own, by number, with the change of
    /// the lines it was worked out at.
    line: Vec<(u32, i64)>,
    /// Counts each change to every line at once; an entry worked out before
    /// the last one is out of date. Starts at 1, so an entry never worked
    /// out (0) is out of date too.
    changes: u32,
    /// The routes found since the lines last changed, by `RouteKey`.
    routes: FastMap<RouteKey, Option<Route>>,
}

/// Numbers each line the graph's links board at, and keeps the number on
/// the link.
pub(super) fn number_lines(links: &mut [Vec<Link>]) -> StepCosts {
    let mut number: FastMap<(i64, i64), u32> = FastMap::default();
    for l in links.iter_mut().flatten() {
        if let Move::Board { shaft, floor } = l.how {
            let next = number.len() as u32;
            l.line = *number.get_or_insert_with((shaft, floor), || next);
        }
    }
    StepCosts {
        line: vec![(0, 0); number.len()],
        number,
        changes: 1,
        routes: FastMap::default(),
    }
}

impl StepCosts {
    /// Every line may have changed: the step's count came in, or the cars
    /// in service changed.
    pub(super) fn all_changed(&mut self) {
        self.changes = self.changes.wrapping_add(1).max(1);
        self.forget_routes();
    }

    /// A rider joined the line at `shaft` on `floor`.
    pub(super) fn joined(&mut self, shaft: i64, floor: i64) {
        if let Some(&n) = self.number.get(&(shaft, floor)) {
            self.line[n as usize].0 = 0;
        }
        self.forget_routes();
    }

    fn forget_routes(&mut self) {
        if !self.routes.is_empty() {
            self.routes.clear();
        }
    }

    /// The route between `key`'s ends found since the lines last changed.
    pub(super) fn route(&self, key: RouteKey) -> Option<&Option<Route>> {
        self.routes.get(&key)
    }

    pub(super) fn keep_route(&mut self, key: RouteKey, route: &Option<Route>) {
        if self.routes.len() >= MOST_ROUTES {
            self.routes.clear();
        }
        self.routes.insert(key, route.clone());
    }
}

/// What `l` costs, the wait and the line at a boarding included: half the
/// time between cars, plus the line ahead over the seats a round trip of
/// every car in service brings, or the longest anyone in that line has
/// already waited when that is longer (a line the cars arrive at full, say
/// below a shaft that fills on the floors above, moves slower than its
/// length says).
pub(super) fn cost_of(router: &Router, l: &Link) -> i64 {
    let Move::Board { shaft, floor } = l.how else {
        return l.tenths;
    };
    let line = router
        .waiting
        .get(&(shaft, floor))
        .copied()
        .unwrap_or_default();
    let s = &router.shafts[&shaft];
    let cars = s.cars.max(1) as f64;
    let running = router.running.get(&shaft).copied().unwrap_or(cars);
    let headway = s.round_trip / (2.0 * running);
    let expected = headway + line.riders as f64 / (running * s.capacity) * s.round_trip;
    l.tenths + tenths(expected.max(line.oldest))
}

/// What `l` costs (`cost_of`), its line's share worked out once until the
/// line changes.
#[inline]
pub(super) fn line_cost(router: &mut Router, l: &Link) -> i64 {
    if l.line == NO_LINE {
        return l.tenths;
    }
    let n = l.line as usize;
    let (at, share) = router.step_costs.line[n];
    if at == router.step_costs.changes {
        return l.tenths + share;
    }
    let cost = cost_of(router, l);
    router.step_costs.line[n] = (router.step_costs.changes, cost - l.tenths);
    cost
}

#[cfg(test)]
#[path = "expected_costs_tests.rs"]
mod tests;
