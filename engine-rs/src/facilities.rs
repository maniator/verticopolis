//! What can be built: [`Kind`] names every floor tile, room and transport,
//! and the constants here give the lot's size.
//!
//! Prices, sizes, star requirements and build limits for a mode come from
//! [`crate::catalog::catalog`], which a frontend reads instead of keeping
//! tables of its own.

use crate::lot::Lot;

/// The lot's width in tiles. A tile column `x` runs from 0 to `LOT_WIDTH - 1`.
pub const LOT_WIDTH: i64 = 375;
/// The top floor of the standard lot ([`crate::lot`]), and the highest top
/// floor any lot has: grids sized for every tower read it.
pub const MAX_FLOOR: i64 = 100;
/// The lowest basement floor. Floor 1 is the ground floor and floor 0 the
/// first basement.
pub const MIN_FLOOR: i64 = -9;
/// Sky lobbies go every this many floors above the ground floor.
pub const LOBBY_INTERVAL: i64 = 15;
#[doc(hidden)]
/// The wedding hall stands on floor `MAX_FLOOR` and rises four stories above it,
/// the only facility that does. Grids that hold every story of every unit size
/// to this.
pub const WEDDING_HALL_TOP_FLOOR: i64 = MAX_FLOOR + 4;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
/// Everything a player can build.
///
/// [`Kind::as_str`] and [`Kind::parse`] convert to and from the names the
/// save, the catalog and the JavaScript binding use (`lobby`, `hotelSingle`,
/// `elevatorExpress`, ...).
pub enum Kind {
    /// Lobby. Floor 1 is all lobby; a lobby every fifteenth floor above it is a sky lobby.
    Lobby,
    /// Floor. An empty floor tile, which rooms stand on.
    Floor,
    /// Office.
    Office,
    /// Condominium.
    Condo,
    /// Single Room.
    HotelSingle,
    /// Double Room.
    HotelDouble,
    /// Suite.
    HotelSuite,
    /// Fast Food.
    FastFood,
    /// Restaurant.
    Restaurant,
    /// Food Hall. Modern only.
    FoodHall,
    /// Retail Shop.
    Shop,
    /// Cinema.
    Cinema,
    /// Party Hall.
    PartyHall,
    /// Amusements. Modern only.
    Amusements,
    /// Boutique Bay. Modern only.
    BoutiqueBay,
    /// Fitness Club. Modern only.
    FitnessClub,
    /// Clinic. Modern only.
    Clinic,
    /// Nightclub. Modern only.
    Nightclub,
    /// Spa. Modern only.
    Spa,
    /// Sky Bar. Modern only.
    SkyBar,
    /// Aquatic Center. Modern only.
    AquaticCenter,
    /// Daycare. Modern only.
    Daycare,
    /// Stairway. Spans two floors.
    Stairs,
    /// Escalator. Spans two floors.
    Escalator,
    /// Standard Elevator.
    ElevatorStandard,
    /// Service Elevator. Staff only.
    ElevatorService,
    /// Express Elevator. Stops only at lobbies and the floors it is set to serve, and spans the whole tower.
    ElevatorExpress,
    /// Parking Ramp.
    ParkingRamp,
    /// Parking Space.
    Parking,
    /// Security.
    Security,
    /// Medical Center.
    Medical,
    /// Housekeeping.
    Housekeeping,
    /// Recycling Center.
    Recycling,
    /// Metro Station.
    Metro,
    /// Wedding Hall. Stands on the top floor.
    WeddingHall,
    /// Studio. A rental home. Modern only.
    RentalStudio,
    /// Apartment. A rental home. Modern only.
    RentalApartment,
}

#[doc(hidden)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Category {
    Structure,
    Transport,
    Office,
    Residential,
    Hotel,
    Food,
    Retail,
    Entertainment,
    Service,
    Special,
}

#[doc(hidden)]
#[derive(Clone, Copy, Debug)]
pub struct Facility {
    pub kind: Kind,
    pub key: &'static str,
    pub category: Category,
    pub name: &'static str,
    pub width: i64,
    pub floors: Option<i64>,
    pub cost: f64,
    pub min_star: i64,
    pub population: i64,
    pub attendance: Option<i64>,
    pub modern_only: bool,
    pub transport: bool,
    pub staff_only: bool,
    pub basement: bool,
}

impl Facility {
    #[doc(hidden)]
    /// Whether a tower of `mode` builds this kind at all, the star gate
    /// aside: a Modern-only kind is built only where the mode's rule
    /// (`GameMode::builds_modern_only_kinds`) allows it. The build gate
    /// (`is_unlocked`) and the catalog's `available` both read it.
    pub fn available_in(&self, mode: crate::clock::GameMode) -> bool {
        !self.modern_only || mode.builds_modern_only_kinds()
    }
}

