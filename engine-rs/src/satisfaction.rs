//! Port of `sim/satisfaction.ts`, `sim/satisfactionStep.ts` and `sim/gripe.ts`.

use indexmap::IndexMap;

use crate::demand::{compute_demand_map, origin_demand, unmet_coverage, DemandMap};
use crate::econ::{rent_config, rent_of};
use crate::facilities::Kind;
use crate::rules::{
    CLASSIC_HOUSEHOLD, DAYCARE_HALO_MAX, FITNESS_HALO_MAX, NO_DRAIN, SPA_SERENITY_MAX,
};
use crate::sim::Simulation;
use crate::tower::Unit;

mod gripes;
pub mod shortfall;
mod update;

use shortfall::{shortfall_drain, ServiceShort, ServiceShortfalls};

pub const VACATE_NOTICE_MINUTES: f64 = 2.0 * 24.0 * 60.0;
pub const VACATE_RESCIND: f64 = 0.4;
pub const NOISE_CAP: f64 = 0.6;
pub const GRIPE_WARN: f64 = NOISE_CAP;
pub const NOISE_EROSION: f64 = 0.07;
pub const CONDO_NOISE_EROSION: f64 = 0.054;
pub const RENTAL_STUDIO_NOISE_EROSION: f64 = 0.04;
pub const TRANSPORT_FAR_TILES: i64 = 79;
pub const SERVED_RECOVERY: f64 = 0.05;
pub const OFFICE_NOISE_TILES: i64 = 11;
pub const HOTEL_NOISE_TILES: i64 = 21;
const GATE_HORIZON_HOURS: i64 = 48;

/// Whether a tenant's satisfaction is low enough for the inspector to name a
/// main gripe: at or under [`GRIPE_WARN`]. The Map's Eval view reads the same
/// line, so a room the inspector names a gripe for never reads Excellent.
pub fn names_gripe(satisfaction: f64) -> bool {
    satisfaction <= GRIPE_WARN
}

pub struct SatisfactionContext {
    pub cong_map: Option<IndexMap<i64, f64>>,
    pub global_cong: f64,
    pub served_set: std::collections::HashSet<i64>,
    pub club_floors: Vec<i64>,
    /// Every operational nightclub's floor, open or not.
    pub nightclub_floors: Vec<i64>,
    /// Whether the nightclubs are open in the hour this context is stepped
    /// for: they disturb the homes around them only then.
    pub nightclub_open: bool,
    pub spa_floors: Vec<i64>,
    pub daycare_floors: Vec<i64>,
    pub demand_map: Option<DemandMap>,
    /// This hour's recycling and office parking coverage, read once.
    pub shortfalls: ServiceShortfalls,
}

pub struct StepResult {
    pub next: f64,
    pub served: bool,
    pub cong: f64,
    pub far_walk: bool,
    pub noisy: bool,
    pub lobby_far: bool,
    pub unmet_demand: bool,
    pub unmet_cov: Option<f64>,
    /// The service shortfall holding this room down, if any.
    pub service_short: Option<ServiceShort>,
}

fn nearest_floor_dist(floors: &[i64], floor: i64) -> f64 {
    let mut nearest = f64::INFINITY;
    for &f in floors {
        let d = (f - floor).abs() as f64;
        if d < nearest {
            nearest = d;
        }
    }
    nearest
}

/// `noiseBaseErosionFor`.
pub fn noise_base_erosion_for(kind: Kind, ever_occupied: bool) -> f64 {
    if kind == Kind::RentalStudio {
        return RENTAL_STUDIO_NOISE_EROSION;
    }
    if kind == Kind::Condo && ever_occupied {
        return CONDO_NOISE_EROSION;
    }
    NOISE_EROSION
}

