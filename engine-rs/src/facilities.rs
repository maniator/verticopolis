//! Port of `src/engine/facilitiesData.ts`, `residentialRentals.ts`,
//! `facilityCaps.ts`, `facilityPredicates.ts` and `tower/towerTopology.ts`.

pub const LOT_WIDTH: i64 = 375;
pub const MAX_FLOOR: i64 = 100;
pub const MIN_FLOOR: i64 = -9;
pub const LOBBY_INTERVAL: i64 = 15;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Kind {
    Lobby,
    Floor,
    Office,
    Condo,
    HotelSingle,
    HotelDouble,
    HotelSuite,
    FastFood,
    Restaurant,
    FoodHall,
    Shop,
    Cinema,
    PartyHall,
    Amusements,
    BoutiqueBay,
    FitnessClub,
    Clinic,
    Nightclub,
    Spa,
    SkyBar,
    AquaticCenter,
    Daycare,
    Stairs,
    Escalator,
    ElevatorStandard,
    ElevatorService,
    ElevatorExpress,
    ParkingRamp,
    Parking,
    Security,
    Medical,
    Housekeeping,
    Recycling,
    Metro,
    WeddingHall,
    RentalStudio,
    RentalApartment,
}

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

macro_rules! fac {
    ($kind:ident, $key:literal, $cat:ident, $name:literal, $w:literal, $floors:expr, $cost:literal, $star:literal, $pop:literal, $att:expr, mo=$mo:literal, t=$t:literal, so=$so:literal, b=$b:literal) => {
        Facility {
            kind: Kind::$kind,
            key: $key,
            category: Category::$cat,
            name: $name,
            width: $w,
            floors: $floors,
            cost: $cost as f64,
            min_star: $star,
            population: $pop,
            attendance: $att,
            modern_only: $mo,
            transport: $t,
            staff_only: $so,
            basement: $b,
        }
    };
}

