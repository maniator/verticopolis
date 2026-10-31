//! The tenant family (PR 1 of #1215): the access line, No Rate, the long walk
//! (W1), lobby distance with its buildable sky lobby slot (#394), "Main
//! gripe", "Won't lease" and the notice countdown, for the kinds
//! `facilityDiagnostics.ts` and `gripeCopy.ts` gate them on.

use serde::Serialize;

use super::DiagnosticFacts;
use crate::churn::CongestionBindingClass;
use crate::demand::unmet_coverage;
use crate::econ::rent_of;
use crate::economy::commercial_daily_income;
use crate::facilities::{is_sky_lobby_floor, Kind, LOBBY_INTERVAL, MAX_FLOOR};
use crate::presence::CongestionAttribution;
use crate::satisfaction::{
    StepResult, GRIPE_WARN, SERVED_RECOVERY, TRANSPORT_FAR_TILES, VACATE_RESCIND,
};
use crate::sim::Simulation;
use crate::tower::{Tower, Unit, UnitState};

/// The lobby-distance block: present when the mode's drain caps the unit
/// below full satisfaction.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LobbyFacts {
    /// Floors to the nearest (sky) lobby; Modern prints it, Classic does not.
    pub distance: i64,
    /// The erosion outpaces the served recovery, so the tenant slides out.
    pub sinking: bool,
    /// The nearest legal sky lobby slot nearer than the current lobby, or
    /// `null` when none exists (the copy goes neutral there).
    pub slot: Option<SlotFacts>,
}

/// What building the lobby on `floor` takes first.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotFacts {
    pub floor: i64,
    /// The unit itself sits on the slot.
    pub on_slot: bool,
    /// The slot is more than one story above the built top.
    pub needs_support: bool,
    /// A room stands on the slot story and must go first. False whenever
    /// `on_slot` or `needs_support` holds, since those advise first.
    pub clear_first: bool,
}

/// An attributed cause and what its copy branches on.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GripeFacts {
    /// The `VacateReason` key.
    pub cause: &'static str,
    /// Congestion: the class that binds the floor's reading (#701).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binding: Option<&'static str>,
    /// Congestion with a walkway binding: a passenger elevator stops here.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub elevator_here: Option<bool>,
    /// Noise: a same-floor office or commercial source (lobby-shieldable).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adjacent: Option<bool>,
    /// Noise: a nightclub within its halo, for the kinds that feel it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub club: Option<bool>,
    /// Unmet demand: the retail coverage the cause was judged on.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub coverage: Option<f64>,
    /// Unmet demand at coverage 0: whether the unit's own floor is
    /// reachable (when it is not, the access line already says so).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub floor_reachable: Option<bool>,
}

/// An empty spot the move-in gate holds vacant.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WontLeaseFacts {
    /// The cause the gate held it for, or absent for the generic line.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gripe: Option<GripeFacts>,
    /// What holding it empty costs a month (Modern overhead plus a condo's
    /// hold tax; 0 in Classic).
    pub carry: f64,
}

/// A tenant on notice.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoticeFacts {
    pub reason: &'static str,
    /// Game minutes until they leave, never negative.
    pub minutes_left: f64,
    pub satisfaction: f64,
    /// The satisfaction that keeps them (`VACATE_RESCIND`).
    pub keep_at: f64,
}

/// `hasAccessDiagnostic`: only kinds that draw commuters or visitors carry
/// an access line. These are the sources the catalog's `population` and
/// `dailyIncome` are built from (`catalog::facility_entry`), which the
/// catalog lock holds equal to the TypeScript's.
fn has_access_diagnostic(sim: &Simulation, kind: Kind) -> bool {
    kind.facility().population > 0 || commercial_daily_income(sim.mode, kind).is_some()
}

/// `dominantGripe`'s `unmetActive` for a coverage read: the drain caps or
/// erodes (the inspector's reading; the eviction path takes erosion only).
fn unmet_active(sim: &Simulation, cov: Option<f64>) -> bool {
    cov.is_some_and(|c| {
        let d = sim.mode.unmet_demand_drain(c);
        d.erosion > 0.0 || d.cap < 1.0
    })
}

