//! Port of `crowd/routing.ts`: adjacency graphs, BFS routing, elevator calls.

use std::collections::{HashMap, HashSet};

use super::banks::balance_shafts;
use super::{AdjGraph, Crowd, Edge, ElevatorCalls, PState, Route};
use crate::facilities::{LOT_WIDTH, MIN_FLOOR};
use crate::tower::{Tower, Transport};
use crate::tower_query::{floor_of_seg, NO_SEGMENT};

fn build_adjacency<'a>(tower: &Tower, transports: impl Iterator<Item = &'a Transport>) -> AdjGraph {
    let mut adj: AdjGraph = HashMap::new();
    for t in transports {
        let stops = tower.stops_of(t);
        let walk_kind = if t.kind.is_walkway() {
            Some(t.kind)
        } else {
            None
        };
        let seg_lists: Vec<Vec<i64>> = stops.iter().map(|&fl| tower.landing_segs(t, fl)).collect();
        for ai in 0..stops.len() {
            for &a_seg in &seg_lists[ai] {
                let list = adj.entry(a_seg).or_default();
                for bi in 0..stops.len() {
                    if bi == ai {
                        continue;
                    }
                    for &b_seg in &seg_lists[bi] {
                        list.push(Edge {
                            f: b_seg,
                            shaft: t.id,
                            walk_kind,
                        });
                    }
                }
            }
        }
    }
    adj
}

pub fn adjacency<'a>(crowd: &'a mut Crowd, tower: &Tower) -> &'a AdjGraph {
    let fresh = !matches!(&crowd.adj, Some((rev, _)) if *rev == tower.revision);
    if fresh {
        let adj = build_adjacency(
            tower,
            tower
                .transports
                .iter()
                .filter(|t| !t.kind.is_staff_only_transport()),
        );
        crowd.adj = Some((tower.revision, adj));
    }
    &crowd.adj.as_ref().unwrap().1
}

pub fn staff_adjacency<'a>(crowd: &'a mut Crowd, tower: &Tower) -> &'a AdjGraph {
    let fresh = !matches!(&crowd.staff_adj, Some((rev, _)) if *rev == tower.revision);
    if fresh {
        let mut service_first: Vec<&Transport> = tower.transports.iter().collect();
        service_first.sort_by_key(|t| !t.kind.is_staff_only_transport());
        let adj = build_adjacency(
            tower,
            service_first
                .into_iter()
                .filter(|t| t.kind.is_staff_transport()),
        );
        crowd.staff_adj = Some((tower.revision, adj));
    }
    &crowd.staff_adj.as_ref().unwrap().1
}

/// `passengerPath`: the per-mode router on segment ids.
pub fn passenger_path(
    crowd: &mut Crowd,
    tower: &Tower,
    from_seg: i64,
    to_seg: i64,
) -> Option<Route> {
    let walk_budget = tower.mode.walkway_willingness_applies();
    let adj = adjacency(crowd, tower);
    if walk_budget {
        bfs_route_walk_budget(adj, from_seg, to_seg)
    } else {
        bfs_route(adj, from_seg, to_seg)
    }
}

fn to_real_floors(r: &mut Route) {
    for f in r.floors.iter_mut() {
        *f = floor_of_seg(*f);
    }
}

/// The JavaScript gives a position that sits over a structural gap its own
/// fractional segment id, which no graph node carries; here both such
/// positions map to one sentinel (`NO_SEGMENT`). The ids are equal in
/// JavaScript only when the two positions are the same, so when both ends
/// are off-run, decide the route the way the fractional ids would: the same
/// position routes to itself with no shafts, a different one has no route.
/// `None` means the ids are not both off-run and the graph decides.
fn off_run_pair(
    a: i64,
    b: i64,
    from_floor: i64,
    from_x: Option<f64>,
    to_floor: i64,
    to_x: Option<f64>,
) -> Option<Option<Route>> {
    if a != NO_SEGMENT || b != NO_SEGMENT {
        return None;
    }
    // The fractional ids themselves decide, as `from === to` does: a position
    // past one floor's lot edge carries the same id as one past the neighbor's.
    let id = |floor: i64, x: Option<f64>| {
        (floor - MIN_FLOOR) as f64 * LOT_WIDTH as f64 + x.unwrap_or(0.0)
    };
    let (a, b) = (id(from_floor, from_x), id(to_floor, to_x));
    // `floorOfSeg` of that id.
    let floor = (a / LOT_WIDTH as f64).floor() as i64 + MIN_FLOOR;
    Some((a == b).then(|| Route {
        floors: vec![floor],
        shafts: vec![],
    }))
}

