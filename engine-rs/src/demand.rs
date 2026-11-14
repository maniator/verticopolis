//! Port of `sim/demand.ts`: the commercial demand pool.

use std::collections::HashMap;

use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::{Unit, UnitState};

pub const RECYCLING_POP_PER_CENTER: f64 = 2500.0;

pub struct DemandMap {
    pub fraction_by_unit: HashMap<i64, f64>,
    pub delivered_by_unit: HashMap<i64, f64>,
    pub reachable_venues_by_origin: HashMap<i64, i64>,
    pub share: f64,
    pub retail_venue_count: i64,
    pub pool: f64,
    pub total_cap: f64,
    /// Daily income capacity of the reachable attendance venues (cinemas,
    /// party halls, aquatic centers) where the mode counts them as amenities
    /// (#705); 0 otherwise. Coverage reads it; the income share does not.
    pub attendance_cap: f64,
    pub bonus: f64,
}

/// `originWeight`.
fn origin_weight(kind: Kind) -> Option<f64> {
    if kind == Kind::Office {
        return Some(1.0);
    }
    if kind == Kind::Condo {
        return Some(0.3);
    }
    if kind.is_hotel() {
        return Some(1.0);
    }
    if kind.is_rental() {
        return Some(0.3);
    }
    None
}

#[doc(hidden)]
impl Simulation {
    /// Whether an operating metro station is helping business: in Classic its
    /// platform floor must also have transport, as in SimTower.
    pub fn metro_helps_business(&self) -> bool {
        self.shopper_metro_platform().is_some()
    }

    /// The platform floor where the metro lets shoppers off, while the
    /// station helps business by this mode's rule (`metro_helps_business`).
    /// The platform is the station's middle story, so SimTower's station on
    /// B8 to B10 lets them off on B9.
    pub fn shopper_metro_platform(&self) -> Option<i64> {
        let need_service = self.mode.metro_help_needs_service();
        self.tower
            .metro_stations()
            .find(|u| {
                u.is_operational() && (!need_service || self.tower.is_metro_platform_served(u))
            })
            .map(|u| u.floor + 1)
    }

    /// Floors from `floor` to the nearest place shoppers arrive: a lobby, a
    /// sky lobby, or `platform`, the metro platform from
    /// `shopper_metro_platform`. A shop or restaurant more than
    /// `COMMERCIAL_LOBBY_FLOORS` from all of them takes half its trade. The
    /// wiki's basement bands follow from the platform counting: B7 to B9
    /// sit within two floors of B9, while B5 and B6 get no help from it.
    pub fn shopper_arrival_distance(&self, floor: i64, platform: Option<i64>) -> i64 {
        let lobby = self.tower.nearest_lobby_floor_distance(floor);
        platform.map_or(lobby, |p| lobby.min((floor - p).abs()))
    }
}

/// `towerDemandBonus`.
fn tower_demand_bonus(sim: &Simulation) -> f64 {
    let metro = if sim.metro_helps_business() {
        0.25
    } else {
        0.0
    };
    let centers = sim.count_operational(Kind::Recycling);
    let mut recycling = 0.0;
    if centers > 0 {
        let pop = sim.tower.total_population() as f64;
        let capacity = centers as f64 * RECYCLING_POP_PER_CENTER;
        recycling = 0.1 * (capacity / pop.max(1.0)).min(1.0);
    }
    1.0 + metro + recycling
}