/// The tenants that feel the lobby-distance drain.
fn lobby_tenant(kind: Kind) -> bool {
    matches!(kind, Kind::Office | Kind::Condo | Kind::RentalApartment) || kind.is_hotel()
}

fn binding_name(b: CongestionBindingClass) -> &'static str {
    match b {
        CongestionBindingClass::Elevator => "elevator",
        CongestionBindingClass::Stairs => "stairs",
        CongestionBindingClass::Escalator => "escalator",
        CongestionBindingClass::Walkways => "walkways",
        CongestionBindingClass::None => "none",
    }
}

/// `nearestBuildableLobbySlot`: the nearest legal sky lobby slot without a
/// lobby that is strictly nearer than the current nearest lobby. A walk over
/// the every-15th slots, a handful.
pub(super) fn nearest_buildable_lobby_slot(tower: &Tower, floor: i64) -> Option<i64> {
    let current = tower.nearest_lobby_floor_distance(floor);
    let mut best: Option<i64> = None;
    let mut slot = LOBBY_INTERVAL;
    while slot <= MAX_FLOOR {
        if is_sky_lobby_floor(slot) && !tower.floor_has_lobby(slot) {
            let d = (floor - slot).abs();
            if d < current && best.is_none_or(|b| d < (floor - b).abs()) {
                best = Some(slot);
            }
        }
        slot += LOBBY_INTERVAL;
    }
    best
}

impl Simulation {
    /// The tenant sections, in card order.
    pub(super) fn tenant_facts(&mut self, u: &Unit, f: &mut DiagnosticFacts) {
        let k = u.kind;
        // `isFloorServed`, `reachesLobby` and `positionReachable` are each
        // read by more than one line; one answer serves them all (the first
        // copies the served set, and on a split floor the other two read
        // per-revision reach sets that a cache miss rebuilds).
        let mut served_floor: Option<bool> = None;
        let mut reaches: Option<bool> = None;
        let mut at_unit: Option<bool> = None;
        if has_access_diagnostic(self, k) {
            f.access = Some(if !self.floor_served_once(u, &mut served_floor) {
                "notConnected"
            } else if !self.reaches_once(u, &mut reaches) {
                "cutOff"
            } else if self.position_once(u, &mut at_unit) {
                "reachable"
            } else {
                "noRoute"
            });
        }
        if u.no_rate {
            f.no_rate = Some(if u.is_present() {
                "occupied"
            } else {
                "offMarket"
            });
        }
        f.far_walk = (k == Kind::Office || k == Kind::RentalApartment)
            && u.floor != 1
            && self.reaches_once(u, &mut reaches)
            && self.far_from_transport(u);
        if lobby_tenant(k) && self.reaches_once(u, &mut reaches) {
            f.lobby = self.lobby_facts(u);
        }
        if u.is_present()
            && u.state != UnitState::Vacating
            && u.satisfaction <= GRIPE_WARN
            && (k == Kind::Office
                || k == Kind::Condo
                || k.is_lease_amenity()
                || k.is_hotel()
                || k.is_rental())
        {
            let served = self.reaches_once(u, &mut reaches);
            f.gripe = self.main_gripe(u, served);
        }
        f.wont_lease = self.wont_lease(u, &mut served_floor, &mut reaches, &mut at_unit);
        if u.state == UnitState::Vacating {
            if let Some(reason) = u.vacate_reason {
                f.notice = Some(NoticeFacts {
                    reason,
                    minutes_left: (u.vacate_at.unwrap_or(0.0) - self.clock.minutes).max(0.0),
                    satisfaction: u.satisfaction,
                    keep_at: VACATE_RESCIND,
                });
            }
        }
    }

    fn reaches_once(&mut self, u: &Unit, cache: &mut Option<bool>) -> bool {
        if let Some(hit) = *cache {
            return hit;
        }
        let hit = self.reaches_lobby(u);
        *cache = Some(hit);
        hit
    }

    /// `tower.isFloorServed(u.floor)`, read once per call.
    fn floor_served_once(&self, u: &Unit, cache: &mut Option<bool>) -> bool {
        *cache.get_or_insert_with(|| self.tower.is_floor_served(u.floor))
    }

