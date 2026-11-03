//! The shaft facts the schedule authoring queries share: how many cars, the
//! span, the floors it serves and the lobbies among them, and the two staging
//! floors the split and uniform seeds draw on. Read from the tower's
//! per-revision caches, never written.

use crate::sim::Simulation;
use crate::tower::Transport;

/// One shaft as the authoring queries see it. Both floor lists are ascending.
pub(crate) struct ShaftGeometry {
    pub cars: i64,
    pub bottom: i64,
    pub top: i64,
    /// Every floor the shaft stops at.
    pub served: Vec<i64>,
    /// The served floors that carry a (sky) lobby.
    pub lobbies: Vec<i64>,
}

impl Simulation {
    pub(crate) fn shaft_geometry(&self, t: &Transport) -> ShaftGeometry {
        // Both lists come from the tower's per-revision caches.
        let served = self.tower.stops_of(t);
        let lobby_floors = self.tower.dispatch_floors();
        // The lobby list is the short one: walk it and look each floor up in
        // the shaft's stops.
        let lobbies = lobby_floors
            .lobbies
            .iter()
            .copied()
            .filter(|f| served.binary_search(f).is_ok())
            .collect();
        ShaftGeometry {
            cars: t.cars,
            bottom: t.bottom,
            top: t.top,
            served,
            lobbies,
        }
    }
}

impl ShaftGeometry {
    /// The base (ground) lobby: the lowest served lobby, or the shaft bottom
    /// when it serves none (it idles at its base, as dispatch does).
    pub fn base_lobby(&self) -> i64 {
        self.lobbies.first().copied().unwrap_or(self.bottom)
    }

    /// The up-tower staging target: the highest served lobby when one sits
    /// above the base, else the shaft's top floor. The fallback matters on the
    /// commonest shaft, a ground-lobby-only local, where "up-tower" would
    /// otherwise collapse onto the base.
    pub fn up_tower_target(&self) -> i64 {
        let top_lobby = self.lobbies.last().copied().unwrap_or(self.top);
        if top_lobby > self.base_lobby() {
            top_lobby
        } else {
            self.top
        }
    }

    /// The fleet split: the lower half homed at the base lobby, the rest at
    /// `up`, in car order.
    pub fn split_homes(&self, up: i64) -> Vec<i64> {
        self.staged_homes(self.cars / 2, up)
    }

    /// The staging a preset or Auto-tune seeds: the fleet split like
    /// [`split_homes`](Self::split_homes), except that a one-car shaft keeps
    /// its only car at the base lobby so the lobby up-rush has a staged car
    /// (#1634). The one-press "stage upper half up-tower" play keeps the plain
    /// split, since the player asked for it.
    pub fn seeded_homes(&self, up: i64) -> Vec<i64> {
        let lobby_cars = if self.cars == 1 { 1 } else { self.cars / 2 };
        self.staged_homes(lobby_cars, up)
    }

    /// The first `lobby_cars` cars homed at the base lobby, the rest at `up`.
    fn staged_homes(&self, lobby_cars: i64, up: i64) -> Vec<i64> {
        let base = self.base_lobby();
        (0..self.cars)
            .map(|i| if i < lobby_cars { base } else { up })
            .collect()
    }

    /// Every car homed at one floor.
    pub fn uniform_homes(&self, floor: i64) -> Vec<i64> {
        vec![floor; self.cars.max(0) as usize]
    }

    /// The nearest served floor, ties to the lower one.
    pub fn snap_to_served(&self, floor: i64) -> i64 {
        let mut best = self.served.first().copied().unwrap_or(self.bottom);
        let mut best_dist = i64::MAX;
        for &f in &self.served {
            let d = (f - floor).abs();
            if d < best_dist {
                best_dist = d;
                best = f;
            }
        }
        best
    }
}
