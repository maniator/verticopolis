//! Port of `crowd/landing.ts`: the landing queue slots.

use std::collections::HashMap;

use indexmap::IndexMap;

use super::{Crowd, PState};
use crate::tower::Tower;

const QUEUE_GAP: f64 = 0.8;
const QUEUE_SPACING: f64 = 1.1;
const QUEUE_REACH: i64 = 30;

fn built_run(tower: &Tower, floor: i64, start_x: i64, dir: i64) -> i64 {
    let mut n = 0;
    let mut x = start_x;
    while n < QUEUE_REACH && tower.has_structure(floor, x) {
        n += 1;
        x += dir;
    }
    n
}

/// Person id -> tile x for every waiting elevator rider.
pub fn landing_slots(crowd: &Crowd, tower: &Tower) -> HashMap<i64, f64> {
    let mut slots: HashMap<i64, f64> = HashMap::new();
    // (shaft, floor) -> (person index list)
    let mut groups: IndexMap<(i64, i64), Vec<usize>> = IndexMap::new();
    for (i, p) in crowd.people.iter().enumerate() {
        if p.state != PState::Waiting {
            continue;
        }
        let Some(sid) = p.shaft_id else { continue };
        let Some(shaft) = tower.get_transport(sid) else { continue };
        if !shaft.kind.is_elevator() {
            continue;
        }
        groups.entry((sid, p.floor)).or_default().push(i);
    }
    for ((sid, floor), mut idx) in groups {
        let shaft = tower.get_transport(sid).unwrap();
        idx.sort_by(|&a, &b| {
            let pa = &crowd.people[a];
            let pb = &crowd.people[b];
            pb.wait
                .partial_cmp(&pa.wait)
                .unwrap()
                .then(pa.id.cmp(&pb.id))
        });
        let left_face = shaft.x;
        let right_face = shaft.x + shaft.width;
        let left_run = built_run(tower, floor, left_face - 1, -1);
        let right_run = built_run(tower, floor, right_face, 1);
        let side: f64 = if right_run >= left_run { 1.0 } else { -1.0 };
        let run = (if side > 0.0 { right_run } else { left_run }) as f64;
        let face = (if side > 0.0 { right_face } else { left_face }) as f64;
        let n = idx.len();
        let front = QUEUE_GAP.min(run);
        let natural_depth = front + (n.saturating_sub(1)) as f64 * QUEUE_SPACING;
        let max_depth = natural_depth.min(run);
        let step = if n > 1 {
            (max_depth - front) / (n - 1) as f64
        } else {
            0.0
        };
        for (rank, &i) in idx.iter().enumerate() {
            slots.insert(crowd.people[i].id, face + side * (front + rank as f64 * step));
        }
    }
    slots
}
