//! The express elevator's stops: every lobby above ground and every
//! basement floor it passes, and how a loaded save is brought to that rule.

use super::Tower;
use crate::facilities::*;

impl Tower {
    /// `setExpressStops`: skip every non-lobby floor inside the span, but an
    /// express keeps every basement floor (the SimTower wiki).
    pub fn set_express_stops(&mut self, id: i64) {
        let lobbies = self.lobby_floors();
        let Some(i) = self.transport_index_edit(id) else {
            return;
        };
        let (bottom, top) = (self.transports[i].bottom, self.transports[i].top);
        let basements_stop = self.transports[i].kind == Kind::ElevatorExpress;
        let skip: Vec<f64> = (bottom + 1..top)
            .filter(|&fl| !(basements_stop && is_basement(fl)) && !lobbies.contains(&fl))
            .map(|fl| fl as f64)
            .collect();
        self.transports[i].skip_floors = Some(skip);
        self.revision += 1;
        if self.transports[i].schedule.is_some() {
            let stops = self.stops_of(&self.transports[i]);
            let t = &mut self.transports[i];
            t.schedule = Some(t.schedule.as_ref().unwrap().snap_homes_to_stops(&stops));
        }
    }

    /// A lobby on `floor` turns the stop on or off for each express passing
    /// it; a basement stop is the player's to set.
    pub fn sync_express_stops_for_floor(&mut self, floor: i64) {
        if is_basement(floor) {
            return;
        }
        let has_lobby = self.floor_has_lobby(floor);
        let ids: Vec<i64> = self
            .transports
            .iter()
            .filter(|t| t.kind == Kind::ElevatorExpress && t.bottom < floor && floor < t.top)
            .map(|t| t.id)
            .collect();
        for id in ids {
            self.set_stop(id, floor, has_lobby);
        }
    }

    /// `coerceExpressStops()`: re-assert the express rule on load. Every
    /// floor above ground without a lobby is skipped; the basement stops
    /// follow [`Transport::preserve_basement_stops`](super::Transport).
    pub fn coerce_express_stops(&mut self) {
        let mut changed = false;
        for i in 0..self.transports.len() {
            if self.transports[i].kind != Kind::ElevatorExpress {
                continue;
            }
            let (bottom, top) = (self.transports[i].bottom, self.transports[i].top);
            let mut skip: Vec<f64> = self.transports[i].skip_floors.clone().unwrap_or_default();
            // A shaft without the flag comes from a save before every express
            // served the basements, so its basement skips were the old rule's
            // and go. A flagged shaft's basement skips are the player's or the
            // imported TDT's own, and stay.
            if !self.transports[i].preserve_basement_stops {
                skip.retain(|&f| !is_basement_stop(f));
                self.transports[i].preserve_basement_stops = true;
            }
            for fl in bottom + 1..top {
                if is_basement(fl) {
                    continue;
                }
                if !self.floor_has_lobby(fl) && !skip.contains(&(fl as f64)) {
                    skip.push(fl as f64);
                }
            }
            skip.retain(|&f| f != bottom as f64 && f != top as f64);
            let mut next: Vec<f64> = Vec::new();
            for f in skip {
                if !next.contains(&f) {
                    next.push(f);
                }
            }
            next.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            let before = self.transports[i].skip_floors.clone().unwrap_or_default();
            if next != before {
                self.transports[i].skip_floors = Some(next);
                changed = true;
            }
        }
        if changed {
            self.revision += 1;
        }
    }
}
