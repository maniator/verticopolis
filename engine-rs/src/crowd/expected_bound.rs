//! The A* bound of the Modern router (`expected_time`): the least a route
//! to a goal can cost with no lines and every car running, searched back
//! from the goal only as far as a search asks for, while the graph stays
//! the same, and kept under a cap.

use std::cmp::Reverse;
use std::collections::BinaryHeap;

use super::{tenths, Link, Move, Node, Router, Shaft};
use crate::crowd::fasthash::FastMap;

/// The most bound entries the router keeps across goals, one per node per
/// goal: 4 MiB. A tower with 1,000 nodes keeps the bound toward 1,000 goals;
/// past the cap the oldest goal's bound goes and is searched again if asked.
/// Each kept bound also holds its open segments (`Toward`), at most one per
/// link into a segment and far fewer once the search nears its end.
pub(super) const BOUND_CELLS: usize = 1_048_576;
/// A bound entry for a node the goal cannot be reached from.
pub(super) const UNREACHABLE: u32 = u32::MAX;

/// The least `l` can ever cost: a boarding with no line and the most cars
/// the shaft holds running, else its own cost. `cost_of` never charges
/// less, which keeps the bound consistent, so A* still finds the cheapest
/// route (`the_bound_never_overtakes_a_link`).
pub(super) fn least_cost(shafts: &FastMap<i64, Shaft>, l: &Link) -> i64 {
    match l.how {
        Move::Board { shaft, .. } => l.tenths + tenths(least_headway(&shafts[&shaft])),
        _ => l.tenths,
    }
}

/// The links into each node with the least each can cost, flat, for the
/// bound's search back from a goal: the links into the node at place `p`
/// are `from[at[p]..at[p + 1]]`, each as (the place it leaves, its least
/// cost). Built with the graph; two graphs with the same `Inbound` have the
/// same bounds (`carry_bounds`). Also whether each node is a car, which
/// the search settles without its heap.
#[derive(PartialEq)]
pub(super) struct Inbound {
    at: Vec<u32>,
    from: Vec<(u32, u32)>,
    car: Vec<bool>,
}

impl Inbound {
    /// The incoming links of a graph of `nodes` whose links out of each
    /// place are `links`.
    pub(super) fn of(nodes: &[Node], links: &[Vec<Link>], shafts: &FastMap<i64, Shaft>) -> Self {
        let mut at = vec![0_u32; links.len() + 1];
        for l in links.iter().flatten() {
            at[l.to as usize + 1] += 1;
        }
        for p in 1..at.len() {
            at[p] += at[p - 1];
        }
        let mut fill = at.clone();
        let mut from = vec![(0, 0); at[links.len()] as usize];
        for (p, out) in links.iter().enumerate() {
            for l in out {
                // A cost past an entry's range keeps the most an entry can
                // hold, which still never overestimates.
                let least = u32::try_from(least_cost(shafts, l).max(0)).unwrap_or(NEAR);
                from[fill[l.to as usize] as usize] = (p as u32, least.min(NEAR));
                fill[l.to as usize] += 1;
            }
        }
        let car = nodes.iter().map(|n| matches!(n, Node::Car(..))).collect();
        Inbound { at, from, car }
    }

    fn links_to(&self, place: u32) -> &[(u32, u32)] {
        let p = place as usize;
        &self.from[self.at[p] as usize..self.at[p + 1] as usize]
    }
}

/// The bound search's scratch, kept between goals (hot-path HP-3): the
/// nodes whose cost has to reach the links into them.
#[derive(Default)]
pub(super) struct BoundScratch {
    reach: Vec<u32>,
}

/// The bound toward one goal as far as it has been searched: each node's
/// least cost found so far (`UNREACHABLE` where none is yet), and the open
/// segments, each as its cost over its place in one number. Every node
/// whose least cost is under the cheapest open one has it for good.
pub(super) struct Toward {
    pub(super) least: Vec<u32>,
    open: BinaryHeap<Reverse<u64>>,
}

impl Toward {
    /// The A* bound at `place` for a search whose start costs `radius` to
    /// the goal (`bound_toward` searched that far): the node's least cost,
    /// at most `radius`. Every node under `radius` has its least cost by
    /// then, and every other costs at least `radius`, so the bound is the
    /// same however much further an earlier search went, and so are the
    /// routes, which keeps a reload routing as the game it saved did. `None`
    /// once the search is over and the goal cannot be reached from `place`.
    #[inline]
    pub(super) fn ahead(&self, place: u32, radius: u32) -> Option<u32> {
        match self.least[place as usize] {
            UNREACHABLE if self.open.is_empty() => None,
            least => Some(least.min(radius)),
        }
    }