/// `computeDemandMap`.
pub fn compute_demand_map(sim: &mut Simulation) -> DemandMap {
    let mut fraction_by_unit = HashMap::new();
    let mut delivered_by_unit = HashMap::new();
    let mut reachable_venues_by_origin = HashMap::new();
    let mut reach_cache: HashMap<(i64, i64), bool> = HashMap::new();
    let mode = sim.mode;
    let rooms: Vec<(i64, Kind, i64, i64, UnitState, Option<i64>)> = sim
        .tower
        .room_units()
        .map(|u| (u.id, u.kind, u.floor, u.x, u.state, u.residents))
        .collect();
    let mut draws = |sim: &mut Simulation, floor: i64, x: i64| -> bool {
        let key = (floor, sim.tower.segment_start_x(floor, x));
        if let Some(&h) = reach_cache.get(&key) {
            return h;
        }
        let h = sim.unit_reachable(floor, x);
        reach_cache.insert(key, h);
        h
    };
    let mut venues: Vec<(i64, f64)> = Vec::new();
    let mut total_cap = 0.0;
    let mut retail_venue_count = 0;
    let mut attendance_cap = 0.0;
    let attendance_is_amenity = mode.attendance_counts_toward_coverage();
    for &(id, kind, floor, x, state, _) in &rooms {
        let Some(cap) = crate::economy::commercial_daily_income(mode, kind) else {
            continue;
        };
        if kind.attendance_cap().is_some() {
            // An attendance venue earns from live fill, not from this pool
            // (#424), so it never joins the share. Where the mode counts it
            // as an amenity it still covers the tenants who can reach it.
            if attendance_is_amenity && operational(state) && draws(sim, floor, x) {
                attendance_cap += cap;
            }
            continue;
        }
        if !operational(state) {
            continue;
        }
        retail_venue_count += 1;
        if !draws(sim, floor, x) {
            continue;
        }
        venues.push((id, cap));
        total_cap += cap;
    }
    let (per_capita, floor_frac) = mode.demand_model();
    let reachable_venue_count = venues.len() as i64;
    let mut pool = 0.0;
    for &(id, kind, floor, x, state, residents) in &rooms {
        let Some(w) = origin_weight(kind) else {
            continue;
        };
        let tenanted = matches!(state, UnitState::Occupied | UnitState::Vacating);
        if !tenanted && state != UnitState::Asleep {
            continue;
        }
        if !draws(sim, floor, x) {
            reachable_venues_by_origin.insert(id, 0);
            continue;
        }
        reachable_venues_by_origin.insert(id, reachable_venue_count);
        pool += resident_count(kind, residents) as f64 * w * per_capita;
    }
    let bonus = tower_demand_bonus(sim);
    pool *= bonus;
    let share = if total_cap > 0.0 {
        pool / total_cap
    } else {
        0.0
    };
    let frac = share.min(1.0).max(floor_frac);
    for (id, cap) in venues {
        fraction_by_unit.insert(id, frac);
        delivered_by_unit.insert(id, frac * cap);
    }
    DemandMap {
        fraction_by_unit,
        delivered_by_unit,
        reachable_venues_by_origin,
        share,
        retail_venue_count,
        pool,
        total_cap,
        attendance_cap,
        bonus,
    }
}

fn operational(state: UnitState) -> bool {
    !matches!(
        state,
        UnitState::Construction | UnitState::Fire | UnitState::Gutted
    )
}

fn resident_count(kind: Kind, residents: Option<i64>) -> i64 {
    if kind.has_household() {
        if let Some(r) = residents {
            return r;
        }
    }
    kind.facility().population
}

/// `originDemand(sim, u, bonus)`.
pub fn origin_demand(sim: &Simulation, kind: Kind, residents: Option<i64>, bonus: f64) -> f64 {
    let Some(w) = origin_weight(kind) else {
        return 0.0;
    };
    resident_count(kind, residents) as f64 * w * sim.mode.demand_model().0 * bonus
}

/// `foldOriginDemand`.
pub fn fold_origin_demand(dm: &mut DemandMap, sim: &Simulation, u: &Unit) {
    dm.pool += origin_demand(sim, u.kind, u.residents, dm.bonus);
}

/// `unmetCoverage`.
pub fn unmet_coverage(dm: &DemandMap, u: &Unit) -> Option<f64> {
    let reachable = *dm.reachable_venues_by_origin.get(&u.id)?;
    if dm.retail_venue_count == 0 {
        return None;
    }
    if reachable == 0 {
        return Some(0.0);
    }
    Some(if dm.share > 0.0 {
        if dm.attendance_cap > 0.0 {
            // Retail and attendance capacity together against the same
            // demand (#705): (retail + attendance) / demand, written through
            // `share` (demand / retail) because the move-in probe
            // (`would_evict_fresh_tenant`) adds its tenant's demand to the
            // share and not to `pool`. Only a mode that counts attendance
            // gets here, and only with a shop in reach: seats add to the
            // retail on offer, they do not stand in for it.
            ((1.0 + dm.attendance_cap / dm.total_cap) / dm.share).min(1.0)
        } else {
            (1.0 / dm.share).min(1.0)
        }
    } else {
        1.0
    })
}

#[cfg(test)]
#[path = "demand_tests.rs"]
mod tests;
