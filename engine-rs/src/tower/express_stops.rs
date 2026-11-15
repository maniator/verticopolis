//! The express elevator's stops, and how a loaded save is brought to the rule.
//!
//! Classic follows the original (the parity run on SimTower 1.0, #1527): an
//! express may stop at the ground floor, every 15th floor whether or not a
//! lobby is built there, and every basement. Each of those stops starts on
//! and can be turned off; no other floor can be turned on, a shaft end
//! included. Modern stops at every basement and every floor with a lobby,
//! and its two ends always stop.

use super::Tower;
use crate::facilities::*;

impl Tower {
    /// Whether an express in this tower may stop at `floor`.
    pub fn express_may_stop(&self, floor: i64) -> bool {
        is_basement(floor)
            || if self.mode.express_stops_on_15th_floors() {
                is_lobby_floor(floor)
            } else {
                self.floor_has_lobby(floor)
            }
    }

    /// Why a Classic express may not span `bottom..=top`: the original only
    /// lets one be placed on the ground floor or a 15th floor, so its span
    /// has to take one in.
    pub(super) fn express_anchor_reason(
        &self,
        kind: Kind,
        bottom: i64,
        top: i64,
    ) -> Option<&'static str> {
        if kind != Kind::ElevatorExpress || !self.mode.express_stops_on_15th_floors() {
            return None;
        }
        let reaches_ground = bottom <= 1 && 1 <= top;
        let highest_sky = top.div_euclid(LOBBY_INTERVAL) * LOBBY_INTERVAL;
        let reaches_sky = highest_sky >= LOBBY_INTERVAL && highest_sky >= bottom;
        (!reaches_ground && !reaches_sky)
            .then_some("An express elevator has to reach the ground floor or a 15th floor.")
    }

    /// `setExpressStops`: an express stops at every floor of its span it may
    /// stop at (in Modern, its ends always stop too). The same command on
    /// any other elevator (the "Express (lobbies)" button) skips every
    /// floor inside its ends that has no lobby.
    pub fn set_express_stops(&mut self, id: i64) {
        let Some(i) = self.transport_index_edit(id) else {
            return;
        };
        let t = &self.transports[i];
        let (bottom, top) = (t.bottom, t.top);
        let skip: Vec<f64> = if t.kind != Kind::ElevatorExpress {
            (bottom + 1..top)
                .filter(|&fl| !self.floor_has_lobby(fl))
                .map(|fl| fl as f64)
                .collect()
        } else {
            let (from, to) = if self.mode.express_stops_on_15th_floors() {
                (bottom, top)
            } else {
                (bottom + 1, top - 1)
            };
            (from..=to)
                .filter(|&fl| !self.express_may_stop(fl))
                .map(|fl| fl as f64)
                .collect()
        };
        self.transports[i].skip_floors = Some(skip);
        self.revision += 1;
        self.snap_schedule_homes(i);
    }

    /// The skips of a Classic express after a resize: the old choices still
    /// inside the span, and every floor of the new span it may not stop at.
    pub(super) fn classic_express_resized_skips(&self, i: usize) -> Vec<f64> {
        let t = &self.transports[i];
        let (bottom, top) = (t.bottom as f64, t.top as f64);
        let mut skip: Vec<f64> = t
            .skip_floors
            .as_deref()
            .unwrap_or(&[])
            .iter()
            .copied()
            .filter(|&f| f >= bottom && f <= top)
            .collect();
        skip.extend(
            (t.bottom..=t.top)
                .filter(|&fl| !self.express_may_stop(fl))
                .map(|fl| fl as f64),
        );
        self.keep_a_stop(t.bottom, t.top, sorted_unique(skip))
    }

    /// `skip` as a Classic express on `bottom..=top` may hold it: a shaft
    /// that would stop nowhere drops the stops the player turned off and
    /// keeps every floor it may stop at. A shaft with no stop leaves its cars
    /// standing and its riders nowhere to get off, so one always remains;
    /// the anchor rule ([`Self::express_anchor_reason`]) gives every Classic
    /// express at least one floor it may stop at.
    pub(super) fn keep_a_stop(&self, bottom: i64, top: i64, skip: Vec<f64>) -> Vec<f64> {
        if (bottom..=top).any(|fl| !skip.contains(&(fl as f64))) {
            return skip;
        }
        let forced: Vec<f64> = skip
            .into_iter()
            .filter(|&f| f.fract() != 0.0 || !self.express_may_stop(f as i64))
            .collect();
        if (bottom..=top).any(|fl| !forced.contains(&(fl as f64))) {
            return forced;
        }
        // A crafted save can span no floor it may stop at: it stops at its
        // ends, as a Modern express does.
        let ends = [bottom as f64, top as f64];
        forced.into_iter().filter(|f| !ends.contains(f)).collect()
    }

    /// A lobby on `floor` turns the stop on or off for each Modern express
    /// passing it. A Classic express's stops do not depend on lobbies, and a
    /// basement stop is the player's to set.
    pub fn sync_express_stops_for_floor(&mut self, floor: i64) {
        if is_basement(floor) || self.mode.express_stops_on_15th_floors() {
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
    /// floor the express may not stop at is skipped; the basement stops
    /// follow [`Transport::preserve_basement_stops`](super::Transport), and a
    /// Classic shaft without
    /// [`Transport::classic_express_stops`](super::Transport) drops the
    /// skips the old lobby-only rule set on a 15th floor with no lobby.
    pub fn coerce_express_stops(&mut self) {
        let fifteenth_floor_stops = self.mode.express_stops_on_15th_floors();
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
            if fifteenth_floor_stops && !self.transports[i].classic_express_stops {
                skip.retain(|&f| !self.old_rule_sky_skip(f));
                self.transports[i].classic_express_stops = true;
            }
            let (from, to) = if fifteenth_floor_stops {
                (bottom, top)
            } else {
                (bottom + 1, top - 1)
            };
            skip.extend(
                (from..=to)
                    .filter(|&fl| !self.express_may_stop(fl))
                    .map(|fl| fl as f64),
            );
            let next = if fifteenth_floor_stops {
                self.keep_a_stop(bottom, top, sorted_unique(skip))
            } else {
                skip.retain(|&f| f != bottom as f64 && f != top as f64);
                sorted_unique(skip)
            };
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

    /// Whether the Elevator window offers a toggle for `floor`'s stop on
    /// shaft `t`. Every shaft but a Classic express always stops at its two
    /// ends. A Classic express toggles each floor it may stop at; a Modern
    /// express toggles a basement, and a lobby only while it is skipped (a
    /// legacy save's skip, so it can come back); any other shaft toggles
    /// every floor between its ends.
    pub fn stop_toggles(&self, t: &super::Transport, floor: i64, served: bool) -> bool {
        let express = t.kind == Kind::ElevatorExpress;
        if express && self.mode.express_stops_on_15th_floors() {
            return self.express_may_stop(floor);
        }
        if floor == t.bottom || floor == t.top {
            return false;
        }
        !express || is_basement(floor) || (self.floor_has_lobby(floor) && !served)
    }

    /// Whether a stop-list entry is a skip the old lobby-only rule forced: a
    /// 15th floor (or the ground floor) with no lobby built on it.
    fn old_rule_sky_skip(&self, f: f64) -> bool {
        f.fract() == 0.0 && is_lobby_floor(f as i64) && !self.floor_has_lobby(f as i64)
    }

    /// Snap a scheduled shaft's car homes onto its stops after a stop edit.
    pub(super) fn snap_schedule_homes(&mut self, i: usize) {
        if self.transports[i].schedule.is_some() {
            let stops = self.stops_of(&self.transports[i]);
            let t = &mut self.transports[i];
            t.schedule = Some(t.schedule.as_ref().unwrap().snap_homes_to_stops(&stops));
        }
    }
}

/// `skip` ascending with each floor once.
fn sorted_unique(mut skip: Vec<f64>) -> Vec<f64> {
    skip.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    skip.dedup();
    skip
}
