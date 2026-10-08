//! Port of `crowd/routing.ts`: adjacency graphs, BFS routing, elevator calls.

use std::collections::{HashMap, HashSet};

use super::banks::balance_shafts;
use super::{AdjGraph, Crowd, Edge, ElevatorCalls, PState, Route};
use crate::tower::{Tower, Transport};
use crate::tower_query::floor_of_seg;

fn build_adjacency<'a>(tower: &Tower, transports: impl Iterator<Item = &'a Transport>) -> AdjGraph {
    let mut adj: AdjGraph = HashMap::new();
    for t in transports {
        let stops = tower.stops_of(t);
        let walk_kind = if t.kind.is_walkway() { Some(t.kind) } else { None };
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
pub fn passenger_path(crowd: &mut Crowd, tower: &Tower, from_seg: i64, to_seg: i64) -> Option<Route> {
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
                    let Some(w) = wk.walkway_willingness() else { continue };
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
        *calls.hall.entry(shaft).or_default().entry(floor).or_insert(0.0) += 1.0;
    };
    for p in &crowd.people {
        let Some(sid) = p.shaft_id else { continue };
        if p.state == PState::Waiting {
            bump(sid, p.floor);
        } else if p.state == PState::Riding && p.car_index.is_some() {
            let Some(&dest) = p.floors.get(p.leg + 1) else { continue };
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
