//! The A* bound of the Modern router (`expected_time`): the floors still to
//! ride, plus the least way out of a segment that is not the goal. It never
//! overestimates, so the route found is still the cheapest.

use super::{tenths, Move, Node, Places, Router, Shaft};
use crate::crowd::fasthash::FastMap;
use crate::tower_query::floor_of_seg;

/// The least each segment's way out costs beyond the floors it covers, by
/// place: a boarding with no line and every car running, a flight, or a
/// walk along the street. Any
/// route off a segment other than its goal takes one of these first, and
/// the bound adds it. Keeping it at or under each link's own cost beyond
/// its floors keeps the bound consistent, so A* still finds the cheapest
/// route (`the_exit_bound_never_overtakes_a_link`).
pub(super) fn exit_costs(g: &Places, shafts: &FastMap<i64, Shaft>, per_floor: i64) -> Vec<i64> {
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
                l.tenths + wait - floors_bound(floor, l.floor, per_floor)
            });
            least.min().unwrap_or(0).max(0)
        })
        .collect()
}

/// Half the time between cars with every car running: the least a boarding
/// waits.
pub(super) fn least_headway(s: &Shaft) -> f64 {
    s.round_trip / (2.0 * s.cars.max(1) as f64)
}

/// The least any route can cost from `floor` to `to`: every ride and flight
/// costs at least `per_floor` whole tenths a floor, so it never overestimates.
pub(super) fn floors_bound(floor: i64, to: i64, per_floor: i64) -> i64 {
    (floor - to).abs() * per_floor
}

/// The A* bound from the node at `place`, standing at `floor`, to the
/// segment `goal` on `to_floor`: the floors still to ride, plus the least
/// way out of a segment that is not the goal.
pub(super) fn bound_to(
    router: &Router,
    (place, floor): (u32, i64),
    (goal, to_floor): (u32, i64),
) -> i64 {
    let exit = if place == goal {
        0
    } else {
        router.exit[place as usize]
    };
    floors_bound(floor, to_floor, router.per_floor) + exit
}