    fn position_once(&mut self, u: &Unit, cache: &mut Option<bool>) -> bool {
        if let Some(hit) = *cache {
            return hit;
        }
        let hit = self.position_reachable(u.floor, u.x);
        *cache = Some(hit);
        hit
    }

    /// The nearest stair, escalator or passenger elevator is past the walk
    /// tolerance; no transport at all counts as far.
    fn far_from_transport(&self, u: &Unit) -> bool {
        self.tower
            .nearest_transport_distance(u)
            .is_none_or(|d| d > TRANSPORT_FAR_TILES)
    }

    fn lobby_facts(&mut self, u: &Unit) -> Option<LobbyFacts> {
        let distance = self.tower.nearest_lobby_floor_distance(u.floor);
        let drain = self.mode.lobby_distance_drain(distance);
        if drain.cap >= 1.0 {
            return None;
        }
        let slot = match nearest_buildable_lobby_slot(&self.tower, u.floor) {
            None => None,
            Some(slot) => {
                let on_slot = slot == u.floor;
                let needs_support = slot > self.highest_floor() + 1;
                let clear_first = !on_slot && !needs_support && self.tower.floor_has_room(slot);
                Some(SlotFacts {
                    floor: slot,
                    on_slot,
                    needs_support,
                    clear_first,
                })
            }
        };
        Some(LobbyFacts {
            distance,
            sinking: drain.erosion > SERVED_RECOVERY,
            slot,
        })
    }

    /// The flags `dominantGripe` recomputes when its caller passes none, with
    /// congestion and the coverage supplied: served is the segment-aware
    /// answer, the far walk and noise the live predicates, lobby-far the
    /// drain cap at or under `GRIPE_WARN` for the demand tenants
    /// (`isDemandTenant`: offices, condos, hotel rooms and the rental
    /// Apartment), and unmet
    /// demand active on a cap or an erosion (the inspector's reading; the
    /// eviction path takes erosion only).
    fn gripe_flags(&mut self, u: &Unit, served: bool, cong: f64, cov: Option<f64>) -> StepResult {
        let lobby_far = served
            && lobby_tenant(u.kind)
            && self
                .mode
                .lobby_distance_drain(self.tower.nearest_lobby_floor_distance(u.floor))
                .cap
                <= GRIPE_WARN;
        let unmet_demand = unmet_active(self, cov);
        StepResult {
            next: u.satisfaction,
            served,
            cong,
            far_walk: self.far_from_transport(u),
            noisy: self.noise_afflicted(u),
            lobby_far,
            unmet_demand,
            unmet_cov: cov,
        }
    }

    /// "Main gripe": the dominant drain on an unhappy tenant, judged on the
    /// floor's live congestion and the hour's demand map.
    ///
    /// The coverage is read lazily, as `dominantGripe`'s `readCov` is: the
    /// TypeScript reads it only at a noise tier that fires (to see whether
    /// unmet demand's steeper erosion takes the tier, #548) and at the last
    /// tier, unmet demand itself, so the hour's demand memo fills at those
    /// reads and nowhere else. The first pass therefore runs with unmet demand
    /// off, and only a first answer of noise or nothing reads the coverage; an
    /// earlier cause stands, since no tier before noise reads it. Both the
    /// #548 override and the last tier need the drain active, so the ladder
    /// runs a second time only when the coverage turns unmet demand on;
    /// otherwise the second pass would repeat the first.
    ///
    /// The congestion maps are built once: the ratio here and, for a
    /// congestion cause, the binding class from the same pass.
    fn main_gripe(&mut self, u: &Unit, served: bool) -> Option<GripeFacts> {
        let att = if served && u.floor != 1 {
            Some(self.inspector_congestion_at(u.floor))
        } else {
            None
        };
        let cong = att.as_ref().map_or(0.0, |(c, _)| *c);
        let att = att.and_then(|(_, a)| a);
        let mut flags = self.gripe_flags(u, served, cong, None);
        let first = self.dominant_gripe(u, &flags);
        if !matches!(first, None | Some("noise")) || !(served && u.kind.is_unmet_demand_kind()) {
            return first.map(|cause| self.gripe_facts(u, cause, None, att.as_ref()));
        }
        let cov = self.inspector_coverage(u);
        if !unmet_active(self, cov) {
            return first.map(|cause| self.gripe_facts(u, cause, None, att.as_ref()));
        }
        flags.unmet_demand = true;
        flags.unmet_cov = cov;
        let cause = self.dominant_gripe(u, &flags)?;
        Some(self.gripe_facts(u, cause, cov, att.as_ref()))
    }

