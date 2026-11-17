//! Each transport's stops as a floor set (#1984), so asking whether a shaft
//! stops at one floor is a bit test rather than a walk of its skip list.
//! `Transport::stops_at` scans `skip_floors`, which on a 100-floor express
//! holds about 95 floors, and the step asks it once per waiting person, per
//! arriving rider and per shaft per floor.
//!
//! The sets are built from `Transport::stop_floors` once per tower edit, on
//! the same key as the dispatch floor lists (`tower_index.rs`), which read
//! the stops too: every stop toggle, stop clear, resize and the express-stop
//! rule bump the revision, and a load or an undo reindexes. A debug build
//! checks every answer against `stops_at`, so a path that changed a skip
//! list without bumping the revision fails the tests that take it.
//!
//! The same pass folds the passenger shafts' stops into one set per class
//! (elevators, stairs, escalators), so asking which classes serve a floor
//! is three bit tests whatever the number of links, which Modern does not
//! limit.

use std::sync::Arc;

use crate::facilities::Kind;
use crate::floor_bits::FloorBits;
use crate::tower::Tower;
use crate::tower_index::floor_slot;

/// The stops of every transport, in `Tower::transports` order, and the
/// union of the passenger shafts' stops per class.
#[derive(Clone)]
pub struct StopBits(Arc<StopSets>);

struct StopSets {
    each: Vec<FloorBits>,
    /// Passenger elevators, stairs and escalators, in that order; a
    /// staff-only shaft is in none.
    classes: [FloorBits; 3],
}

impl StopBits {
    /// Whether the transport at `index` in the list stops at `floor`.
    #[inline]
    fn at(&self, index: usize, floor: i64) -> bool {
        match (self.0.each.get(index), floor_slot(floor)) {
            (Some(bits), Some(slot)) => bits.contains(slot),
            _ => false,
        }
    }

    /// (elevator, stairs, escalator): whether a passenger shaft of each
    /// class stops at `floor`.
    fn classes_at(&self, floor: i64) -> (bool, bool, bool) {
        let Some(slot) = floor_slot(floor) else {
            return (false, false, false);
        };
        let [elevators, stairs, escalators] = &self.0.classes;
        (
            elevators.contains(slot),
            stairs.contains(slot),
            escalators.contains(slot),
        )
    }
}

/// Which class set a transport of `kind` folds into, if any.
fn class_of(kind: Kind) -> Option<usize> {
    match kind {
        _ if kind.is_staff_only_transport() => None,
        _ if kind.is_elevator() => Some(0),
        Kind::Stairs => Some(1),
        Kind::Escalator => Some(2),
        _ => None,
    }
}

impl Tower {
    /// Every transport's stops, built once per edit.
    pub(crate) fn stop_bits(&self) -> StopBits {
        let key = self.index_key();
        if let Some((built, bits)) = &self.memo.borrow().stop_bits {
            if *built == key {
                return bits.clone();
            }
        }
        let mut classes = [FloorBits::default(); 3];
        let each = self
            .transports
            .iter()
            .map(|t| {
                let mut bits = FloorBits::default();
                for slot in t.stop_floors().into_iter().filter_map(floor_slot) {
                    bits.insert(slot);
                }
                if let Some(class) = class_of(t.kind) {
                    classes[class].union_with(&bits);
                }
                bits
            })
            .collect();
        let bits = StopBits(Arc::new(StopSets { each, classes }));
        self.memo.borrow_mut().stop_bits = Some((key, bits.clone()));
        bits
    }

    /// [`Transport::stops_at`](crate::tower::Transport::stops_at) for the
    /// transport at `index` in the list, from `stops` (`stop_bits`), so a
    /// loop fetches the sets once.
    #[inline]
    pub(crate) fn stops_at_index(&self, stops: &StopBits, index: usize, floor: i64) -> bool {
        let fast = stops.at(index, floor);
        debug_assert_eq!(
            fast,
            self.transports[index].stops_at(floor),
            "stop bits stale for transport {index} at floor {floor}"
        );
        fast
    }

    /// [`Transport::stops_at`](crate::tower::Transport::stops_at) for the
    /// transport with `id`; false when there is none.
    #[cfg(test)]
    pub(crate) fn stops_at_id(&self, id: i64, floor: i64) -> bool {
        self.transport_index(id)
            .is_some_and(|i| self.stops_at_index(&self.stop_bits(), i, floor))
    }

    /// `servingTransportKindsAt(floor)`: (elevator, stairs, escalator), the
    /// passenger classes with a shaft stopping at `floor`; staff-only service
    /// elevators never count. Three bit tests; a debug build checks them
    /// against a walk of the shafts.
    pub(crate) fn serving_transport_kinds_at(&self, floor: i64) -> (bool, bool, bool) {
        let fast = self.stop_bits().classes_at(floor);
        debug_assert_eq!(fast, self.serving_kinds_by_walk(floor), "floor {floor}");
        fast
    }

    /// [`Self::serving_transport_kinds_at`] by a walk of every shaft: the
    /// reference the sets are checked against.
    pub(crate) fn serving_kinds_by_walk(&self, floor: i64) -> (bool, bool, bool) {
        let mut kinds = (false, false, false);
        for t in &self.transports {
            if t.kind.is_staff_only_transport() || !t.stops_at(floor) {
                continue;
            }
            match t.kind {
                k if k.is_elevator() => kinds.0 = true,
                Kind::Stairs => kinds.1 = true,
                Kind::Escalator => kinds.2 = true,
                _ => {}
            }
        }
        kinds
    }
}

#[cfg(test)]
#[path = "tower_stop_bits_tests.rs"]
mod tests;
