//! The router's lines: a rider joining one as they are routed, and the
//! maps the motion pass counts each step's lines into.

use super::super::fasthash::FastMap;
use super::super::line_count::Line;
use super::super::{Crowd, Route};

/// Puts a rider routed this step in the line for their first car, so the
/// next rider routed in the step sees it.
pub fn join_line(crowd: &mut Crowd, r: &Route) {
    let (Some(&shaft), Some(&floor)) = (r.shafts.first(), r.floors.first()) else {
        return;
    };
    if let Some(router) = crowd.router.as_mut() {
        if router.shafts.contains_key(&shaft) {
            router
                .waiting
                .get_or_insert_with((shaft, floor), Line::default)
                .riders += 1;
            router.step_costs.joined(shaft, floor);
        }
    }
}

/// A map for the motion pass to count the next lines into, one an earlier
/// count left behind, so a pass allocates nothing once the lines have grown.
/// The last count stays with the crowd until the pass ends: a rider who
/// weighs another way mid-pass may start the router's step, which reads it.
pub fn spare_lines(crowd: &mut Crowd) -> FastMap<(i64, i64), Line> {
    crowd
        .router
        .as_mut()
        .map(|r| std::mem::take(&mut r.spare))
        .unwrap_or_default()
}

/// The lines the router reads this step, for tests.
#[cfg(test)]
pub fn router_lines(crowd: &Crowd) -> Option<&FastMap<(i64, i64), Line>> {
    crowd.router.as_ref().map(|r| &r.waiting)
}

/// Hands the crowd the pass's `counted` lines, keeping the count they
/// replace for the next pass to fill (one a route this step took is the
/// router's to keep).
pub fn keep_lines(crowd: &mut Crowd, counted: FastMap<(i64, i64), Line>) {
    let last = std::mem::replace(&mut crowd.shaft_lines, counted);
    if let (false, Some(router)) = (last.is_empty(), crowd.router.as_mut()) {
        router.spare = last;
    }
}