    /// The facts a cause's copy branches on (`gripeLineText`). `att` is the
    /// floor's congestion attribution when the caller built it; only a
    /// congestion cause reads it.
    pub(super) fn gripe_facts(
        &mut self,
        u: &Unit,
        cause: &'static str,
        cov: Option<f64>,
        att: Option<&CongestionAttribution>,
    ) -> GripeFacts {
        let mut g = GripeFacts {
            cause,
            binding: None,
            elevator_here: None,
            adjacent: None,
            club: None,
            coverage: None,
            floor_reachable: None,
        };
        match cause {
            "congestion" => {
                let binding = self.binding_class_from(att, u.floor);
                g.binding = Some(binding_name(binding));
                if matches!(
                    binding,
                    CongestionBindingClass::Stairs
                        | CongestionBindingClass::Escalator
                        | CongestionBindingClass::Walkways
                ) {
                    let (elevator, _stairs, _escalator) = self.serving_transport_kinds_at(u.floor);
                    g.elevator_here = Some(elevator);
                }
            }
            "noise" => {
                g.adjacent = Some(self.noise_afflicted(u));
                let halo =
                    matches!(u.kind, Kind::Condo | Kind::RentalApartment) || u.kind.is_hotel();
                g.club = Some(halo && self.near_nightclub(u.floor));
            }
            "unmetDemand" => {
                g.coverage = cov;
                if cov == Some(0.0) {
                    g.floor_reachable = Some(self.floor_reachable(u.floor));
                }
            }
            _ => {}
        }
        g
    }

    /// "Won't lease": an empty, on-market, reachable office, condo, lease
    /// amenity or rental the move-in gate holds vacant, the cause it was held
    /// for (congestion neutralized, coverage from the gate's own
    /// candidate-aware map) and what holding it costs.
    fn wont_lease(
        &mut self,
        u: &Unit,
        served_floor: &mut Option<bool>,
        reaches: &mut Option<bool>,
        at_unit: &mut Option<bool>,
    ) -> Option<WontLeaseFacts> {
        let k = u.kind;
        if !(k == Kind::Office || k == Kind::Condo || k.is_lease_amenity() || k.is_rental())
            || u.state != UnitState::Empty
            || u.no_rate
            || !self.floor_served_once(u, served_floor)
            || !self.position_once(u, at_unit)
        {
            return None;
        }
        let mut ctx = self.build_satisfaction_context(true);
        if !self.would_evict_fresh_tenant(u, &mut ctx) {
            return None;
        }
        let cov = if k.is_unmet_demand_kind() {
            ctx.demand_map.as_ref().and_then(|dm| unmet_coverage(dm, u))
        } else {
            None
        };
        let served = self.reaches_once(u, reaches);
        let flags = self.gripe_flags(u, served, 0.0, cov);
        let gripe = self
            .dominant_gripe(u, &flags)
            .map(|cause| self.gripe_facts(u, cause, cov, None));
        Some(WontLeaseFacts {
            gripe,
            carry: self.carrying_cost(u),
        })
    }

    /// `carryingCostNote`'s figure: the Modern operating overhead on any held
    /// unit plus an unsold condo's hold tax on its asking price. Classic has
    /// neither (both rates are 0), so the figure is 0 there. `rent_of` gives
    /// the asking price `unitPrice` reads (the unit's rent, else the kind's
    /// Modern default, 0 off the market). `unitPrice` reads the tower's
    /// catalog, whose defaults differ in Classic, but the price only meets a
    /// rate of 0 there, so the two agree in both modes.
    pub(super) fn carrying_cost(&self, u: &Unit) -> f64 {
        let hold_tax = if u.kind == Kind::Condo {
            (rent_of(u.kind, u.rent, u.no_rate) * self.mode.condo_hold_tax_rate()).ceil()
        } else {
            0.0
        };
        self.mode.operating_overhead_per_unit() + hold_tax
    }
}
