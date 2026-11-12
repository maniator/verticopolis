//! Modern's amenity halos: the fitness club, nightclub, spa, daycare,
//! aquatic center and party hall effects on nearby floors, and how far they
//! lift a capped room.

use super::households::{HOUSEHOLD_SIZES, MAX_HOUSEHOLD};
use crate::clock::GameMode;

pub const FITNESS_HALO_FLOORS: f64 = 5.0;
pub const FITNESS_HALO_MAX: f64 = 0.03;
pub const NIGHTCLUB_NOISE_FLOORS: f64 = 4.0;
/// The nightclub's hourly drain on its own floor while it is open
/// (`Kind::Nightclub.is_open_at`). It is felt only at night, so it is set
/// above recovery: a home on the club's floor dips to Good overnight and
/// refills by the afternoon, without the club alone ever bringing it to
/// notice.
pub const NIGHTCLUB_NOISE_MAX: f64 = 0.12;
pub const SPA_SERENITY_FLOORS: f64 = 5.0;
pub const SPA_SERENITY_MAX: f64 = 0.03;
pub const DAYCARE_HALO_FLOORS: f64 = 4.0;
pub const DAYCARE_HALO_MAX: f64 = 0.035;
/// The aquatic center's reach: the priciest amenity reaches furthest, and it
/// is the one both homes and hotel rooms feel.
pub const AQUATIC_HALO_FLOORS: f64 = 6.0;
pub const AQUATIC_HALO_MAX: f64 = 0.035;
/// The party hall's reach: a small lift for the cheapest venue, so it does not
/// outdo the aquatic center for a quarter of the price.
pub const PARTY_HALL_HALO_FLOORS: f64 = 3.0;
pub const PARTY_HALL_HALO_MAX: f64 = 0.02;
/// The share of the daycare's bonus the smallest household (two people)
/// feels; it rises in equal steps to the whole bonus for the largest one.
pub const DAYCARE_SMALLEST_FAMILY_SHARE: f64 = 0.4;
/// How far an amenity (any lift in `GameMode::halos`) at full strength
/// raises a room's ceiling when noise, a far lobby or unmet demand caps it
/// (Modern). It fades with distance exactly as the amenity's bonus does,
/// and a room takes the largest single lift around it, never a sum.
pub const AMENITY_CAP_LIFT_MAX: f64 = 0.15;

#[doc(hidden)]
impl GameMode {
    pub(super) fn halo(self, d: f64, floors: f64, max: f64) -> f64 {
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
        self.halo(d, DAYCARE_HALO_FLOORS, DAYCARE_HALO_MAX) * daycare_family_share(family_size)
    }

    /// How far an amenity whose bonus here is `bonus` (out of its full-strength
    /// `bonus_max`) raises a capped room's ceiling: the same fade, scaled to
    /// [`AMENITY_CAP_LIFT_MAX`]. Classic has no amenity halos, so no lift.
    pub fn amenity_cap_lift(self, bonus: f64, bonus_max: f64) -> f64 {
        if self == GameMode::Classic || bonus <= 0.0 {
            return 0.0;
        }
        AMENITY_CAP_LIFT_MAX * (bonus / bonus_max).min(1.0)
    }
}

/// The share of the daycare's bonus a household of `family_size` feels:
/// none without a family, [`DAYCARE_SMALLEST_FAMILY_SHARE`] for the
/// smallest, rising in equal steps to the whole bonus for the largest.
pub(super) fn daycare_family_share(family_size: f64) -> f64 {
    let smallest = HOUSEHOLD_SIZES[0] as f64;
    if family_size < smallest {
        return 0.0;
    }
    let growth = (family_size - smallest) / (MAX_HOUSEHOLD as f64 - smallest);
    DAYCARE_SMALLEST_FAMILY_SHARE + (1.0 - DAYCARE_SMALLEST_FAMILY_SHARE) * growth.min(1.0)
}
