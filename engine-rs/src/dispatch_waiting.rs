//! The waiting estimate `accumulate` keeps per served floor: the people
//! the rooms of a floor send to the elevators while no crowd rides for
//! them, and a share at each lobby of the population that does not ride in
//! person. Nobody draws these riders, so a room whose people ride as the
//! crowd stops feeding it: a car sent for both would carry nobody visible.

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
        // The people who ride the cars themselves (`Kind::arrives_in_person`),
        // left out of the lobbies' share so nobody is counted twice.
        let mut in_person = 0;
        // Only a tower whose offices commute has anyone riding in person, so
        // a Classic tower never asks a room.
        let some_ride = tower.mode.office_workers_commute_in_person();
        // Rooms come in runs of one kind, so the kind's answer is kept from
        // the last room rather than asked again.
        let mut last: Option<(Kind, bool)> = None;
        for u in tower.room_units() {
            if u.is_present() {
                let n = u.census_count();
                pop += n;
                if some_ride && u.kind.arrives_in_person(tower.mode) {
                    in_person += n;
                }
            }
            if u.occupants <= 0 {
                continue;
            }
            // A venue's visitors, an office's workers and a home's
            // residents ride as real people, so they are not waiting.
            let waits = match last {
                Some((kind, waits)) if kind == u.kind => waits,
                _ => {
                    let waits = !(u.kind.counts_visitors() || u.kind.arrives_in_person(tower.mode));
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
        let estimated = pop - in_person;
        if estimated > 0 {
            for &fl in &floors.lobbies {
                let w = self.waiting.entry(fl).or_insert(0.0);
                *w = (*w + estimated as f64 * rush * dt * 0.0015).min(25.0);
            }
        }
        pop
    }
}
