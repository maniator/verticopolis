//! Why a tenant is unhappy: the nightclub noise and the dominant gripe.

use super::{noise_base_erosion_for, StepResult};
use crate::econ::{rent_config, rent_of};
use crate::facilities::Kind;
use crate::rules::{Drain, NIGHTCLUB_NOISE_FLOORS};
use crate::sim::Simulation;
use crate::tower::Unit;

impl Simulation {
    /// `nearNightclub`.
    pub(crate) fn near_nightclub(&self, floor: i64) -> bool {
        self.tower.units.iter().any(|c| {
            c.kind == Kind::Nightclub
                && c.is_operational()
                && self.tower.is_floor_served(c.floor)
                && ((c.floor - floor).abs() as f64) < NIGHTCLUB_NOISE_FLOORS
        })
    }

    /// `nightclubPenaltyAt`.
    fn nightclub_penalty_at(&self, floor: i64) -> f64 {
        let mut nearest: Option<i64> = None;
        for c in &self.tower.units {
            if c.kind == Kind::Nightclub
                && c.is_operational()
                && self.tower.is_floor_served(c.floor)
            {
                let d = (c.floor - floor).abs();
                if nearest.is_none_or(|n| d < n) {
                    nearest = Some(d);
                }
            }
        }
        match nearest {
            None => 0.0,
            Some(d) => self.mode.nightclub_noise_penalty(d as f64),
        }
    }

    /// `dominantGripe` with every flag supplied (the eviction path).
    pub fn dominant_gripe(&self, u: &Unit, r: &StepResult) -> Option<&'static str> {
        if !r.served {
            return Some(if self.tower.is_floor_served(u.floor) {
                "noTransport"
            } else {
                "access"
            });
        }
        if u.floor != 1 && r.cong > 1.0 {
            return Some("congestion");
        }
        let very_far = r.lobby_far;
        let unmet_active = r.unmet_demand;
        let unmet_drain = |cov: Option<f64>| -> Option<Drain> {
            if !unmet_active || !u.kind.is_unmet_demand_kind() {
                return None;
            }
            cov.map(|c| self.mode.unmet_demand_drain(c))
        };
        let unmet_outranks =
            |competing: f64| unmet_drain(r.unmet_cov).is_some_and(|d| d.erosion > competing);
        let unmet_outranks_noise = || {
            unmet_outranks(
                noise_base_erosion_for(u.kind, u.ever_occupied) * self.mode.noise_erosion_scale(),
            )
        };
        let over_rent = |kind: Kind| {
            rent_config(kind).is_some_and(|cfg| rent_of(kind, u.rent, u.no_rate) > cfg.default)
        };
        if u.kind == Kind::Office {
            if over_rent(Kind::Office) {
                return Some("rent");
            }
            if u.floor != 1 && r.far_walk {
                return Some("transportFar");
            }
            if very_far {
                return Some("lobbyFar");
            }
            if r.noisy && !unmet_outranks_noise() {
                return Some("noise");
            }
            if unmet_active {
                return Some("unmetDemand");
            }
            return None;
        }
        if u.kind.is_lease_amenity() {
            if over_rent(u.kind) {
                return Some("rent");
            }
            return None;
        }
        if u.kind.is_rental() {
            if over_rent(u.kind) {
                return Some("rent");
            }
            if u.kind == Kind::RentalApartment && u.floor != 1 && r.far_walk {
                return Some("transportFar");
            }
            if very_far {
                return Some("lobbyFar");
            }
            if r.noisy && !unmet_outranks_noise() {
                return Some("noise");
            }
            if u.kind == Kind::RentalApartment
                && self.near_nightclub(u.floor)
                && !unmet_outranks(self.nightclub_penalty_at(u.floor))
            {
                return Some("noise");
            }
            if u.kind.is_unmet_demand_kind() && unmet_active {
                return Some("unmetDemand");
            }
            return None;
        }
        if very_far {
            return Some("lobbyFar");
        }
        if r.noisy && !unmet_outranks_noise() {
            return Some("noise");
        }
        if self.near_nightclub(u.floor) && !unmet_outranks(self.nightclub_penalty_at(u.floor)) {
            return Some("noise");
        }
        if unmet_active {
            return Some("unmetDemand");
        }
        None
    }

    pub fn vacate_cause(&self, u: &Unit, r: &StepResult) -> &'static str {
        self.dominant_gripe(u, r).unwrap_or("access")
    }
}
