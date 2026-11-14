//! Port of `crowd/landing.ts`: the landing queue slots.

use indexmap::IndexMap;

use super::fasthash::FastMap;
use super::{Crowd, PState};
use crate::tower::{Tower, Transport};

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

/// One landing's waiting line: the shaft face it starts at, the side it runs
/// to (1 right, -1 left) and how far the built floor lets it run.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Line {
    face: f64,
    side: f64,
    run: f64,
}

/// The line beside `shaft` on `floor`: on the side with more built floor,
/// the right one on a tie.
pub fn line_at(tower: &Tower, shaft: &Transport, floor: i64) -> Line {
    let left_face = shaft.x;
    let right_face = shaft.x + shaft.width;
    let left_run = built_run(tower, floor, left_face - 1, -1);
    let right_run = built_run(tower, floor, right_face, 1);
    let side: f64 = if right_run >= left_run { 1.0 } else { -1.0 };
    let run = (if side > 0.0 { right_run } else { left_run }) as f64;
    let face = (if side > 0.0 { right_face } else { left_face }) as f64;
    Line { face, side, run }
}

/// The tile x of place `rank` (0 at the front) in a line of `n`: evenly
/// spaced, squeezed to fit the built run when the line is long.
pub fn slot_x(line: Line, rank: usize, n: usize) -> f64 {
    let front = QUEUE_GAP.min(line.run);
    let natural_depth = front + (n.saturating_sub(1)) as f64 * QUEUE_SPACING;
    let max_depth = natural_depth.min(line.run);
    let step = if n > 1 {
        (max_depth - front) / (n - 1) as f64
    } else {
        0.0
    };
    line.face + line.side * (front + rank as f64 * step)
}

/// Where everyone waits this slice: each waiting elevator rider's tile x by
/// person id, and each landing's line with how many stand in it, so a rider
/// still walking up can head for the back of the line (#2116). Both are
/// only looked up, never walked, so they use the fast hasher (hot-path HP-5).
#[derive(Default)]
pub struct Landings {
    pub slots: FastMap<i64, f64>,
    pub lines: FastMap<(i64, i64), (Line, usize)>,
}

impl Landings {
    /// The place at the back of the line at `shaft` on `floor`, where the next
    /// rider to arrive will stand.
    pub fn back_of_line(&mut self, tower: &Tower, shaft: &Transport, floor: i64) -> f64 {
        let (line, n) = *self
            .lines
            .get_or_insert_with((shaft.id, floor), || (line_at(tower, shaft, floor), 0));
        slot_x(line, n, n + 1)
    }

    /// One more rider stands in the line at `shaft` on `floor`, so the next
    /// to arrive in the same slice takes the place behind them.
    pub fn join(&mut self, shaft: i64, floor: i64) {
        if let Some((_, n)) = self.lines.get_mut(&(shaft, floor)) {
            *n += 1;
        }
    }
}

/// Every waiting elevator rider's place, and the lines they stand in.
pub fn landing_slots(crowd: &Crowd, tower: &Tower) -> Landings {
    let mut out = Landings::default();
    // (shaft, floor) -> (person index list)
    let mut groups: IndexMap<(i64, i64), Vec<usize>> = IndexMap::new();
    for (i, p) in crowd.people.iter().enumerate() {
        if p.state != PState::Waiting {
            continue;
        }
        let Some(sid) = p.shaft_id else { continue };
        let Some(shaft) = tower.get_transport(sid) else {
            continue;
        };
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
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(pa.id.cmp(&pb.id))
        });
        let line = line_at(tower, shaft, floor);
        let n = idx.len();
        for (rank, &i) in idx.iter().enumerate() {
            out.slots.insert(crowd.people[i].id, slot_x(line, rank, n));
        }
        out.lines.insert((sid, floor), (line, n));
    }
    out
}

#[cfg(test)]
#[path = "landing_tests.rs"]
mod tests;