pub fn route(
    crowd: &mut Crowd,
    tower: &Tower,
    from_floor: i64,
    from_x: Option<f64>,
    to_floor: i64,
    to_x: Option<f64>,
) -> Option<Route> {
    let a = tower.seg_at(from_floor, from_x);
    let b = tower.seg_at(to_floor, to_x);
    if let Some(decided) = off_run_pair(a, b, from_floor, from_x, to_floor, to_x) {
        return decided.map(|r| balance_shafts(crowd, tower, r));
    }
    let mut r = passenger_path(crowd, tower, a, b)?;
    to_real_floors(&mut r);
    Some(balance_shafts(crowd, tower, r))
}

pub fn reachable(
    crowd: &mut Crowd,
    tower: &Tower,
    from_floor: i64,
    from_x: Option<f64>,
    to_floor: i64,
    to_x: Option<f64>,
) -> bool {
    let a = tower.seg_at(from_floor, from_x);
    let b = tower.seg_at(to_floor, to_x);
    if let Some(decided) = off_run_pair(a, b, from_floor, from_x, to_floor, to_x) {
        return decided.is_some();
    }
    passenger_path(crowd, tower, a, b).is_some()
}

pub fn staff_route(
    crowd: &mut Crowd,
    tower: &Tower,
    from_floor: i64,
    from_x: Option<f64>,
    to_floor: i64,
    to_x: Option<f64>,
) -> Option<Route> {
    let a = tower.seg_at(from_floor, from_x);
    let b = tower.seg_at(to_floor, to_x);
    if let Some(decided) = off_run_pair(a, b, from_floor, from_x, to_floor, to_x) {
        return decided.map(|r| balance_shafts(crowd, tower, r));
    }
    let mut r = bfs_route(staff_adjacency(crowd, tower), a, b)?;
    to_real_floors(&mut r);
    Some(balance_shafts(crowd, tower, r))
}

/// Fewest-edges BFS; the first-listed edge wins a level tie.
pub fn bfs_route(adj: &AdjGraph, from: i64, to: i64) -> Option<Route> {
    if from == to {
        return Some(Route {
            floors: vec![from],
            shafts: vec![],
        });
    }
    let mut prev: HashMap<i64, (i64, i64)> = HashMap::new();
    let mut seen: HashSet<i64> = HashSet::new();
    seen.insert(from);
    let mut frontier = vec![from];
    while !frontier.is_empty() {
        let mut next = Vec::new();
        for &f in &frontier {
            let Some(edges) = adj.get(&f) else { continue };
            for edge in edges {
                if !seen.insert(edge.f) {
                    continue;
                }
                prev.insert(edge.f, (f, edge.shaft));
                if edge.f == to {
                    let mut floors = vec![to];
                    let mut shafts = Vec::new();
                    let mut cur = to;
                    while cur != from {
                        let (pf, ps) = prev[&cur];
                        floors.push(pf);
                        shafts.push(ps);
                        cur = pf;
                    }
                    floors.reverse();
                    shafts.reverse();
                    return Some(Route { floors, shafts });
                }
                next.push(edge.f);
            }
        }
        frontier = next;
    }
    None
}