/// The catalog in `FACILITIES` key order (rentals last).
pub static FACILITIES: [Facility; 37] = [
    fac!(
        Lobby,
        "lobby",
        Structure,
        "Lobby",
        1,
        None,
        5000,
        1,
        0,
        None,
        mo = false,
        t = false,
        so = false,
        b = false
    ),
    fac!(
        Floor,
        "floor",
        Structure,
        "Floor",
        1,
        None,
        500,
        1,
        0,
        None,
        mo = false,
        t = false,
        so = false,
        b = false
    ),
    fac!(
        Office,
        "office",
        Office,
        "Office",
        9,
        None,
        40000,
        1,
        6,
        None,
        mo = false,
        t = false,
        so = false,
        b = false
    ),
    fac!(
        Condo,
        "condo",
        Residential,
        "Condominium",
        16,
        None,
        80000,
        1,
        3,
        None,
        mo = false,
        t = false,
        so = false,
        b = false
    ),
    fac!(
        HotelSingle,
        "hotelSingle",
        Hotel,
        "Single Room",
        4,
        None,
        20000,
        2,
        1,
        None,
        mo = false,
        t = false,
        so = false,
        b = false
    ),
    fac!(
        HotelDouble,
        "hotelDouble",
        Hotel,
        "Double Room",
        6,
        None,
        50000,
        3,
        2,
        None,
        mo = false,
        t = false,
        so = false,
        b = false
    ),
    fac!(
        HotelSuite,
        "hotelSuite",
        Hotel,
        "Suite",
        10,
        None,
        100000,
        3,
        3,
        None,
        mo = false,
        t = false,
        so = false,
        b = false
    ),
    fac!(
        FastFood,
        "fastFood",
        Food,
        "Fast Food",
        16,
        None,
        100000,
        1,
        25,
        None,
        mo = false,
        t = false,
        so = false,
        b = false
    ),
    fac!(
        Restaurant,
        "restaurant",
        Food,
        "Restaurant",
        24,
        None,
        200000,
        3,
        35,
        None,
        mo = false,
        t = false,
        so = false,
        b = false
    ),
    fac!(
        FoodHall,
        "foodHall",
        Food,
        "Food Hall",
        24,
        None,
        250000,
        3,
        40,
        None,
        mo = true,
        t = false,
        so = false,
        b = false
    ),
    fac!(
        Shop,
        "shop",
        Retail,
        "Retail Shop",
        12,
        None,
        100000,
        3,
        20,
        None,
        mo = false,
        t = false,
        so = false,
        b = false
    ),
    fac!(
        Cinema,
        "cinema",
        Entertainment,
        "Cinema",
        31,
        Some(2),
        500000,
        3,
        0,
        Some(30),
        mo = false,
        t = false,
        so = false,
        b = false
    ),
    fac!(
        PartyHall,
        "partyHall",
        Entertainment,
        "Party Hall",
        24,
        Some(2),
        100000,
        3,
        0,
        Some(20),
        mo = false,
        t = false,
        so = false,
        b = false
    ),
    fac!(
        Amusements,
        "amusements",
        Entertainment,
        "Amusements",
        12,
        None,
        180000,
        3,
        25,
        None,
        mo = true,
        t = false,
        so = false,
        b = false
    ),
    fac!(
        BoutiqueBay,
        "boutiqueBay",
        Retail,
        "Boutique Bay",
        12,
        None,
        150000,
        3,
        22,
        None,
        mo = true,
        t = false,
        so = false,
        b = false
    ),
    fac!(
        FitnessClub,
        "fitnessClub",
        Entertainment,
        "Fitness Club",
        16,
        None,
        220000,
        3,
        20,
        None,
        mo = true,
        t = false,
        so = false,
        b = false
    ),
    fac!(
        Clinic,
        "clinic",
        Retail,
        "Clinic",
        8,
        None,
        120000,
        3,
        12,
        None,
        mo = true,
        t = false,
        so = false,
        b = false
    ),
    fac!(
        Nightclub,
        "nightclub",
        Entertainment,
        "Nightclub",
        20,
        None,
        350000,
        3,
        30,
        None,
        mo = true,
        t = false,
        so = false,
        b = false
    ),
    fac!(
        Spa,
        "spa",
        Entertainment,
        "Spa",
        14,
        None,
        200000,
        3,
        18,
        None,
        mo = true,
        t = false,
        so = false,
        b = false
    ),
    fac!(
        SkyBar,
        "skyBar",
        Entertainment,
        "Sky Bar",
        12,
        None,
        260000,
        3,
        22,
        None,
        mo = true,
        t = false,
        so = false,
        b = false
    ),
    fac!(
        AquaticCenter,
        "aquaticCenter",
        Entertainment,
        "Aquatic Center",
        28,
        Some(2),
        450000,
        3,
        0,
        Some(24),
        mo = true,
        t = false,
        so = false,
        b = false
    ),
    fac!(
        Daycare,
        "daycare",
        Retail,
        "Daycare",
        12,
        None,
        160000,
        3,
        14,
        None,
        mo = true,
        t = false,
        so = false,
        b = false
    ),
    fac!(
        Stairs,
        "stairs",
        Transport,
        "Stairway",
        8,
        None,
        5000,
        1,
        0,
        None,
        mo = false,
        t = true,
        so = false,
        b = false
    ),
    fac!(
        Escalator,
        "escalator",
        Transport,
        "Escalator",
        8,
        None,
        20000,
        3,
        0,
        None,
        mo = false,
        t = true,
        so = false,
        b = false
    ),
    fac!(
        ElevatorStandard,
        "elevatorStandard",
        Transport,
        "Standard Elevator",
        4,
        None,
        200000,
        1,
        0,
        None,
        mo = false,
        t = true,
        so = false,
        b = false
    ),
    fac!(
        ElevatorService,
        "elevatorService",
        Transport,
        "Service Elevator",
        4,
        None,
        100000,
        2,
        0,
        None,
        mo = false,
        t = true,
        so = true,
        b = false
    ),
    fac!(
        ElevatorExpress,
        "elevatorExpress",
        Transport,
        "Express Elevator",
        6,
        None,
        400000,
        3,
        0,
        None,
        mo = false,
        t = true,
        so = false,
        b = false
    ),
    fac!(
        ParkingRamp,
        "parkingRamp",
        Service,
        "Parking Ramp",
        16,
        None,
        50000,
        3,
        0,
        None,
        mo = false,
        t = false,
        so = false,
        b = true
    ),
    fac!(
        Parking,
        "parking",
        Service,
        "Parking Space",
        4,
        None,
        3000,
        3,
        0,
        None,
        mo = false,
        t = false,
        so = false,
        b = true
    ),
    fac!(
        Security,
        "security",
        Service,
        "Security",
        8,
        None,
        100000,
        2,
        0,
        None,
        mo = false,
        t = false,
        so = false,
        b = false
    ),
    fac!(
        Medical,
        "medical",
        Service,
        "Medical Center",
        16,
        None,
        500000,
        3,
        0,
        None,
        mo = false,
        t = false,
        so = false,
        b = false
    ),
    fac!(
        Housekeeping,
        "housekeeping",
        Service,
        "Housekeeping",
        8,
        None,
        50000,
        2,
        0,
        None,
        mo = false,
        t = false,
        so = false,
        b = false
    ),
    fac!(
        Recycling,
        "recycling",
        Service,
        "Recycling Center",
        20,
        Some(2),
        500000,
        3,
        0,
        None,
        mo = false,
        t = false,
        so = false,
        b = true
    ),
    fac!(
        Metro,
        "metro",
        Special,
        "Metro Station",
        375,
        Some(3),
        1000000,
        4,
        0,
        None,
        mo = false,
        t = false,
        so = false,
        b = true
    ),
    fac!(
        WeddingHall,
        "weddingHall",
        Special,
        "Wedding Hall",
        16,
        None,
        3000000,
        5,
        0,
        Some(12),
        mo = false,
        t = false,
        so = false,
        b = false
    ),
    fac!(
        RentalStudio,
        "rentalStudio",
        Residential,
        "Studio",
        6,
        None,
        22000,
        2,
        1,
        None,
        mo = true,
        t = false,
        so = false,
        b = false
    ),
    fac!(
        RentalApartment,
        "rentalApartment",
        Residential,
        "Apartment",
        11,
        None,
        60000,
        3,
        2,
        None,
        mo = true,
        t = false,
        so = false,
        b = false
    ),
];

