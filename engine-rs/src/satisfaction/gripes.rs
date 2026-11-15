//! Why a tenant is unhappy: the nightclub noise and the dominant gripe.

use super::shortfall::{HOME_PARKING_CAUSE, PARKING_CAUSE, TRASH_CAUSE};
use super::{noise_base_erosion_for, StepResult};
use crate::econ::{rent_config, rent_of};
use crate::facilities::Kind;
use crate::rules::{Drain, NIGHTCLUB_NOISE_FLOORS};
use crate::sim::Simulation;
use crate::tower::Unit;

/// Whether a nightclub's noise halo reaches a tenant of `kind`: homes and
/// guest rooms, the kinds whose rating the halo drains (`dominant_gripe`
/// names it for them, and the gripe card says so).
pub(crate) fn feels_nightclub_halo(kind: Kind) -> bool {
    matches!(kind, Kind::Condo | Kind::RentalApartment) || kind.is_hotel()
}

#[doc(hidden)]
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
        // The club drains only in its open hours, so the ladder weighs its
        // average over the day against drains that run around the clock.
        let open_share = Kind::Nightclub.open_hours_per_day() as f64 / 24.0;
        match nearest {
            None => 0.0,
            Some(d) => self.mode.nightclub_noise_penalty(d as f64) * open_share,
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
        // A service shortfall that sinks the rating outranks unmet demand; one
        // that only holds it at Good ranks last.
        let sinking_short = r.service_short.filter(|s| s.sinks).map(|s| s.cause);
        let holding_short = r.service_short.filter(|s| !s.sinks).map(|s| s.cause);
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
        // A far walk wears at the full noise rate in either mode, and a far
        // lobby at its band's erosion; a steeper unmet-demand drain outranks
        // either, as it does noise (#548, #550).
        let unmet_outranks_far_walk =
            || unmet_outranks(noise_base_erosion_for(u.kind, u.ever_occupied));
        let unmet_outranks_lobby = || {
            unmet_outranks(
                self.mode
                    .lobby_distance_drain(self.tower.nearest_lobby_floor_distance(u.floor))
                    .erosion,
            )
        };
        let over_rent = |kind: Kind| {
            rent_config(kind).is_some_and(|cfg| cfg.over_neutral(rent_of(kind, u.rent, u.no_rate)))
        };
        if u.kind == Kind::Office {
            if over_rent(Kind::Office) {
                return Some("rent");
            }
            if u.floor != 1 && r.far_walk && !unmet_outranks_far_walk() {
                return Some("transportFar");
            }
            if very_far && !unmet_outranks_lobby() {
                return Some("lobbyFar");
            }
            if r.noisy && !unmet_outranks_noise() {
                return Some("noise");
            }
            if let Some(cause) = sinking_short {
                return Some(cause);
            }
            if unmet_active {
                return Some("unmetDemand");
            }
            return holding_short;
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
            if u.kind == Kind::RentalApartment
                && u.floor != 1
                && r.far_walk
                && !unmet_outranks_far_walk()
            {
                return Some("transportFar");
            }
            if very_far && !unmet_outranks_lobby() {
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
            if let Some(cause) = sinking_short {
                return Some(cause);
            }
            if u.kind.is_unmet_demand_kind() && unmet_active {
                return Some("unmetDemand");
            }
            return holding_short;
        }
        if very_far && !unmet_outranks_lobby() {
            return Some("lobbyFar");
        }
        if r.noisy && !unmet_outranks_noise() {
            return Some("noise");
        }
        if self.near_nightclub(u.floor) && !unmet_outranks(self.nightclub_penalty_at(u.floor)) {
            return Some("noise");
        }
        if let Some(cause) = sinking_short {
            return Some(cause);
        }
        if unmet_active {
            return Some("unmetDemand");
        }
        holding_short
    }

    pub fn vacate_cause(&self, u: &Unit, r: &StepResult) -> &'static str {
        self.dominant_gripe(u, r).unwrap_or("access")
    }

    /// The cause a tenant leaving at the end of its notice is named for: the
    /// cause it gave notice for while that still holds, or else whatever
    /// wears it down now (#550). A player who fixed the rent while the floor
    /// stayed too far from a lobby sees the tenant leave for the lobby, not
    /// for the rent. With nothing wrong now, the stamped cause stays: the
    /// tenant is leaving because the rating has not climbed back yet.
    pub(crate) fn departure_cause(
        &self,
        u: &Unit,
        r: &StepResult,
        stamped: &'static str,
    ) -> &'static str {
        if self.stamped_cause_holds(u, r, stamped) {
            stamped
        } else {
            self.dominant_gripe(u, r).unwrap_or(stamped)
        }
    }

    /// Whether the cause a notice was stamped with still wears the tenant
    /// down. A cause this pass does not know (a relocation, or a name a
    /// later build added) counts as holding, so it is never replaced.
    fn stamped_cause_holds(&self, u: &Unit, r: &StepResult, stamped: &'static str) -> bool {
        match stamped {
            "access" | "noTransport" => !r.served,
            "congestion" => u.floor != 1 && r.cong > 1.0,
            "rent" => rent_config(u.kind)
                .is_some_and(|cfg| cfg.over_neutral(rent_of(u.kind, u.rent, u.no_rate))),
            "transportFar" => u.floor != 1 && r.far_walk,
            "lobbyFar" => r.lobby_far,
            "noise" => r.noisy || (feels_nightclub_halo(u.kind) && self.near_nightclub(u.floor)),
            "unmetDemand" => r.unmet_demand,
            TRASH_CAUSE | PARKING_CAUSE | HOME_PARKING_CAUSE => {
                r.service_short.is_some_and(|s| s.cause == stamped)
            }
            _ => true,
        }
    }
}