#[doc(hidden)]
impl Simulation {
    /// `buildSatisfactionContext`.
    pub fn build_satisfaction_context(&self, neutralize_congestion: bool) -> SatisfactionContext {
        let cong_map = if neutralize_congestion {
            None
        } else {
            Some(self.spatial_congestion_by_floor())
        };
        let mut global_cong = 0.0;
        if let Some(m) = &cong_map {
            for &v in m.values() {
                if v > global_cong {
                    global_cong = v;
                }
            }
        }
        let served_set = self.tower.served_floors();
        // A nightclub disturbs the homes around it only while it is open.
        let nightclub_open = Kind::Nightclub.is_open_at(self.clock.hour());
        let mut club_floors = Vec::new();
        let mut nightclub_floors = Vec::new();
        let mut spa_floors = Vec::new();
        let mut daycare_floors = Vec::new();
        for c in self.tower.room_units() {
            if c.kind == Kind::FitnessClub && c.is_tenanted() && served_set.contains(&c.floor) {
                club_floors.push(c.floor);
            } else if c.kind == Kind::Nightclub
                && c.is_operational()
                && served_set.contains(&c.floor)
            {
                nightclub_floors.push(c.floor);
            } else if c.kind == Kind::Spa && c.is_operational() && served_set.contains(&c.floor) {
                spa_floors.push(c.floor);
            } else if c.kind == Kind::Daycare && c.is_operational() && served_set.contains(&c.floor)
            {
                daycare_floors.push(c.floor);
            }
        }
        SatisfactionContext {
            cong_map,
            global_cong,
            served_set,
            club_floors,
            nightclub_floors,
            nightclub_open,
            spa_floors,
            daycare_floors,
            demand_map: None,
            shortfalls: self.service_shortfalls(),
        }
    }

    /// `reachesLobby`.
    pub fn reaches_lobby(&mut self, u: &Unit) -> bool {
        if !self.tower.is_floor_served(u.floor) {
            return false;
        }
        if self.tower.segments_of(u.floor).len() <= 1 {
            return true;
        }
        self.crowd.segment_connected(&self.tower, u.floor, u.x)
    }

