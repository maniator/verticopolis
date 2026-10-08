//! Port of `sim/satisfaction.ts`, `sim/satisfactionStep.ts` and `sim/gripe.ts`.

use indexmap::IndexMap;

use crate::demand::{compute_demand_map, origin_demand, unmet_coverage, DemandMap};
use crate::econ::{rent_config, rent_of};
use crate::facilities::Kind;
use crate::rules::{Drain, CLASSIC_HOUSEHOLD, NIGHTCLUB_NOISE_FLOORS, NO_DRAIN};
use crate::sim::{LogKind, Simulation};
use crate::tower::{Unit, UnitState};

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

pub struct SatisfactionContext {
    pub cong_map: Option<IndexMap<i64, f64>>,
    pub global_cong: f64,
    pub served_set: std::collections::HashSet<i64>,
    pub club_floors: Vec<i64>,
    pub nightclub_floors: Vec<i64>,
    pub spa_floors: Vec<i64>,
    pub daycare_floors: Vec<i64>,
    pub demand_map: Option<DemandMap>,
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
            spa_floors,
            daycare_floors,
            demand_map: None,
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

    /// `nearestKindWithin`.
    fn nearest_kind_within(
        &self,
        u: &Unit,
        is_source: impl Fn(Kind) -> bool,
        max_tiles: i64,
    ) -> bool {
        for dir in [-1i64, 1] {
            let start = if dir < 0 { u.x - 1 } else { u.x + u.width };
            for d in 0..=max_tiles {
                let x = start + dir * d;
                if self.tower.structure_kind_at(u.floor, x) == Some(Kind::Lobby) {
                    break;
                }
                let room = self.tower.room_at(u.floor, x);
                if let Some(r) = room {
                    if is_source(r.kind) {
                        return true;
                    }
                } else if !self.tower.has_structure(u.floor, x) {
                    break;
                }
            }
        }
        false
    }