impl Kind {
    /// The catalog row. `FACILITIES` is laid out in `Kind` order, which the
    /// `catalog_order` test pins, so the lookup is an index.
    pub fn facility(self) -> &'static Facility {
        &FACILITIES[self as usize]
    }

    pub fn as_str(self) -> &'static str {
        self.facility().key
    }

    pub fn parse(s: &str) -> Option<Kind> {
        FACILITIES.iter().find(|f| f.key == s).map(|f| f.kind)
    }

    pub fn is_structural(self) -> bool {
        matches!(self, Kind::Floor | Kind::Lobby)
    }

    pub fn is_transport(self) -> bool {
        self.facility().transport
    }

    pub fn is_elevator(self) -> bool {
        matches!(
            self,
            Kind::ElevatorStandard | Kind::ElevatorService | Kind::ElevatorExpress
        )
    }

    pub fn is_hotel(self) -> bool {
        matches!(
            self,
            Kind::HotelSingle | Kind::HotelDouble | Kind::HotelSuite
        )
    }

    pub fn is_rental(self) -> bool {
        matches!(self, Kind::RentalStudio | Kind::RentalApartment)
    }

    pub fn is_room(self) -> bool {
        !self.is_structural() && !self.is_transport()
    }

    /// `facilityFloors`.
    pub fn floors(self) -> i64 {
        self.facility().floors.unwrap_or(1)
    }

    /// `maxSpanFor`.
    pub fn max_span(self) -> i64 {
        match self {
            Kind::Stairs | Kind::Escalator => 1,
            Kind::ElevatorExpress => MAX_FLOOR - MIN_FLOOR,
            _ => 30,
        }
    }

    pub fn is_fixed_span(self) -> bool {
        self.is_transport() && self.max_span() == 1
    }

    pub fn max_cars(self) -> i64 {
        8
    }

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

    /// `resaleRefund`.
    pub fn resale_refund(self) -> f64 {
        (self.facility().cost * 0.5).floor()
    }

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

