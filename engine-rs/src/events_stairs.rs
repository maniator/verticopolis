//! The emergency stairs Security walks during a bomb search or to catch a
//! thief. Each stretch of floor (one run of floor tiles on one floor, the
//! segments `Tower::segments_of` lists) has emergency stairs at its outer
//! edges, which reach the stretch above or below wherever the two overlap.
//! On a lot with several towers standing apart, each tower is its own set of
//! stretches: a guard crosses to another tower only down to a floor the two
//! share (a common lobby, say) and back up, and never into a tower no floor
//! joins to his own.

use std::collections::{BTreeMap, VecDeque};

use crate::tower::Tower;

/// One stretch of floor: the tiles `first` to `last` on `floor`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Stretch {
    pub floor: i64,
    pub first: i64,
    pub last: i64,
}

/// Every stretch of the tower and the stairs between them, built once per
/// search event from the tower's memoized floor runs.
pub struct Stairs {
    stretches: Vec<Stretch>,
    /// Each floor's stretches, as indexes into `stretches`, left to right.
    floors: BTreeMap<i64, Vec<usize>>,
    /// The stretches each one's stairs reach, one floor up or down.
    linked: Vec<Vec<usize>>,
}

/// How far each stretch is from one start, in floors of stairs walked, and
/// the stretch each was reached from on the way. `None` where no stairs lead.
pub struct Walk {
    pub floors: Vec<Option<i64>>,
    came_from: Vec<usize>,
}

impl Stairs {
    /// The tower's stretches and their stairs: one pass over its floors.
    pub fn of(tower: &Tower) -> Stairs {
        let (low, high) = tower.floor_bounds();
        let mut stretches = Vec::new();
        let mut floors: BTreeMap<i64, Vec<usize>> = BTreeMap::new();
        for floor in low..=high {
            for (first, last) in tower.segments_of(floor) {
                floors.entry(floor).or_default().push(stretches.len());
                stretches.push(Stretch { floor, first, last });
            }
        }
        let mut linked = vec![Vec::new(); stretches.len()];
        for (&floor, here) in &floors {
            let Some(above) = floors.get(&(floor + 1)) else {
                continue;
            };
            for &a in here {
                for &b in above {
                    let (s, t) = (stretches[a], stretches[b]);
                    if s.first <= t.last && t.first <= s.last {
                        linked[a].push(b);
                        linked[b].push(a);
                    }
                }
            }
        }
        Stairs {
            stretches,
            floors,
            linked,
        }
    }

    /// The stretch on `floor` that holds tile `x`, if any.
    pub fn at(&self, floor: i64, x: i64) -> Option<usize> {
        self.floors
            .get(&floor)?
            .iter()
            .copied()
            .find(|&i| self.stretches[i].first <= x && x <= self.stretches[i].last)
    }

    /// The leftmost stretch on `floor`, if any.
    pub fn first_on(&self, floor: i64) -> Option<usize> {
        self.floors.get(&floor)?.first().copied()
    }

    /// Stretch `i`.
    pub fn stretch(&self, i: usize) -> Stretch {
        self.stretches[i]
    }

    /// The floors of stairs from `start` to every stretch: one breadth-first
    /// walk, each step one floor, so the count is the floors climbed.
    pub fn walk_from(&self, start: usize) -> Walk {
        let mut floors = vec![None; self.stretches.len()];
        let mut came_from = vec![start; self.stretches.len()];
        let mut queue = VecDeque::from([start]);
        floors[start] = Some(0);
        while let Some(i) = queue.pop_front() {
            let d = floors[i].unwrap_or(0);
            for &j in &self.linked[i] {
                if floors[j].is_none() {
                    floors[j] = Some(d + 1);
                    came_from[j] = i;
                    queue.push_back(j);
                }
            }
        }
        Walk { floors, came_from }
    }

    /// The floor a guard turns at on the way from `start` to `to` along
    /// `walk`: the shared floor it goes down (or up) to before climbing the
    /// other tower, or `start`'s own floor when the stairs lead straight there.
    pub fn turn_floor(&self, walk: &Walk, start: usize, to: usize) -> i64 {
        let (from, dest) = (self.stretches[start].floor, self.stretches[to].floor);
        let (low, high) = (from.min(dest), from.max(dest));
        let mut turn = from;
        let mut i = to;
        while i != start {
            let f = self.stretches[i].floor;
            let outside = |g: i64| (g - g.clamp(low, high)).abs();
            if outside(f) > outside(turn) {
                turn = f;
            }
            i = walk.came_from[i];
        }
        turn
    }
}

#[cfg(test)]
#[path = "events_stairs_tests.rs"]
mod tests;