/// The Classic router with the contiguous-walk budget.
pub fn bfs_route_walk_budget(adj: &AdjGraph, from: i64, to: i64) -> Option<Route> {
    if from == to {
        return Some(Route {
            floors: vec![from],
            shafts: vec![],
        });
    }
    // (floor, walkRun, runCap); None is the NO_CAP sentinel (Infinity).
    type St = (i64, i64, Option<i64>);
    let origin: St = (from, 0, None);
    let mut prev: HashMap<St, (St, i64, i64)> = HashMap::new();
    let mut seen: HashSet<St> = HashSet::new();
    seen.insert(origin);
    let mut frontier: Vec<St> = vec![origin];
    while !frontier.is_empty() {
        let mut next = Vec::new();
        for &s in &frontier {
            let Some(edges) = adj.get(&s.0) else { continue };
            for edge in edges {
                let ns: St = if let Some(wk) = edge.walk_kind {
                    let Some(w) = wk.walkway_willingness() else {
                        continue;
                    };
                    let cap = match s.2 {
                        Some(c) => c.min(w),
                        None => w,
                    };
                    if s.1 + 1 > cap {
                        continue;
                    }
                    (edge.f, s.1 + 1, Some(cap))
                } else {
                    (edge.f, 0, None)
                };
                if !seen.insert(ns) {
                    continue;
                }
                prev.insert(ns, (s, s.0, edge.shaft));
                if edge.f == to {
                    let mut floors = vec![to];
                    let mut shafts = Vec::new();
                    let mut cur = ns;
                    while cur != origin {
                        let (pk, pf, ps) = prev[&cur];
                        floors.push(pf);
                        shafts.push(ps);
                        cur = pk;
                    }
                    floors.reverse();
                    shafts.reverse();
                    return Some(Route { floors, shafts });
                }
                next.push(ns);
            }
        }
        frontier = next;
    }
    None
}

/// `elevatorCalls`.
pub fn elevator_calls(crowd: &Crowd, tower: &Tower) -> ElevatorCalls {
    let mut calls = ElevatorCalls::default();
    let mut bump = |shaft: i64, floor: i64| {
        *calls
            .hall
            .entry(shaft)
            .or_default()
            .entry(floor)
            .or_insert(0.0) += 1.0;
    };
    for p in &crowd.people {
        let Some(sid) = p.shaft_id else { continue };
        if p.state == PState::Waiting {
            bump(sid, p.floor);
        } else if p.state == PState::Riding && p.car_index.is_some() {
            let Some(&dest) = p.floors.get(p.leg + 1) else {
                continue;
            };
            calls
                .cab
                .entry(sid)
                .or_default()
                .entry(p.car_index.unwrap())
                .or_default()
                .insert(dest);
        } else if p.staff && p.state == PState::ToShaft {
            if let Some(shaft) = tower.get_transport(sid) {
                if shaft.kind.is_staff_only_transport() {
                    bump(sid, p.floor);
                }
            }
        }
    }
    calls
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::GameMode;
    use crate::facilities::Kind;
    use crate::sim::Simulation;

    /// Two positions over structural gaps carry fractional ids in the
    /// JavaScript: equal only for the same position, which routes to itself
    /// with no shafts; a different one has no route and is not reachable.
    #[test]
    fn off_run_positions_route_as_their_fractional_ids_would() {
        let mut sim = Simulation::new_game(3, GameMode::Classic);
        sim.money = 1e9;
        for x in 170..200 {
            assert!(sim.build(Kind::Lobby, 1, x).ok);
        }
        let Simulation {
            ref mut crowd,
            ref tower,
            ..
        } = sim;
        // Over the gap right of the lobby run, off the integer grid.
        let same = route(crowd, tower, 1, Some(210.5), 1, Some(210.5)).expect("itself");
        assert_eq!(same.floors, vec![1]);
        assert!(same.shafts.is_empty());
        assert!(route(crowd, tower, 1, Some(210.5), 1, Some(220.5)).is_none());
        assert!(route(crowd, tower, 1, Some(210.5), 2, Some(210.5)).is_none());
        assert!(reachable(crowd, tower, 1, Some(210.5), 1, Some(210.5)));
        assert!(!reachable(crowd, tower, 1, Some(210.5), 1, Some(220.5)));
        // An off-run start and an on-run end: no route, as the graph has no
        // node for the start.
        assert!(route(crowd, tower, 1, Some(210.5), 1, Some(180.0)).is_none());
        // Past the lot's left edge the fractional id belongs to the floor
        // below, as `floorOfSeg` reads it.
        let edge = route(crowd, tower, 1, Some(-0.5), 1, Some(-0.5)).expect("itself");
        assert_eq!(edge.floors, vec![0]);
        // The same id spelled from the floor below: equal ids, one route.
        let twin = route(crowd, tower, 1, Some(-0.5), 0, Some(374.5)).expect("same id");
        assert_eq!(twin.floors, vec![0]);
    }
}
