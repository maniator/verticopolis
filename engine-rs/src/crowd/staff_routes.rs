//! The staff routes found on the staff graph as it stands, kept until the
//! tower changes. A crew's route between two segments is a fewest-edges
//! search (`routing::bfs_route_in`) over the staff graph, which is built
//! from the tower alone and kept under the tower revision
//! (`routing::staff_adjacency`). The same pairs come up all day, so on the
//! audit's maxed Modern tower the search ran about 6,600 times a day and
//! made up 9% of the day's work. Keeping its answer under the same
//! revision gives back the route the search would find again (hot-path
//! HP-8: the record names this as the equivalent). What a route does
//! next, which bank's car it takes (`balance_shafts`), reads the crowd and
//! is worked out again on every ask.

use super::fasthash::FastMap;
use super::routing::{bfs_route_in, parts_split, staff_adjacency};
use super::{Crowd, Route};
use crate::tower::Tower;

/// The most routes kept at once: past it the kept ones go and are searched
/// again if asked. A route is a few floors and shafts, so a full map (its
/// table and the routes' lists) stays under about 0.7 MiB.
const MOST_ROUTES: usize = 4096;

/// The staff routes kept for one tower revision, by (from segment, to
/// segment). Never saved: a load builds a fresh crowd.
#[derive(Default)]
pub(crate) struct StaffRoutes {
    revision: Option<i64>,
    routes: FastMap<(i64, i64), Option<Route>>,
}

/// The staff route on the staff graph from segment `a` to `b`, still on
/// segment floors, as the search finds it (`None` when the two are not
/// joined).
pub(super) fn staff_search(crowd: &mut Crowd, tower: &Tower, a: i64, b: i64) -> Option<Route> {
    let kept = &crowd.staff_routes;
    if kept.revision == Some(tower.revision) {
        if let Some(route) = kept.routes.get(&(a, b)) {
            return route.clone();
        }
    }
    let mut seen = std::mem::take(&mut crowd.route_seen);
    let (adj, parts) = staff_adjacency(crowd, tower);
    // A search between two parts of the staff graph visits all of the
    // first one before it gives up, and dispatch keeps asking for such
    // routes: a floor-level staff link can leave a room's segment off the
    // crew's network (#1143 item 6). The parts answer that without a search.
    let found = (!parts_split(parts, a, b))
        .then(|| bfs_route_in(adj, a, b, &mut seen))
        .flatten();
    crowd.route_seen = seen;
    let kept = &mut crowd.staff_routes;
    if kept.revision != Some(tower.revision) || kept.routes.len() >= MOST_ROUTES {
        kept.routes.clear();
        kept.revision = Some(tower.revision);
    }
    kept.routes.insert((a, b), found.clone());
    found
}

#[cfg(test)]
#[path = "staff_routes_tests.rs"]
mod tests;
