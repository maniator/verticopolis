//! Port of `crowd/segmentGraph.ts`: reachability probes.

use std::collections::HashSet;

use super::routing::{adjacency, passenger_path};
use super::Crowd;
use crate::tower::Tower;
use crate::tower_query::seg_id;

fn seg_reachable(crowd: &mut Crowd, tower: &Tower, target: i64) -> bool {
    for s1 in tower.lobby_segs() {
        if passenger_path(crowd, tower, s1, target).is_some() {
            return true;
        }
    }
    false
}

pub fn position_reachable(crowd: &mut Crowd, tower: &Tower, floor: i64, x: i64) -> bool {
    let s = tower.seg_at(floor, Some(x as f64));
    seg_reachable(crowd, tower, s)
}

pub fn floor_reachable_from_lobby(crowd: &mut Crowd, tower: &Tower, floor: i64) -> bool {
    if floor == 1 {
        return true;
    }
    for (start, _) in tower.segments_of(floor) {
        if seg_reachable(crowd, tower, seg_id(floor, start)) {
            return true;
        }
    }
    false
}

fn connected_set<'a>(crowd: &'a mut Crowd, tower: &Tower) -> &'a HashSet<i64> {
    let fresh = !matches!(&crowd.seg_served, Some((rev, _)) if *rev == tower.revision);
    if fresh {
        let mut seen: HashSet<i64> = HashSet::new();
        let mut frontier: Vec<i64> = Vec::new();
        for s1 in tower.lobby_segs() {
            if seen.insert(s1) {
                frontier.push(s1);
            }
        }
        {
            let adj = adjacency(crowd, tower);
            while let Some(s) = frontier.pop() {
                if let Some(edges) = adj.get(&s) {
                    for e in edges {
                        if seen.insert(e.f) {
                            frontier.push(e.f);
                        }
                    }
                }
            }
        }
        crowd.seg_served = Some((tower.revision, seen));
    }
    &crowd.seg_served.as_ref().unwrap().1
}

pub fn segment_connected(crowd: &mut Crowd, tower: &Tower, floor: i64, x: i64) -> bool {
    let s = tower.seg_at(floor, Some(x as f64));
    connected_set(crowd, tower).contains(&s)
}