pub struct Pool {
    pub kinds: &'static [Kind],
    pub cap: i64,
    pub label: &'static str,
}

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

pub fn is_lobby_floor(floor: i64) -> bool {
    floor == 1 || (floor > 1 && floor % LOBBY_INTERVAL == 0)
}

pub fn is_sky_lobby_floor(floor: i64) -> bool {
    floor >= 2 && floor % LOBBY_INTERVAL == 0
}

pub fn ground_floor_structure_kind(kind: Kind, floor: i64) -> Kind {
    if kind == Kind::Floor && floor == 1 {
        Kind::Lobby
    } else {
        kind
    }
}

/// `NO_BASEMENT_KINDS`.
pub fn no_basement(kind: Kind) -> bool {
    matches!(
        kind,
        Kind::Office | Kind::Condo | Kind::HotelSingle | Kind::HotelDouble | Kind::HotelSuite
    )
}

pub fn covers_ground_floor(floor: i64, hgt: i64) -> bool {
    floor <= 1 && floor + hgt > 1
}

pub const NEEDS_FLOORS: &str = "Transport must run through built floors. Lay floors first.";
pub const SHAFT_OVERLAP: &str = "Transport shafts cannot overlap.";

// ---- predicates from facilityPredicates.ts / facilityCaps.ts -------------

impl Kind {
    /// `transportCarCapacity`.
    pub fn car_capacity(self) -> f64 {
        match self {
            Kind::ElevatorStandard => 21.0,
            Kind::ElevatorService => 10.0,
            Kind::ElevatorExpress => 42.0,
            Kind::Escalator => 30.0,
            Kind::Stairs => 8.0,
            _ => 0.0,
        }
    }

    /// `isStaffOnlyTransport`.
    pub fn is_staff_only_transport(self) -> bool {
        self.facility().staff_only
    }

    /// `isStaffTransportKind`: staff-only elevators plus stairs.
    pub fn is_staff_transport(self) -> bool {
        self.is_staff_only_transport() || self == Kind::Stairs
    }

    pub fn is_walkway(self) -> bool {
        matches!(self, Kind::Stairs | Kind::Escalator)
    }

    /// `WALKWAY_WILLINGNESS`.
    pub fn walkway_willingness(self) -> Option<i64> {
        match self {
            Kind::Stairs => Some(4),
            Kind::Escalator => Some(7),
            _ => None,
        }
    }

    /// `attendanceCap`.
    pub fn attendance_cap(self) -> Option<i64> {
        self.facility().attendance
    }

    /// `isCommercialKind`.
    pub fn is_commercial(self) -> bool {
        matches!(
            self,
            Kind::FastFood
                | Kind::Restaurant
                | Kind::FoodHall
                | Kind::Amusements
                | Kind::BoutiqueBay
                | Kind::Nightclub
                | Kind::Spa
                | Kind::SkyBar
                | Kind::Daycare
                | Kind::Shop
                | Kind::Cinema
        )
    }

    /// `hasBusinessHours`.
    pub fn has_business_hours(self) -> bool {
        self.is_commercial() || matches!(self, Kind::PartyHall | Kind::AquaticCenter)
    }

    /// `isOpenAt`.
    pub fn is_open_at(self, hour: i64) -> bool {
        match self {
            Kind::FastFood => (7..22).contains(&hour),
            Kind::Restaurant => (11..14).contains(&hour) || (17..23).contains(&hour),
            Kind::FoodHall => (10..22).contains(&hour),
            Kind::Shop => (10..21).contains(&hour),
            Kind::Amusements => (10..24).contains(&hour),
            Kind::Nightclub => !(2..20).contains(&hour),
            Kind::BoutiqueBay => (10..21).contains(&hour),
            Kind::Spa => (9..21).contains(&hour),
            Kind::SkyBar => (16..24).contains(&hour),
            Kind::Daycare => (7..19).contains(&hour),
            Kind::Cinema => (12..24).contains(&hour),
            Kind::PartyHall => (17..24).contains(&hour),
            Kind::AquaticCenter => (8..22).contains(&hour),
            _ => true,
        }
    }