mod predicates;
mod table;
#[doc(hidden)]
pub use table::FACILITIES;

impl Kind {
    #[doc(hidden)]
    /// The catalog row. `FACILITIES` is laid out in `Kind` order, which the
    /// `catalog_order` test pins, so the lookup is an index.
    pub fn facility(self) -> &'static Facility {
        &FACILITIES[self as usize]
    }

    /// The kind's name in saves and the catalog, such as `fastFood`.
    pub fn as_str(self) -> &'static str {
        self.facility().key
    }

    /// The kind with this name, as [`as_str`](Kind::as_str) writes it.
    ///
    /// ```
    /// use verticopolis_engine::facilities::Kind;
    ///
    /// assert_eq!(Kind::parse("hotelSuite"), Some(Kind::HotelSuite));
    /// assert_eq!(Kind::HotelSuite.as_str(), "hotelSuite");
    /// ```
    pub fn parse(s: &str) -> Option<Kind> {
        FACILITIES.iter().find(|f| f.key == s).map(|f| f.kind)
    }

    /// A floor or lobby tile.
    pub fn is_structural(self) -> bool {
        matches!(self, Kind::Floor | Kind::Lobby)
    }

    /// An elevator, stairs or an escalator.
    pub fn is_transport(self) -> bool {
        self.facility().transport
    }

    /// One of the three elevator kinds.
    pub fn is_elevator(self) -> bool {
        matches!(
            self,
            Kind::ElevatorStandard | Kind::ElevatorService | Kind::ElevatorExpress
        )
    }

    #[doc(hidden)]
    pub fn is_hotel(self) -> bool {
        matches!(
            self,
            Kind::HotelSingle | Kind::HotelDouble | Kind::HotelSuite
        )
    }

    #[doc(hidden)]
    pub fn is_rental(self) -> bool {
        matches!(self, Kind::RentalStudio | Kind::RentalApartment)
    }

    /// Anything that is neither a floor tile nor a transport.
    pub fn is_room(self) -> bool {
        !self.is_structural() && !self.is_transport()
    }

    #[doc(hidden)]
    /// `facilityFloors`.
    pub fn floors(self) -> i64 {
        self.facility().floors.unwrap_or(1)
    }

    #[doc(hidden)]
    /// The highest story a unit of this kind may occupy on the standard lot:
    /// `MAX_FLOOR`, except the wedding hall, which stands on floor
    /// `MAX_FLOOR` and rises above it. A tower asks its own lot.
    pub fn highest_story(self) -> i64 {
        Lot::STANDARD.highest_story(self)
    }

    #[doc(hidden)]
    /// The highest floor a unit of this kind may stand on (its bottom story),
    /// on the standard lot.
    pub fn highest_base_floor(self) -> i64 {
        Lot::STANDARD.highest_base_floor(self)
    }

    #[doc(hidden)]
    /// `maxSpanFor`, on the standard lot.
    pub fn max_span(self) -> i64 {
        Lot::STANDARD.max_span(self)
    }

    #[doc(hidden)]
    pub fn is_fixed_span(self) -> bool {
        self.is_transport() && self.max_span() == 1
    }

    #[doc(hidden)]
    pub fn max_cars(self) -> i64 {
        8
    }

    #[doc(hidden)]
    /// `buildMinutes`.
    pub fn build_minutes(self) -> f64 {
        if self.is_structural() {
            return 0.0;
        }
        let f = self.facility();
        (8.0_f64 * 60.0).min(crate::jsmath::round(
            60.0 + f.width as f64 * 8.0 + f.cost / 5000.0,
        ))
    }

    #[doc(hidden)]
    /// `resaleRefund`.
    pub fn resale_refund(self) -> f64 {
        (self.facility().cost * 0.5).floor()
    }

    #[doc(hidden)]
    /// `subtypeListFor`.
    pub fn subtype_list(self) -> Option<&'static [&'static str]> {
        Some(match self {
            Kind::Restaurant => &[
                "English Pub",
                "French",
                "Chinese",
                "Sushi Bar",
                "Steak House",
            ],
            Kind::FastFood => &[
                "Japanese Soba",
                "Chinese Cafe",
                "Hamburger Stand",
                "Ice Cream",
                "Coffee Shop",
            ],
            Kind::Shop => &[
                "Men's Clothing",
                "Pet Store",
                "Flower Shop",
                "Book Store",
                "Drug Store",
                "Boutique",
                "Electronics",
                "Bank",
                "Hair Salon",
                "Post Office",
                "Sports Gear",
            ],
            Kind::FoodHall => &[
                "Ramen Bar",
                "Taco Stand",
                "Bubble Tea",
                "Poke Bowl",
                "Deli Counter",
                "Coffee Cart",
            ],
            Kind::Amusements => &["Classic Arcade", "VR Lounge", "Claw Parlor", "Mini Golf"],
            Kind::BoutiqueBay => &[
                "Florist",
                "Barber",
                "Phone Repair",
                "Vintage",
                "Tattoo",
                "Record Store",
                "Gallery",
            ],
            Kind::FitnessClub => &[
                "Weight Floor",
                "Yoga Studio",
                "Spin Studio",
                "Boxing Gym",
                "Climbing Wall",
            ],
            Kind::Clinic => &["Dental", "Urgent Care", "Optometry", "Pharmacy", "Physio"],
            _ => return None,
        })
    }
}