    /// A bound with `least` searched to the end, for the tests.
    #[cfg(test)]
    pub(super) fn searched(least: Vec<u32>) -> Toward {
        Toward {
            least,
            open: BinaryHeap::new(),
        }
    }
}

/// The most a reachable node's bound entry holds.
const NEAR: u32 = UNREACHABLE - 1;

/// The A* bound toward `goal`, searched until `until`'s least cost is
/// known (to the end with `None`): the least any route from each node to
/// the goal can cost, by Dijkstra back from the goal over the least link
/// costs. A goal's search picks up where the last one stopped while the
/// graph stays the same (`keep_bound`, `carry_bounds`), so a goal asked
/// once costs only the nodes nearer it than the start, and one asked often
/// costs at most one whole search. With it, the search follows the
/// quickest way unless a line makes it dearer. Also whether it was started
/// just now.
///
/// Only segments wait in the heap. A car's cost passes on at once to the
/// car before it and the segments that board it, and again whenever it
/// drops: a car leads only along its shaft, so this costs a few steps up
/// the shaft, where the heap would pay for every car node (most of the
/// graph). A segment still leaves the heap at its least cost, since every
/// cost a car passes on came from a segment already settled plus links that
/// cost nothing below zero.
pub(super) fn bound_toward(router: &mut Router, goal: u32, until: Option<u32>) -> (Toward, bool) {
    let (mut toward, fresh) = match router.toward[goal as usize].take() {
        Some(known) => (known, false),
        None => {
            let mut least = vec![UNREACHABLE; router.nodes.len()];
            least[goal as usize] = 0;
            let open = BinaryHeap::from([Reverse(u64::from(goal))]);
            (Toward { least, open }, true)
        }
    };
    let (into, reach) = (&router.into, &mut router.bound_scratch.reach);
    let Toward { least, open } = &mut toward;
    while let Some(&Reverse(next_open)) = open.peek() {
        let cost = (next_open >> 32) as u32;
        // Every cost up to the start's own is final: stop there.
        if until.is_some_and(|start| cost > least[start as usize]) {
            break;
        }
        open.pop();
        let at = next_open as u32;
        if cost > least[at as usize] {
            continue;
        }
        reach.push(at);
        while let Some(at) = reach.pop() {
            let here = least[at as usize];
            for &(from, step) in into.links_to(at) {
                // Past the range, a cost keeps the most an entry holds.
                let next = here.saturating_add(step).min(NEAR);
                if next >= least[from as usize] {
                    continue;
                }
                least[from as usize] = next;
                // A segment reached at the cost being settled (off a car
                // here, which costs nothing) is settled too.
                if into.car[from as usize] || next == cost {
                    reach.push(from);
                } else {
                    open.push(Reverse((u64::from(next) << 32) | u64::from(from)));
                }
            }
        }
    }
    (toward, fresh)
}

/// Puts `goal`'s bound back after a search. A bound searched just now
/// (`fresh`) joins the kept ones, and the oldest go once they would pass
/// `BOUND_CELLS`.
pub(super) fn keep_bound(router: &mut Router, goal: u32, (bound, fresh): (Toward, bool)) {
    let n = router.nodes.len().max(1);
    if fresh {
        while !router.kept.is_empty() && (router.kept.len() + 1) * n > BOUND_CELLS {
            if let Some(old) = router.kept.pop_front() {
                router.toward[old as usize] = None;
            }
        }
        router.kept.push_back(goal);
    }
    router.toward[goal as usize] = Some(bound);
}

/// Keeps the bounds `old` searched when the tower edit that rebuilt the
/// graph left it as it was. A bound reads only each node's incoming links
/// and their least costs (`into`), so when those match, every kept bound
/// is still the one a search would find. Most edits (a room on a floor, a
/// rent) change no way up, and the rush goes on without searching each
/// goal's bound again.
pub(super) fn carry_bounds(rebuilt: &mut Router, old: &mut Router) {
    if rebuilt.into == old.into {
        rebuilt.toward = std::mem::take(&mut old.toward);
        rebuilt.kept = std::mem::take(&mut old.kept);
    }
}

/// Half the time between cars with as many cars as the shaft can hold
/// running: the least a boarding waits, now or after the player adds cars.
/// Counting the shaft's own cars would make the bound a little tighter, but
/// a change of cars, the edit a player makes most while lines are long,
/// would then search every goal's bound again.
fn least_headway(s: &Shaft) -> f64 {
    s.round_trip / (2.0 * s.most_cars.max(s.cars).max(1) as f64)
}
