//! What caps or wears down a tenant's rating: a far lobby, unmet demand,
//! noise and a recycling shortfall.

use crate::clock::GameMode;
use crate::satisfaction::shortfall::TRASH_SINK_MISSING_CAPACITY;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Drain {
    pub cap: f64,
    pub erosion: f64,
}
pub const NO_DRAIN: Drain = Drain {
    cap: 1.0,
    erosion: 0.0,
};
pub const LOBBY_FAR_FLOORS: i64 = 7; // floor(lobbyInterval / 2)
pub const LOBBY_VERY_FAR_FLOORS: i64 = 11;
pub const LOBBY_FAR_CAP: f64 = 0.7;
pub const LOBBY_VERY_FAR_CAP: f64 = 0.5;
pub const LOBBY_VERY_FAR_EROSION: f64 = 0.055;
pub const UNMET_DEMAND_FLOOR: f64 = 0.5;
pub const UNMET_DEMAND_CAP: f64 = 0.6;
pub const UNMET_DEMAND_EVICT_FLOOR: f64 = 0.35;
pub const UNMET_DEMAND_EROSION: f64 = 0.12;

#[doc(hidden)]
impl GameMode {
    pub fn lobby_distance_drain(self, d: i64) -> Drain {
        match self {
            GameMode::Classic => {
                if d > LOBBY_VERY_FAR_FLOORS {
                    Drain {
                        cap: LOBBY_VERY_FAR_CAP,
                        erosion: LOBBY_VERY_FAR_EROSION,
                    }
                } else if d > LOBBY_FAR_FLOORS {
                    Drain {
                        cap: LOBBY_FAR_CAP,
                        erosion: 0.0,
                    }
                } else {
                    NO_DRAIN
                }
            }
            GameMode::Modern => {
                if d <= LOBBY_FAR_FLOORS {
                    return NO_DRAIN;
                }
                let cap_span = (LOBBY_VERY_FAR_FLOORS + 2 - LOBBY_FAR_FLOORS) as f64;
                let cap_t = (((d - LOBBY_FAR_FLOORS) as f64) / cap_span).min(1.0);
                let cap = 1.0 - cap_t * (1.0 - LOBBY_VERY_FAR_CAP);
                let ero_t = (((d - LOBBY_VERY_FAR_FLOORS) as f64) / 2.0).clamp(0.0, 1.0);
                Drain {
                    cap,
                    erosion: ero_t * LOBBY_VERY_FAR_EROSION,
                }
            }
        }
    }

    pub fn unmet_demand_drain(self, coverage: f64) -> Drain {
        if coverage >= UNMET_DEMAND_FLOOR {
            return NO_DRAIN;
        }
        match self {
            GameMode::Classic => Drain {
                cap: UNMET_DEMAND_CAP,
                erosion: 0.0,
            },
            GameMode::Modern => {
                let cap_t = ((UNMET_DEMAND_FLOOR - coverage) / UNMET_DEMAND_FLOOR).min(1.0);
                let cap = 1.0 - cap_t * (1.0 - UNMET_DEMAND_CAP);
                let ero_t = ((UNMET_DEMAND_EVICT_FLOOR - coverage) / UNMET_DEMAND_EVICT_FLOOR)
                    .clamp(0.0, 1.0);
                Drain {
                    cap,
                    erosion: ero_t * UNMET_DEMAND_EROSION,
                }
            }
        }
    }

    /// Whether cinemas, party halls and other attendance venues count as
    /// amenities when a tenant's unmet-demand coverage is read (#705). Modern
    /// counts their seats so an entertainment-led tower does not shed tenants
    /// over a short shop row; Classic keeps the 1994 rule, which read commerce
    /// only (and never evicts on coverage).
    pub fn attendance_counts_toward_coverage(self) -> bool {
        matches!(self, GameMode::Modern)
    }

    pub fn noise_erosion_scale(self) -> f64 {
        match self {
            GameMode::Classic => 0.0,
            GameMode::Modern => 1.0,
        }
    }

    /// Whether a recycling shortfall `missing` people past capacity sinks
    /// ratings rather than holding them at Good: any shortfall in Classic,
    /// more than one center's worth in Modern.
    pub fn trash_shortfall_sinks(self, missing: f64) -> bool {
        match self {
            GameMode::Classic => missing > 0.0,
            GameMode::Modern => missing > TRASH_SINK_MISSING_CAPACITY,
        }
    }
}
