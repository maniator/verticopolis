//! Port of the retired TypeScript `src/engine/crowd/landing.ts`: the landing queue slots.

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
/// the right one on a tie. Each motion slice asks it for every landing with a
/// line, so it is kept per tower edit (`Memo::landing_lines`, #2214).
pub fn line_at(tower: &Tower, shaft: &Transport, floor: i64) -> Line {
    let key = tower.index_key();
    let slot = (shaft.x, shaft.width, floor);
    if let Some((built, lines)) = &tower.memo.borrow().landing_lines {
        if *built == key {
            if let Some(line) = lines.get(&slot) {
                return *line;
            }
        }
    }
    let line = measure_line(tower, shaft, floor);
    let mut memo = tower.memo.borrow_mut();
    match &mut memo.landing_lines {
        Some((built, lines)) if *built == key => {
            lines.insert(slot, line);
        }
        _ => {
            let mut lines = FastMap::default();
            lines.insert(slot, line);
            memo.landing_lines = Some((key, lines));
        }
    }
    line
}

/// `line_at` measured from the built floor beside the shaft.
fn measure_line(tower: &Tower, shaft: &Transport, floor: i64) -> Line {
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
/// their place in `Crowd::people` (nobody leaves the list until the slice
/// ends), and each landing's line with how many stand in it, so a rider
/// still walking up can head for the back of the line (#2116). The lines
/// are only looked up, never walked, so they use the fast hasher (HP-5).
/// The crowd keeps one between slices (`Crowd::landings`) and `fill` empties
/// it in place, so a slice allocates nothing once the lists have grown
/// (hot-path HP-3).
#[derive(Default)]
pub struct Landings {
    slots: Vec<Option<f64>>,
    pub lines: FastMap<(i64, i64), (Line, usize)>,
    /// Each landing with a rider waiting, by its place in `keys`, which lists
    /// them as the crowd first does.
    groups: FastMap<(i64, i64), usize>,
    keys: Vec<(i64, i64)>,
    /// The riders at each landing in `keys`, by their place in the crowd.
    /// Lists past `keys.len()` are left from an earlier slice for reuse.
    riders: Vec<Vec<usize>>,
    /// Each rider's (wait, id, place) at one landing, sorted longest wait
    /// first.
    line_up: Vec<(f64, i64, usize)>,
}

impl Landings {
    /// Where the rider at `people[i]` stands in their line, if they wait for
    /// an elevator.
    pub fn slot(&self, i: usize) -> Option<f64> {
        self.slots.get(i).copied().flatten()
    }

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
    out.fill(crowd, tower);
    out
}

impl Landings {
    /// The crowd's lists from the last slice, taken off it and filled again
    /// in place for this one. The slice hands them back when it ends.
    pub fn refill(crowd: &mut Crowd, tower: &Tower) -> Landings {
        let mut landings = std::mem::take(&mut crowd.landings);
        landings.fill(crowd, tower);
        landings
    }

    /// Fills in every waiting elevator rider's place and the lines they
    /// stand in, emptying what an earlier slice left here first.
    pub fn fill(&mut self, crowd: &Crowd, tower: &Tower) {
        self.slots.clear();
        self.slots.resize(crowd.people.len(), None);
        self.lines.clear();
        self.groups.clear();
        self.keys.clear();
        for (i, p) in crowd.people.iter().enumerate() {
            if p.state != PState::Waiting {
                continue;
            }
            let Some(sid) = p.shaft_id else { continue };
            let key = (sid, p.floor);
            let (keys, riders) = (&mut self.keys, &mut self.riders);
            let g = *self.groups.get_or_insert_with(key, || {
                let g = keys.len();
                keys.push(key);
                match riders.get_mut(g) {
                    Some(list) => list.clear(),
                    None => riders.push(Vec::new()),
                }
                g
            });
            self.riders[g].push(i);
        }
        // The shaft is read once per line, in the order the crowd first
        // lists the lines.
        for (g, &(sid, floor)) in self.keys.iter().enumerate() {
            let Some(shaft) = tower.get_transport(sid).filter(|s| s.kind.is_elevator()) else {
                continue;
            };
            let line_up = &mut self.line_up;
            line_up.clear();
            line_up.extend(
                self.riders[g]
                    .iter()
                    .map(|&i| (crowd.people[i].wait, crowd.people[i].id, i)),
            );
            line_up.sort_by(|a, b| {
                b.0.partial_cmp(&a.0)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then(a.1.cmp(&b.1))
            });
            let line = line_at(tower, shaft, floor);
            let n = line_up.len();
            for (rank, &(_, _, i)) in line_up.iter().enumerate() {
                self.slots[i] = Some(slot_x(line, rank, n));
            }
            self.lines.insert((sid, floor), (line, n));
        }
    }
}

/// The stretch of floor the line at `shaft` on `floor` covers right now, as
/// `(from, to)` tile x with `from <= to`: from the shaft face it starts at to
/// the rider standing farthest from it. A rider still shuffling up to a place
/// a boarding freed counts where they stand, so the stretch holds everyone in
/// the line as drawn. Lines run beside the shaft across any shaft next to it,
/// so this is the only way to tell which riders on a floor of several
/// elevators stand in which line. `None` when nobody waits there or `shaft`
/// is not an elevator. One pass over the crowd, so it is a read for a tap,
/// not a frame.
pub fn queue_line(crowd: &Crowd, tower: &Tower, shaft: i64, floor: i64) -> Option<(f64, f64)> {
    let elevator = tower
        .get_transport(shaft)
        .filter(|s| s.kind.is_elevator())?;
    let mut riders = crowd
        .people
        .iter()
        .filter(|p| p.state == PState::Waiting && p.shaft_id == Some(shaft) && p.floor == floor)
        .map(|p| p.x)
        .peekable();
    riders.peek()?;
    let face = line_at(tower, elevator, floor).face;
    Some(riders.fold((face, face), |(lo, hi), x| (lo.min(x), hi.max(x))))
}

#[cfg(test)]
#[path = "landing_tests.rs"]
mod tests;
