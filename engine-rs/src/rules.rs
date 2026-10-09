//! Port of `src/engine/ruleSets.ts`: the Classic and Modern rule values the
//! loop reads, as methods on the mode.

use crate::clock::GameMode;

#[derive(Clone, Copy, Debug)]
pub struct HousekeepingShift {
    pub start: i64,
    pub end: i64,
    pub cutoff: f64,
}

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
pub const FITNESS_HALO_FLOORS: f64 = 5.0;
pub const FITNESS_HALO_MAX: f64 = 0.03;
pub const NIGHTCLUB_NOISE_FLOORS: f64 = 4.0;
pub const NIGHTCLUB_NOISE_MAX: f64 = 0.08;
pub const SPA_SERENITY_FLOORS: f64 = 5.0;
pub const SPA_SERENITY_MAX: f64 = 0.03;
pub const DAYCARE_HALO_FLOORS: f64 = 4.0;
pub const DAYCARE_HALO_MAX: f64 = 0.035;
pub const DEMAND_PER_CAPITA: f64 = 30.0;
pub const DEMAND_FLOOR_MODERN: f64 = 0.25;
pub const CLASSIC_HOUSEHOLD: f64 = 3.0;
pub const HOUSEHOLD_CHURN_PER_PERSON: f64 = 0.06;
pub const CONDO_RELOCATION_CHANCE_MONTHLY: f64 = 0.015;
pub const HOTEL_DAYTIME_PRESENCE: f64 = 0.2;
pub const SKY_BAR_VIEW_BASE_FLOOR: f64 = 10.0;
pub const SKY_BAR_VIEW_PER_FLOOR: f64 = 0.02;
pub const SKY_BAR_VIEW_MAX: f64 = 1.0;

impl GameMode {
    pub fn is_modern(self) -> bool {
        self == GameMode::Modern
    }

    /// `bridgingToggleable()`: Modern can switch automatic bridging off;
    /// Classic always bridges.
    pub fn bridging_toggleable(self) -> bool {
        self == GameMode::Modern
    }

    pub fn walkway_willingness_applies(self) -> bool {
        self == GameMode::Classic
    }

    pub fn housekeeping_shift(self) -> HousekeepingShift {
        match self {
            GameMode::Classic => HousekeepingShift {
                start: 12,
                end: 17,
                cutoff: 16.5,
            },
            GameMode::Modern => HousekeepingShift {
                start: 8,
                end: 19,
                cutoff: 18.5,
            },
        }
    }

    /// `demographicRoutines()`: `(schoolRun, salesCall)`.
    pub fn demographic_routines(self) -> (f64, f64) {
        match self {
            GameMode::Classic => (0.0, 0.0),
            GameMode::Modern => (1.0, 0.35),
        }
    }

    pub fn rain_crowd_factor(self) -> f64 {
        match self {
            GameMode::Classic => 0.5,
            GameMode::Modern => 0.7,
        }
    }

    pub fn hotel_daytime_presence(self) -> f64 {
        match self {
            GameMode::Classic => 0.0,
            GameMode::Modern => HOTEL_DAYTIME_PRESENCE,
        }
    }

    pub fn noise_erosion_scale(self) -> f64 {
        match self {
            GameMode::Classic => 0.0,
            GameMode::Modern => 1.0,
        }
    }

    pub fn churn_multiplier(self, residents: Option<i64>) -> f64 {
        match (self, residents) {
            (GameMode::Modern, Some(r)) => {
                (1.0 + HOUSEHOLD_CHURN_PER_PERSON * (r as f64 - CLASSIC_HOUSEHOLD)).max(0.5)
            }
            _ => 1.0,
        }
    }

    pub fn condo_relocation_chance(self, residents: Option<i64>) -> f64 {
        match self {
            GameMode::Classic => 0.0,
            GameMode::Modern => {
                let size = residents.map(|r| r as f64).unwrap_or(CLASSIC_HOUSEHOLD);
                CONDO_RELOCATION_CHANCE_MONTHLY * (size / CLASSIC_HOUSEHOLD)
            }
        }
    }

    /// `demandModel()`: `(perCapita, floor)`.
    pub fn demand_model(self) -> (f64, f64) {
        match self {
            GameMode::Classic => (DEMAND_PER_CAPITA, 0.0),
            GameMode::Modern => (DEMAND_PER_CAPITA, DEMAND_FLOOR_MODERN),
        }
    }

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

    fn halo(self, d: f64, floors: f64, max: f64) -> f64 {
        if self == GameMode::Classic || d < 0.0 || d >= floors {
            return 0.0;
        }
        max * (1.0 - d / floors)
    }

    pub fn fitness_halo_bonus(self, d: f64) -> f64 {
        self.halo(d, FITNESS_HALO_FLOORS, FITNESS_HALO_MAX)
    }

    pub fn nightclub_noise_penalty(self, d: f64) -> f64 {
        self.halo(d, NIGHTCLUB_NOISE_FLOORS, NIGHTCLUB_NOISE_MAX)
    }

    pub fn spa_serenity_bonus(self, d: f64) -> f64 {
        self.halo(d, SPA_SERENITY_FLOORS, SPA_SERENITY_MAX)
    }

    pub fn daycare_family_bonus(self, d: f64, family_size: f64) -> f64 {
        if self == GameMode::Classic || !(0.0..DAYCARE_HALO_FLOORS).contains(&d) {
            return 0.0;
        }
        let family_factor = ((family_size - 1.0) / 4.0).clamp(0.0, 1.0);
        if family_factor == 0.0 {
            return 0.0;
        }
        DAYCARE_HALO_MAX * (1.0 - d / DAYCARE_HALO_FLOORS) * family_factor
    }

    pub fn view_premium(self, floor: i64) -> f64 {
        match self {
            GameMode::Classic => 1.0,
            GameMode::Modern => {
                let above = (floor as f64 - SKY_BAR_VIEW_BASE_FLOOR).max(0.0);
                1.0 + (above * SKY_BAR_VIEW_PER_FLOOR).min(SKY_BAR_VIEW_MAX)
            }
        }
    }
}
