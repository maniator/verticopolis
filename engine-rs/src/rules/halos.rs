//! The Modern venues' cross-floor halos as one table: which venue reaches
//! which rooms, over how many floors and how hard. The hourly satisfaction
//! step applies them (`Simulation::satisfaction_step`, which a rule test
//! holds to this table), the catalog publishes them for the placement range
//! rings, and the inspector names the amenity helping a room. Classic has none.

use super::amenities::daycare_family_share;
use super::{
    AMENITY_CAP_LIFT_MAX, AQUATIC_HALO_FLOORS, AQUATIC_HALO_MAX, DAYCARE_HALO_FLOORS,
    DAYCARE_HALO_MAX, FITNESS_HALO_FLOORS, FITNESS_HALO_MAX, NIGHTCLUB_NOISE_FLOORS,
    NIGHTCLUB_NOISE_MAX, PARTY_HALL_HALO_FLOORS, PARTY_HALL_HALO_MAX, SPA_SERENITY_FLOORS,
    SPA_SERENITY_MAX,
};
use crate::clock::GameMode;
use crate::facilities::Kind;

/// Whether a halo raises the rooms it reaches or drains them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HaloEffect {
    /// An amenity: an hourly bonus, and a lift to the ceiling a capped room
    /// is held to.
    Lift,
    /// A nuisance: an hourly drain.
    Drain,
}

impl HaloEffect {
    pub fn as_str(self) -> &'static str {
        match self {
            HaloEffect::Lift => "lift",
            HaloEffect::Drain => "drain",
        }
    }
}

/// One venue's halo.
#[derive(Clone, Copy, Debug)]
pub struct Halo {
    /// The venue that casts it.
    pub source: Kind,
    pub effect: HaloEffect,
    /// How far it reaches: a room `d` floors from the venue's nearest story
    /// feels `max * (1 - d / floors)`, and none at `floors` or beyond.
    pub floors: f64,
    /// The hourly bonus or drain on the venue's own floor.
    pub max: f64,
    /// Felt only while the venue is open (the nightclub).
    pub open_hours_only: bool,
    /// Scaled by the household's size, largest for the biggest family (the
    /// daycare).
    pub family_scaled: bool,
    felt_by: fn(Kind) -> bool,
}

impl Halo {
    /// Whether a room of `kind` feels this halo.
    pub fn felt_by(&self, kind: Kind) -> bool {
        (self.felt_by)(kind)
    }

    /// Whether the halo is felt in `hour`: always, or only while the venue
    /// is open for one that follows its open hours.
    pub fn is_felt_at(&self, hour: i64) -> bool {
        !self.open_hours_only || self.source.is_open_at(hour)
    }

    /// How many floors a room on `floor` is from a venue whose lowest story
    /// is `venue_floor`: from its nearer story, so 0 on any story it fills.
    pub fn distance(&self, venue_floor: i64, floor: i64) -> i64 {
        let top = venue_floor + self.source.floors() - 1;
        (venue_floor - floor).max(floor - top).max(0)
    }

    /// How far a lift raises a capped room's ceiling at full strength, or
    /// None for a drain.
    pub fn cap_lift_max(&self) -> Option<f64> {
        (self.effect == HaloEffect::Lift).then_some(AMENITY_CAP_LIFT_MAX)
    }
}

fn is_home(kind: Kind) -> bool {
    kind == Kind::Condo || kind == Kind::RentalApartment
}

fn is_home_or_hotel(kind: Kind) -> bool {
    is_home(kind) || kind.is_hotel()
}

/// A `static`, so every lookup hands out the same entries. The hourly step
/// applies the rows in this order, each clamped to 0 and 1 as it lands.
static MODERN_HALOS: [Halo; 6] = [
    Halo {
        source: Kind::FitnessClub,
        effect: HaloEffect::Lift,
        floors: FITNESS_HALO_FLOORS,
        max: FITNESS_HALO_MAX,
        open_hours_only: false,
        family_scaled: false,
        felt_by: is_home,
    },
    Halo {
        source: Kind::Nightclub,
        effect: HaloEffect::Drain,
        floors: NIGHTCLUB_NOISE_FLOORS,
        max: NIGHTCLUB_NOISE_MAX,
        open_hours_only: true,
        family_scaled: false,
        felt_by: is_home_or_hotel,
    },
    Halo {
        source: Kind::Spa,
        effect: HaloEffect::Lift,
        floors: SPA_SERENITY_FLOORS,
        max: SPA_SERENITY_MAX,
        open_hours_only: false,
        family_scaled: false,
        felt_by: Kind::is_hotel,
    },
    Halo {
        source: Kind::Daycare,
        effect: HaloEffect::Lift,
        floors: DAYCARE_HALO_FLOORS,
        max: DAYCARE_HALO_MAX,
        open_hours_only: false,
        family_scaled: true,
        felt_by: is_home,
    },
    Halo {
        source: Kind::AquaticCenter,
        effect: HaloEffect::Lift,
        floors: AQUATIC_HALO_FLOORS,
        max: AQUATIC_HALO_MAX,
        open_hours_only: false,
        family_scaled: false,
        felt_by: is_home_or_hotel,
    },
    Halo {
        source: Kind::PartyHall,
        effect: HaloEffect::Lift,
        floors: PARTY_HALL_HALO_FLOORS,
        max: PARTY_HALL_HALO_MAX,
        open_hours_only: false,
        family_scaled: false,
        felt_by: is_home_or_hotel,
    },
];

impl GameMode {
    /// Every venue halo in this mode: the six Modern ones, none in Classic.
    pub fn halos(self) -> &'static [Halo] {
        match self {
            GameMode::Modern => &MODERN_HALOS,
            GameMode::Classic => &[],
        }
    }

    /// The halo a venue of `kind` casts in this mode, if any.
    pub fn halo_of(self, kind: Kind) -> Option<&'static Halo> {
        self.halos().iter().find(|h| h.source == kind)
    }

    /// The hourly bonus or drain `halo` gives a room `d` floors from its
    /// venue whose household is `family_size` (read only by a family-scaled
    /// halo): the same values the hourly step applies, faded over the
    /// halo's own `floors` from its own `max`.
    pub fn halo_strength(self, halo: &Halo, d: f64, family_size: f64) -> f64 {
        let strength = self.halo(d, halo.floors, halo.max);
        if halo.family_scaled {
            strength * daycare_family_share(family_size)
        } else {
            strength
        }
    }
}