    /// `satisfactionStep`.
    pub fn satisfaction_step(
        &mut self,
        u: &Unit,
        current: f64,
        ctx: &mut SatisfactionContext,
    ) -> StepResult {
        let served = ctx.served_set.contains(&u.floor) && self.reaches_lobby(u);
        let cong = match &ctx.cong_map {
            Some(m) => m.get(&u.floor).copied().unwrap_or(0.0),
            None => ctx.global_cong,
        };
        let churn = self.mode.churn_multiplier(u.residents);
        let mut s = current;
        if !served {
            s = (s - 0.15 * churn).max(0.0);
        } else if u.floor != 1 && cong > 1.0 {
            s = (s - 0.04 * (cong - 1.0).min(3.0) * churn).max(0.0);
        } else {
            s = (s + SERVED_RECOVERY).min(1.0);
        }
        if (u.kind == Kind::Office || u.kind.is_lease_amenity() || u.kind.is_rental()) && served {
            let cfg = rent_config(u.kind).unwrap();
            let over = (rent_of(u.kind, u.rent, u.no_rate) - cfg.default) / cfg.default;
            s = (s - over * 0.07).min(1.0).max(0.0);
        }
        let residential = u.kind == Kind::Condo || u.kind == Kind::RentalApartment;
        // The largest ceiling lift any nearby amenity gives this room.
        let mut amenity_lift: f64 = 0.0;
        if residential && served && !ctx.club_floors.is_empty() {
            let bonus = self
                .mode
                .fitness_halo_bonus(nearest_floor_dist(&ctx.club_floors, u.floor));
            if bonus > 0.0 {
                s = (s + bonus).min(1.0);
                amenity_lift =
                    amenity_lift.max(self.mode.amenity_cap_lift(bonus, FITNESS_HALO_MAX));
            }
        }
        if (u.kind == Kind::Condo || u.kind.is_hotel() || u.kind == Kind::RentalApartment)
            && served
            && ctx.nightclub_open
            && !ctx.nightclub_floors.is_empty()
        {
            let penalty = self
                .mode
                .nightclub_noise_penalty(nearest_floor_dist(&ctx.nightclub_floors, u.floor));
            if penalty > 0.0 {
                s = (s - penalty).max(0.0);
            }
        }
        if u.kind.is_hotel() && served && !ctx.spa_floors.is_empty() {
            let bonus = self
                .mode
                .spa_serenity_bonus(nearest_floor_dist(&ctx.spa_floors, u.floor));
            if bonus > 0.0 {
                s = (s + bonus).min(1.0);
                amenity_lift =
                    amenity_lift.max(self.mode.amenity_cap_lift(bonus, SPA_SERENITY_MAX));
            }
        }
        if residential && served && !ctx.daycare_floors.is_empty() {
            let bonus = self.mode.daycare_family_bonus(
                nearest_floor_dist(&ctx.daycare_floors, u.floor),
                u.residents.unwrap_or(0) as f64,
            );
            if bonus > 0.0 {
                s = (s + bonus).min(1.0);
                amenity_lift =
                    amenity_lift.max(self.mode.amenity_cap_lift(bonus, DAYCARE_HALO_MAX));
            }
        }
        let far_walk = (u.kind == Kind::Office || u.kind == Kind::RentalApartment)
            && served
            && u.floor != 1
            && self
                .tower
                .nearest_transport_distance(u)
                .is_none_or(|d| d > TRANSPORT_FAR_TILES);
        let noisy = (u.kind == Kind::Office
            || u.kind.is_hotel()
            || u.kind == Kind::Condo
            || u.kind.is_rental())
            && served
            && self.noise_afflicted(u);
        let lobby_drain = if served
            && (u.kind == Kind::Office
                || u.kind.is_hotel()
                || u.kind == Kind::Condo
                || u.kind == Kind::RentalApartment)
        {
            self.mode
                .lobby_distance_drain(self.tower.nearest_lobby_floor_distance(u.floor))
        } else {
            NO_DRAIN
        };
        let lobby_capped = lobby_drain.cap < 1.0;
        let coverage = if served && u.kind.is_unmet_demand_kind() {
            if ctx.demand_map.is_none() {
                ctx.demand_map = Some(compute_demand_map(self));
            }
            unmet_coverage(ctx.demand_map.as_ref().unwrap(), u)
        } else {
            None
        };
        let unmet_drain = match coverage {
            None => NO_DRAIN,
            Some(c) => self.mode.unmet_demand_drain(c),
        };
        let unmet_capped = unmet_drain.cap < 1.0;
        let service_short = ctx.shortfalls.binding_for(u, served);
        let short_drain = service_short.map_or(NO_DRAIN, shortfall_drain);
        let short_capped = short_drain.cap < 1.0;
        if far_walk || noisy || lobby_capped || unmet_capped || short_capped {
            let base_erosion = noise_base_erosion_for(u.kind, u.ever_occupied);
            let scale = if far_walk {
                1.0
            } else {
                self.mode.noise_erosion_scale()
            };
            let placement_erosion = if far_walk || noisy {
                base_erosion * scale
            } else {
                0.0
            };
            let erosion = placement_erosion
                .max(lobby_drain.erosion)
                .max(unmet_drain.erosion)
                .max(short_drain.erosion);
            let cap = (if far_walk || noisy { NOISE_CAP } else { 1.0 })
                .min(lobby_drain.cap)
                .min(unmet_drain.cap);
            // A nearby amenity raises the ceiling that noise, a far lobby or
            // unmet demand sets, never the one a far walk to transport sets
            // (no gym shortens that walk) nor a service shortfall's (#1970).
            // The capped flags above still read the raw caps, so the gripe
            // ladder keeps naming the cause.
            let lift = if far_walk { 0.0 } else { amenity_lift };
            let cap = (cap + lift).min(1.0).min(short_drain.cap);
            s = (s - erosion).min(cap).max(0.0);
        }
        StepResult {
            next: s,
            served,
            cong,
            far_walk,
            noisy,
            lobby_far: lobby_drain.cap <= GRIPE_WARN,
            unmet_demand: unmet_drain.erosion > 0.0,
            unmet_cov: coverage,
            service_short,
        }
    }