    /// `openHoursPerDay`.
    pub fn open_hours_per_day(self) -> i64 {
        let h = (0..24).filter(|&hr| self.is_open_at(hr)).count() as i64;
        if h == 0 {
            1
        } else {
            h
        }
    }

    /// `isUnmetDemandKind`.
    pub fn is_unmet_demand_kind(self) -> bool {
        matches!(self, Kind::Office | Kind::Condo | Kind::RentalApartment) || self.is_hotel()
    }

    /// `isLeaseAmenityKind`.
    pub fn is_lease_amenity(self) -> bool {
        matches!(self, Kind::FitnessClub | Kind::Clinic)
    }

    /// `hasHousehold`.
    pub fn has_household(self) -> bool {
        matches!(self, Kind::Condo | Kind::RentalApartment)
    }

    pub fn is_staff_kind(self) -> bool {
        matches!(
            self,
            Kind::Security | Kind::Medical | Kind::Housekeeping | Kind::Recycling
        )
    }

    /// The one-way ambient venue pool in `spawnFloors`.
    pub fn is_ambient_venue(self) -> bool {
        matches!(
            self,
            Kind::Shop
                | Kind::Restaurant
                | Kind::FastFood
                | Kind::Amusements
                | Kind::BoutiqueBay
                | Kind::Nightclub
                | Kind::Spa
                | Kind::SkyBar
                | Kind::Daycare
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The canon section of CLAUDE.md, stated as numbers so a "fix" to the
    /// 1994 pooling or caps fails here before it reaches the referee.
    #[test]
    fn canon_caps_and_pools() {
        for (kind, cap) in [
            (Kind::Metro, 1),
            (Kind::WeddingHall, 1),
            (Kind::Security, 10),
            (Kind::Medical, 10),
            (Kind::Cinema, 16),
            (Kind::PartyHall, 16),
            (Kind::AquaticCenter, 8),
        ] {
            assert_eq!(build_cap(kind), Some(cap), "{kind:?}");
        }
        assert_eq!(build_cap(Kind::Office), None);
        // One 24-shaft pool for every elevator kind, express included.
        let shafts = &POOLED_CAPS[0];
        assert_eq!(shafts.cap, 24);
        assert_eq!(
            shafts.kinds,
            &[
                Kind::ElevatorStandard,
                Kind::ElevatorService,
                Kind::ElevatorExpress
            ]
        );
        // A separate 64-link pool for stairs and escalators.
        let links = &POOLED_CAPS[1];
        assert_eq!(links.cap, 64);
        assert_eq!(links.kinds, &[Kind::Stairs, Kind::Escalator]);
        // Eight cars per shaft for every elevator kind, service included.
        for kind in shafts.kinds {
            assert_eq!(kind.max_cars(), 8, "{kind:?}");
        }
        // Spans: standard and service 30 floors, express the whole tower,
        // stairs and escalators a fixed two floors (span 1).
        assert_eq!(Kind::ElevatorStandard.max_span(), 30);
        assert_eq!(Kind::ElevatorService.max_span(), 30);
        assert_eq!(Kind::ElevatorExpress.max_span(), MAX_FLOOR - MIN_FLOOR);
        assert_eq!(Kind::Stairs.max_span(), 1);
        assert_eq!(Kind::Escalator.max_span(), 1);
        assert!(Kind::Stairs.is_fixed_span() && Kind::Escalator.is_fixed_span());
        assert!(!Kind::ElevatorStandard.is_fixed_span());
    }

    #[test]
    fn catalog_order() {
        for (i, f) in FACILITIES.iter().enumerate() {
            assert_eq!(f.kind as usize, i, "{} is out of Kind order", f.name);
        }
    }
}
