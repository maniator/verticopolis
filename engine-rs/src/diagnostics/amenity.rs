//! The amenity helping a room (#1980): of the lifts whose halo reaches it
//! (`GameMode::halos`), the one that raises its ceiling most, and by how much.

use serde::Serialize;

use crate::rules::HaloEffect;
use crate::satisfaction::casts_halo;
use crate::sim::Simulation;
use crate::tower::Unit;

/// The amenity line's facts.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AmenityFacts {
    /// The venue's kind key.
    pub kind: &'static str,
    /// How far it raises the ceiling a capped room is held to (up to
    /// `AMENITY_CAP_LIFT_MAX`): the same lift the hourly step gives.
    pub lift: f64,
}

impl Simulation {
    /// The amenity whose halo lifts `u` most, or `None` in Classic, for a
    /// room no amenity reaches, for one cut off from the lobby (the step
    /// gives an unserved room no halo), and for one that is not operating
    /// (under construction, on fire or gutted). A tie goes to the earlier
    /// halo.
    pub(super) fn amenity_facts(&mut self, u: &Unit) -> Option<AmenityFacts> {
        let mode = self.mode;
        let felt = |h: &&crate::rules::Halo| h.effect == HaloEffect::Lift && h.felt_by(u.kind);
        if !u.is_operational() || !mode.halos().iter().any(|h| felt(&h)) || !self.reaches_lobby(u) {
            return None;
        }
        let family = u.residents.unwrap_or(0) as f64;
        let mut best: Option<AmenityFacts> = None;
        for h in mode.halos().iter().filter(felt) {
            let nearest = self
                .tower
                .room_units()
                .filter(|c| c.kind == h.source && casts_halo(c))
                .filter(|c| self.tower.is_floor_served(c.floor))
                .map(|c| h.distance(c.floor, u.floor))
                .min();
            let Some(d) = nearest else { continue };
            let bonus = mode.halo_strength(h, d as f64, family);
            let lift = mode.amenity_cap_lift(bonus, h.max);
            if lift > 0.0 && best.as_ref().is_none_or(|b| lift > b.lift) {
                best = Some(AmenityFacts {
                    kind: h.source.as_str(),
                    lift,
                });
            }
        }
        best
    }
}