    /// `wouldEvictFreshTenant`.
    pub fn would_evict_fresh_tenant(&mut self, u: &Unit, ctx: &mut SatisfactionContext) -> bool {
        let mut probe = u.clone();
        probe.ever_occupied = true;
        probe.residents = if u.kind == Kind::Condo || u.kind == Kind::RentalApartment {
            Some(CLASSIC_HOUSEHOLD as i64)
        } else {
            u.residents
        };
        if u.kind.is_unmet_demand_kind() {
            if ctx.demand_map.is_none() {
                ctx.demand_map = Some(compute_demand_map(self));
            }
            // Floor-level on purpose: the TypeScript probe reads
            // `sim.floorReachable(u.floor)` here, so the segment probe would
            // be the wrong one.
            let reachable = self.floor_reachable(u.floor);
            let dm = ctx.demand_map.as_mut().unwrap();
            let n = if reachable {
                dm.fraction_by_unit.len() as i64
            } else {
                0
            };
            dm.reachable_venues_by_origin.insert(u.id, n);
            let od = origin_demand(self, probe.kind, probe.residents, dm.bonus);
            dm.share = if dm.total_cap > 0.0 {
                (dm.pool + od) / dm.total_cap
            } else {
                0.0
            };
        }
        // The nightclub is felt only while it is open, so the gate walks its
        // horizon hour by hour from now and opens the clubs in their hours:
        // a night run would otherwise hold every spot near a club, and a day
        // run would let a tenant in beside one that evicts them overnight.
        // The newcomer adds to the trash and parking need it is judged by,
        // only while the probe runs.
        let open_now = ctx.nightclub_open;
        ctx.shortfalls.set_candidate(Some(fresh_tenant_need(u)));
        let doomed = self.gate_horizon_dooms(&probe, ctx);
        ctx.shortfalls.set_candidate(None);
        ctx.nightclub_open = open_now;
        doomed
    }

    /// Whether `probe`, starting content, falls under [`VACATE_RESCIND`]
    /// within the gate's horizon without ever recovering.
    fn gate_horizon_dooms(&mut self, probe: &Unit, ctx: &mut SatisfactionContext) -> bool {
        let mut s = 1.0;
        let now = self.clock.hour();
        for h in 0..GATE_HORIZON_HOURS {
            ctx.nightclub_open = Kind::Nightclub.is_open_at((now + h) % 24);
            let prev = s;
            s = self.satisfaction_step(probe, s, ctx).next;
            if s < VACATE_RESCIND {
                return true;
            }
            if s >= prev {
                return false;
            }
        }
        true
    }
}

/// `VACATE_REASON_TEXT`: the player-facing phrase for a departure cause, as
/// the toasts and the inspector word it. The cause keys themselves are what
/// the save carries (`vacateReason`); the log carries this text. Log text is
/// outside the conformance hash, so a rule test pins it:
/// `rule_tests::simulation_economy` reads the eviction line.
pub fn vacate_reason_text(reason: &'static str) -> &'static str {
    match reason {
        "access" => "no route to the lobby",
        "noTransport" => "no way to transportation from here",
        "congestion" => "overcrowded vertical transport",
        "rent" => "rent set too high",
        "noise" => "a noisy neighbor nearby",
        "transportFar" => "too far from a stairway, escalator, or passenger elevator",
        "lobbyFar" => "too far from a lobby or sky lobby",
        "unmetDemand" => "too few shops or restaurants within reach",
        "trash" => "trash piling up without enough recycling",
        "parking" => "too little parking for its workers",
        "relocation" => "the household is relocating",
        other => other,
    }
}

/// The kind and head count a fresh tenant of `u` adds to the service need:
/// a seated household for a condo or rental apartment (as the move-in gate
/// seats its probe), else the unit's residents or its kind's population.
pub(crate) fn fresh_tenant_need(u: &Unit) -> (Kind, f64) {
    let heads = if u.kind == Kind::Condo || u.kind == Kind::RentalApartment {
        CLASSIC_HOUSEHOLD
    } else {
        u.residents
            .map_or(u.kind.facility().population as f64, |r| r as f64)
    };
    (u.kind, heads)
}

#[cfg(test)]
mod tests;
