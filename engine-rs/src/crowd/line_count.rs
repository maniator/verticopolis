//! The lines the Modern router (`expected_time`) reads next step, counted
//! in the crowd's motion pass.

use super::fasthash::FastMap;
use super::{PState, Person};
use crate::tower::Tower;

/// The lines the Modern router reads next step, counted in the crowd's
/// motion pass as it visits each person, so nobody is walked twice for them
/// (hot-path HP-2). Classic counts nothing.
pub struct LineCount {
    on: bool,
    lines: FastMap<(i64, i64), i64>,
}

impl LineCount {
    pub fn new(tower: &Tower) -> LineCount {
        LineCount {
            on: tower.mode.routes_by_expected_time(),
            lines: FastMap::default(),
        }
    }

    /// Counts `p` if they wait for, or walk to, a shaft.
    pub fn see(&mut self, p: &Person) {
        if let (true, Some(shaft), PState::Waiting | PState::ToShaft) =
            (self.on, p.shaft_id, p.state)
        {
            *self.lines.get_or_insert_with((shaft, p.floor), || 0) += 1;
        }
    }

    pub fn counted(self) -> FastMap<(i64, i64), i64> {
        self.lines
    }
}
