//! The waiting estimate `accumulate` keeps per served floor: the people
//! the rooms of a floor send to the elevators while no crowd rides for
//! them, and a share of the tower's population at each lobby.

use super::ElevatorDispatch;
use crate::facilities::Kind;
use crate::tower::Tower;

impl ElevatorDispatch {
    pub(super) fn accumulate_waiting(&mut self, tower: &Tower, dt: f64, rush: f64) -> i64 {
        self.waiting.retain(|_, n| {
            let v = *n - dt * 0.03;
            if v <= 0.0 {
                false
            } else {
                *n = v;
                true
            }
        });
        let floors = tower.dispatch_floors();
        let served = &floors.served;
        self.acc.clear();
        self.acc.resize(served.len(), None);
        // `totalPopulation` rides along: the same rooms in the same order,
        // so one pass over the rooms instead of two.
        let mut pop = 0;
        // Rooms come in runs of one kind, so the kind's answer is kept from
        // the last room rather than asked again.
        let mut last: Option<(Kind, bool)> = None;
        for u in tower.room_units() {
            if u.is_present() {
                pop += u.census_count();
            }
            if u.occupants <= 0 {
                continue;
            }
            // A venue's visitors and an office's workers ride as real
            // people, so they are not waiting.
            let waits = match last {
                Some((kind, waits)) if kind == u.kind => waits,
                _ => {
                    let waits =
                        !(u.kind.counts_visitors() || u.kind.commutes_in_person(tower.mode));
                    last = Some((u.kind, waits));
                    waits
                }
            };
            if !waits {
                continue;
            }
            let Some(slot) = floors.slot(u.floor) else {
                continue;
            };
            // Each floor folds its rooms in room order, starting from the
            // value the map held, exactly as the per-room map updates did.
            let w = self.acc[slot]
                .get_or_insert_with(|| self.waiting.get(&u.floor).copied().unwrap_or(0.0));
            *w = (*w + u.occupants as f64 * rush * dt * 0.012).min(25.0);
        }
        for (slot, w) in self.acc.iter().enumerate() {
            if let Some(w) = *w {
                self.waiting.insert(served[slot], w);
            }
        }
        debug_assert_eq!(pop, tower.total_population());
        if pop > 0 {
            for &fl in &floors.lobbies {
                let w = self.waiting.entry(fl).or_insert(0.0);
                *w = (*w + pop as f64 * rush * dt * 0.0015).min(25.0);
            }
        }
        pop
    }
}
