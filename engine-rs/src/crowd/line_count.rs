//! The lines the Modern router (`expected_time`) reads next step, counted
//! in the crowd's motion pass.

#[path = "waits_seen.rs"]
pub mod waits_seen;

use super::expected_time::join_line;
use super::fasthash::FastMap;
use super::routing::plan;
use super::walk::take_route;
use super::{Crowd, PState, Person, GIVE_UP};
use crate::tower::Tower;

/// One line at a shaft's landing: the riders waiting in it or walking to
/// it, and the longest anyone standing in it has waited (crowd seconds).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Line {
    pub riders: i64,
    pub oldest: f64,
}

/// The lines the Modern router reads next step, counted in the crowd's
/// motion pass as it visits each person, so nobody is walked twice for them
/// (hot-path HP-2). Classic counts nothing.
pub struct LineCount {
    on: bool,
    lines: FastMap<(i64, i64), Line>,
}

impl LineCount {
    /// A count into `room`, a map the last count left behind, emptied here
    /// so a motion pass allocates nothing once the lines have grown.
    pub fn new(tower: &Tower, mut room: FastMap<(i64, i64), Line>) -> LineCount {
        room.clear();
        LineCount {
            on: tower.mode.routes_by_expected_time(),
            lines: room,
        }
    }

    /// Counts `p` if they wait for, or walk to, a shaft.
    pub fn see(&mut self, p: &Person) {
        if let (true, Some(shaft), PState::Waiting | PState::ToShaft) =
            (self.on, p.shaft_id, p.state)
        {
            let line = self
                .lines
                .get_or_insert_with((shaft, p.floor), Line::default);
            line.riders += 1;
            if p.state == PState::Waiting {
                line.oldest = line.oldest.max(p.wait);
            }
        }
    }

    pub fn counted(self) -> FastMap<(i64, i64), Line> {
        self.lines
    }
}

/// Sets each saved line's longest wait from `people` as the motion pass that
/// last moved them counted it. A save carries everyone's wait and each
/// line's riders, so a load counts the waits again instead of saving them.
pub fn restore_oldest(lines: &mut FastMap<(i64, i64), Line>, people: &[Person]) {
    for p in people.iter().filter(|p| p.state == PState::Waiting) {
        if let Some(line) = p.shaft_id.and_then(|s| lines.get_mut(&(s, p.floor))) {
            line.oldest = line.oldest.max(p.wait);
        }
    }
}

/// Someone waiting at a Modern shaft looks for another way once, when
/// their wait in this line passes an hour (`GIVE_UP`): by then the router
/// counts how long this line keeps people (`Line::oldest`). They keep their
/// place when the quickest way from where they stand is still this line, and
/// a new line gets its own hour. Housekeepers keep to their own cars; anyone
/// still on the floor they set out from turns back on their own patience
/// (`motion`).
pub fn rethink_long_wait(crowd: &mut Crowd, i: usize, waited_before: f64, tower: &Tower) {
    let p = &crowd.people[i];
    let passed_an_hour = waited_before < GIVE_UP && p.wait >= GIVE_UP;
    if !(passed_an_hour && p.state == PState::Waiting && tower.mode.routes_by_expected_time())
        || p.staff
    {
        return;
    }
    let (from, from_x, dest_x, line) = (p.floor, p.x, p.dest_x, p.shaft_id);
    let Some(&to) = p.floors.last() else { return };
    let Some((r, joins)) = plan(crowd, tower, (from, Some(from_x)), (to, Some(dest_x))) else {
        return;
    };
    if r.shafts.first().copied() == line {
        return;
    }
    let waited = crowd.people[i].wait;
    if joins {
        join_line(crowd, &r);
    }
    take_route(crowd, i, r);
    crowd.people[i].trip_wait += waited;
}

#[cfg(test)]
#[path = "line_count_tests.rs"]
mod tests;