impl Category {
    #[doc(hidden)]
    /// The category as the TypeScript engine spells it.
    pub fn as_str(self) -> &'static str {
        match self {
            Category::Structure => "structure",
            Category::Transport => "transport",
            Category::Office => "office",
            Category::Residential => "residential",
            Category::Hotel => "hotel",
            Category::Food => "food",
            Category::Retail => "retail",
            Category::Entertainment => "entertainment",
            Category::Service => "service",
            Category::Special => "special",
        }
    }
}

#[doc(hidden)]
/// `BUILD_CAPS`.
pub fn build_cap(kind: Kind) -> Option<i64> {
    match kind {
        Kind::Metro => Some(1),
        Kind::WeddingHall => Some(1),
        Kind::Security => Some(10),
        Kind::Medical => Some(10),
        Kind::Cinema => Some(16),
        Kind::PartyHall => Some(16),
        Kind::AquaticCenter => Some(8),
        _ => None,
    }
}

#[doc(hidden)]
pub struct Pool {
    pub kinds: &'static [Kind],
    pub cap: i64,
    pub label: &'static str,
}

#[doc(hidden)]
/// `POOLED_CAPS`.
pub static POOLED_CAPS: [Pool; 2] = [
    Pool {
        kinds: &[
            Kind::ElevatorStandard,
            Kind::ElevatorService,
            Kind::ElevatorExpress,
        ],
        cap: 24,
        label: "elevator shafts",
    },
    Pool {
        kinds: &[Kind::Stairs, Kind::Escalator],
        cap: 64,
        label: "stairs/escalators",
    },
];

/// Classic's party hall and theater pool (#1932): the 1994 save keeps one
/// table of 16 records shared by every party hall and theater, so the two
/// kinds share one cap of 16. Modern keeps a cap of 16 for each.
pub static CLASSIC_VENUE_POOL: Pool = Pool {
    kinds: &[Kind::Cinema, Kind::PartyHall],
    cap: 16,
    label: "party halls and theaters",
};

/// Every pooled cap `mode` enforces: the transport pools, then Classic's
/// venue pool.
pub fn pools_for(mode: crate::clock::GameMode) -> impl Iterator<Item = &'static Pool> {
    let venues = mode.shares_venue_cap().then_some(&CLASSIC_VENUE_POOL);
    POOLED_CAPS.iter().chain(venues)
}

#[doc(hidden)]
pub fn is_lobby_floor(floor: i64) -> bool {
    floor == 1 || (floor > 1 && floor % LOBBY_INTERVAL == 0)
}

#[doc(hidden)]
pub fn is_sky_lobby_floor(floor: i64) -> bool {
    floor >= 2 && floor % LOBBY_INTERVAL == 0
}

#[doc(hidden)]
pub fn ground_floor_structure_kind(kind: Kind, floor: i64) -> Kind {
    if kind == Kind::Floor && floor == 1 {
        Kind::Lobby
    } else {
        kind
    }
}

#[doc(hidden)]
/// `NO_BASEMENT_KINDS`.
pub fn no_basement(kind: Kind) -> bool {
    matches!(
        kind,
        Kind::Office
            | Kind::Condo
            | Kind::HotelSingle
            | Kind::HotelDouble
            | Kind::HotelSuite
            | Kind::Housekeeping
    )
}

#[doc(hidden)]
pub fn covers_ground_floor(floor: i64, hgt: i64) -> bool {
    floor <= 1 && floor + hgt > 1
}

#[doc(hidden)]
pub const NEEDS_FLOORS: &str = "Transport must run through built floors. Lay floors first.";
#[doc(hidden)]
pub const SHAFT_OVERLAP: &str = "Transport shafts cannot overlap.";

#[cfg(test)]
mod tests;
