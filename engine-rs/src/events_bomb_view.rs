//! What a host reads of the bomb search: the stretches guards are sweeping
//! and how each got there. The hiding place stays out.

use std::collections::BTreeMap;

use serde_json::{json, Value};

use super::super::stairs::Stairs;
use crate::sim::Simulation;

#[doc(hidden)]
impl Simulation {
    /// The host's read of the search: the deadline, each stretch guards are
    /// sweeping now with the tile span of its rooms, the floor the guard set
    /// off from, the corners of its walk on the emergency stairs (floor and
    /// stairs tile) and the minutes it left, reaches the stretch by the
    /// stairs and finishes the walk, and the floors with a stretch
    /// already clear. The hiding place stays out. One pass over the units,
    /// read only when the search's `seq` moves.
    pub fn bomb_search_view(&self) -> Option<Value> {
        let b = self.events.bomb.as_ref()?;
        let stairs = Stairs::of(&self.tower);
        let rooms = self.stretch_rooms(&stairs);
        let span = |floor: i64, x: Option<i64>| -> Option<(i64, i64)> {
            match x {
                Some(x) => rooms.get(&stairs.at(floor, x)?).copied(),
                None => rooms
                    .iter()
                    .filter(|(&i, _)| stairs.stretch(i).floor == floor)
                    .map(|(_, &s)| s)
                    .reduce(|a, b| (a.0.min(b.0), a.1.max(b.1))),
            }
        };
        let sweeping: Vec<Value> = b
            .guards
            .iter()
            .filter_map(|g| Some((g, g.floor?)))
            .filter_map(|(g, f)| {
                let (left, right) = span(f, g.x)?;
                let route: Vec<Value> = g.route.iter().map(|&(f, x)| json!([f, x])).collect();
                Some(json!({
                    "floor": f, "left": left, "right": right, "from": g.from,
                    "route": route, "start": g.start, "arrive": g.arrive, "done": g.done_at,
                }))
            })
            .collect();
        let mut searched: Vec<i64> = Vec::new();
        for &(f, _) in &b.searched {
            if !searched.contains(&f) {
                searched.push(f);
            }
        }
        Some(
            json!({ "deadline": b.deadline, "sweeping": sweeping, "searched": searched, "seq": b.seq }),
        )
    }

    /// Each stretch of floor with a room a bomb can hide in, with the tile
    /// span of those rooms (left edge, right edge). One pass over the units.
    pub(super) fn stretch_rooms(&self, stairs: &Stairs) -> BTreeMap<usize, (i64, i64)> {
        let mut spans = BTreeMap::new();
        for u in &self.tower.units {
            if u.kind.is_structural() || !u.is_operational() {
                continue;
            }
            let Some(i) = stairs.at(u.floor, u.x) else {
                continue;
            };
            let span = spans.entry(i).or_insert((u.x, u.x + u.width));
            span.0 = span.0.min(u.x);
            span.1 = span.1.max(u.x + u.width);
        }
        spans
    }
}