    /// `noiseAfflicted` (computed fresh; the TypeScript memo is pure).
    pub fn noise_afflicted(&self, u: &Unit) -> bool {
        if u.kind == Kind::Office {
            return self.nearest_kind_within(u, |k| k.is_commercial(), OFFICE_NOISE_TILES);
        }
        if u.kind.is_hotel() || u.kind == Kind::Condo || u.kind.is_rental() {
            return self.nearest_kind_within(
                u,
                |k| k == Kind::Office || k.is_commercial(),
                HOTEL_NOISE_TILES,
            );
        }
        false
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
        if residential && served && !ctx.club_floors.is_empty() {
            let bonus = self
                .mode
                .fitness_halo_bonus(nearest_floor_dist(&ctx.club_floors, u.floor));
            if bonus > 0.0 {
                s = (s + bonus).min(1.0);
            }
        }
        if (u.kind == Kind::Condo || u.kind.is_hotel() || u.kind == Kind::RentalApartment)
            && served
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
            }
        }
        if residential && served && !ctx.daycare_floors.is_empty() {
            let bonus = self.mode.daycare_family_bonus(
                nearest_floor_dist(&ctx.daycare_floors, u.floor),
                u.residents.unwrap_or(0) as f64,
            );
            if bonus > 0.0 {
                s = (s + bonus).min(1.0);
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
        if far_walk || noisy || lobby_capped || unmet_capped {
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
                .max(unmet_drain.erosion);
            let cap = (if far_walk || noisy { NOISE_CAP } else { 1.0 })
                .min(lobby_drain.cap)
                .min(unmet_drain.cap);
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
            // `sim.floorReachable(u.floor)` here, not the segment probe.
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
        let mut s = 1.0;
        for _ in 0..GATE_HORIZON_HOURS {
            let prev = s;
            s = self.satisfaction_step(&probe, s, ctx).next;
            if s < VACATE_RESCIND {
                return true;
            }
            if s >= prev {
                return false;
            }
        }
        true
    }

    /// `nearNightclub`.
    fn near_nightclub(&self, floor: i64) -> bool {
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

    /// `updateSatisfaction`.
    pub fn update_satisfaction(&mut self) {
        let mut ctx = self.build_satisfaction_context(false);
        if ctx.global_cong > 1.4 && self.clock.hour() == 9 && self.rng.chance(0.5) {
            self.emit(
                "Tenants are complaining of long elevator waits. Add cars or shafts.",
                LogKind::Bad,
            );
        }
        let mut notices: Vec<(i64, Kind, &'static str)> = Vec::new();
        for i in self.tower.room_indices() {
            let u = self.tower.units[i].clone();
            if u.is_dormant() {
                continue;
            }
            let r = self.satisfaction_step(&u, u.satisfaction, &mut ctx);
            self.tower.units[i].satisfaction = r.next;
            let mut u = self.tower.units[i].clone();
            let lease_tenant = matches!(
                u.kind,
                Kind::Office | Kind::Condo | Kind::FitnessClub | Kind::Clinic
            ) || u.kind.is_rental();
            if lease_tenant && u.state == UnitState::Vacating {
                let is_relocation = u.vacate_reason == Some("relocation");
                let noise_cannot_evict =
                    u.vacate_reason == Some("noise") && self.mode.noise_erosion_scale() == 0.0;
                let price_cfg = if u.kind == Kind::Office || u.kind.is_rental() {
                    rent_config(u.kind)
                } else {
                    None
                };
                let over_market_rent =
                    price_cfg.is_some_and(|c| rent_of(u.kind, u.rent, u.no_rate) > c.default);
                let non_noise_problem = !r.served
                    || (u.floor != 1 && r.cong > 1.0)
                    || over_market_rent
                    || r.far_walk
                    || r.lobby_far;
                if noise_cannot_evict && non_noise_problem {
                    u.vacate_reason = Some(self.vacate_cause(&u, &r));
                    self.tower.units[i].vacate_reason = u.vacate_reason;
                }
                let rescind_noise = noise_cannot_evict && !non_noise_problem;
                if !is_relocation && (u.satisfaction >= VACATE_RESCIND || rescind_noise) {
                    let w = &mut self.tower.units[i];
                    w.state = UnitState::Occupied;
                    w.vacate_reason = None;
                    w.vacate_at = None;
                    if rescind_noise {
                        w.satisfaction = w.satisfaction.max(NOISE_CAP);
                    }
                } else if self.clock.minutes >= u.vacate_at.unwrap_or(0.0) {
                    let reason = u.vacate_reason.unwrap_or("access");
                    self.vacate(i, reason);
                }
            } else if lease_tenant && u.satisfaction <= 0.0 {
                let reason = self.vacate_cause(&u, &r);
                let w = &mut self.tower.units[i];
                w.state = UnitState::Vacating;
                w.vacate_reason = Some(reason);
                w.vacate_at = Some(self.clock.minutes + VACATE_NOTICE_MINUTES);
                notices.push((u.floor, u.kind, reason));
            } else if u.satisfaction <= 0.0 && u.kind.is_hotel() {
                let reason = self.vacate_cause(&u, &r);
                self.vacate(i, reason);
            }
        }
        self.emit_notices(&notices);
    }

    fn emit_notices(&mut self, notices: &[(i64, Kind, &'static str)]) {
        if notices.is_empty() {
            return;
        }
        if notices.len() == 1 {
            let (floor, kind, reason) = notices[0];
            let msg = format!(
                "{} on {} gave notice: {}. Fix it before they leave.",
                kind.facility().name,
                self.floor_label(floor),
                reason
            );
            self.emit(&msg, LogKind::Bad);
            return;
        }
        let msg = format!(
            "{} tenants gave notice. Fix the flagged units before they leave.",
            notices.len()
        );
        self.emit(&msg, LogKind::Bad);
    }
}
